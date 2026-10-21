---
'injecute': minor
---

**Extension points with tags: `createTag()` and `collect()`.** A tag names an extension point that modules contribute services to. `const route = createTag('route').of<Route>()`; a module registers `addSingleton(route('orders'), (db) => ordersRoute(db), ['db'])` (the key `'orders:route'`), and the service is checked against `Route` at compile time; the owner depends on `collect(route)` and receives a `Route[]` of every service under the tag, including namespaces (`Orders.orders:route`), in registration order. Services are collected in the container that creates the owner, so isolated forks see their replacements and additions; an `AsyncDIContainer` awaits them. See [Extension points with tags](https://masyaka.github.io/injecute/guide/tags).

`DependencyInfo` (from `getRegistration()`) has a new variant, `{ type: 'collect', tag }`: code that switches over every dependency type should handle it.

Typing: keys built by a tag are `TaggedKey`s. In the service map they are plain strings, and `get()`, `call()`, `createResolver()`, dependency lists and `optional()` accept them. `addSingleton`, `addTransient`, `addInstance` and `addAlias` check what is registered under them against the tag's type. `Factory` has an optional fourth type parameter, the type the factory must produce.
