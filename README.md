# recon

Release control CLI for Node.js packages.

`recon` helps prepare releases from Conventional Commits, calculate the next
SemVer version, update changelogs, create Git tags, push releases, and create
GitHub Releases through the GitHub REST API.

## Install

```sh
npm install --save-dev @licentora/recon
```

## Usage

```sh
npx recon --help
npx recon --version
npx recon init
npx recon publish --dry
npx recon publish --dry-run
npx recon publish
```

`recon publish --dry-run` is an alias for `recon publish --dry`.

## Config

Run `recon init` to create `recon.json`.

`recon.json` stores project release settings, including the GitHub token when
GitHub Release integration is enabled. Because the token is a secret, `recon`
automatically adds `recon.json` to `.gitignore` and `.npmignore`.

```json
{
  "$schema": "https://licentora.com/recon-schema.json",
  "packageManager": "npm",
  "changelog": {
    "types": [
      { "type": "feat", "section": "Features" },
      { "type": "fix", "section": "Bug Fixes" },
      { "type": "perf", "section": "Performance Improvements" },
      { "type": "docs", "hidden": true },
      { "type": "chore", "hidden": true }
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
  }
}
```

## Release Rules

- `feat` commits create a minor release.
- `fix` and `perf` commits create a patch release.
- Breaking commits, including `!` or `BREAKING CHANGE:`, create a major release.
- Hidden changelog types do not appear in `CHANGELOG.md`.

Tags use plain SemVer, for example `1.3.0` or `1.3.0-beta.0`.
Generated changelog release headings include the release version, date, and the
latest releaseable commit link when the Git remote is a GitHub repository.

## GitHub Releases

GitHub Releases use `GITHUB_TOKEN` from `recon.json`.

For fine-grained personal access tokens, grant the target repository
`Contents: Read and write` permission.

If `GITHUB_TOKEN` is empty when `recon publish` starts, `recon` asks whether to
save a token to `recon.json` and continue, or skip GitHub Release for that
publish while still creating and pushing the Git tag.

Release mode:

- `auto`: create a GitHub Release only when token and GitHub remote are valid.
- `true`: fail publish if GitHub Release requirements are missing.
- `false`: skip GitHub Release.
