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

Each registration adds to the container type. A chain of 300 registrations takes about a second to
typecheck; split big containers into [modules](./containers.md#modules), which also keeps each file
readable.

## Supported versions

TypeScript **5.2 and newer** (CI checks 5.2 and the latest release, currently 7.0). The minimum is raised
only in a minor release, announced in the changelog; see [Versioning and support](./versioning.md).

If your `lib` setting predates `Symbol.asyncDispose` (for example `"ES2022"`), the package's type
declarations add it, so `await using` and `dispose()` typecheck anyway.
