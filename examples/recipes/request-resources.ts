import { AsyncLocalStorage } from 'node:async_hooks';
import { DIContainer } from 'injecute';

export const log: string[] = [];

class Transaction {
  #committed = false;
  constructor(readonly id: number) {}
  query(sql: string): void {
    log.push(`tx${this.id}: ${sql}`);
  }
  commit(): void {
    this.#committed = true;
    log.push(`tx${this.id}: commit`);
  }
  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.#committed) log.push(`tx${this.id}: rollback`);
  }
}

class Database {
  #next = 1;
  begin(): Transaction {
    return new Transaction(this.#next++);
  }
}

// #region resources
type Resource = Disposable | AsyncDisposable;

/** What one request owns. Released when the request ends, the last one first. */
export class RequestResources {
  #owned: Resource[] = [];

  add<T extends Resource>(resource: T): T {
    this.#owned.push(resource);
    return resource;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    const owned = this.#owned.reverse();
    this.#owned = [];
    const errors: unknown[] = [];
    for (const resource of owned) {
      try {
        if (Symbol.asyncDispose in resource)
          await resource[Symbol.asyncDispose]();
        else resource[Symbol.dispose]();
      } catch (error) {
        errors.push(error); // release the others before reporting it
      }
    }
    if (errors.length > 0)
      throw new AggregateError(errors, 'Releasing request resources failed');
  }
}

export interface RequestContext {
  readonly traceId: string;
  readonly resources: RequestResources;
}

/** One resource per request: created on first use, released with the request. */
export interface PerRequest<T> {
  current(): T;
}

export function perRequest<T extends Resource>(
  context: { current(): RequestContext | undefined },
  create: () => T,
): PerRequest<T> {
  const values = new WeakMap<RequestContext, T>();
  return {
    current() {
      const request = context.current();
      if (!request)
        throw new Error('No request context: call this inside a request');
      if (!values.has(request))
        values.set(request, request.resources.add(create()));
      return values.get(request)!;
    },
  };
}
// #endregion resources

// #region request-resources
class OrderRepository {
  constructor(private readonly tx: PerRequest<Transaction>) {}
  insert(item: string): void {
    this.tx.current().query(`insert ${item}`);
  }
}

class Payments {
  constructor(private readonly tx: PerRequest<Transaction>) {}
  async charge(amount: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1)); // the gateway call
    this.tx.current().query(`charge ${amount}`); // the same transaction after awaits
  }
}

class Checkout {
  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: Payments,
    private readonly tx: PerRequest<Transaction>,
  ) {}

  async placeOrder(item: string, quantity: number): Promise<void> {
    this.orders.insert(item);
    if (quantity < 1) throw new Error('quantity must be at least 1');
    await this.payments.charge(quantity * 10);
    this.tx.current().commit();
  }
}

const storage = new AsyncLocalStorage<RequestContext>();

// Every service is a singleton, built once. Only the transaction is per request.
const app = new DIContainer()
  .addInstance('context', { current: () => storage.getStore() })
  .addSingleton('db', Database)
  .addSingleton('tx', (context, db) => perRequest(context, () => db.begin()), [
    'context',
    'db',
  ])
  .addSingleton('orders', OrderRepository, ['tx'])
  .addSingleton('payments', Payments, ['tx'])
  .addSingleton('checkout', Checkout, ['orders', 'payments', 'tx']);

// The host owns the request, so it releases what the request created: after the handler, also
// when it throws.
export async function handle(item: string, quantity: number): Promise<void> {
  await using resources = new RequestResources();
  const context = { traceId: crypto.randomUUID(), resources };
  await storage.run(context, () =>
    app.get('checkout').placeOrder(item, quantity),
  );
}
// #endregion request-resources

export { app };
