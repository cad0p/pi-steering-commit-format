# Publishing

**Status: PUBLISHED** as `@cad0p/pi-steering-commit-format` on npm (2026-08-10), version `0.1.0`.

## How releases work

This repo carries the `cad0p/semver-calver-release` workflows (`release.yml`, `validate-package-version.yml`, `validate-release-pr.yml`):

- **Push to `main` with code changes** → hybrid SemVer+CalVer prerelease (`0.1.0-YYYYMMDD.N`), tagged + GitHub prerelease, published to npm with the `next` dist-tag, draft changelog PR on `release/from-v0.1.0` updated.
- **Curated base release** (e.g. `0.1.1`): edit CHANGELOG on `release/from-v0.1.0`, bump `package.json`, merge the draft PR. Floating tags (`v0`, `v0.1`) move on base releases only.
- **Validation**: `validate-package-version` and `validate-release-pr` are required status checks on the `main` ruleset.

## npm publishing mechanics

- **OIDC trusted publishing** (npmjs.com → Access Tokens → GitHub Actions) is configured for `@cad0p/pi-steering-commit-format`: owner `cad0p`, repository `pi-steering-commit-format`, workflow `release.yml`. No npm tokens/secrets needed.
- The `npm-publish` action fetches the OIDC token (`audience=npm`) itself, sets the version from the release tag, runs `npm install` (pnpm on the runner for `prepare: pnpm build` — semver-calver-release v1.2.3+), and publishes `--access public` (`--tag next` for prereleases).
- Depends on `@cad0p/pi-steering` (`peerDependencies`/dev) — registry range `^0.1.0`, no `github:` specs. This package's commit-message format predicates for pi-steering rules.
- `publishConfig.access: public` is set in the manifest.

## Pre-publish trivia

- 0.1.0 was published from the CLI with 2FA web-auth per publish; the release workflows have taken over since.
