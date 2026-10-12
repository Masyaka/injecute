---
title: Coming from NestJS
description: How NestJS's dependency injection maps to injecute — plain classes without legacy decorators or reflect-metadata, wiring checked at compile time, one simple pipeline — and how to move step by step.
---

# Coming from NestJS

NestJS's dependency injection works through your classes: every service is decorated, every module is a
decorated class, and the container reads constructor types from metadata the compiler emits. injecute
takes the opposite approach: your classes stay plain, and the wiring is a list of keys in one place.

## What changes for your code

- **Nothing in your classes.** No `@Injectable()`, `@Inject()` or `@Module()`. Services don't import the
  DI library, so they are tested with `new`, reused outside the app, and unchanged if you ever remove
  injecute: you delete the composition root, not a decorator in every file.
- **No legacy decorators, no `reflect-metadata`.** Nest's injection reads constructor parameter types
  from `emitDecoratorMetadata`, which needs TypeScript's legacy `experimentalDecorators` and
  `reflect-metadata` at runtime. The standard decorators of TypeScript 5 don't emit that metadata, and
  tools that only strip types can't: Node.js's built-in TypeScript support doesn't run decorators at all,
  and esbuild (and so tsx) doesn't emit the metadata. Every tool that compiles your code, for the app,
  the tests and the scripts, has to support legacy decorator metadata. injecute is plain TypeScript:
  `node main.ts`, Bun, Deno, esbuild, or no build step at all.
- **Interfaces without tokens.** Nest injects by runtime class, and an interface has no runtime type, so
  it needs a token and `@Inject(TOKEN)`. In injecute every dependency is a key, and its type comes from
  the registration.
- **Wiring errors at compile time.** A missing provider in Nest is
  `Nest can't resolve dependencies of the OrdersService (?, …)` when the app boots. In injecute, the
  registration doesn't compile, and the error names the missing key.
- **One pipeline to read.** Register, resolve, start, stop, dispose. No module scanning, no
  `forwardRef()`, and no injection scopes that spread: in Nest, a provider that depends on a
  request-scoped one becomes request-scoped itself, up to the controller.

## Before and after

A service that depends on a repository and a payment gateway (an interface), in Nest:

```ts
export const PAYMENTS = Symbol('PAYMENTS');

@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: OrdersRepository,
    @Inject(PAYMENTS) private readonly payments: PaymentGateway, // an interface needs a token
  ) {}
}

@Module({
  imports: [DatabaseModule],
  providers: [
    OrdersService,
    OrdersRepository,
    { provide: PAYMENTS, useClass: StripeGateway },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
```

With injecute, the class has no decorators, and the module is a function:

```ts
export class OrdersService {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly payments: PaymentGateway,
  ) {}
}

export const addOrders = (c: ServiceRegistry<{ db: Database }>) =>
  c
    .addSingleton('repo', OrdersRepository, ['db'])
    .addSingleton('payments', StripeGateway)
    .addSingleton('orders', OrdersService, ['repo', 'payments']);
```

- `ServiceRegistry<{ db: Database }>` replaces `imports`: the module states what it needs, and
  `extend(addOrders)` is a compile error on a container without `db`.
- A `StripeGateway` that doesn't implement `PaymentGateway` is a compile error at the registration.
- Remove `experimentalDecorators` and `emitDecoratorMetadata` from `tsconfig.json`, and
  `import 'reflect-metadata'` from the entry point, once the last decorator is gone.
- To keep a decorator on each class, standard decorators can register classes under typed keys. See
  [Custom registration](../guide/custom-registration.md#services-from-decorators).

## Concepts

| NestJS                                             | injecute                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@Injectable()`                                    | Nothing: register the class                                                                                 |
| `@Module({ providers, imports, exports })`         | A module function over `ServiceRegistry<{ …what it needs }>`, applied with `extend()` or `namespace()`      |
| `{ provide, useClass }`                            | `addSingleton(key, Class, [deps])`                                                                          |
| `{ provide, useValue }`                            | `addInstance(key, value)`                                                                                   |
| `{ provide, useFactory, inject }`                  | `addSingleton(key, factory, [deps])`                                                                        |
| `{ provide, useExisting }`                         | `addAlias(key, target)`                                                                                     |
| `@Inject(TOKEN)`, `@Optional()`                    | The key in the dependency list, `optional(key)`                                                             |
| `Scope.TRANSIENT`                                  | `addTransient()`                                                                                            |
| `Scope.REQUEST`                                    | A [context accessor](../guide/request-context.md) or [one instance per request](../guide/request-state.md)  |
| Dynamic modules, `forRoot(options)`                | A function that returns a module: `const addMailer = (options: MailerOptions) => (c: ServiceRegistry) => …` |
| Multi-providers, `DiscoveryService` for plugins    | An [extension point](../guide/tags.md): `createTag()` and `collect()`                                       |
| `ModuleRef.get()`                                  | A `ServiceProvider` at the entry point; services get their dependencies injected                            |
| `forwardRef()`                                     | A cycle is an error with its path: extract the shared part into its own service                             |
| `onModuleInit()`, `onApplicationBootstrap()`       | [Lifecycle hooks](../guide/startup-shutdown.md) in `lifecycle.init` and `lifecycle.start`, or `startable()` |
| `onModuleDestroy()`, `beforeApplicationShutdown()` | The undo function a hook returns, and the `dispose` of a registration                                       |
| `app.enableShutdownHooks()`                        | `process.once('SIGTERM', () => running.stop())`                                                             |
| `Test.createTestingModule().overrideProvider()`    | `app.fork({ isolated: true }).addInstance(key, fake, { replace: true })`                                    |

## Tests

In Nest, a test compiles a testing module with the overrides:

```ts
const moduleRef = await Test.createTestingModule({ imports: [OrdersModule] })
  .overrideProvider(PAYMENTS)
  .useValue(fakePayments)
  .compile();
const orders = moduleRef.get(OrdersService);
```

In injecute, a test replaces the service in an isolated fork of the app, and everything resolved through
the fork uses the replacement:

```ts
await using test = app
  .fork({ isolated: true })
  .addInstance('payments', fakePayments, { replace: true });
const orders = test.get('orders');
```

## Moving step by step

You don't have to move everything at once. Build an injecute container next to the Nest app, move
services into it module by module, and give them to Nest's controllers by key:

```ts
// container.ts
export const app = new DIContainer()
  .addSingleton('db', () => new Database(process.env.DATABASE_URL!), {
    dispose: (db) => db.close(),
  })
  .extend(addOrders)
  .seal();
```

```ts
// app.module.ts
import { app } from './container';

@Controller('orders')
export class OrdersController {
  constructor(@Inject('orders') private readonly orders: OrdersService) {}

  @Get()
  list() {
    return this.orders.list();
  }
}

@Module({
  controllers: [OrdersController],
  // services that moved to injecute, provided to Nest by key
  providers: [{ provide: 'orders', useFactory: () => app.get('orders') }],
})
export class AppModule implements OnApplicationShutdown {
  onApplicationShutdown() {
    return app.dispose();
  }
}
```

The moved services lose their decorators, and the controllers keep working. When the last provider has
moved, decide whether to keep Nest for HTTP or move the controllers too.

## What Nest gives you that injecute doesn't

Nest is a framework: controllers, guards, pipes, interceptors, OpenAPI generation, microservice
transports. injecute is only the container. Pair it with an HTTP framework ([Express](./express.md),
[Fastify](./fastify.md), [Hono](./hono.md)) and the libraries you choose for validation and API
documentation.
