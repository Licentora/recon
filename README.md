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
6. Whether to create `CHANGELOG.md` from existing Conventional Commit history.

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
- If every detected commit is configured as `hidden: true`, `recon publish`
  only pushes the current Git branch.
- Visible custom types without a SemVer mapping stop the publish with a clear
  error.

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
If a Conventional Commit includes a body or footer, `recon` renders those
details under the related changelog item.

## Publish Flow

`recon publish` first checks the configured changelog types and decides whether
the current commits require a versioned release.

For versioned releases, `recon publish` asks where to publish this release:

- `All`
- `GitHub`
- `npm`

The default follows `publish.targets` from `recon.json`.

For hidden-only commits, such as a `docs:` commit when `docs` is configured with
`hidden: true`, `recon publish` skips this prompt and runs a push-only flow.
Push-only mode does not update `package.json`, write `CHANGELOG.md`, create a
tag, publish to npm, or create a GitHub Release.

For versioned releases, it then:

1. Checks Git repository context, branch, remote, latest tag, and file status.
2. Detects releaseable commits since the latest tag.
3. If releaseable commits exist and unstaged files also exist, asks whether to:
   - use detected commits only; or
   - create an additional commit from selected unstaged files.
     The file picker includes `Select all` for large unstaged file sets.
4. Asks whether to publish the selected targets as a stable release or
   prerelease.
5. Checks selected GitHub Release and npm publish access before mutating files.
6. Updates `package.json` and the package-manager lockfile.
7. Prepends `CHANGELOG.md`.
8. Runs npm package validation when npm is selected.
9. Creates a release commit.
10. Creates a plain SemVer Git tag.
11. Pushes the branch and tag.
12. Publishes to npm when selected.
13. Creates a GitHub Release when selected.

If the current branch has no upstream yet, `recon` uses `git push -u` for the
branch push and then pushes the release tag.

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

Before changing release files, `recon` checks that the token can access the
target repository and that a GitHub Release for the next tag does not already
exist. If the token is present but invalid or under-scoped, `recon` asks for a
replacement token before continuing.

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

If `NPM_TOKEN` is present but invalid or cannot access the registry, `recon`
asks for a replacement token before continuing. After updating local release
files but before committing, `recon` also runs npm publish dry-run validation so
package build or packing errors stop before Git commit, tag, and push.

Stable npm releases use the configured dist-tag, defaulting to `latest`.
Prereleases use the same release/prerelease choice as GitHub Releases. If
`All` is selected and the user chooses `Prerelease`, recon publishes:

- a SemVer prerelease version such as `1.3.0-beta.0`
- a GitHub prerelease
- an npm package using the selected channel as the dist-tag

Default prerelease dist-tags are:

- `alpha`
- `beta`
- `rc`

## Partial Failure Recovery

Git pushes and npm publishes are external operations and cannot always be rolled
back automatically.

If Git commit, tag, and push succeed but GitHub Release creation fails:

1. Fix the GitHub token or repository permissions.
2. Rerun `recon publish`.
3. Confirm recovery for the existing tag.

If Git push succeeds but npm publish fails:

1. Fix the npm token, package access, or npm account requirement.
2. Rerun `recon publish`.
3. Confirm recovery for the existing tag.

Recovery mode is only offered when the current package version matches the
latest plain SemVer tag, the tag points at `HEAD`, and the latest commit is the
release commit for that version. Recovery never bumps version, rewrites
`CHANGELOG.md`, creates a new tag, or pushes Git again.

## Security Notes

- `recon.json` can contain tokens and must stay ignored by Git and npm.
- `recon` does not write tokens to project `.npmrc`.
- npm token usage is isolated to a temporary config file.
- Dry run mode is non-mutating.
- Legacy configs do not automatically enable npm publish.
