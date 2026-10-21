// The error table: every code with its title and hint. Kept apart from errors.ts so that browser
// bundles leave it out: InjecuteError reads hints through ./hints.ts, which browser bundlers swap for
// a version without them (see the "browser" field in package.json, and "Hints in browser bundles"
// in scripts/generate-error-pages.mjs, which writes the Errors page).

/**
 * Every error injecute throws, with a short title and how to fix it. The docs pages under
 * `/errors/<slug>` are generated from this list.
 */
export const errorCodes = {
  INJECUTE_NOT_REGISTERED: {
    title: 'No service is registered under this key',
    hint: 'Register it (addSingleton / addTransient / addInstance) before resolving it, check the key for typos, or pass { optional: true } to get undefined instead.',
  },
  INJECUTE_ALREADY_REGISTERED: {
    title: 'The key is already registered in this container or a parent',
    hint: "Pass { replace: true } to replace the registration, or use another key. In a fork, { replace: true } is needed to override a parent's key too, and the override reaches only services resolved in the fork: services registered in the parent keep the parent's one. To replace it for every service, use fork({ isolated: true }).",
  },
  INJECUTE_CIRCULAR_DEPENDENCY: {
    title: 'Services depend on each other in a cycle',
    hint: 'Break the cycle: extract the shared part into its own service, or resolve one side lazily with a function dependency (() => container.get(key)).',
  },
  INJECUTE_NOTHING_TO_REPLACE: {
    title: 'A registration replaces a key that nothing is registered under',
    hint: 'replace: true replaces a registration of this container or a parent. Nothing has this key, which usually means a registration is missing: a module that was not applied, or a typo in the key. Register the original first, or remove replace: true if this is the first registration.',
  },
  INJECUTE_NO_PREVIOUS_DEFINITION: {
    title: 'A service depends on itself but there is nothing to decorate',
    hint: 'A dependency on the key being registered resolves its previous definition (the replaced one, or the parent one). Register the original service first.',
  },
  INJECUTE_INVALID_FACTORY: {
    title: 'The factory is not a function or class',
    hint: 'Pass a function that creates the service, a class, or use addInstance() for a ready value.',
  },
  INJECUTE_INVALID_DEPENDENCY: {
    title:
      'A dependency is not a key, optional(key), collect(tag) or a function',
    hint: 'Dependencies are service keys, optional(key), collect(tag) with a tag made by createTag(), or functions that return the value.',
  },
  INJECUTE_CLASS_NOT_CONSTRUCTED: {
    title: 'A class was called without new',
    hint: 'Classes compiled to ES5 (Babel for old browsers, TypeScript target: es5) and bound classes cannot be detected. Register them with construct(MyClass).',
  },
  INJECUTE_RESOLUTION_FAILED: {
    title: 'A factory threw (or its promise rejected) while creating a service',
    hint: 'The original error is in `cause`; `path` shows which service needed it.',
  },
  INJECUTE_NOT_A_FUNCTION: {
    title: 'call() was used on a service that is not a function',
    hint: 'Only function services can be called with call(); use get() for other services.',
  },
  INJECUTE_NAMESPACE_CONFLICT: {
    title: 'The namespace name is already used by a service',
    hint: 'Choose another namespace name, or remove the service with that key.',
  },
  INJECUTE_NAMESPACE_RESULT: {
    title: 'A namespace callback returned something other than a new container',
    hint: 'Return the registry the callback received (after adding services), a fork of it, or a new DIContainer.',
  },
  INJECUTE_EXTENSION_RESULT: {
    title:
      'An extension returned a container that is not this one or its child',
    hint: 'A module function must return the registry it received (after adding services) or a fork of it.',
  },
  INJECUTE_SEALED: {
    title: 'The container is sealed',
    hint: 'Register every service before seal(). To add services later (per request, per test), register them in a fork: app.fork().addInstance(...).',
  },
  INJECUTE_DISPOSED: {
    title: 'The container is disposed',
    hint: 'Create a new container (or fork) instead of using one after dispose().',
  },
  INJECUTE_DISPOSE_FAILED: {
    title: 'Some services failed to dispose',
    hint: 'Every other service was still disposed. The failures are in `cause` (an AggregateError).',
  },
  INJECUTE_INVALID_OPTION: {
    title: 'An option is not supported here',
    hint: 'Transient services are not kept by the container, so they cannot have a dispose option. createTag() and createLifecycle() take unique, non-empty names without ":" or "."; startLifecycle() takes a lifecycle made by createLifecycle() and only its stages in "concurrent".',
  },
  INJECUTE_UNKNOWN_EVENT: {
    title: 'Unknown event name',
    hint: 'Supported events: add, replace, reset, get, produce, dispose.',
  },
  INJECUTE_READ_ONLY: {
    title: 'The object is read-only',
    hint: 'Proxy accessors only read services. Register or replace services on the container.',
  },
  INJECUTE_INVALID_HOOK: {
    title: 'A lifecycle hook is not registered correctly',
    hint: 'A key that ends with `:<stage>` is a lifecycle hook. Register it with addSingleton() under `lifecycle.<stage>(name)`, and let it depend on services, never on other hooks: order hooks with stages. Rename a key that is not meant as a hook.',
  },
  INJECUTE_UNDO_FAILED: {
    title: 'A lifecycle hook could not be undone',
    hint: 'Its undo function threw, rejected, or did not finish before the stop signal aborted. The hook is in `path`, the original error in `cause`.',
  },
  INJECUTE_LIFECYCLE_STOPPED: {
    title: 'The lifecycle of this container was stopped',
    hint: 'A lifecycle runs once per container. To start again, create a new container or an isolated fork.',
  },
} as const;
