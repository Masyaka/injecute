---
title: Frameworks
description: How injecute fits into a web framework (the composition root, routes from modules, request context, startup and shutdown, tests), with pages for Express, Fastify, Hono, Next.js, GraphQL and NestJS users.
---

# Frameworks

injecute doesn't replace your framework. The framework handles requests; the container builds the
services behind them, wires them, and releases them when the app stops. Every page in this section
follows the same shape:

1. **One composition root.** The app is built in one chain: configuration, connections, feature
   modules. A missing service is a compile error, not a crash on the first request.
2. **Handlers close over their services.** A module's route factory receives the services it needs, and
   its handlers use them. Handlers never see the container.
3. **Routes come from modules.** The HTTP module declares an [extension point](../guide/tags.md); each
   feature module contributes its routes to it. The HTTP module doesn't import the features.
4. **Request data through a context accessor.** The framework's middleware runs each request in
   `storage.run()`; services read the trace id, tenant or user when they need it. See
   [Request context](../guide/request-context.md).
5. **Listening is a lifecycle hook.** `startLifecycle()` starts the server, and `running.stop()` stops
   accepting requests, waits for open ones, then closes the connections. See
   [Startup and shutdown](../guide/startup-shutdown.md).
6. **Tests use an isolated fork.** Replace the database in a fork, build the server from it and send it
   requests with the framework's own test helper, without listening on a port.

These pages put the framework in the container: routes are services, and the server is a lifecycle
hook. For most apps, keeping the framework out of the core is the better default; see
[Keep the web framework out of the core](../guide/app-structure.md#keep-the-web-framework-out-of-the-core).

Your services import neither the framework nor injecute, so the same modules run under an HTTP server, a
queue worker, a cron job or a CLI.

| Page                              | For                                                                    |
| --------------------------------- | ---------------------------------------------------------------------- |
| [Express](./express.md)           | Express 5 apps                                                         |
| [Fastify](./fastify.md)           | Fastify 5 apps: plugins for HTTP, the container for services           |
| [Hono](./hono.md)                 | Hono on Node.js, Bun, Deno and Cloudflare Workers                      |
| [Next.js](./nextjs.md)            | The App Router: server components, route handlers and server actions   |
| [GraphQL](./graphql.md)           | GraphQL Yoga and Apollo Server, with a DataLoader per request          |
| [Coming from NestJS](./nestjs.md) | Moving from NestJS's dependency injection, all at once or step by step |
