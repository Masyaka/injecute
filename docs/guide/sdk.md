---
title: Building an SDK
description: A platform SDK that other teams install, built on a hidden container. Consumers get a plain object with lazy services, start and stop, plugins that replace, decorate or extend its services, and a test kit.
---

# Building an SDK

A platform team ships an SDK that product teams install: an API client, feature flags, telemetry,
auth. Inside, the SDK is a graph of services with shared clients, background work and resources to
release. injecute wires that graph, and consumers use it through a plain object:

```ts
import { createPlatform } from 'platform-sdk';

await using platform = createPlatform({ service: 'checkout', apiUrl, token });
await platform.start();
platform.flags.isEnabled('one-click');
```

What the SDK gets from the container:

- **Lazy services.** A consumer that only calls the API never creates the telemetry pipeline.
- **Start and stop.** Background work (flag refresh, telemetry flush) starts in stages and stops in
  reverse, and everything is released with one call.
- **Plugins.** Consumers replace, decorate or extend the services the SDK opens to them, with typed
  modules, and the change reaches every service that uses them.
- **A test kit.** A fake transport reaches the whole graph, so consumers test their code against the
  real SDK without a network.
- **Modules for the teams behind the SDK.** Each feature is a module with typed requirements and
  services private to it.

What the consumers get: an object typed by the SDK's own interface. A consumer that doesn't write
plugins never deals with injecute, can use another container or none, and doesn't break when the SDK
changes its wiring.

## The design

| Part                 | What it is                                                      | Public |
| -------------------- | --------------------------------------------------------------- | ------ |
| The contract         | interfaces of the SDK object, its options and its services      | yes    |
| The plugin API       | the services plugins can use, the plugin type, extension points | yes    |
| The modules          | one module per feature, applied as a namespace                  | no     |
| The core             | the SDK's composition root: a new sealed container per call     | no     |
| `createPlatform()`   | builds a core and returns the SDK object                        | yes    |
| `createTestPlatform` | the SDK with fakes, in a testing entry (`platform-sdk/testing`) | yes    |

The whole example is in `examples/sdk/` of the repository: the SDK in
[`platform-sdk.ts`](https://github.com/Masyaka/injecute/blob/main/examples/sdk/platform-sdk.ts) and a
consumer in [`consumer.ts`](https://github.com/Masyaka/injecute/blob/main/examples/sdk/consumer.ts).

## The contract

Write the public types first, as interfaces the SDK owns:

<<< @/../examples/sdk/platform-sdk.ts#contract

- **The SDK object is not a container.** It isn't a `DIContainer`, a `ServiceProvider` or a
  `ProxyAccessor`, so consumers can't resolve or replace services through it. What plugins can do is
  defined by the [plugin API](#plugins).
- **Expose interfaces, not classes.** `flags` is a `FeatureFlags`, not `RemoteFlags`: the SDK can add
  methods to its classes (`refresh()`) without making them public.
- **Options for settings, plugins for services.** A logger or a `fetch` is an option. Replacing or
  wrapping how the SDK works is a plugin.

## The modules and the core

Each feature is a [module](./containers.md#modules) that declares what it needs, applied as a
[namespace](./containers.md#namespaces). Services only the module uses get symbol keys, so they are
[private](./containers.md#private-services) to it:

<<< @/../examples/sdk/platform-sdk.ts#modules

The core is the SDK's composition root:

<<< @/../examples/sdk/platform-sdk.ts#core

- **A new container per call.** Two SDK instances (two tenants, two tests) share nothing. Don't create
  a container at the top of a module.
- **Shared internals at the root.** `transport` and `logger` are used by several modules, so they are
  registered in the root, before the modules that need them. `extend()` and `namespace()` check that
  they are there.
- **Plugins last, then sealed.** Plugins see everything the SDK registered. Nothing registers after
  them, and the sealed type is a single flat object, which is cheaper to typecheck. See
  [Seal the composition root](./typescript.md#seal-the-composition-root).

## The SDK object

`createPlatform()` builds a core and wraps it in the SDK object:

<<< @/../examples/sdk/platform-sdk.ts#create

- **One getter per exposed service.** The object lists what consumers get, with the SDK's types and a
  place for TSDoc. A getter resolves its service on first access, and then returns the cached singleton.
- **`start()` runs the [lifecycle](./startup-shutdown.md).** The flags load and the timers start.
  Services work without it: a consumer that only uses `api` never calls `start()`.
- **`stop()` undoes the hooks in reverse, then disposes.** The last telemetry is flushed before the
  transport is released. Without `start()`, it only disposes. A second call returns the same promise, so
  `await using` and an app's `dispose` can both call it.
- **After `stop()`, services are gone.** A getter throws
  [`INJECUTE_DISPOSED`](../errors/disposed.md) instead of returning a closed client.

### Why not a proxy accessor

[`createProxyAccessor()`](./recipes.md#exposing-a-container-as-a-plain-object) exposes a container as
a plain object without writing getters. It suits an internal object of an app. For an SDK, write the
getters:

- The SDK object also needs `start()`, `stop()` and `[Symbol.asyncDispose]`, and a proxy accessor only
  resolves services.
- The accessor's type is a `ProxyAccessor<…>` from injecute. Without an annotation with your own
  interface, it ends up in the SDK's `.d.ts`.
- Getters show up in the debugger, in `console.log()` and in "go to definition" as ordinary properties.

If the SDK exposes dozens of services, put them on a proxy accessor annotated with your interface
(`platform.services.api`), and keep `start()` and `stop()` on the SDK object.

## Plugins

A plugin is a [module](./containers.md#modules): a function that registers services in the SDK's
container. The SDK declares which services plugins can use, and the extension points they contribute
to:

<<< @/../examples/sdk/platform-sdk.ts#plugin-api

A consumer writes plugins with the same calls as any module:

<<< @/../examples/sdk/consumer.ts#plugins

- **Replace** a service with `replace: true`. The core applies plugins after its own registrations,
  so the API client, the flags and the telemetry buffer use the new transport.
- **Decorate** a service by depending on its own key: `inner` is the previous definition. Plugins
  apply in order, so a later plugin decorates what an earlier one registered.
- **Contribute** to an extension point: the SDK collects every `telemetrySink(…)` with
  [`collect()`](./tags.md), and the sink's type is checked where the plugin registers it.
- **Start and stop with the SDK.** A plugin can register a
  [lifecycle hook](./startup-shutdown.md#writing-a-hook) (`lifecycle.start('name')`), and the SDK's
  `start()` and `stop()` run it with the SDK's own hooks.

What the types check:

- A plugin receives a `ServiceRegistry<PluginServices>`. A dependency on a key outside
  `PluginServices`, such as a module's internal service, is a compile error, and the SDK's
  [private services](./containers.md#private-services) can't be resolved from a plugin at all.
- A registry can register, but not add middlewares, fork or dispose: plugins can't take over the
  SDK's configuration or lifecycle. See [Roles](../concepts/roles.md).
- `replace: true` doesn't check that the new service matches the old one. Annotate the factory's return
  type with the service's interface, as `(inner): Transport => …` does.

What it makes public:

- **`PluginServices`, the plugin type and the tags are public API.** Renaming `transport` or
  changing `Transport` is a breaking change of the SDK. Open only what plugins need; the rest stays
  internal and free to change.
- **The plugin API is typed with injecute.** `PlatformPlugin` uses `ServiceRegistry`, and
  `telemetrySink` is a `Tag`, so the SDK's `.d.ts` refers to injecute there. The SDK re-exports the
  helpers plugins use (`lifecycle`, `optional`): a marker such as `optional(key)` is recognized only by
  the copy of injecute that created it, and the re-export makes plugins use the SDK's copy.

## Tests for consumers

Ship a testing entry with the SDK. It creates the SDK with the fakes as the first plugin:

<<< @/../examples/sdk/platform-sdk.ts#testing

The fake transport reaches the API client, the flags and the telemetry buffer, also the private one,
and the consumer's plugins decorate the fake as they would decorate the real transport. Consumers test
their code against the real SDK:

<<< @/../examples/sdk/consumer.ts#testing

`PlatformFakes` is public API of the testing entry. Keep it small: a fake transport covers the network,
and the SDK's own logic runs as in production.

## Using the SDK

A consumer without a container creates the SDK in its entry point:

<<< @/../examples/sdk/consumer.ts#plain

A consumer that uses injecute registers the SDK as one service, and the parts its own code uses as keys
of its app:

<<< @/../examples/sdk/consumer.ts#in-app

- **The app's services don't depend on the SDK object.** `Checkout` receives `FeatureFlags` and
  `Telemetry`, so its tests pass fakes of two small interfaces.
- **The SDK starts with the app.** The `init` hook starts it before the app's `start` hooks (servers,
  consumers) run. On shutdown, the app's hooks are undone first, then `dispose` stops the SDK after
  everything that depends on it.
- **Tests replace the SDK.** The `testApp()` function in the example above replaces `platform` in an
  [isolated fork](./containers.md#isolated-forks) with `createTestPlatform()`.

## Packaging

```text
platform-sdk/
  src/
    index.ts          createPlatform, the contract and the plugin API: the public API
    testing.ts        createTestPlatform, PlatformFakes
    core.ts           createCore and toPlatform: not exported from the package
    flags/flags.container.ts
    telemetry/telemetry.container.ts
  package.json
```

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./testing": "./lib/testing.js"
  },
  "dependencies": {
    "injecute": "^1.0.0"
  }
}
```

- **A regular dependency, not a peer.** The SDK never shares its container with the app, and plugins
  get injecute's helpers from the SDK, so the app and the SDK may use different versions of injecute,
  and several SDKs may bundle their own copies. A peer dependency is for a library that takes the app's
  container; see [Libraries built on injecute](../concepts/roles.md#libraries-built-on-injecute).
- **Check the public types.** Build the SDK and search its `.d.ts` files for `injecute`: only the
  plugin API should mention it.
- **Size.** In a browser bundle, the container adds about 7 KB gzipped, and the lifecycle about
  2.5 KB more. The package has no runtime dependencies and is tree-shakable.
- **Versioning.** The SDK's semver covers its contract, its plugin API and its testing entry. A change
  to the rest of the wiring is not a breaking change.

## When not to

If the SDK is one client class, a class with a constructor is the simplest SDK: there is no graph to
wire, and nothing for plugins to replace.
