---
title: Extension points with tags
description: Let modules contribute services to an extension point (routes, commands, health checks, plugins) with createTag(), and give the owner all of them as a typed array with collect().
---

# Extension points with tags

Some services are built from contributions of many modules: a router from every module's routes, a CLI
from every module's commands, a health endpoint from every module's checks. The owner shouldn't have to
know its contributors, and contributors shouldn't have to know each other.

A **tag** names such an extension point. Modules register services under it, and the owner depends on
`collect(tag)`: every service under the tag, as a typed array.

## Defining a tag and collecting it

<<< @/../examples/tags.ts#tags

[Open in the playground](../playground?example=tags)

`createTag('route')` creates the tag; `.of<Route>()` gives it the type of its services, so
`collect(route)` resolves to `Route[]`. Export the tag from the module that owns the extension point.

## Contributing

Calling the tag builds a key: `route('list')` is `'list:route'`. Register a contribution under it like
any service, with its own dependencies:

<<< @/../examples/tags.ts#contribute

- **Namespaces are included.** In the namespace `Orders`, the key is `Orders.list:route`, and it is
  collected like the others. Each service is collected once, also by a collector inside a namespace
  (which sees both `list:route` and the root's `Orders.list:route`), and a replacement or decoration
  of `Orders.list:route` in the root is what gets collected.
- **Registration order.** Contributions come in the order they were registered, the root's first.
  Contributions registered after the collector are included too: they are collected when the collector
  is created.
- **Contributions are type-checked.** A key built by the tag carries the tag's type, so `addSingleton`,
  `addTransient` and `addInstance` check the service against it: a factory that doesn't produce a
  `Route` is a compile error at the factory, and its parameters stay typed. An alias under a tag
  (`addAlias(route('start'), route('home'))`) must point to a service of the tag's type. Keys typed by
  hand (`'list:route'`) aren't checked: build them with the tag.
- **The key works for lookups too.** `app.get(route('list'))`, `[route('list')]` in a dependency list
  and `optional(route('list'))` resolve the contribution like its plain key `'list:route'`.
- **Each contribution is a service.** A singleton contribution is created once and shared with anything
  else that resolves it; middlewares, the services graph and error paths (`router → Orders.list:route`)
  see it like any dependency.

## Tests

Contributions are collected in the container that creates the collector. An isolated fork collects its
own replacements and additions; the app is untouched:

<<< @/../examples/tags.ts#testing

## Details

- **Lifetime.** A singleton collector keeps the array it received. A contribution registered after it
  was created (for example in a fork that doesn't re-create it) is not added. An isolated fork
  re-creates it.
- **Async.** In an `AsyncDIContainer`, a contribution may be async: the collector receives the resolved
  services. In a `DIContainer`, an async contribution would arrive as a promise, so the check rejects it;
  type the tag accordingly (`.of<Promise<Route>>()`) if you want promises.
- **Cycles.** A contribution that depends on its collector is a circular dependency, reported with the
  path when the collector is resolved.
- **Introspection.** `getRegistration('router')` lists the dependency as `{ type: 'collect', tag: 'route' }`,
  and `buildServicesGraph()` draws an edge to every contribution.
- **Names.** Tag names are non-empty and contain no `:` or `.`. Keys that don't end with `:<tag>`, like
  `'user:repo'`, are never collected.

## Lifecycle stages are tags

The [lifecycle](./startup-shutdown.md) stages are tags of lifecycle hooks: `lifecycle.start('server')`
is the key `'server:start'`, and `collect(lifecycle.start)` would resolve every start hook. Don't
collect stages yourself: `startLifecycle()` runs the hooks in order and undoes them.

## Tags or a push in `init`?

Use a tag and `collect(tag)`: it is the default for extension points. Two exceptions:

| The owner…                                                                         | Use instead                                                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| keeps a registry that changes at runtime, with an undo (an event bus, a scheduler) | an `init` [lifecycle hook](./startup-shutdown.md) that calls its API and returns the undo |
| has two or three fixed contributors it knows                                       | depend on their keys directly                                                             |
