# Contributing to injecute

Thanks for helping. Bug reports, docs fixes and pull requests are all welcome.

- **Bugs, questions and ideas:** [open an issue](https://github.com/Masyaka/injecute/issues/new/choose).
- **Security issues:** report them privately, see [SECURITY.md](./SECURITY.md).

## Setup

Node.js ≥ 22 (CI also runs 24 and 26). Deno and Bun are only needed for the smoke tests.

```sh
npm ci
npm run check   # format, lint, typecheck, tests, build: what CI runs
```

| Task                                    | Command                                      |
| --------------------------------------- | -------------------------------------------- |
| Tests (watch)                           | `npm run test:watch`                         |
| Docs site with the playground           | `npm run docs:dev`                           |
| Package checks (publint, attw, tarball) | `npm run check:package`                      |
| JSR dry run                             | `npm run check:jsr`                          |
| Node, Deno and Bun smoke tests          | `npm run test:smoke`                         |
| Consumer typecheck on TypeScript 5.2    | `TS_VERSION=5.2 npm run test:types-consumer` |
| Browser tests (no bundler) / docs tests | `npm run test:browser` / `npm run test:docs` |

[AGENTS.md](./AGENTS.md) describes the layout and the conventions; it's written for coding agents and
people alike. [Design principles](./docs/concepts/principles.md) lists the principles injecute is built
on and the tests a new feature has to pass.

## Pull requests

Open pull requests against **`next`** until 1.0.0 is released, then against `main`.

1. The change passes the tests in [Keeping the direction](./docs/concepts/principles.md#keeping-the-direction);
   a change that bends a principle says so and adds it to the Exceptions table.
2. `npm run check` passes.
3. Behaviour changes have runtime tests; type changes have type tests (`tests/types/*.test-d.ts`).
4. Public exports have TSDoc with an `@example`; docs pages and `examples/` are updated.
5. A changeset is added (below).

## Changesets

Every pull request that changes the published package adds a changeset:

```sh
npx changeset
```

Pick the bump type and write the summary for **users**: what changed and what to do about it. The
summaries become `CHANGELOG.md` and the GitHub Release notes. Breaking changes get a one-line
"before → after" and a link to the migration guide section that explains them. Docs, tests and CI-only
pull requests add an empty changeset: `npx changeset --empty`. CI fails a pull request without one.

## Releasing (maintainers)

Releases are automated by [`.github/workflows/release.yml`](./.github/workflows/release.yml):

1. Every push to `next` or `main` with pending changesets updates a **"Version Packages"** pull request
   (version bump in `package.json` and `jsr.json`, `CHANGELOG.md`).
2. Merging it is the release decision. The workflow runs the checks again, then waits for approval in the
   `release` environment.
3. After approval it publishes to npm (trusted publishing with provenance, no tokens) and JSR, pushes the
   git tag, creates the GitHub Release, and smoke-tests the CDNs.

Release candidates: in pre-release mode (`.changeset/pre.json`), versions are `x.y.z-rc.N` and go to the
npm dist-tag `rc`. To leave it, run `npx changeset pre exit` and commit; the next "Version Packages" pull
request is the stable release.

If a version reached npm but the JSR step failed, re-run the workflow: it publishes the missing JSR
version.
