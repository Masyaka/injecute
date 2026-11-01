// The application layer: it declares the context it needs and knows nothing about HTTP or
// AsyncLocalStorage.
import type { ServiceRegistry } from 'injecute';

export const lines: string[] = [];

// #region app
/** What the application needs to know about the current request, job or command. */
export interface RequestContext {
  readonly traceId: string;
  readonly tenantId?: string;
}

/** Reads the current context; `undefined` outside a request (at startup, in timers). */
export interface ContextAccessor<T> {
  current(): T | undefined;
}

class Logger {
  constructor(private readonly context: ContextAccessor<RequestContext>) {}

  info(message: string): void {
    // read the context when it is used, never in the constructor
    const { traceId = '-', tenantId = '-' } = this.context.current() ?? {};
    lines.push(`[${traceId} ${tenantId}] ${message}`);
  }
}

class Orders {
  constructor(
    private readonly logger: Logger,
    private readonly context: ContextAccessor<RequestContext>,
  ) {}

  async place(item: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 1)); // the context survives awaits
    this.logger.info(`order placed: ${item}`);
    return `${this.context.current()?.tenantId ?? 'public'}: ${item}`;
  }
}

// The module requires a `context` service: `extend()` checks that the host registered one.
export const addOrders = (
  c: ServiceRegistry<{ context: ContextAccessor<RequestContext> }>,
) =>
  c
    .addSingleton('logger', Logger, ['context'])
    .addSingleton('orders', Orders, ['logger', 'context']);
// #endregion app
