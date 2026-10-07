---
title: Next.js
description: Use injecute with the Next.js App Router — connections that survive hot reloads, typed services in server components, route handlers and server actions, graceful shutdown, request context, and tests without Next.js.
---

# Next.js

Next.js has no place for services. Apps keep a `globalThis` singleton per client (the pattern Prisma
recommends, repeated for Redis and every SDK), import concrete clients in components, and replace them in
tests with module mocks. With injecute:

- **Connections that survive hot reloads.** One platform container per server process holds the
  connections. Editing a file doesn't open a new pool.
- **Your edits take effect.** The application's services are rebuilt from the new code after every edit,
  on top of the same connections.
- **Typed services everywhere on the server.** Server components, route handlers and server actions
  resolve the same services with `app.get()`, typed from the registrations.
- **A clean shutdown.** The platform closes its connections when the server stops.
- **The same modules outside Next.js.** A queue worker or a cron script uses the application's modules
  with its own entry point.
- **Tests without Next.js.** The services don't import Next.js; tests build them on an isolated fork.

## Two layers: the platform and the app

Next.js evaluates a module again after every edit in development, and can bundle a module more than
once (for example, into `instrumentation.ts` and into the routes). A container created at the top of a
module would open new connections every time. Split it in two:

- the **platform**: configuration and connections, created once per process;
- the **app**: the application's services, a [fork](../guide/containers.md#forks) of the platform. A
  fork shares the platform's singletons, so the services rebuilt after an edit use the same connections.

```ts
// lib/services.ts — no Next.js imports: tests and workers use it too
import { DIContainer, type ServiceRegistry } from 'injecute';

/** Connections and clients: one set per server process. */
export const createPlatform = () =>
  new DIContainer()
    .addInstance('config', loadConfig())
    .addSingleton('db', (config) => new Database(config.databaseUrl), {
      dependencies: ['config'],
      dispose: (db) => db.close(),
    })
    .seal();

const addOrders = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('orders', OrderService, ['db']);

/** The application's services, on top of the platform. */
export const addApp = (c: ServiceRegistry<{ db: Database }>) =>
  c.namespace('Orders', addOrders);
```

```ts
// lib/platform.ts
import { createPlatform } from './services';

type Platform = ReturnType<typeof createPlatform>;
const shared = globalThis as typeof globalThis & { __platform?: Platform };

// Next.js evaluates this module again on every hot reload, and can bundle it more than once
// (instrumentation.ts and the routes): keep one platform per process.
export const platform = (shared.__platform ??= createPlatform());
```

```ts
// lib/app.ts
import 'server-only';
import { platform } from './platform';
import { addApp } from './services';

// Built again from the new code after every edit; the connections stay in the platform.
export const app = platform.fork().extend(addApp).seal();
```

`import 'server-only'` makes importing the app from a Client Component a build error.
Changes to `createPlatform()` itself take effect when the dev server restarts.

## Server components, route handlers and server actions

These are the entry points of a Next.js app: they resolve services, like `main.ts` does elsewhere.
Everything below them gets its dependencies injected, and never imports `app`.

::: code-group

```tsx [app/orders/page.tsx]
import { app } from '@/lib/app';
import { placeOrder } from './actions';

export default async function OrdersPage() {
  const orders = await app.get('Orders.orders').list();
  return (
    <form action={placeOrder}>
      <ul>
        {orders.map((order) => (
          <li key={order.id}>{order.item}</li>
        ))}
      </ul>
      <input name="item" />
    </form>
  );
}
```

```ts [app/orders/actions.ts]
'use server';
import { revalidatePath } from 'next/cache';
import { app } from '@/lib/app';

export async function placeOrder(form: FormData) {
  await app.get('Orders.orders').place(String(form.get('item')));
  revalidatePath('/orders');
}
```

```ts [app/orders/route.ts]
import { app } from '@/lib/app';

export async function GET() {
  return Response.json(await app.get('Orders.orders').list());
}
```

:::

The platform holds Node.js connections: use it from the Node.js runtime (the default for pages, route
handlers and server actions), not from the Edge runtime.

## Shutdown

Start the platform's [lifecycle](../guide/startup-shutdown.md) in `instrumentation.ts`, and stop it on
`SIGTERM`. Next.js handles `SIGTERM` itself and exits the process without waiting for your handlers; set `NEXT_MANUAL_SIG_HANDLE=true` in the
server's environment to handle it yourself:

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startLifecycle } = await import('injecute');
  const { platform } = await import('./lib/platform');

  const running = await startLifecycle(platform);
  // Next.js leaves SIGTERM to you when NEXT_MANUAL_SIG_HANDLE=true
  process.once('SIGTERM', () =>
    running.stop().then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      },
    ),
  );
}
```

Hooks registered in the platform run at startup, for example to check the database connection in
`lifecycle.init`. `running.stop()` undoes them, then disposes the platform and closes the connections.

Run queue consumers and schedulers in a worker process of their own, with the same `lib/services.ts`
and `startLifecycle()`: Next.js can restart or scale its servers at any time, and requests and
background work then don't compete for one process.

## Request context

Pages, route handlers and server actions read the request with `headers()` and `cookies()`. By default,
pass what services need as arguments: `orders.list({ tenantId })`.

When services deeper in the graph need it (a logger with the trace id, a repository filtered by tenant),
use a [context accessor](../guide/request-context.md), and run route handlers and server actions in the
context:

```ts
// lib/context.ts
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';

export const storage = new AsyncLocalStorage<RequestContext>();

/** Runs a route handler or a server action in the request's context. */
export const withContext =
  <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    const h = await headers();
    const context: RequestContext = {
      traceId: h.get('x-request-id') ?? crypto.randomUUID(),
      tenantId: h.get('x-tenant-id') ?? undefined,
    };
    return storage.run(context, () => handler(...args));
  };
```

Register `{ current: () => storage.getStore() }` as `context` in `createPlatform()`, and wrap:
`export const POST = withContext(async (request: Request) => …)`. Server components render their
children outside such a wrapper, so pass arguments there.

## Tests

The services don't import Next.js, so tests build them on an isolated fork of a new platform:

```ts
// lib/services.test.ts
import { expect, it } from 'vitest';
import { addApp, createPlatform } from './services';

it('lists orders', async () => {
  await using test = createPlatform()
    .fork({ isolated: true })
    .addInstance('db', new FakeDatabase(), { replace: true })
    .extend(addApp);

  expect(await test.get('Orders.orders').list()).toEqual([]);
});
```

Keep pages, route handlers and server actions thin: they resolve a service and call it, and the tests
cover the service. See [Testing](../guide/testing.md).
