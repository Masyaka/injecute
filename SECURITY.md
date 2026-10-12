# Security policy

## Supported versions

| Version | Supported                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------- |
| 1.x     | Yes                                                                                             |
| 0.x     | No: upgrade with the [migration guide](https://masyaka.github.io/injecute/migration/0.x-to-1.0) |

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/Masyaka/injecute/security/advisories/new).

Include what an attacker can do, the affected versions, and a minimal reproduction if you have one.
Once a fix is released, the advisory is published with credit to you,
unless you prefer otherwise.

injecute has no runtime dependencies. Releases are published from GitHub Actions with npm trusted
publishing and provenance, so you can check that a version was built from this repository:
`npm audit signatures`.
