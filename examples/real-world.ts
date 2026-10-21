// A small shop backend: the request context lives in AsyncLocalStorage, a logger and a tracer read it,
// and each feature is a module in its own namespace. Two requests run at the same time and never see
// each other's context. The Console tab shows the logs, then each request's trace.
import { AsyncLocalStorage } from 'node:async_hooks';
import { DIContainer, preload, type ServiceRegistry } from 'injecute';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Platform: what every module may use ────────────────────────────────────────────────────────

/** What the application knows about the current request. It owns this shape, not the host. */
interface RequestContext {
  readonly traceId: string;
  readonly userId?: string;
  /** The span the current code runs in; `Tracer.span()` starts a child. */
  readonly spanId?: string;
}

/** Reads the current context, and runs a callback in a derived one. Implemented by the host. */
interface Context<T> {
  current(): T | undefined;
  run<R>(context: T, callback: () => R): R;
}

/** Sequential ids, so the output is the same on every run. */
class Ids {
  private readonly counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}

interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  ms: number;
  error?: string;
}

class Tracer {
  private readonly finished: FinishedSpan[] = [];

  constructor(
    private readonly context: Context<RequestContext>,
    private readonly ids: Ids,
  ) {}

  /** Runs `work` in a child span of the current one; everything it calls sees the new span id. */
  async span<R>(name: string, work: () => Promise<R>): Promise<R> {
    const parent = this.context.current();
    if (!parent) return work(); // outside a request: nothing to trace
    const span = { ...parent, spanId: this.ids.next('span') };
    const start = performance.now();
    let error: string | undefined;
    try {
      return await this.context.run(span, work);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.finished.push({
        traceId: span.traceId,
        spanId: span.spanId,
        parentId: parent.spanId,
        name,
        ms: performance.now() - start,
        error,
      });
    }
  }

  /** The spans of one trace as an indented tree. */
  report(traceId: string): string[] {
    const spans = this.finished.filter((s) => s.traceId === traceId);
    const lines: string[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      for (const s of spans.filter((s) => s.parentId === parentId)) {
        const status = s.error ? `  ✗ ${s.error}` : '';
        lines.push(
          `${'  '.repeat(depth)}${s.name} ${s.ms.toFixed(0)}ms${status}`,
        );
        walk(s.spanId, depth + 1);
      }
    };
    walk(undefined, 1);
    return [`trace ${traceId}`, ...lines];
  }
}

class Logger {
  constructor(
    private readonly context: Context<RequestContext>,
    private readonly scope = 'app',
  ) {}

  /** A logger for one module; it shares the context, so it needs no registration of its own. */
  child(scope: string): Logger {
    return new Logger(this.context, scope);
  }

  info(message: string): void {
    this.write('INFO ', message);
  }

  error(message: string): void {
    this.write('ERROR', message);
  }

  private write(level: string, message: string): void {
    // Read the context on every line, never in the constructor: this logger is a singleton.
    const {
      traceId = '-',
      spanId = '-',
      userId = '-',
    } = this.context.current() ?? {};
    console.log(
      `${level} ${traceId} ${spanId} ${userId} [${this.scope}] ${message}`,
    );
  }
}

// A module declares only the services it needs; `extend()` checks the host provides them.
const addPlatform = (
  c: ServiceRegistry<{ context: Context<RequestContext> }>,
) =>
  c
    .addSingleton('ids', Ids)
    .addSingleton('tracer', Tracer, ['context', 'ids'])
    .addSingleton('logger', Logger, ['context']);

type Platform = { logger: Logger; tracer: Tracer };

// ─── Catalog ────────────────────────────────────────────────────────────────────────────────────

class Products {
  private readonly prices: Record<string, number> = { book: 12, pen: 2 };
  private readonly logger: Logger;

  constructor(
    logger: Logger,
    private readonly tracer: Tracer,
  ) {
    this.logger = logger.child('catalog');
  }

  price(sku: string): Promise<number> {
    return this.tracer.span('catalog.price', async () => {
      await sleep(5); // a database query: the context survives awaits and timers
      const price = this.prices[sku];
      if (price === undefined) throw new Error(`unknown product ${sku}`);
      this.logger.info(`${sku} costs ${price}`);
      return price;
    });
  }
}

const addCatalog = (c: ServiceRegistry<Platform>) =>
  c.addSingleton('products', Products, ['logger', 'tracer']);

// ─── Payments ───────────────────────────────────────────────────────────────────────────────────

class PaymentGateway {
  private readonly logger: Logger;

  constructor(
    logger: Logger,
    private readonly tracer: Tracer,
    private readonly limit: number,
  ) {
    this.logger = logger.child('payments');
  }

  charge(amount: number): Promise<void> {
    return this.tracer.span('payments.charge', async () => {
      await sleep(10);
      if (amount > this.limit) {
        this.logger.error(`declined ${amount}, the limit is ${this.limit}`);
        throw new Error('payment declined');
      }
      this.logger.info(`charged ${amount}`);
    });
  }
}

const addPayments = (c: ServiceRegistry<Platform & { paymentLimit: number }>) =>
  c.addSingleton('gateway', PaymentGateway, [
    'logger',
    'tracer',
    'paymentLimit',
  ]);

// ─── Orders: uses the other two namespaces ──────────────────────────────────────────────────────

class OrderService {
  private readonly logger: Logger;

  constructor(
    logger: Logger,
    private readonly tracer: Tracer,
    private readonly context: Context<RequestContext>,
    private readonly products: Products,
    private readonly payments: PaymentGateway,
  ) {
    this.logger = logger.child('orders');
  }

  place(sku: string, quantity: number): Promise<string> {
    return this.tracer.span('orders.place', async () => {
      const user = this.context.current()?.userId ?? 'guest';
      this.logger.info(`${user} orders ${quantity} × ${sku}`);
      const price = await this.products.price(sku);
      await this.payments.charge(price * quantity);
      this.logger.info('order placed');
      return `${user}: ${quantity} × ${sku}`;
    });
  }
}

const addOrders = (
  c: ServiceRegistry<
    Platform & {
      context: Context<RequestContext>;
      'Catalog.products': Products;
      'Payments.gateway': PaymentGateway;
    }
  >,
) =>
  c.addSingleton('service', OrderService, [
    'logger',
    'tracer',
    'context',
    'Catalog.products',
    'Payments.gateway',
  ]);

// ─── Host: the only code that knows about AsyncLocalStorage ─────────────────────────────────────

const storage = new AsyncLocalStorage<RequestContext>();

export const app = new DIContainer()
  .addInstance('context', {
    current: () => storage.getStore(),
    run: (context, callback) => storage.run(context, callback),
  } satisfies Context<RequestContext>)
  .addInstance('paymentLimit', 50)
  .extend(addPlatform)
  .namespace('Catalog', addCatalog)
  .namespace('Payments', addPayments)
  .namespace('Orders', addOrders)
  .seal();

interface Request {
  path: string;
  headers: Record<string, string | undefined>;
  body: { sku: string; quantity: number };
}

/** An HTTP handler: every request runs in its own context, with a root span. */
export function handle(request: Request): Promise<string> {
  const context: RequestContext = {
    traceId: request.headers['x-trace-id'] ?? app.get('ids').next('trace'),
    userId: request.headers['x-user'],
  };
  return storage.run(context, async () => {
    const logger = app.get('logger').child('http');
    try {
      return await app
        .get('tracer')
        .span(`POST ${request.path}`, () =>
          app
            .get('Orders.service')
            .place(request.body.sku, request.body.quantity),
        );
    } catch (e) {
      logger.error(`500: ${e instanceof Error ? e.message : String(e)}`);
      return 'failed';
    }
  });
}

// Create the singletons at startup, outside any request.
await preload(app);
app.get('logger').info('server started');

// Two requests at the same time: their log lines interleave, their context doesn't.
export const responses = await Promise.all([
  handle({
    path: '/orders',
    headers: { 'x-user': 'alice' },
    body: { sku: 'book', quantity: 1 },
  }),
  handle({
    path: '/orders',
    headers: { 'x-user': 'bob', 'x-trace-id': 'trace-from-gateway' },
    body: { sku: 'book', quantity: 5 },
  }),
]);

export const traces = ['trace-1', 'trace-from-gateway'].map((id) =>
  app.get('tracer').report(id),
);
for (const trace of traces) console.log(trace.join('\n'));

export default app;
