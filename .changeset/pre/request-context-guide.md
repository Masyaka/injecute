---
'injecute': patch
---

**New guides: request context and per-request state.**

- [Request context](https://masyaka.github.io/injecute/guide/request-context): pass request data that services need (trace id, tenant, user) through a context accessor backed by `AsyncLocalStorage`. The host registers it first in the root container, and singletons read it when they use it. Covers Fastify, queue consumers, logging, pitfalls and testing.
- [Per-request state](https://masyaka.github.io/injecute/guide/request-state): patterns to try before a fork per request, each with a tested example:
  - an argument
  - a factory with `using` (a unit of work)
  - one instance per context (caches, DataLoaders)
  - a strategy chosen by the tenant

  It also says when a fork is still the right tool, with a table for choosing.

The docs shipped in the package, the Agent Skill and the `fork()` TSDoc follow the same advice.
