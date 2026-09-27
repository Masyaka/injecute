---
layout: home
hero:
  name: injecute
  text: Dependency injection without decorators
  tagline: Explicit dependency keys, full type inference, forks, modules and dispose. For Node, Deno, Bun and browsers.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Playground
      link: /playground
    - theme: alt
      text: Migrating from 0.x
      link: /migration/0.x-to-1.0
features:
  - title: Typed from the registrations
    details: The container type grows with every registration. `get()` results and factory parameters are inferred; a typo in a dependency key is a compile error with "Did you mean".
  - title: No decorators, no reflection
    details: Your classes and functions stay free of container code. Dependencies are a list of keys next to the registration.
  - title: Scopes that behave
    details: '`fork()` for request scopes, `fork({ isolated: true })` for tests: overrides reach the whole graph and nothing leaks back.'
  - title: Owns what it creates
    details: '`dispose()` and `await using` release singletons in reverse creation order.'
  - title: Errors that say how to fix it
    details: Every error has a stable code, the resolution path and a link to its page.
  - title: Runs everywhere
    details: ESM for Node ≥ 22, Deno, Bun and browsers, from npm, JSR or a CDN. No runtime dependencies.
---
