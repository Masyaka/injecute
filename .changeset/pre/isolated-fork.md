---
'injecute': minor
---

**`fork({ isolated: true })`.** An isolated fork runs and caches every service it resolves, including services registered in its parents. Overriding a dependency in the fork (for example a fake database in a test) therefore reaches the whole graph, while the parent stays untouched. Namespaces are re-created inside the fork, and forks of an isolated fork share its instances. Replaces the removed `flatten()`.
