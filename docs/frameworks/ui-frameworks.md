---
title: React, Vue and Solid
description: When a React, Vue or Solid app needs a container and when imports are enough — one core per widget, request or test, a client-side service graph, components that resolve services through the framework's context, TanStack Query, state management libraries, and what the container leaves to the framework.
---

# React, Vue and Solid

React Context, Vue's `provide`/`inject` and Solid's context pass values down the component tree, and
ES module imports already give an app an explicit, typed graph of its modules. What they don't give is
more than one instance of that graph: the API client, the session and the stores are module-level
singletons, one per page. injecute builds the services behind the UI as a container you can create more
than once, and replace parts of. The framework passes one value down, the core, and components resolve
what they need from it. With injecute:

- **One core per mount or request.** Widgets, micro-frontends, server-rendered requests and tests each
  get their own container (API client, session, query cache), and `dispose()` releases what it opened.
- **A service graph wired in one place.** A session that refreshes tokens, a realtime connection that
  updates the cache, an offline queue: registered with their dependencies, created when first used,
  closed dependents first.
- **Implementations chosen at startup.** A demo mode with an in-memory API, another storage on another
  platform, a fake in a story: the composition root picks one, or an isolated fork replaces it for the
  whole graph.
- **Components resolve services but can't rewire them.** Components get a read-only
  [`ServiceProvider`](../concepts/roles.md) through the framework's context, and resolve typed services
  with `useService()`.
- **The core doesn't import the UI framework.** The same core runs under React, Vue or Solid, and its
  tests need no DOM.

## When to use it

Most single-page apps don't need a container. React with TanStack Query (or Vue Query, Solid Query) and
[MSW](https://mswjs.io) for tests is a complete setup for an app that fetches and shows data: imports
give a typed graph, the `QueryClient` caches server state, and MSW replaces the network in tests
without a seam in the code. A container adds a composition root and a `useService()` hook to that app,
and nothing it needs.

Use injecute when the app needs what imports can't give:

- **More than one instance of its services** on a page or in a process: embedded widgets,
  micro-frontends, tenants side by side, or server rendering with per-request services beyond the
  `QueryClient` (the user's session, the tenant, a logger).
- **A client-side service graph with lifetimes:** a session that refreshes tokens, a WebSocket that
  writes into the query cache, an offline mutation queue; services that depend on each other and are
  opened and closed in order.
- **Implementations chosen at startup:** a demo mode, web and React Native, a fake in a story.
- **One core for several surfaces** (web, mobile, a worker, Node.js scripts), or a backend that already
  uses injecute.

If none of these applies, keep imports and the framework's context. The rest of this page assumes one
does.

This page follows [Keep the web framework out of the core](../guide/app-structure.md#keep-the-web-framework-out-of-the-core),
with the UI in the place of the web layer.

## The core

The core is plain TypeScript: an API client, and stores that hold what the UI shows. A store exposes
`getSnapshot()` and `subscribe()`, the shape React's `useSyncExternalStore` takes. Vue and Solid adapt
to it in a few lines. The examples use a hand-written store to stay free of libraries; for Zustand,
Redux, Jotai or Pinia, see [State management](#state-management).

```ts
// src/core/store.ts
/** A value components can read and subscribe to. */
export interface ExternalStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
```

```ts
// src/core/orders/orders-store.ts: no UI framework, no injecute
import type { ApiClient, Order } from '../api';
import type { ExternalStore } from '../store';

export class OrdersStore implements ExternalStore<readonly Order[]> {
  #orders: readonly Order[] = [];
  #listeners = new Set<() => void>();

  constructor(private readonly api: ApiClient) {}

  getSnapshot = () => this.#orders;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  async load() {
    this.#set(await this.api.get<Order[]>('/orders'));
  }

  async place(item: string) {
    const order = await this.api.post<Order>('/orders', { item });
    this.#set([...this.#orders, order]);
  }

  #set(orders: readonly Order[]) {
    this.#orders = orders;
    for (const listener of this.#listeners) listener();
  }
}
```

```ts
// src/core/container.ts: no UI framework imports
import {
  DIContainer,
  type ContainerServices,
  type ServiceRegistry,
} from 'injecute';
import { ApiClient } from './api';
import { OrdersStore } from './orders/orders-store';

export interface Config {
  apiUrl: string;
}

const addOrders = (c: ServiceRegistry<{ api: ApiClient }>) =>
  c.addSingleton('store', OrdersStore, ['api']);

export const createCore = (config: Config) =>
  new DIContainer()
    .addInstance('config', config)
    .addSingleton('api', (config) => new ApiClient(config.apiUrl), ['config'])
    .namespace('Orders', addOrders)
    .seal();

export type Core = ReturnType<typeof createCore>;
export type CoreServices = ContainerServices<Core>;
```

`createCore()` returns a new container on every call. Don't create the core at the top of a module:
tests, widgets and server rendering each need their own.

## Giving components the services

One file per app connects the core to the framework: the context that carries the services,
`useService()` to resolve one, and `useStore()` to follow a store.

::: code-group

```tsx [React]
// src/ui/services.tsx (React 19)
import { createContext, use, useSyncExternalStore } from 'react';
import type { ServiceProvider } from 'injecute';
import type { CoreServices } from '../core/container';
import type { ExternalStore } from '../core/store';

const Services = createContext<ServiceProvider<CoreServices> | null>(null);

/** Gives the components below it the core's services. */
export const ServicesProvider = Services;

/** Resolves a service of the core. */
export function useService<K extends keyof CoreServices>(key: K) {
  const services = use(Services);
  if (!services)
    throw new Error('useService() is used outside <ServicesProvider>');
  return services.get(key);
}

/** Re-renders the component when the store changes. */
export function useStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
```

```ts [Vue]
// src/ui/services.ts
import {
  inject,
  onScopeDispose,
  shallowRef,
  type InjectionKey,
  type ShallowRef,
} from 'vue';
import type { ServiceProvider } from 'injecute';
import type { CoreServices } from '../core/container';
import type { ExternalStore } from '../core/store';

export const servicesKey: InjectionKey<ServiceProvider<CoreServices>> =
  Symbol('services');

/** Resolves a service of the core. */
export function useService<K extends keyof CoreServices>(key: K) {
  const services = inject(servicesKey);
  if (!services)
    throw new Error(
      'useService() is used outside an app that provides the services',
    );
  return services.get(key);
}

/** A ref that follows the store. */
export function useStore<T>(store: ExternalStore<T>): Readonly<ShallowRef<T>> {
  const state = shallowRef(store.getSnapshot());
  onScopeDispose(store.subscribe(() => (state.value = store.getSnapshot())));
  return state;
}
```

```ts [Solid]
// src/ui/services.ts
import {
  createContext,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
} from 'solid-js';
import type { ServiceProvider } from 'injecute';
import type { CoreServices } from '../core/container';
import type { ExternalStore } from '../core/store';

const Services = createContext<ServiceProvider<CoreServices>>();

/** Gives the components below it the core's services. */
export const ServicesProvider = Services.Provider;

/** Resolves a service of the core. */
export function useService<K extends keyof CoreServices>(key: K) {
  const services = useContext(Services);
  if (!services)
    throw new Error('useService() is used outside <ServicesProvider>');
  return services.get(key);
}

/** A signal that follows the store. */
export function useStore<T>(store: ExternalStore<T>): Accessor<T> {
  const [state, setState] = createSignal(store.getSnapshot());
  onCleanup(store.subscribe(() => setState(() => store.getSnapshot())));
  return state;
}
```

:::

On React 18, render `<Services.Provider>` and read it with `useContext()`.

`useService('Orders.store')` is typed as `OrdersStore`, and a wrong key is a compile error. The context
holds a `ServiceProvider`, not the container, so components can't register services, fork or dispose.

## Components

Components resolve the services they use and render the store's state:

::: code-group

```tsx [React]
// src/ui/orders-page.tsx
import { useEffect } from 'react';
import { useService, useStore } from './services';

export function OrdersPage() {
  const store = useService('Orders.store');
  const orders = useStore(store);

  useEffect(() => {
    store.load().catch(console.error);
  }, [store]);

  return (
    <ul>
      {orders.map((order) => (
        <li key={order.id}>{order.item}</li>
      ))}
    </ul>
  );
}
```

```vue [Vue]
<!-- src/ui/OrdersPage.vue -->
<script setup lang="ts">
import { onMounted } from 'vue';
import { useService, useStore } from './services';

const store = useService('Orders.store');
const orders = useStore(store);

onMounted(() => store.load().catch(console.error));
</script>

<template>
  <ul>
    <li v-for="order in orders" :key="order.id">{{ order.item }}</li>
  </ul>
</template>
```

```tsx [Solid]
// src/ui/OrdersPage.tsx
import { For, onMount } from 'solid-js';
import { useService, useStore } from './services';

export function OrdersPage() {
  const store = useService('Orders.store');
  const orders = useStore(store);

  onMount(() => store.load().catch(console.error));

  return (
    <ul>
      <For each={orders()}>{(order) => <li>{order.item}</li>}</For>
    </ul>
  );
}
```

:::

## The entry point

The entry point creates the core and gives it to the UI:

::: code-group

```tsx [React]
// src/main.tsx
import { createRoot } from 'react-dom/client';
import { createCore } from './core/container';
import { App } from './ui/app';
import { ServicesProvider } from './ui/services';

const core = createCore({ apiUrl: import.meta.env.VITE_API_URL });

createRoot(document.getElementById('root')!).render(
  <ServicesProvider value={core}>
    <App />
  </ServicesProvider>,
);
```

```ts [Vue]
// src/main.ts
import { createApp } from 'vue';
import { createCore } from './core/container';
import App from './ui/App.vue';
import { servicesKey } from './ui/services';

const core = createCore({ apiUrl: import.meta.env.VITE_API_URL });

createApp(App).provide(servicesKey, core).mount('#app');
```

```tsx [Solid]
// src/index.tsx
import { render } from 'solid-js/web';
import { createCore } from './core/container';
import { App } from './ui/App';
import { ServicesProvider } from './ui/services';

const core = createCore({ apiUrl: import.meta.env.VITE_API_URL });

render(
  () => (
    <ServicesProvider value={core}>
      <App />
    </ServicesProvider>
  ),
  document.getElementById('root')!,
);
```

:::

An app that lives as long as the page doesn't need to dispose its core: the browser releases everything
when the page closes. Dispose it when the UI is removed and the page stays; see
[Widgets](#widgets-one-core-per-mount).

## Tests

Render the component with an isolated fork of the core that replaces a service. The fork creates
everything that depends on it again, on top of the fake:

::: code-group

```tsx [React]
// src/ui/orders-page.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createCore } from '../core/container';
import { OrdersPage } from './orders-page';
import { ServicesProvider } from './services';

afterEach(cleanup);

it('lists the orders', async () => {
  await using core = createCore({ apiUrl: 'http://test' })
    .fork({ isolated: true })
    .addInstance('api', new FakeApi([{ id: '1', item: 'Tea' }]), {
      replace: true,
    });

  render(
    <ServicesProvider value={core}>
      <OrdersPage />
    </ServicesProvider>,
  );

  expect(await screen.findByText('Tea')).toBeTruthy();
});
```

```ts [Vue]
// src/ui/OrdersPage.test.ts
import { cleanup, render, screen } from '@testing-library/vue';
import { afterEach, expect, it } from 'vitest';
import { createCore } from '../core/container';
import OrdersPage from './OrdersPage.vue';
import { servicesKey } from './services';

afterEach(cleanup);

it('lists the orders', async () => {
  await using core = createCore({ apiUrl: 'http://test' })
    .fork({ isolated: true })
    .addInstance('api', new FakeApi([{ id: '1', item: 'Tea' }]), {
      replace: true,
    });

  render(OrdersPage, {
    global: { provide: { [servicesKey as symbol]: core } },
  });

  expect(await screen.findByText('Tea')).toBeTruthy();
});
```

:::

The example replaces the API client to stay short. If your tests mock the network with MSW, keep
doing so, and use a fork for what isn't HTTP: the session, a realtime connection, storage, the clock.

Solid tests do the same with `@solidjs/testing-library`. In Storybook, a decorator wraps each story in a
`ServicesProvider` with such a fork. Test the stores themselves without a component:
`core.get('Orders.store')` on the fork. See [Testing](../guide/testing.md).

## Widgets: one core per mount

A widget embedded in another page, or a micro-frontend, can be mounted more than once and removed while
the page stays. Create a core per mount, and dispose it after the UI is removed:

```tsx
// src/widget.tsx
import { createRoot } from 'react-dom/client';
import { createCore, type Config } from './core/container';
import { OrdersPage } from './ui/orders-page';
import { ServicesProvider } from './ui/services';

/** Mounts the orders widget into `element`. Returns a function that removes it. */
export function mountOrders(element: HTMLElement, config: Config) {
  const core = createCore(config);
  const root = createRoot(element);
  root.render(
    <ServicesProvider value={core}>
      <OrdersPage />
    </ServicesProvider>,
  );

  return async () => {
    root.unmount();
    await core.dispose();
  };
}
```

In Vue, call `core.dispose()` in `app.onUnmount()`; in Solid, after the function `render()` returns.
`dispose()` releases the singletons the core created, dependents first: give a service that opens a
WebSocket or an `EventSource` a `dispose` option or a `[Symbol.dispose]()` method that closes it. See
[Lifecycle and dispose](../guide/lifecycle.md).

## Server-side rendering

On the server, a core created at the top of a module is shared by every request: one user's orders would
render for the next. Create the core per request, and dispose it after rendering:

```tsx
// src/entry-server.tsx
import { renderToString } from 'react-dom/server';
import { createCore, type Config } from './core/container';
import { OrdersPage } from './ui/orders-page';
import { ServicesProvider } from './ui/services';

export async function render(config: Config) {
  // One core per request: its stores hold this user's data only.
  await using core = createCore(config);
  const store = core.get('Orders.store');
  await store.load();

  const html = renderToString(
    <ServicesProvider value={core}>
      <OrdersPage />
    </ServicesProvider>,
  );
  return { html, state: { orders: store.getSnapshot() } };
}
```

Send `state` with the HTML, and give it to the client's stores before hydrating, so both render the same
thing. With TanStack Query, `dehydrate()` and `HydrationBoundary` do this; see
[TanStack Query](#tanstack-query). In Nuxt, SolidStart or a Next.js app, create the core where the
framework creates per-request state, never at the top of a module. For Next.js server code (server
components, route handlers, server actions), see [Next.js](./nextjs.md).

## TanStack Query

With [TanStack Query](https://tanstack.com/query) (React Query, Vue Query, Solid Query), the query cache
holds server state, and replaces stores like `OrdersStore` for data that comes from the API. Keep
`useStore()` for client state. The core owns the `QueryClient`: TanStack Query wants one per app, a new
one per test and per server request, which are the lifetimes of the core.

```ts
// src/core/container.ts
import { QueryClient } from '@tanstack/query-core';

export interface Config {
  apiUrl: string;
  retry?: boolean;
}

export const createCore = (config: Config) =>
  new DIContainer()
    .addInstance('config', config)
    .addSingleton('api', (config) => new ApiClient(config.apiUrl), ['config'])
    .addSingleton(
      'queryClient',
      (config) =>
        new QueryClient({
          defaultOptions: { queries: { retry: config.retry ?? 3 } },
        }),
      { dependencies: ['config'], dispose: (client) => client.clear() },
    )
    .namespace('Orders', addOrders)
    .seal();
```

A service keeps the query keys and functions of a feature together, with its dependencies injected:

```ts
// src/core/orders/orders-queries.ts
import type { QueryClient } from '@tanstack/query-core';
import type { ApiClient, Order } from '../api';

export class OrdersQueries {
  constructor(
    private readonly api: ApiClient,
    private readonly queryClient: QueryClient,
  ) {}

  list() {
    return {
      queryKey: ['orders'] as const,
      queryFn: () => this.api.get<Order[]>('/orders'),
    };
  }

  place() {
    return {
      mutationFn: (item: string) => this.api.post<Order>('/orders', { item }),
      onSuccess: () =>
        this.queryClient.invalidateQueries({ queryKey: ['orders'] }),
    };
  }
}

// src/core/container.ts
const addOrders = (
  c: ServiceRegistry<{ api: ApiClient; queryClient: QueryClient }>,
) => c.addSingleton('queries', OrdersQueries, ['api', 'queryClient']);
```

The UI gives the core's client to TanStack Query, and components pass the options to its hooks:

```tsx
// src/ui/root.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Core } from '../core/container';
import { ServicesProvider } from './services';

export function Root({ core, children }: { core: Core; children: ReactNode }) {
  return (
    <ServicesProvider value={core}>
      <QueryClientProvider client={core.get('queryClient')}>
        {children}
      </QueryClientProvider>
    </ServicesProvider>
  );
}

// src/ui/orders-page.tsx
export function OrdersPage() {
  const queries = useService('Orders.queries');
  const { data: orders = [] } = useQuery(queries.list());
  const place = useMutation(queries.place());
  // …
}
```

`useQuery()` infers `data` as `Order[]` from the plain options. They keep the core free of React; in a
React-only app, wrap them in `queryOptions()` from `@tanstack/react-query` to type `getQueryData()` too.

- **Tests.** An isolated fork creates a new `QueryClient`, so each test starts with an empty cache.
  Create the core with `retry: false` in tests.
- **Server-side rendering.** The core per request brings a `QueryClient` per request. Prefetch with the
  same options, and send the cache to the client:

  ```tsx
  await using core = createCore(config);
  const queryClient = core.get('queryClient');
  await queryClient.prefetchQuery(core.get('Orders.queries').list());
  const state = dehydrate(queryClient);
  // render <HydrationBoundary state={state}> inside <Root core={core}>
  ```

- **Vue and Solid.** Register the `QueryClient` from `@tanstack/vue-query` or `@tanstack/solid-query`:
  they extend the core client for their framework, and the core then imports that package. Give it to
  `app.use(VueQueryPlugin, { queryClient })` or Solid's `<QueryClientProvider client={…}>`. React
  Query's `QueryClient` is the core one.
- **Inject, don't look up.** Don't call `core.get()` inside a `queryFn`: give the service its
  dependencies. The cache belongs to TanStack Query: register the client, not query results.

## State management

A container and a state library do different jobs. The container decides how many stores there are and
what they depend on; the library holds the state and makes it reactive. Register stores, not the values
in them.

| State                                                    | Where it lives                                      | The container's part                         |
| -------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Server data: orders, users                               | The [TanStack Query](#tanstack-query) cache         | Creates the `QueryClient` and the API client |
| Client state: the session, a cart, preferences, a wizard | A store: Zustand, Redux, Jotai, Pinia, MobX, XState | Creates the store and injects its services   |
| The state of one component: open, hovered, an input      | `useState`, `ref`, `createSignal`                   | None                                         |

### A store per core

Create the store in a factory, and register the factory as a singleton of the core. Each core (a
widget, a server request, a test) then has its own store, built on the services of that core:

::: code-group

```ts [Zustand]
// src/core/session-store.ts
import { createStore } from 'zustand/vanilla';
import type { ApiClient, User } from './api';

interface SessionState {
  user: User | null;
  signIn(email: string): Promise<void>;
  signOut(): void;
}

export const createSessionStore = (api: ApiClient) =>
  createStore<SessionState>()((set) => ({
    user: null,
    async signIn(email) {
      set({ user: await api.post<User>('/session', { email }) });
    },
    signOut() {
      set({ user: null });
    },
  }));

// src/core/container.ts
//   .addSingleton('session', createSessionStore, ['api'])

// a component: Zustand's hook takes the store
//   const name = useStore(useService('session'), (s) => s.user?.name);
```

```ts [Redux Toolkit]
// src/core/cart-store.ts
import {
  configureStore,
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import type { ApiClient, Order } from './api';

interface CartItem {
  id: string;
  quantity: number;
}

export const checkout = createAsyncThunk<
  Order,
  void,
  { state: { cart: CartItem[] }; extra: { api: ApiClient } }
>('cart/checkout', (_, { getState, extra }) =>
  extra.api.post<Order>('/orders', { items: getState().cart }),
);

const cart = createSlice({
  name: 'cart',
  initialState: [] as CartItem[],
  reducers: {
    add: (state, action: PayloadAction<string>) => {
      state.push({ id: action.payload, quantity: 1 });
    },
  },
  extraReducers: (builder) => {
    builder.addCase(checkout.fulfilled, () => []);
  },
});
export const { add } = cart.actions;

export const createCartStore = (api: ApiClient) =>
  configureStore({
    reducer: { cart: cart.reducer },
    // Services reach thunks as their extra argument, not through the state
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: { api } } }),
  });

// src/core/container.ts
//   .addSingleton('cart', createCartStore, ['api'])

// the root: <Provider store={core.get('cart')}>…</Provider>
```

```ts [Jotai]
// src/core/session-atoms.ts
import { atom, createStore } from 'jotai/vanilla';
import type { ApiClient, User } from './api';

/** Set once per store, by createAtomStore(). */
export const apiAtom = atom<ApiClient | null>(null);
export const userAtom = atom<User | null>(null);
export const signInAtom = atom(null, async (get, set, email: string) => {
  set(userAtom, await get(apiAtom)!.post<User>('/session', { email }));
});

export const createAtomStore = (api: ApiClient) => {
  const store = createStore();
  store.set(apiAtom, api);
  return store;
};

// src/core/container.ts
//   .addSingleton('atoms', createAtomStore, ['api'])

// the root: <Provider store={core.get('atoms')}>…</Provider>
```

:::

The stores import their library, but no UI framework: `zustand/vanilla`, Redux Toolkit and
`jotai/vanilla` don't import React. A MobX class is registered like any other class, with its
dependencies; an XState actor is created by a factory, with `dispose: (actor) => actor.stop()`.

What you get:

- **Tests start with fresh stores.** Each test's core, or isolated fork, builds the stores again on its
  fakes. No helper resets module-level stores between tests.
- **A store per server request,** so one user's state never renders for the next.
- **A store per widget,** so two widgets on one page don't share a cart.

### Stores the library owns: Pinia

Pinia defines stores once, and creates them per Pinia instance. Create a Pinia per Vue app (and per
server request), and give setup stores the services with `inject()`:

```ts
// src/ui/stores/session.ts
import { defineStore } from 'pinia';
import { inject, ref } from 'vue';
import type { User } from '../../core/api';
import { servicesKey } from '../services';

export const useSessionStore = defineStore('session', () => {
  const api = inject(servicesKey)!.get('api');
  const user = ref<User | null>(null);

  async function signIn(email: string) {
    user.value = await api.post<User>('/session', { email });
  }

  return { user, signIn };
});

// src/main.ts
//   createApp(App).use(createPinia()).provide(servicesKey, core).mount('#app');
```

The store takes the services of the app that uses it, so a test that provides a fork gets a store built
on its fakes. Keep the services in local variables, as `api` is here, not in the returned state.

### Pitfalls

- **Stores at the top of a module.** `create()` from `zustand`, Jotai's default store (atoms used
  without a `Provider`) and a Redux store exported from a module are one per page. Widgets share them,
  tests have to reset them, and in server rendering one request's state renders for the next.
- **Server data copied into a store.** A slice that holds the orders goes stale when TanStack Query
  refetches them. Keep server data in the query cache, and client state in stores.
- **Values registered instead of stores.** `addInstance('currentUser', user)` is cached and never
  changes; a transient isn't reactive either. Register the session store, and read the user from it.
- **Services in the state.** Instances aren't serializable: Redux warns about them, and DevTools,
  persistence and server-rendered state break. Pass them as the thunk's extra argument, or keep them in
  the store's closure.
- **Looking services up in actions.** Don't call `core.get()` in an action, a reducer or an atom: give
  the store its services when the core creates it.
- **The auth cycle.** The API client needs the session's token, and the session store needs the API
  client to sign in: the core throws `INJECUTE_CIRCULAR_DEPENDENCY`. Register a `tokens` service that
  both depend on: the session store writes the token, the API client reads it.
- **Hydration.** In server rendering, the per-request store is filled on the server, and the client's
  store has to start from the same state: Redux's `preloadedState` (pass it to the store's factory),
  `setState()` on a Zustand store, `store.set()` for Jotai atoms, `pinia.state.value` for Pinia.
- **Stores that start work.** Persistence, subscriptions and actors keep running after the UI is gone.
  Give their registration a `dispose` option that stops them.

## What the container leaves to the framework

- **Reactivity.** The container creates and caches instances; it doesn't know about refs, signals or
  re-renders. `useStore()` or a state library's hooks make a store reactive; see
  [State management](#state-management). A store built with the framework's own primitives (Vue's
  `reactive()`, Solid's `createStore()`) works as a service too, but the core then depends on that
  framework.
- **Component state.** Don't create a fork per component for its local state. React's
  `<StrictMode>` mounts components twice in development: a fork disposed in an effect's cleanup is
  disposed when the component mounts again, and the next `get()` throws `INJECUTE_DISPOSED`. Use the
  framework's state, or a store the component creates.
- **Components.** The container doesn't create or render components. Components are the edge of the
  app: they resolve services with `useService()`, and everything below them is injected.
- **Lifetimes per render.** In React, `useService()` runs on every render. A singleton is resolved from
  the cache; a transient would be a new instance each time. Register what components resolve as
  singletons.
