---
title: GraphQL
description: Use injecute with GraphQL Yoga or Apollo Server — a DataLoader per request without a container per request, resolvers that close over typed services, a schema assembled from modules, and tests without a server.
---

# GraphQL

A GraphQL server needs a few things per request (DataLoaders above all) and many things per app
(repositories, clients, the schema). Apps often build a container per request to get the first, or put
every service in the GraphQL context to reach the second. With injecute:

- **A DataLoader per request, without a container per request.** A singleton factory, wired by the
  container, creates the loaders for each request's GraphQL context.
- **Resolvers close over typed services.** The context carries only per-request values; resolvers don't
  call `context.container.get()`.
- **A schema assembled from modules.** Each feature module contributes its types and resolvers to an
  extension point.
- **Tests without a server**, with `yoga.fetch()` on an isolated fork: replace a repository and count
  the queries the loaders batch.

The examples use [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server); see
[Apollo Server](#apollo-server) for the differences.

## The GraphQL module

```ts
// graphql.ts
import DataLoader from 'dataloader';
import { createSchema, createYoga } from 'graphql-yoga';
import { collect, createTag, type ServiceRegistry } from 'injecute';

/** What one request's resolvers share. */
export interface GraphQLContext {
  readonly loaders: Loaders;
}
export interface Loaders {
  readonly user: DataLoader<string, User | undefined>;
}

/** A part of the schema: a module's types and their resolvers. */
export interface SchemaPart {
  readonly typeDefs: string;
  readonly resolvers: Record<string, Record<string, unknown>>;
}
export const schema = createTag('schema').of<SchemaPart>();

export const addGraphQL = (c: ServiceRegistry<{ users: UserRepository }>) =>
  c
    // a singleton factory: new loaders for every request
    .addSingleton(
      'loaders',
      (users) => ({
        create: (): Loaders => ({
          user: new DataLoader((ids) => users.findByIds(ids)),
        }),
      }),
      ['users'],
    )
    .addSingleton(
      'graphql',
      (parts, loaders) =>
        createYoga<{}, GraphQLContext>({
          schema: createSchema<GraphQLContext>({
            typeDefs: ['type Query', ...parts.map((p) => p.typeDefs)],
            resolvers: parts.map((p) => p.resolvers),
          }),
          context: () => ({ loaders: loaders.create() }),
        }),
      [collect(schema), 'loaders'],
    );
```

- `loaders` is the [factory pattern](../guide/request-state.md#a-factory-and-using-a-unit-of-work): a
  singleton with its dependencies from the container, which creates new loaders when Yoga builds a
  request's context. The loaders are garbage-collected with the context.
- `collect(schema)` receives every module's part of the schema, also from namespaces.

## A feature module

A module contributes its types and resolvers. Resolvers close over the module's services, and take
per-request values from the context:

```ts
// orders.ts
import type { ServiceRegistry } from 'injecute';
import { schema, type GraphQLContext, type SchemaPart } from './graphql.ts';

export const addOrders = (c: ServiceRegistry) =>
  c.addSingleton('orders', OrderService).addSingleton(
    schema('orders'),
    (orders): SchemaPart => ({
      typeDefs: /* GraphQL */ `
        type User {
          id: ID!
          name: String!
        }
        type Order {
          id: ID!
          item: String!
          customer: User
        }
        extend type Query {
          orders: [Order!]!
        }
      `,
      resolvers: {
        Query: { orders: () => orders.list() },
        Order: {
          customer: (
            order: Order,
            _args: unknown,
            { loaders }: GraphQLContext,
          ) => loaders.user.load(order.customerId),
        },
      },
    }),
    ['orders'],
  );
```

## The composition root

Yoga is a request handler for Node.js's `http` server (and for Bun, Deno and Workers, like
[Hono](./hono.md)). The server is a [lifecycle hook](../guide/startup-shutdown.md):

```ts
// app.ts
import { once } from 'node:events';
import { createServer } from 'node:http';
import { DIContainer, lifecycle } from 'injecute';
import { addGraphQL } from './graphql.ts';
import { addOrders } from './orders.ts';

export const createApp = () =>
  new DIContainer()
    .addInstance('port', 4000)
    .addSingleton('users', UserRepository)
    .extend(addGraphQL)
    .namespace('Orders', addOrders)
    .addSingleton(
      lifecycle.start('server'),
      async (graphql, port) => {
        const server = createServer(graphql);
        server.listen(port);
        await once(server, 'listening'); // rejects when the port is taken
        return () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
      },
      ['graphql', 'port'],
    )
    .seal();
```

Start it with `const running = await startLifecycle(createApp())`, and stop it with `running.stop()`;
see [Graceful shutdown in Node.js](../guide/startup-shutdown.md#graceful-shutdown-in-node-js).

## Loaders below the resolvers

When a service the resolvers call needs a loader (a `PricingService` that loads products), don't thread
the GraphQL context through it. Run each request in a [request context](../guide/request-context.md),
and keep [one instance per request](../guide/request-state.md#one-instance-per-request) in a singleton:
the service gets the loader for the current request, and stays a singleton.

## Tests

`yoga.fetch()` executes a query without a server. Replace the repository in an isolated fork, and check
that the loader batched the queries:

```ts
// orders.test.ts
import { expect, it } from 'vitest';
import { createApp } from './app.ts';

it('loads the customers of all orders in one query', async () => {
  const users = new CountingUserRepository();
  await using test = createApp()
    .fork({ isolated: true })
    .addInstance('users', users, { replace: true });

  const response = await test.get('graphql').fetch('http://test/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ orders { item customer { name } } }' }),
  });

  expect(response.status).toBe(200);
  expect(users.queries).toBe(1);
});
```

## Apollo Server

With [Apollo Server](https://www.apollographql.com/docs/apollo-server), the same parts and loaders go to
`ApolloServer` and the standalone server's `context`, and the server is the hook:

```ts
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';

c.addSingleton(
  lifecycle.start('graphql'),
  async (parts, loaders, port) => {
    const server = new ApolloServer<GraphQLContext>({
      typeDefs: ['type Query', ...parts.map((p) => p.typeDefs)],
      resolvers: parts.map((p) => p.resolvers),
    });
    await startStandaloneServer(server, {
      listen: { port },
      context: async () => ({ loaders: loaders.create() }),
    });
    return () => server.stop();
  },
  [collect(schema), 'loaders', 'port'],
);
```

With an Express or Fastify integration, register Apollo's middleware in the
[Express](./express.md) or [Fastify](./fastify.md) HTTP module instead, and call `server.stop()` in its
undo.
