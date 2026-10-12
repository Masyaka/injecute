---
'injecute': major
---

**Errors with codes, paths and fixes.** Every error is an `InjecuteError` with a stable `code`, the resolution `path`, a `docs` link and a hint on how to fix it; unknown keys get "did you mean" suggestions. Errors thrown by factories are wrapped as `INJECUTE_RESOLUTION_FAILED` with the original as `cause`. Classes that cannot be detected (ES5-compiled, bound) are reported as `INJECUTE_CLASS_NOT_CONSTRUCTED` with a `construct()` hint, on V8, JavaScriptCore and SpiderMonkey. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#errors-injecuteerror-with-codes)
