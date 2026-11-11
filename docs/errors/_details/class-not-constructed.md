## Why it happens

Native classes are detected and constructed with `new`. Two kinds of classes look like plain functions:

- classes **compiled to ES5** (Babel targeting old browsers, TypeScript `target: es5`, prebuilt ES5
  libraries in `node_modules`);
- **bound** classes (`MyClass.bind(null)`).

The container calls them without `new`, and the engine throws, for example "Class constructor X cannot be
invoked without 'new'" (V8), "Cannot call a class constructor without |new|" (JavaScriptCore) or "Cannot
call a class as a function" (Babel).

## Fix

```ts
import { construct } from 'injecute';

app.addSingleton('client', construct(LegacyClient), ['config']);
```

An ES5 constructor that has no prototype methods and never uses `this` cannot be detected at all: it
resolves to `undefined`. Use `construct()` for it too.
