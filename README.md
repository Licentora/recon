# recon

Release control CLI for Node.js packages.

`recon` prepares releases from Conventional Commits, calculates the next SemVer
version, updates package metadata and changelogs, creates Git tags, pushes to
the configured remote, and can publish release artifacts to GitHub Releases and
npm.

## Install

```sh
npm install --save-dev @licentora/recon
```

## Commands

```sh
npx recon --help
npx recon --version
npx recon init
npx recon init --github
npx recon init -gh
npx recon init --npm
npx recon init -n
npx recon publish --dry
npx recon publish --dry-run
npx recon publish
```

`recon publish --dry-run` is an alias for `recon publish --dry`.

## What recon Manages

`recon init` creates or updates `recon.json`. The file stores project release
settings and, by design, can store `GITHUB_TOKEN` and `NPM_TOKEN`.

Because `recon.json` may contain secrets, `recon init` automatically adds it to:

- `.gitignore`
- `.npmignore`

Do not commit `recon.json`.

## Configuration

Example configuration:

```json
{
  "$schema": "https://licentora.com/recon-schema.json",
  "packageManager": "npm",
  "publish": {
    "targets": ["github", "npm"]
  },
  "changelog": {
    "types": [
      { "type": "feat", "section": "Features" },
      { "type": "fix", "section": "Bug Fixes" },
      { "type": "perf", "section": "Performance Improvements" },
      { "type": "docs", "hidden": true },
      { "type": "chore", "hidden": true },
      { "type": "style", "hidden": true },
      { "type": "test", "hidden": true }
    ]
  },
  "github": {
    "release": {
      "GITHUB_TOKEN": "",
      "enabled": "auto",
      "prerelease": {
        "defaultChannel": "beta",
        "channels": [
          { "name": "alpha", "identifier": "alpha" },
          { "name": "beta", "identifier": "beta" },
          { "name": "rc", "identifier": "rc" }
        ]
      }
    }
  },
  "npm": {
    "publish": {
      "NPM_TOKEN": "",
      "enabled": "auto",
      "registry": "https://registry.npmjs.org/",
      "access": "public",
      "tag": "latest"
    }
  }
}
```

## Publish Targets

`publish.targets` controls the default publish destination prompt.

Supported targets:

- `github`: create a GitHub Release.
- `npm`: publish the package to npm.

When both are configured, `recon publish` defaults to `All`. For older configs
that do not include `publish.targets`, `recon` keeps backward-compatible
behavior by defaulting to GitHub only. npm publish is never enabled silently for
legacy projects.

## Initialization Flow

`recon init` asks:

1. Which package manager the project uses: `npm`, `pnpm`, or `yarn`.
2. Where the project should publish: `All`, `GitHub`, or `npm`.
3. GitHub Release settings when GitHub is selected.
4. npm publish settings when npm is selected.
5. Whether to save the required tokens in `recon.json`.

You can add setup for one target later:

```sh
npx recon init --github
npx recon init --npm
```

These commands update `recon.json` without removing the other target.

## Release Rules

`recon` reads commits using Conventional Commits:

- `feat:` creates a minor release.
- `fix:` and `perf:` create a patch release.
- `type!:` or a `BREAKING CHANGE:` footer creates a major release.
- Hidden changelog types are excluded from `CHANGELOG.md`.

Tags use plain SemVer, for example:

- `1.3.0`
- `1.3.0-beta.0`

No `v` prefix is added.

## Changelog Format

Generated release headings include the version, date, and the latest releaseable
commit when the remote is a GitHub repository:

```md
## [1.3.0] - 2026-05-26 [(abc1234)](https://github.com/owner/repo/commit/abc1234...)
```

Release sections are grouped by visible changelog types from `recon.json`.

## Publish Flow

`recon publish` starts by asking where to publish this release:

- `All`
- `GitHub`
- `npm`

The default follows `publish.targets` from `recon.json`.

Then it:

1. Checks Git repository context, branch, remote, latest tag, and file status.
2. Detects releaseable commits since the latest tag.
3. If releaseable commits exist and unstaged files also exist, asks whether to:
   - use detected commits only; or
   - create an additional commit from selected unstaged files.
4. Asks whether to publish a stable release or prerelease.
5. Updates `package.json` and the package-manager lockfile.
6. Prepends `CHANGELOG.md`.
7. Creates a release commit.
8. Creates a plain SemVer Git tag.
9. Pushes the branch and tag.
10. Publishes to npm when selected.
11. Creates a GitHub Release when selected.

## Dry Run

```sh
npx recon publish --dry
```

Dry run mode does not:

- stage files
- create commits
- update files
- create tags
- push to Git
- publish to npm
- create GitHub Releases

It only prints the detected release plan and changelog preview.

## GitHub Releases

GitHub Releases use `GITHUB_TOKEN` from `recon.json`.

For fine-grained personal access tokens, select the target repository and grant
repository permission:

- `Contents: Read and write`

If `GITHUB_TOKEN` is empty when GitHub is selected during `recon publish`,
`recon` asks whether to save a token to `recon.json` or skip GitHub Release for
that run.

GitHub release modes:

- `auto`: create a GitHub Release only when requirements are satisfied.
- `true`: fail publish if GitHub Release requirements are missing.
- `false`: skip GitHub Release.

## npm Publish

npm publish uses `NPM_TOKEN` from `recon.json`.

An npm automation token is recommended. If `NPM_TOKEN` is empty when npm is
selected during `recon publish`, `recon` asks whether to save a token to
`recon.json` or skip npm publish for that run.

Before mutating release files, `recon` checks npm access with a temporary npm
config file. During publish, the token is written only to that temporary file and
removed after the npm command exits.

Stable npm releases use the configured dist-tag, defaulting to `latest`.
Prereleases use the selected prerelease channel as the dist-tag, for example:

- `alpha`
- `beta`
- `rc`

## Partial Failure Recovery

Git pushes and npm publishes are external operations and cannot always be rolled
back automatically.

If Git commit, tag, and push succeed but GitHub Release creation fails:

1. Fix the GitHub token or repository permissions.
2. Create the GitHub Release from the existing tag.
3. Do not rerun the full publish flow for the same version.

If Git push succeeds but npm publish fails:

1. Fix the npm token, package access, or npm account requirement.
2. Publish the already-bumped package manually with the intended dist-tag.
3. Do not rerun the full publish flow for the same version.

## Security Notes

- `recon.json` can contain tokens and must stay ignored by Git and npm.
- `recon` does not write tokens to project `.npmrc`.
- npm token usage is isolated to a temporary config file.
- Dry run mode is non-mutating.
- Legacy configs do not automatically enable npm publish.
