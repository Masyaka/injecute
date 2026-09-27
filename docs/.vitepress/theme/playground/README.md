# Playground internals

- `../Playground.vue`: the page component (toolbar, editor, graph / trace / console tabs).
- `editor.ts`: Monaco with every `lib/**/*.d.ts` loaded, so the editor's types match the build. The
  JavaScript to run is emitted by Monaco's own TypeScript worker.
- `runner.worker.ts`: runs the emitted code in a fresh Web Worker per run (no DOM access, terminated
  after 3 s). `import … from 'injecute'` is rewritten to the library bundled into the worker. It finds
  the container (default export, `app`, `container`, any exported container, or a `create*()` result),
  resolves every service with a tracing middleware and posts back plain data (`protocol.ts`).
- `services-graph.ts`: the d3 graph. Service keys come from user code, so tooltip HTML escapes them.
- `share.ts`: code in the URL hash (`#code=…`, lz-string), `?example=<name>` loads a file from
  `examples/`.
