---
title: TypeScript
description: How injecute types containers, how to type modules and consumers, what the errors look like, and supported TypeScript versions.
---

# TypeScript

## Types come from the registrations

Every `add*` call returns the container with a bigger type, so `get()` and factory parameters are always
inferred. You rarely write a type by hand.

## Typing consumers and modules

<<< @/../examples/typescript.ts#provider

<<< @/../examples/typescript.ts#registry

<<< @/../examples/typescript.ts#container

A `ServiceProvider` of more services is assignable to one of fewer, so declare only what a function
needs. See [Roles](../concepts/roles.md) for why modules get a `ServiceRegistry` and consumers a
`ServiceProvider`.

## What errors look like

| Mistake                                          | Error                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| a typo in a dependency key                       | `Type '"loger"' is not assignable to type 'Dependency<…>'. Did you mean '"logger"'?`                       |
| a dependency of the wrong type                   | `Argument of type '(l: string) => string' is not assignable to parameter of type 'Factory<["logger"], …>'` |
| constructor arguments in the wrong order         | `Argument of type 'typeof Repo' is not assignable to parameter of type 'Factory<["url", "logger"], …>'`    |
| a factory with parameters but no dependency list | `… is not assignable to parameter of type 'Factory<[], …>'`                                                |
| a module needs a service that is not registered  | `… '{ 'injecute: extension requires services that are not registered': "db"; }'`                           |
| an unknown key in `get()`                        | `Argument of type '"nope"' is not assignable to parameter of type '"url" \| …'`                            |

## Long registration chains

Each registration adds to the container type, and one long chain gets slower to typecheck the longer it
is: 300 `addSingleton` calls in a single chain take about 0.6 s. Split big containers into
[modules](./containers.md#modules) that declare only what they need
(`ServiceRegistry<{ db: Database }>`). A module's registrations are checked against its own small
service map, so the same 300 registrations as 10 modules take about 0.2 s, and each file stays
readable. In the container's type, each module's services are one object, so hovers stay short too.

## Seal the composition root

A container's type is an intersection of every registration (`{ db: … } & { users: … } & …`). Once the
composition root is complete, [`seal()`](./containers.md#sealing-the-composition-root) turns it into
one object type and removes the registration methods:

<<< @/../examples/containers.ts#seal

- **Faster typechecking.** Forks, request scopes and tests built on the sealed root typecheck about
  25% faster, because TypeScript looks services up in one object instead of scanning every
  registration.
- **Readable hovers and errors**: `{ dbUrl: string; db: Database; users: UserRepository }` instead of
  hundreds of `{ key: … } &` members.

### Exporting a container from a package

When a library or shared package exports a container, TypeScript writes its whole service map into
the `.d.ts` file, and writes it again for every exported fork or derived container. Give the map a
name with an interface; TypeScript refers to interfaces by name:

<<< @/../examples/typescript.ts#name-services

Everything built on `container` then refers to `RootServices`: for a 300-service app that also exports
a request scope, the `.d.ts` is about half the size, and forks built on it typecheck as fast as on a
sealed container. Seal it too if nothing should register in it any more:
`const container: SealedDIContainer<RootServices> = root.seal()`.

Namespaces don't multiply the map: it holds each namespaced service once, under its full key
(`Billing.invoices`), and a `Namespace` marker under the namespace name. `get('Billing')` turns the
marker into a `ServiceProvider` of the namespace's services; `NamespaceServices<typeof app, 'Billing'>`
is the same service map as a type.

## Supported versions

TypeScript **5.2 and newer** (CI checks 5.2 and the latest release, currently 7.0). The minimum is raised
only in a minor release, announced in the changelog; see [Versioning and support](./versioning.md).

If your `lib` setting predates `Symbol.asyncDispose` (for example `"ES2022"`), the package's type
declarations add it, so `await using` and `dispose()` typecheck anyway.
