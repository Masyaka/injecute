---
---

Docs: forks for one unit of work are presented as explicit scopes (a session, a request, a transaction, a job): a scope's services may depend on the root's, never the reverse. "Per-request state" is now "Scoped state", with scopes as one option among the patterns, scope modules, decorating a root service in a scope, and a neutral table for choosing.
