# Changelog

## [1.7.0] - 2026-05-27 [(304cbc2)](https://github.com/Licentora/recon/commit/304cbc25080d7fbd343a0c6a064b5793ca1fac13)

### Features

- add preflight checks and recovery flow
  - Validate GitHub Release access before mutating release files
  - Validate npm token, package availability, and package dry-run before commit and push
  - Add recovery mode for incomplete releases from existing release commits and tags
  - Add Git, GitHub, and npm helpers for publish recovery
  - Document preflight and recovery behavior in README

This prevents selected publish targets from failing only after the release commit, tag, and push have already completed.

## [1.6.0] - 2026-05-27 [(f786316)](https://github.com/Licentora/recon/commit/f7863164a96002189d690a14e108a844a99e30fe)

### Features

- enhance publish flow with hidden commit handling and error classification

## [1.5.1] - 2026-05-26 [(e7a1ca5)](https://github.com/Licentora/recon/commit/e7a1ca524e8f75deeae6b991545717a6f76ca7a4)

### Bug Fixes

- update changelog formatting and improve clarity in prompts

## [1.5.0] - 2026-05-26 [(ab07807)](https://github.com/Licentora/recon/commit/ab07807bf6ba576bfa037182776d442a0bad5027)

### Features

- add historical changelog bootstrap
  - Prompt during init to generate CHANGELOG.md from existing Conventional Commit history
  - Add Select all option when staging unstaged files during publish
  - Detect missing branch upstream and use git push -u on first publish
  - Improve remote setup guidance for projects that have not been pushed before
  - Document changelog bootstrap, Select all staging, and first upstream push behavior

## [1.4.3] - 2026-05-26 [(374359c)](https://github.com/Licentora/recon/commit/374359c454efae1ac7f95edf8620ad741f14e0bc)

### Bug Fixes

- improve markdown block formatting and list detection
  - Extract splitMarkdownBlocks function to split detail text by blank lines
  - Rename indentMarkdownBlock to formatDetailBlock with list awareness
  - Refactor formatCommitChangelogEntry to process markdown blocks individually
  - Enhance blank line insertion logic based on block type (list vs. regular)
  - Improve handling of consecutive detail blocks with proper spacing

This refactoring provides more granular control over changelog formatting,
ensuring proper spacing and indentation for different markdown block types
(lists, paragraphs, etc.) while maintaining consistency across commit entries.

## [1.4.2] - 2026-05-26 [(8afe4e8)](https://github.com/Licentora/recon/commit/8afe4e87273ca52145b0f0280c4c588682c868cd)

### Bug Fixes

- improve command execution and error handling
  - Extract runCommandQuiet utility to dedicated command.ts module
  - Update cli.ts to use new command execution utility
  - Refactor git.ts command handling with improved error messages
  - Update npm-publish.ts for better error reporting
  - Enhance package-manager.ts command execution
  - Improve error handling in publish command workflow

  This refactoring centralizes command execution logic and provides
  consistent error handling across the CLI application.

## [1.4.1] - 2026-05-26 [(2878206)](https://github.com/Licentora/recon/commit/2878206613f5f46631a9aba48b1252a9c9a4e295)

### Bug Fixes

- handle markdown list formatting in commit details
  - Add startsWithMarkdownList() to detect markdown list prefixes
  - Only insert blank line when details don't start with lists
  - Improves changelog formatting consistency

## [1.4.0] - 2026-05-26 [(f908964)](https://github.com/Licentora/recon/commit/f908964160a8bac8ed5e159c97dedaec2ceb0923)

### Features

- include commit body and footer in release notes
  - Parse Conventional Commit body and footer alongside the header
  - Render body and footer under each changelog item with Prettier-compatible Markdown spacing
  - Document that changelog generation now includes body and footer details

## [1.3.0] - 2026-05-26 [(b56de84)](https://github.com/Licentora/recon/commit/b56de84e492dcead5b54b815c31c0aa3eeb2169a)

### Features

- add npm publish target support

## [1.2.0] - 2026-05-26 [(7c553ff)](https://github.com/Licentora/recon/commit/7c553ff26f764480e99dcbe47cfe2bac76dafbc5)

### Features

- enhance commit flow with improved handling of unstaged files and commit strategies

## [1.1.0] - 2026-05-26 [(421f808)](https://github.com/Licentora/recon/commit/421f80825d6d2b9c9233a24bf41c401d6ae82a52)

### Features

- enhance GitHub release process with token prompt and changelog commit references

### Bug Fixes

- enhance commit process with message prompt and streamline git commit handling

## [1.0.0] - 2026-05-26 [(be3e8ba)](https://github.com/Licentora/recon/commit/be3e8ba2f4b3489c0f558e9608edb143576f0afc)

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
