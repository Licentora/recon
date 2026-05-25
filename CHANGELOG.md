# Changelog

## [1.2.0] - 2026-05-26 [(7c553ff)](https://github.com/Licentora/recon/commit/7c553ff26f764480e99dcbe47cfe2bac76dafbc5)

### Features

- enhance commit flow with improved handling of unstaged files and commit strategies

## [1.1.0] - 2026-05-26 [(421f808)](https://github.com/Licentora/recon/commit/421f80825d6d2b9c9233a24bf41c401d6ae82a52)

### Features

- enhance GitHub release process with token prompt and changelog commit references

### Bug Fixes

- enhance commit process with message prompt and streamline git commit handling

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-26

### Added

- **`recon init` command** — Interactive setup wizard using `@clack/prompts` that walks users through creating `recon.json` with package manager selection, GitHub release mode, default prerelease channel, and optional `GITHUB_TOKEN` configuration
- **`recon publish` command** — Full automated release workflow that scans commits since the latest tag, determines the next SemVer version, updates `package.json`, updates lockfiles, generates changelog, creates an annotated Git tag, commits the release, pushes to remote, and optionally creates a GitHub Release
- **`recon publish --dry` / `--dry-run`** — Preview mode that displays the next version, detected commits, changelog content, and GitHub Release plan without modifying any files
- **Conventional Commits parsing** — Robust regex-based parser that extracts type, scope, breaking change indicator (`!`), and description from commit messages following the Conventional Commits specification
- **Breaking change detection** — Detects breaking changes via both the `!` syntax in the subject line and `BREAKING CHANGE:` footers
- **SemVer bump engine** — Pure version bump logic supporting `major`, `minor`, and `patch` increments with proper reset rules (e.g., minor resets patch to zero)
- **Prerelease versioning** — Full prerelease support with configurable channels (`alpha`, `beta`, `rc`, or custom), dot-separated identifiers, and monotonic counter increments; stable promotion strips prerelease tags
- **Automatic changelog generation** — Groups parsed commits into organized sections (Features, Bug Fixes, Performance Improvements) with support for hidden types (`docs`, `chore`, `style`, `test`) that are excluded from output
- **Changelog prepending** — Inserts new release notes below the `# Changelog` header while preserving existing history; creates the header if absent
- **GitHub Release creation** — Creates GitHub Releases via the REST API with proper authentication, prerelease marking, and error handling
- **GitHub Release plan resolution** — Three modes: `auto` (skip gracefully if token or remote is missing), `true` (fail hard if requirements unmet), `false` (skip entirely)
- **Remote URL parsing** — Supports HTTPS (`https://github.com/...`), SSH (`git@github.com:...`), and `ssh://` URL formats for GitHub remote detection
- **Git status parsing** — Accurately parses `git status --porcelain` output, correctly separating staged, unstaged, and untracked files with rename and multi-status support
- **Interactive file staging** — During publish, prompts the user to select which unstaged files to include in the release commit
- **Git context gathering** — Retrieves current branch name, default remote name, and latest SemVer tag from the repository
- **Lockfile updates** — Runs the appropriate platform command (`npm install --package-lock-only`, `pnpm install --lockfile-only`, or `yarn install --mode update-lockfile`) to keep lockfiles in sync after version bumps
- **Commit with editor** — Opens the user's default Git editor for the pre-release commit message
- **Annotated Git tags** — Creates annotated tags with the message `Release <version>`
- **Git push** — Pushes both the branch and the new tag to the remote
- **Release file detection** — Automatically includes `package.json`, the detected lockfile, and optionally `CHANGELOG.md` in the release commit
- **Ignore file management** — Automatically adds `recon.json`, `node_modules/`, `dist/`, and `build/` to `.gitignore` and `recon.json` to `.npmignore` during `init`
- **Configuration schema** — Full `ReconConfig` interface with validation for `packageManager`, changelog type mappings, GitHub release settings, and prerelease channel definitions
- **CLI argument parsing** — Typed argument parsing with support for `--help`, `--version`, `init`, `publish`, `--dry` / `--dry-run`, and rejection of unknown flags
- **ASCII art logo** — Branded CLI help output with a project logo
- **TypeScript strict mode** — Full TypeScript strict checks enabled with `ES2022` target, `NodeNext` module resolution, and generated declaration files
- **Prettier CI workflow** — GitHub Actions workflow that checks code formatting on push to `main` and pull requests
- **Comprehensive test suite** — ~50 tests across 11 test files covering CLI parsing, config validation, changelog generation, commit parsing, Git operations, GitHub Release API, SemVer bumping, package manager commands, and ignore file management

[1.0.0]: https://github.com/Licentora/recon/releases/tag/1.0.0
