---
title: Versioning and support
description: What counts as a breaking change, which TypeScript versions and runtimes are supported, and how releases are published.
---

# Versioning and support

injecute follows [semantic versioning](https://semver.org). Breaking changes only happen in a major
version, and each one comes with a before/after entry in a migration guide.

## What the public API is

- Everything exported from `injecute` (the package root), with the behaviour its docs describe.
- The TypeScript types of those exports, following the
  [Semantic Versioning for TypeScript Types](https://www.semver-ts.org) policy: a change that makes
  correct code stop compiling is breaking. Fixing a type so that it rejects code that already failed at
  runtime is a bug fix.
- Error `code` values (`INJECUTE_*`). New codes can be added in minor versions. Error **messages** are
  not part of the API: they get better over time, so branch on `code`.

Not part of the API: anything marked `@internal`, files imported by path (`injecute/lib/…`), and the
exact text of messages and hints.

## Deprecations

A renamed API keeps working under its old name, marked `@deprecated` with the replacement, until the next
major version. Your editor shows the deprecation and the replacement.

## TypeScript

TypeScript **5.2 and newer**, checked in CI against 5.2 and the latest release, and weekly against the
next one. The minimum is raised only in a minor release, announced in the changelog.

## Runtimes

Node.js **22 and newer**, current Deno and Bun, and browsers that support ES2022 modules. Raising the
minimum Node.js version is a breaking change.

## Releases

Every release is published from GitHub Actions to [npm](https://www.npmjs.com/package/injecute) (with
provenance) and [JSR](https://jsr.io/@masyaka/injecute), with notes in the [changelog](../changelog.md)
and on [GitHub Releases](https://github.com/Masyaka/injecute/releases). Release candidates use the npm
dist-tag `rc`: `npm install injecute@rc`.
