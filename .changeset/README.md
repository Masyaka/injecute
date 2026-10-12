# Changesets

Every pull request that changes the published package adds a changeset:

```sh
npx changeset
```

Pick the bump type and write a **user-facing** summary. For breaking changes, include a
one-line "before → after" and link the matching section of `docs/migration/0.x-to-1.0.md`.
Pull requests that only touch docs, tests or CI add an empty changeset: `npx changeset --empty`.

The release workflow turns pending changesets into `CHANGELOG.md` entries and version bumps.
