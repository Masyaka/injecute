# Playground internals

- `../Playground.vue`: the page component (toolbar, editor, graph / trace / console tabs).
- `editor.ts`: Monaco with every `lib/**/*.d.ts` loaded, so the editor's types match the build. The
  JavaScript to run is emitted by Monaco's own TypeScript worker.
- `runner.worker.ts`: runs the emitted code in a fresh Web Worker per run (no DOM access, terminated if
  a run takes over 3 s; the clock starts when the worker posts `ready`, so a slow download doesn't
  count). `import … from 'injecute'` is rewritten to the library bundled into the worker. It finds
  the container (default export, `app`, `container`, any exported container, or a `create*()` result),
  resolves every service with a tracing middleware and posts back plain data (`protocol.ts`).
- `async-hooks.ts`: `AsyncLocalStorage` for the worker (`node:async_hooks` imports are rewritten to it).
  The stores travel with `then()` callbacks and timers; the editor emits ES2016, so `async`/`await` in
  user code compiles to generators driven by `then()`. Native `await` (top-level, and inside the bundled
  library, e.g. async factories) doesn't carry them.
- `services-graph.ts`: the d3 graph. Service keys come from user code, so tooltip HTML escapes them.
- `share.ts`: code in the URL hash (`#code=…`, lz-string), `?example=<name>` loads a file from
  `examples/`.
