// The host: an HTTP server (or a queue worker) that keeps the current context in AsyncLocalStorage.
import { AsyncLocalStorage } from 'node:async_hooks';
import { DIContainer, preload } from 'injecute';
import { addOrders, type ContextAccessor, type RequestContext } from './app.ts';

// #region host
export const storage = new AsyncLocalStorage<RequestContext>();
const context: ContextAccessor<RequestContext> = {
  current: () => storage.getStore(),
};

// The first layer is the context; the application is added on top of it.
export const app = new DIContainer()
  .addInstance('context', context)
  .extend(addOrders);

await preload(app); // create the singletons at startup, outside any request
// #endregion host

interface Request {
  headers: Record<string, string | undefined>;
}

// #region request
export function handle(request: Request): Promise<string> {
  const context: RequestContext = {
    traceId: request.headers['x-trace-id'] ?? crypto.randomUUID(),
    tenantId: request.headers['x-tenant-id'],
  };
  // everything the request calls sees `context`, including code after `await`
  return storage.run(context, () => app.get('orders').place('book'));
}
// #endregion request

// #region job
// A queue consumer provides the same context, so the application code does not change.
export function consume(job: {
  id: string;
  tenantId: string;
  item: string;
}): Promise<string> {
  return storage.run({ traceId: `job-${job.id}`, tenantId: job.tenantId }, () =>
    app.get('orders').place(job.item),
  );
}
// #endregion job
