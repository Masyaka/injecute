---
'injecute': major
---

**Typed namespaces with small declaration files.** `get('Billing')` returns a `ServiceProvider` of the namespace's services (it was an untyped container), also for nested namespaces. In the service map, the namespace name now holds a `Namespace` marker (`AsyncNamespace` for async containers), and each namespaced service is stored once, under its full key. Nested namespaces no longer multiply the container type, so an exported container with three levels of namespaces emits a `.d.ts` about 4× smaller. `ContainerServices<typeof app>['Billing']` → `NamespaceServices<typeof app, 'Billing'>`. New types: `Namespace`, `AsyncNamespace`, `ServiceType<S, K>`, `ServicesInNamespace<S, N>`. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#namespace-types)
