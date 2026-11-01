import { DIContainer } from 'injecute';
import { addOrders, type ContextAccessor, type RequestContext } from './app.ts';

// #region testing
// The application needs no AsyncLocalStorage in tests: give it a fixed context.
const fixed: ContextAccessor<RequestContext> = {
  current: () => ({ traceId: 'test-1', tenantId: 'acme' }),
};
const app = new DIContainer().addInstance('context', fixed).extend(addOrders);

export const placed = await app.get('orders').place('book'); // "acme: book"
// #endregion testing

export { app };
