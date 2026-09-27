---
title: Registering services
description: Lifetimes (singleton, transient, instance), dependency keys, optional dependencies, aliases, decoration and classes.
---

# Registering services

Every registration has a **key**, a **factory** and the **keys it depends on**. Dependencies are passed
to the factory in the same order.

## Lifetimes

<<< @/../examples/registration.ts#lifetimes

[Open in the playground](../playground?example=registration)

| Method                             | Created             | Cached          | Disposed by `dispose()`               |
| ---------------------------------- | ------------------- | --------------- | ------------------------------------- |
| `addSingleton(key, factory, deps)` | on first use        | yes             | yes (see [Lifecycle](./lifecycle.md)) |
| `addTransient(key, factory, deps)` | on every resolution | no              | no                                    |
| `addInstance(key, value)`          | by you              | it is the value | only with `{ dispose: true }`         |

A factory is a function or a class. Classes are detected and called with `new`.

## Dependencies

<<< @/../examples/registration.ts#dependencies

A dependency is one of:

- a **key**: the factory receives that service;
- **`optional(key)`**: the service when it is registered, `undefined` otherwise;
- a **function**: called on every resolution, the factory receives its result.

When you need options, pass an object instead of the array:

```ts
app.addSingleton('mailer', createMailer, {
  dependencies: ['config'],
  replace: true, // replace an existing registration of 'mailer' in this container
  dispose: (mailer) => mailer.close(), // how dispose() releases it
});
```

## Aliases

<<< @/../examples/registration.ts#alias

## Decorating a service

A dependency on the key being registered receives its **previous definition**: the one it replaces in the
same container (with `replace: true`), or the parent's one in a [fork](./containers.md#forks).

<<< @/../examples/registration.ts#decorate

## Classes that cannot be detected

The container recognises native classes (including subclasses, proxied classes and built-ins like `Map`).
Two kinds of classes look like plain functions and cannot be detected:

- classes **compiled to ES5**: Babel for old browsers, TypeScript with `target: es5` (removed in
  TypeScript 7), or prebuilt ES5 libraries;
- **bound** classes (`MyClass.bind(null)`).

Register them with `construct()`, which wraps the class in a factory that calls `new`:

<<< @/../examples/registration.ts#construct

What happens if you forget `construct()`:

| Class                                                  | Without `construct()`                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Babel-compiled (`_classCallCheck`)                     | `INJECUTE_CLASS_NOT_CONSTRUCTED`                                          |
| TypeScript ES5 output that assigns `this.x`            | `INJECUTE_CLASS_NOT_CONSTRUCTED`                                          |
| ES5 class with prototype methods that returns nothing  | `INJECUTE_CLASS_NOT_CONSTRUCTED`                                          |
| Bound class                                            | `INJECUTE_CLASS_NOT_CONSTRUCTED` (on V8, JavaScriptCore and SpiderMonkey) |
| ES5 constructor with no methods that never uses `this` | resolves to `undefined` (cannot be detected)                              |

## Keys

Keys are strings, numbers or symbols. Use symbols for services that should stay private to a module.
Keys containing dots are how [namespaces](./containers.md#namespaces) expose their services
(`Billing.invoices`). Registering the same key twice in one container throws
[`INJECUTE_ALREADY_REGISTERED`](../errors/already-registered.md) unless you pass `replace: true`.
