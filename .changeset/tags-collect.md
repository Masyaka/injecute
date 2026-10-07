---
'injecute': minor
---

**Extension points with tags: `createTag()` and `collect()`.** A tag names an extension point that modules contribute services to. `const route = createTag('route').of<Route>()`; a module registers `addSingleton(route('orders'), (): Route => …)` (the key `'orders:route'`); the owner depends on `collect(route)` and receives a `Route[]` of every service under the tag, including namespaces (`Orders.orders:route`), in registration order. Services are collected in the container that creates the owner, so isolated forks see their replacements and additions; an `AsyncDIContainer` awaits them. See [Extension points with tags](https://masyaka.github.io/injecute/guide/tags).

`DependencyInfo` (from `getRegistration()`) has a new variant, `{ type: 'collect', tag }`: code that switches over every dependency type should handle it.
