## When it happens

`startLifecycle()` checks every lifecycle hook before it runs any of them, and rejects with this code
when one isn't registered correctly. Nothing has run, and the container is left as it is. A key that
ends with `:<stage>` (`:init`, `:start`, `:ready`, or a stage of your own) is a hook:

- **It isn't a singleton:**

  ```text
  "app:ready" ends with ":ready", so it is a lifecycle hook, but it is an instance. Rename it, or register the hook with addSingleton().
  ```

  Register hooks with `addSingleton(lifecycle.ready('probe'), …)`. If the key isn't meant as a hook,
  rename it so it doesn't end with a stage name.

- **It depends on another hook**, directly, through the services it depends on, or by collecting a
  stage:

  ```text
  Lifecycle hook "server:start" depends on the lifecycle hook "schema:init" (through "db"). Hooks depend on services; order them with stages.
  ```

  The hook would run as a dependency, outside the stage order, and its undo function would run in the
  wrong order. Depend on the service instead, and let the stages order the effects: hooks of `init`
  finish before `start` begins.

See [Startup and shutdown](../guide/startup-shutdown.md).
