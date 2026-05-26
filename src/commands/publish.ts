import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  password,
  select,
  text,
} from "@clack/prompts";

import {
  generateReleaseChangelog,
  prependReleaseChangelog,
} from "../changelog/changelog.js";
import type {
  PrereleaseChannel,
  PublishTarget,
  ReconConfig,
} from "../config.js";
import {
  isValidNpmDistTag,
  readReconConfig,
  writeReconConfig,
} from "../config.js";
import {
  buildGithubCommitUrl,
  createGithubRelease,
  hasGithubReleaseForTag,
  parseGitHubRemote,
  preflightGithubReleaseAccess,
  resolveGithubReleaseDryRunPlan,
  resolveGithubReleasePlan,
  resolveGithubTokenFromConfig,
  shouldPromptForGithubToken,
  withGithubReleaseSkipped,
  withGithubReleaseToken,
} from "../github-release.js";
import {
  commitRelease,
  commitWithMessage,
  createReleaseTag,
  getCommitsSinceLatestTag,
  getGitContext,
  getGitStatus,
  getLatestCommitSubject,
  getLatestCommitSummary,
  isTagAtHead,
  pushBranch,
  pushRelease,
  stageFiles,
  stageReleaseFiles,
} from "../git.js";
import {
  parseConventionalCommit,
  type ConventionalCommit,
} from "../release/conventional-commits.js";
import {
  classifyCommitForPublish,
  classifyPublishFlow,
} from "../release/publish-flow.js";
import {
  type ReleaseSelection,
  resolveNextVersion,
} from "../release/release-selection.js";
import { getReleaseFilePaths, updateLockfile } from "../package-manager.js";
import {
  isNpmPackageVersionPublished,
  preflightNpmPackage,
  preflightNpmPublish,
  publishToNpm,
  resolveNpmPublishPlan,
  resolveNpmTokenFromConfig,
  shouldPromptForNpmToken,
  withNpmPublishSkipped,
  withNpmPublishToken,
} from "../npm-publish.js";
import {
  readPackageName,
  readPackageVersion,
  updatePackageJsonFileVersion,
} from "../package-json.js";
import { ensureReconConfigIgnored, isGitTracked } from "../ignore-files.js";

interface RunPublishOptions {
  cwd: string;
  dryRun: boolean;
}

type ReleaseCommit = ConventionalCommit & {
  sha: string;
  shortSha: string;
  url: string | null;
};

type PublishTargetChoice = "all" | PublishTarget;

export async function runPublish({
  cwd,
  dryRun,
}: RunPublishOptions): Promise<void> {
  intro(dryRun ? "recon publish --dry" : "recon publish");

  let config = await readReconConfig(cwd);
  const gitContext = getGitContext(cwd);
  const githubRepository = parseGitHubRemote(gitContext.remote.url);
  const status = getGitStatus(cwd);

  note(
    [
      `Branch: ${gitContext.branch}`,
      `Upstream: ${gitContext.upstream ?? "none"}`,
      `Remote: ${gitContext.remote.name} (${gitContext.remote.url})`,
      `Latest tag: ${gitContext.latestTag ?? "none"}`,
      `Staged files: ${status.staged.length}`,
      `Unstaged files: ${status.unstaged.length}`,
    ].join("\n"),
    "Git status",
  );

  let commits = getReleaseCommits(cwd, githubRepository);
  note(formatDetectedCommits(commits, config), "Detected commits");

  const initialFlow = classifyPublishFlow(commits, config);

  if (initialFlow.kind === "error") {
    throw new Error(initialFlow.reason);
  }

  if (!dryRun) {
    const commitFlow = await prepareCommitFlow(cwd, status, commits, config);

    if (!commitFlow.shouldContinue) return;

    if (commitFlow.shouldReloadCommits) {
      commits = getReleaseCommits(cwd, githubRepository);
      note(formatDetectedCommits(commits, config), "Detected commits");
    }
  }

  const publishFlow = classifyPublishFlow(commits, config);

  if (publishFlow.kind === "error") {
    throw new Error(publishFlow.reason);
  }

  if (publishFlow.kind === "push-only") {
    runPushOnlyFlow({
      cwd,
      dryRun,
      gitContext,
      commits,
    });
    return;
  }

  if (publishFlow.kind === "none") {
    const didRecover = await maybeRunRecoveryFlow({
      cwd,
      dryRun,
      config,
      gitContext,
      githubRepository,
      status,
      reason: publishFlow.reason,
    });

    if (didRecover) return;

    outro(publishFlow.reason);
    return;
  }

  const selectedTargets = await promptPublishTargets(config.publish.targets);

  if (selectedTargets === null) return;

  config = applySelectedPublishTargets(config, selectedTargets);

  const configAfterGithubTokenPrompt = await promptMissingGithubToken(
    cwd,
    config,
    dryRun,
  );

  if (configAfterGithubTokenPrompt === null) return;

  config = configAfterGithubTokenPrompt;

  const configAfterNpmTokenPrompt = await promptMissingNpmToken(
    cwd,
    config,
    dryRun,
  );

  if (configAfterNpmTokenPrompt === null) return;

  config = configAfterNpmTokenPrompt;

  const currentVersion = await readPackageVersion(cwd);
  const releaseType = publishFlow.releaseType;
  let githubRelease = config.github.release;
  let githubToken = resolveGithubTokenFromConfig(githubRelease);
  const commitReference = getChangelogCommitReference(commits, config);
  const defaultPrereleaseChannel = getDefaultPrereleaseChannel(config);
  const stablePreview = resolveNextVersion(currentVersion, releaseType, {
    kind: "stable",
  });
  const prereleasePreview = resolveNextVersion(currentVersion, releaseType, {
    kind: "prerelease",
    channel: defaultPrereleaseChannel,
  });

  if (dryRun) {
    const githubDryRunPlan = resolveGithubReleaseDryRunPlan(githubRelease, {
      token: githubToken,
      repository: githubRepository,
    });
    const npmToken = resolveNpmTokenFromConfig(config.npm.publish);
    const npmPlan = resolveNpmPublishPlan(config.npm.publish, {
      token: npmToken,
    });
    const changelogPreview = generateReleaseChangelog({
      version: stablePreview.version,
      date: formatDate(new Date()),
      commits,
      config,
      commitReference,
    });

    note(
      [
        `Current version: ${currentVersion}`,
        `Release type: ${releaseType}`,
        `Selected targets: ${formatPublishTargets(config.publish.targets)}`,
        `Stable preview: ${stablePreview.version}`,
        `Prerelease preview: ${prereleasePreview.version}`,
        `Prerelease channel: ${defaultPrereleaseChannel.name}`,
        `GitHub Release: ${formatGithubDryRunPlan(githubDryRunPlan)}`,
        `npm publish: ${formatNpmPublishPlan(npmPlan)}`,
        "Preflight: skipped in dry run",
      ].join("\n"),
      "Dry run",
    );
    note(
      changelogPreview || `Release ${stablePreview.version}\n`,
      "CHANGELOG.md preview",
    );
    outro("Dry run complete. No files changed.");
    return;
  }

  const selection = await promptReleaseSelection(
    config,
    stablePreview.version,
    prereleasePreview.version,
  );

  if (selection === null) return;

  const resolvedVersion = resolveNextVersion(
    currentVersion,
    releaseType,
    selection,
  );
  const nextVersion = resolvedVersion.version;
  const tag = nextVersion;
  const releaseContent = generateReleaseChangelog({
    version: nextVersion,
    date: formatDate(new Date()),
    commits,
    config,
    commitReference,
  });

  const githubPlan = resolveGithubReleasePlan(githubRelease, {
    token: githubToken,
    repository: githubRepository,
  });
  const npmToken = resolveNpmTokenFromConfig(config.npm.publish);
  const npmPlan = resolveNpmPublishPlan(config.npm.publish, {
    token: npmToken,
  });
  const npmDistTag =
    npmPlan.action === "publish" ? resolveNpmDistTag(config, selection) : null;

  if (githubPlan.action === "error") {
    throw new Error(githubPlan.reason);
  }

  if (npmPlan.action === "error") {
    throw new Error(npmPlan.reason);
  }

  if (githubPlan.action === "skip") {
    note(githubPlan.reason, "GitHub Release skipped");
  }

  if (npmPlan.action === "skip") {
    note(npmPlan.reason, "npm publish skipped");
  }

  let npmPackageName: string | null = null;

  if (githubPlan.action === "create") {
    if (githubToken === null || githubRepository === null) {
      throw new Error("GitHub Release requirements were not resolved.");
    }

    config = await ensureGithubReleaseAccess({
      cwd,
      config,
      repository: githubRepository,
      tag,
    });
    githubRelease = config.github.release;
    githubToken = resolveGithubTokenFromConfig(githubRelease);
  }

  if (npmPlan.action === "publish" && npmDistTag !== null) {
    npmPackageName = await readPackageName(cwd);
    config = await ensureNpmPublishAccess({
      cwd,
      config,
      distTag: npmDistTag,
      packageName: npmPackageName,
      version: nextVersion,
    });
  }

  note(
    formatReleaseModeSummary(config, selection, nextVersion, {
      githubAction: githubPlan.action,
      npmAction: npmPlan.action,
      npmDistTag,
      isPrerelease: resolvedVersion.isPrerelease,
    }),
    "Release mode",
  );

  if (npmPlan.action === "publish" && npmDistTag !== null) {
    note(
      [
        `Package: ${npmPackageName}`,
        `Version: ${nextVersion}`,
        `Registry: ${config.npm.publish.registry}`,
        `dist-tag: ${npmDistTag}`,
        "Status: access verified",
      ].join("\n"),
      "npm publish access",
    );
  }

  await updatePackageJsonFileVersion(cwd, nextVersion);

  try {
    updateLockfile(cwd, config.packageManager);
  } catch (error) {
    throw new Error(
      [
        formatErrorMessage(error),
        `package.json was already updated to ${nextVersion}.`,
        "Release commit, tag, push, npm publish, and GitHub Release were not created yet.",
        "Fix the package manager error, then rerun `recon publish` or restore package.json before retrying.",
      ].join("\n"),
    );
  }

  const hasVisibleChangelog = releaseContent.length > 0;

  if (hasVisibleChangelog) {
    const changelogPath = join(cwd, "CHANGELOG.md");
    const currentChangelog = await readOptionalTextFile(changelogPath);
    await writeFile(
      changelogPath,
      prependReleaseChangelog(currentChangelog, releaseContent),
    );
  }

  const releaseFiles = getReleaseFilePaths(
    cwd,
    config.packageManager,
    hasVisibleChangelog,
  );

  note(
    [
      `Version: ${currentVersion} -> ${nextVersion}`,
      `Lockfile: updated for ${config.packageManager}`,
      `CHANGELOG.md: ${hasVisibleChangelog ? "updated" : "skipped"}`,
      `Release files: ${releaseFiles.join(", ")}`,
    ].join("\n"),
    "Prepared release",
  );

  if (npmPlan.action === "publish" && npmDistTag !== null) {
    try {
      await preflightNpmPackage({
        cwd,
        config: config.npm.publish,
        distTag: npmDistTag,
      });
    } catch (error) {
      throw new Error(
        [
          formatErrorMessage(error),
          `package.json was already updated to ${nextVersion}.`,
          "Release commit, tag, push, npm publish, and GitHub Release were not created yet.",
          "Fix the npm package validation error, then rerun `recon publish` or restore the release file changes before retrying.",
        ].join("\n"),
      );
    }

    note(
      [
        `Package: ${npmPackageName ?? "unknown"}`,
        `Version: ${nextVersion}`,
        `dist-tag: ${npmDistTag}`,
        "Status: dry run passed",
      ].join("\n"),
      "npm package validation",
    );
  }

  try {
    stageReleaseFiles(cwd, releaseFiles);
    commitRelease(cwd, nextVersion);
  } catch (error) {
    throw new Error(
      [
        formatErrorMessage(error),
        "Release files may already be staged, but the release commit was not created.",
        "Fix the Git commit error, then rerun `recon publish` or restore the release file changes before retrying.",
      ].join("\n"),
    );
  }

  const releaseCommitSummary = getLatestCommitSummary(cwd);

  note(releaseCommitSummary, "Release commit");

  try {
    createReleaseTag(cwd, nextVersion);
  } catch (error) {
    throw new Error(
      [
        formatErrorMessage(error),
        `Release commit was already created: ${releaseCommitSummary}.`,
        "Fix the Git tag error, then create the tag manually or remove the release commit before retrying.",
      ].join("\n"),
    );
  }

  try {
    if (gitContext.upstream === null) {
      note(
        [
          `Branch: ${gitContext.branch}`,
          `Remote: ${gitContext.remote.name} (${gitContext.remote.url})`,
          `Command: git push -u ${gitContext.remote.name} ${gitContext.branch}`,
        ].join("\n"),
        "First branch push",
      );
    }

    pushRelease(cwd, gitContext.remote.name, gitContext.branch, tag, {
      setUpstream: gitContext.upstream === null,
    });
  } catch (error) {
    throw new Error(
      [
        formatErrorMessage(error),
        `Release commit and tag already exist locally for ${tag}.`,
        `After fixing Git remote or authentication, push manually with \`${formatBranchPushCommand(gitContext)}\` and \`git push ${gitContext.remote.name} refs/tags/${tag}\`.`,
      ].join("\n"),
    );
  }

  note(
    [
      `Branch: ${gitContext.branch}`,
      `Upstream: ${gitContext.upstream ?? `${gitContext.remote.name}/${gitContext.branch}`}`,
      `Remote: ${gitContext.remote.name}`,
      `Tag: ${tag}`,
    ].join("\n"),
    "Pushed to Git",
  );

  if (npmPlan.action === "publish" && npmDistTag !== null) {
    if (npmPackageName === null) {
      throw new Error("npm package name was not resolved.");
    }

    try {
      await publishToNpm({
        cwd,
        config: config.npm.publish,
        distTag: npmDistTag,
      });
    } catch (error) {
      throw new Error(
        [
          formatErrorMessage(error),
          `Git commit, tag, and push already completed for ${tag}.`,
          "Fix npm access, then rerun `recon publish` to recover this release without bumping version again.",
        ].join("\n"),
      );
    }

    note(
      [
        `Package: ${npmPackageName}`,
        `Version: ${nextVersion}`,
        `Registry: ${config.npm.publish.registry}`,
        `dist-tag: ${npmDistTag}`,
      ].join("\n"),
      "Published to npm",
    );
  }

  if (githubPlan.action === "create") {
    if (githubToken === null || githubRepository === null) {
      throw new Error("GitHub Release requirements were not resolved.");
    }

    try {
      await createGithubRelease({
        repository: githubRepository,
        token: githubToken,
        tag,
        notes: releaseContent || `Release ${tag}\n`,
        prerelease: resolvedVersion.isPrerelease,
      });
    } catch (error) {
      throw new Error(
        [
          formatErrorMessage(error),
          `Git commit, tag, and push already completed for ${tag}.`,
          "Fix the GitHub token permissions, then rerun `recon publish` to recover this release without bumping version again.",
        ].join("\n"),
      );
    }

    note(
      [
        `Repository: ${githubRepository.owner}/${githubRepository.repo}`,
        `Tag: ${tag}`,
        `Prerelease: ${resolvedVersion.isPrerelease ? "yes" : "no"}`,
      ].join("\n"),
      "Created GitHub Release",
    );
  }

  note(
    [
      `Mode: ${resolvedVersion.isPrerelease ? "prerelease" : "release"}`,
      `Version: ${nextVersion}`,
      `Tag: ${tag}`,
      `Targets: ${formatPublishTargets(config.publish.targets)}`,
      ...(npmDistTag === null ? [] : [`npm dist-tag: ${npmDistTag}`]),
    ].join("\n"),
    "Published release",
  );
  outro("Done.");
}

async function prepareCommitFlow(
  cwd: string,
  status: ReturnType<typeof getGitStatus>,
  commits: ReleaseCommit[],
  config: ReconConfig,
): Promise<{ shouldContinue: boolean; shouldReloadCommits: boolean }> {
  const hasReleaseableCommits =
    classifyPublishFlow(commits, config).kind === "versioning";

  if (status.unstaged.length > 0 && hasReleaseableCommits) {
    const strategy = await promptUnstagedCommitStrategy();

    if (strategy === null) {
      return { shouldContinue: false, shouldReloadCommits: false };
    }

    if (strategy === "strict") {
      if (status.staged.length > 0) {
        log.warn(
          "Strict mode cannot continue while files are already staged. Commit or unstage them first, or choose additional commit.",
        );
        return { shouldContinue: false, shouldReloadCommits: false };
      }

      log.info(
        "Using detected commits only. Unstaged files will not be staged.",
      );
      return { shouldContinue: true, shouldReloadCommits: false };
    }
  }

  const shouldContinue = await stageUnstagedFiles(cwd, status.unstaged);

  if (!shouldContinue) {
    return { shouldContinue: false, shouldReloadCommits: false };
  }

  const commitResult = await commitStagedFiles(cwd);

  return {
    shouldContinue: commitResult !== "cancelled",
    shouldReloadCommits: commitResult === "committed",
  };
}

async function promptUnstagedCommitStrategy(): Promise<
  "strict" | "commit" | null
> {
  const strategy = await select<"strict" | "commit">({
    message: "Detected releaseable commits and unstaged files. Continue how?",
    initialValue: "strict",
    options: [
      {
        value: "strict",
        label: "Use detected commits only",
        hint: "do not stage unstaged files",
      },
      {
        value: "commit",
        label: "Create additional commit",
        hint: "choose unstaged files to stage",
      },
    ],
  });

  if (isCancel(strategy)) {
    cancel("Operation cancelled.");
    return null;
  }

  return strategy;
}

function runPushOnlyFlow({
  cwd,
  dryRun,
  gitContext,
  commits,
}: {
  cwd: string;
  dryRun: boolean;
  gitContext: ReturnType<typeof getGitContext>;
  commits: ReleaseCommit[];
}): void {
  note(
    [
      "Mode: push only",
      "Version: unchanged",
      "Tag: skipped",
      "CHANGELOG.md: skipped",
      "npm publish: skipped",
      "GitHub Release: skipped",
      `Hidden commits: ${commits.length}`,
    ].join("\n"),
    dryRun ? "Dry run" : "Push-only publish",
  );

  if (dryRun) {
    outro("Dry run complete. No files changed.");
    return;
  }

  try {
    if (gitContext.upstream === null) {
      note(
        [
          `Branch: ${gitContext.branch}`,
          `Remote: ${gitContext.remote.name} (${gitContext.remote.url})`,
          `Command: git push -u ${gitContext.remote.name} ${gitContext.branch}`,
        ].join("\n"),
        "First branch push",
      );
    }

    pushBranch(cwd, gitContext.remote.name, gitContext.branch, {
      setUpstream: gitContext.upstream === null,
    });
  } catch (error) {
    throw new Error(
      [
        formatErrorMessage(error),
        "No version, changelog, tag, npm publish, or GitHub Release was created.",
        `After fixing Git remote or authentication, push manually with \`${formatBranchPushCommand(gitContext)}\`.`,
      ].join("\n"),
    );
  }

  note(
    [
      `Branch: ${gitContext.branch}`,
      `Upstream: ${gitContext.upstream ?? `${gitContext.remote.name}/${gitContext.branch}`}`,
      `Remote: ${gitContext.remote.name}`,
      "Tag: skipped",
    ].join("\n"),
    "Pushed to Git",
  );
  outro("Done.");
}

async function maybeRunRecoveryFlow({
  cwd,
  dryRun,
  config,
  gitContext,
  githubRepository,
  status,
  reason,
}: {
  cwd: string;
  dryRun: boolean;
  config: ReconConfig;
  gitContext: ReturnType<typeof getGitContext>;
  githubRepository: ReturnType<typeof parseGitHubRemote>;
  status: ReturnType<typeof getGitStatus>;
  reason: string;
}): Promise<boolean> {
  const recovery = await getRecoverableRelease(cwd, gitContext);

  if (recovery === null) return false;

  if (dryRun) {
    note(
      [
        `Reason: ${reason}`,
        `Mode: recovery`,
        `Version: ${recovery.version}`,
        `Tag: ${recovery.tag}`,
        `Selected targets: ${formatPublishTargets(config.publish.targets)}`,
        "Git push: skipped",
        "Version bump: skipped",
      ].join("\n"),
      "Recovery plan",
    );
    outro("Dry run complete. No files changed.");
    return true;
  }

  const shouldRecover = await confirm({
    message: `Recover incomplete release ${recovery.version}?`,
    initialValue: true,
  });

  if (isCancel(shouldRecover)) {
    cancel("Operation cancelled.");
    return true;
  }

  if (!shouldRecover) return true;

  if (status.staged.length > 0 || status.unstaged.length > 0) {
    throw new Error(
      "Recovery requires a clean working tree so npm does not publish unintended local changes.",
    );
  }

  const selectedTargets = await promptPublishTargets(config.publish.targets);

  if (selectedTargets === null) return true;

  let recoveryConfig = applySelectedPublishTargets(config, selectedTargets);

  const configAfterGithubTokenPrompt = await promptMissingGithubToken(
    cwd,
    recoveryConfig,
    dryRun,
  );

  if (configAfterGithubTokenPrompt === null) return true;

  recoveryConfig = configAfterGithubTokenPrompt;

  const configAfterNpmTokenPrompt = await promptMissingNpmToken(
    cwd,
    recoveryConfig,
    dryRun,
  );

  if (configAfterNpmTokenPrompt === null) return true;

  recoveryConfig = configAfterNpmTokenPrompt;

  const recovered: string[] = [];
  const skipped: string[] = [];

  if (recoveryConfig.publish.targets.includes("github")) {
    await recoverGithubRelease({
      cwd,
      config: recoveryConfig,
      repository: githubRepository,
      release: recovery,
      recovered,
      skipped,
    });
  }

  if (recoveryConfig.publish.targets.includes("npm")) {
    recoveryConfig = await recoverNpmPublish({
      cwd,
      config: recoveryConfig,
      release: recovery,
      recovered,
      skipped,
    });
  }

  note(
    [
      `Version: ${recovery.version}`,
      `Tag: ${recovery.tag}`,
      `Recovered: ${recovered.join(", ") || "none"}`,
      `Skipped: ${skipped.join(", ") || "none"}`,
    ].join("\n"),
    "Recovery complete",
  );
  outro("Done.");

  return true;
}

async function recoverGithubRelease({
  cwd,
  config,
  repository,
  release,
  recovered,
  skipped,
}: {
  cwd: string;
  config: ReconConfig;
  repository: ReturnType<typeof parseGitHubRemote>;
  release: RecoverableRelease;
  recovered: string[];
  skipped: string[];
}): Promise<void> {
  const githubRelease = config.github.release;
  const token = resolveGithubTokenFromConfig(githubRelease);
  const githubPlan = resolveGithubReleasePlan(githubRelease, {
    token,
    repository,
  });

  if (githubPlan.action === "skip") {
    skipped.push(`GitHub Release (${githubPlan.reason})`);
    return;
  }

  if (githubPlan.action === "error") {
    throw new Error(githubPlan.reason);
  }

  if (token === null || repository === null) {
    throw new Error("GitHub Release requirements were not resolved.");
  }

  const releaseStatus = await resolveGithubReleaseExists({
    cwd,
    config,
    repository,
    tag: release.tag,
  });

  if (releaseStatus.exists) {
    skipped.push("GitHub Release already exists");
    return;
  }

  const checkedConfig = await ensureGithubReleaseAccess({
    cwd,
    config: releaseStatus.config,
    repository,
    tag: release.tag,
  });
  const checkedToken = resolveGithubTokenFromConfig(
    checkedConfig.github.release,
  );

  if (checkedToken === null) {
    throw new Error("GitHub Release requirements were not resolved.");
  }

  await createGithubRelease({
    repository,
    token: checkedToken,
    tag: release.tag,
    notes: await readRecoveryReleaseNotes(cwd, release.version),
    prerelease: release.isPrerelease,
  });

  recovered.push("GitHub Release");
}

async function recoverNpmPublish({
  cwd,
  config,
  release,
  recovered,
  skipped,
}: {
  cwd: string;
  config: ReconConfig;
  release: RecoverableRelease;
  recovered: string[];
  skipped: string[];
}): Promise<ReconConfig> {
  const npmToken = resolveNpmTokenFromConfig(config.npm.publish);
  const npmPlan = resolveNpmPublishPlan(config.npm.publish, {
    token: npmToken,
  });

  if (npmPlan.action === "skip") {
    skipped.push(`npm publish (${npmPlan.reason})`);
    return config;
  }

  if (npmPlan.action === "error") {
    throw new Error(npmPlan.reason);
  }

  const packageName = await readPackageName(cwd);
  const distTag = resolveNpmRecoveryDistTag(config, release.version);
  const publishStatus = await resolveNpmPackageVersionPublished({
    cwd,
    config,
    packageName,
    version: release.version,
  });

  if (publishStatus.isPublished) {
    skipped.push("npm package already published");
    return config;
  }

  const checkedConfig = await ensureNpmPublishAccess({
    cwd,
    config: publishStatus.config,
    distTag,
    packageName,
    version: release.version,
  });

  await preflightNpmPackage({
    cwd,
    config: checkedConfig.npm.publish,
    distTag,
  });

  await publishToNpm({
    cwd,
    config: checkedConfig.npm.publish,
    distTag,
  });

  recovered.push(`npm publish (${distTag})`);

  return checkedConfig;
}

async function resolveGithubReleaseExists({
  cwd,
  config,
  repository,
  tag,
}: {
  cwd: string;
  config: ReconConfig;
  repository: NonNullable<ReturnType<typeof parseGitHubRemote>>;
  tag: string;
}): Promise<{ config: ReconConfig; exists: boolean }> {
  let currentConfig = config;

  for (;;) {
    const token = resolveGithubTokenFromConfig(currentConfig.github.release);

    if (token === null) {
      throw new Error("GitHub token not found.");
    }

    try {
      return {
        config: currentConfig,
        exists: await hasGithubReleaseForTag({
          repository,
          token,
          tag,
        }),
      };
    } catch (error) {
      if (!isCredentialError(error)) {
        throw error;
      }

      const updatedConfig = await promptReplacementGithubToken(
        cwd,
        currentConfig,
        error,
      );

      if (updatedConfig === null) {
        throw new Error("GitHub Release access check cancelled.");
      }

      currentConfig = updatedConfig;
    }
  }
}

async function resolveNpmPackageVersionPublished({
  cwd,
  config,
  packageName,
  version,
}: {
  cwd: string;
  config: ReconConfig;
  packageName: string;
  version: string;
}): Promise<{ config: ReconConfig; isPublished: boolean }> {
  let currentConfig = config;

  for (;;) {
    try {
      return {
        config: currentConfig,
        isPublished: await isNpmPackageVersionPublished(
          cwd,
          currentConfig.npm.publish,
          packageName,
          version,
        ),
      };
    } catch (error) {
      if (!isCredentialError(error)) {
        throw error;
      }

      const updatedConfig = await promptReplacementNpmToken(
        cwd,
        currentConfig,
        error,
      );

      if (updatedConfig === null) {
        throw new Error("npm publish access check cancelled.");
      }

      currentConfig = updatedConfig;
    }
  }
}

interface RecoverableRelease {
  version: string;
  tag: string;
  isPrerelease: boolean;
}

async function getRecoverableRelease(
  cwd: string,
  gitContext: ReturnType<typeof getGitContext>,
): Promise<RecoverableRelease | null> {
  if (gitContext.latestTag === null) return null;

  const version = await readPackageVersion(cwd);

  if (version !== gitContext.latestTag) return null;
  if (!isTagAtHead(cwd, gitContext.latestTag)) return null;
  if (getLatestCommitSubject(cwd) !== `chore(release): ${version}`) {
    return null;
  }

  return {
    version,
    tag: gitContext.latestTag,
    isPrerelease: version.includes("-"),
  };
}

async function commitStagedFiles(
  cwd: string,
): Promise<"committed" | "none" | "cancelled"> {
  const stagedStatus = getGitStatus(cwd);

  if (stagedStatus.staged.length === 0) return "none";

  note(stagedStatus.staged.join("\n"), "Files ready to commit");
  const commitMessage = await promptCommitMessage();

  if (commitMessage === null) return "cancelled";

  commitWithMessage(cwd, commitMessage);
  note(getLatestCommitSummary(cwd), "Created commit");

  return "committed";
}

async function promptPublishTargets(
  currentTargets: PublishTarget[],
): Promise<PublishTarget[] | null> {
  const selectedTargets = await select<PublishTargetChoice>({
    message: "Where should recon publish this release?",
    initialValue: getPublishTargetChoice(currentTargets),
    options: [
      {
        value: "all",
        label: "All",
        hint: "GitHub Release and npm publish",
      },
      {
        value: "github",
        label: "GitHub",
        hint: "create GitHub Release",
      },
      {
        value: "npm",
        label: "npm",
        hint: "publish package to npm registry",
      },
    ],
  });

  if (isCancel(selectedTargets)) {
    cancel("Operation cancelled.");
    return null;
  }

  if (selectedTargets === "all") return ["github", "npm"];

  return [selectedTargets];
}

function applySelectedPublishTargets(
  config: ReconConfig,
  targets: PublishTarget[],
): ReconConfig {
  return {
    ...config,
    publish: {
      targets,
    },
    github: {
      ...config.github,
      release: {
        ...config.github.release,
        enabled: targets.includes("github")
          ? config.github.release.enabled === false
            ? "auto"
            : config.github.release.enabled
          : false,
      },
    },
    npm: {
      ...config.npm,
      publish: {
        ...config.npm.publish,
        enabled: targets.includes("npm")
          ? config.npm.publish.enabled === false
            ? "auto"
            : config.npm.publish.enabled
          : false,
      },
    },
  };
}

async function promptMissingGithubToken(
  cwd: string,
  config: ReconConfig,
  dryRun: boolean,
): Promise<ReconConfig | null> {
  if (!config.publish.targets.includes("github")) {
    return config;
  }

  if (!shouldPromptForGithubToken(config.github.release, { dryRun })) {
    return config;
  }

  note(
    [
      "GITHUB_TOKEN is empty in recon.json.",
      "GitHub Release needs this token, but Git tag and push can continue without creating a GitHub Release.",
    ].join("\n"),
    "GitHub Release token",
  );

  const tokenAction = await select<"input" | "skip">({
    message: "How do you want to continue?",
    initialValue: "input",
    options: [
      {
        value: "input",
        label: "Input GitHub token",
        hint: "save token to recon.json, then continue",
      },
      {
        value: "skip",
        label: "Skip GitHub Release",
        hint: "continue tag and push only",
      },
    ],
  });

  if (isCancel(tokenAction)) {
    cancel("Operation cancelled.");
    return null;
  }

  if (tokenAction === "skip") {
    log.warn("GitHub Release skipped for this publish.");
    return withGithubReleaseSkipped(config);
  }

  await ensureReconConfigIgnored(cwd);

  if (isGitTracked(cwd, "recon.json")) {
    throw new Error(
      "Cannot save GITHUB_TOKEN because recon.json is tracked by Git. Run `git rm --cached recon.json`, then rerun `recon publish`.",
    );
  }

  const token = await password({
    message: "Enter GitHub token (Fine-grained PAT, Contents: Read and write)",
    validate(value) {
      if (!value || value.trim().length === 0) {
        return "GitHub token is required.";
      }
    },
  });

  if (isCancel(token)) {
    cancel("Operation cancelled.");
    return null;
  }

  const updatedConfig = withGithubReleaseToken(config, token);

  await writeReconConfig(cwd, updatedConfig);
  log.success("GITHUB_TOKEN saved in recon.json.");

  return updatedConfig;
}

async function promptMissingNpmToken(
  cwd: string,
  config: ReconConfig,
  dryRun: boolean,
): Promise<ReconConfig | null> {
  if (!config.publish.targets.includes("npm")) {
    return config;
  }

  if (!shouldPromptForNpmToken(config.npm.publish, { dryRun })) {
    return config;
  }

  note(
    [
      "NPM_TOKEN is empty in recon.json.",
      "npm publish needs this token, but Git release flow can continue without publishing to npm.",
    ].join("\n"),
    "npm publish token",
  );

  const tokenAction = await select<"input" | "skip">({
    message: "How do you want to continue?",
    initialValue: "input",
    options: [
      {
        value: "input",
        label: "Input npm token",
        hint: "save token to recon.json, then continue",
      },
      {
        value: "skip",
        label: "Skip npm publish",
        hint: "continue without npm publish",
      },
    ],
  });

  if (isCancel(tokenAction)) {
    cancel("Operation cancelled.");
    return null;
  }

  if (tokenAction === "skip") {
    log.warn("npm publish skipped for this publish.");
    return withNpmPublishSkipped(config);
  }

  await ensureReconConfigIgnored(cwd);

  if (isGitTracked(cwd, "recon.json")) {
    throw new Error(
      "Cannot save NPM_TOKEN because recon.json is tracked by Git. Run `git rm --cached recon.json`, then rerun `recon publish`.",
    );
  }

  const token = await password({
    message: "Enter npm token (Automation token recommended)",
    validate(value) {
      if (!value || value.trim().length === 0) {
        return "NPM_TOKEN is required.";
      }
    },
  });

  if (isCancel(token)) {
    cancel("Operation cancelled.");
    return null;
  }

  const updatedConfig = withNpmPublishToken(config, token);

  await writeReconConfig(cwd, updatedConfig);
  log.success("NPM_TOKEN saved in recon.json.");

  return updatedConfig;
}

async function ensureGithubReleaseAccess({
  cwd,
  config,
  repository,
  tag,
}: {
  cwd: string;
  config: ReconConfig;
  repository: NonNullable<ReturnType<typeof parseGitHubRemote>>;
  tag: string;
}): Promise<ReconConfig> {
  let currentConfig = config;

  for (;;) {
    const token = resolveGithubTokenFromConfig(currentConfig.github.release);

    if (token === null) {
      throw new Error("GitHub token not found.");
    }

    try {
      await preflightGithubReleaseAccess({
        repository,
        token,
        tag,
      });

      note(
        [
          `Repository: ${repository.owner}/${repository.repo}`,
          `Tag: ${tag}`,
          "Status: access verified",
        ].join("\n"),
        "Checking GitHub Release access",
      );

      return currentConfig;
    } catch (error) {
      if (!isCredentialError(error)) {
        throw error;
      }

      const updatedConfig = await promptReplacementGithubToken(
        cwd,
        currentConfig,
        error,
      );

      if (updatedConfig === null) {
        throw new Error("GitHub Release access check cancelled.");
      }

      currentConfig = updatedConfig;
    }
  }
}

async function ensureNpmPublishAccess({
  cwd,
  config,
  distTag,
  packageName,
  version,
}: {
  cwd: string;
  config: ReconConfig;
  distTag: string;
  packageName: string;
  version: string;
}): Promise<ReconConfig> {
  let currentConfig = config;

  for (;;) {
    try {
      await preflightNpmPublish({
        cwd,
        config: currentConfig.npm.publish,
        distTag,
        packageName,
        version,
      });

      return currentConfig;
    } catch (error) {
      if (!isCredentialError(error)) {
        throw error;
      }

      const updatedConfig = await promptReplacementNpmToken(
        cwd,
        currentConfig,
        error,
      );

      if (updatedConfig === null) {
        throw new Error("npm publish access check cancelled.");
      }

      currentConfig = updatedConfig;
    }
  }
}

async function promptReplacementGithubToken(
  cwd: string,
  config: ReconConfig,
  error: unknown,
): Promise<ReconConfig | null> {
  note(formatErrorMessage(error), "GitHub Release access failed");

  const tokenAction = await select<"input" | "cancel">({
    message: "How do you want to continue?",
    initialValue: "input",
    options: [
      {
        value: "input",
        label: "Input GitHub token",
        hint: "save token to recon.json, then retry access check",
      },
      {
        value: "cancel",
        label: "Cancel publish",
        hint: "no files, commits, tags, or pushes are created",
      },
    ],
  });

  if (isCancel(tokenAction) || tokenAction === "cancel") {
    cancel("Operation cancelled.");
    return null;
  }

  await ensureReconConfigIgnored(cwd);

  if (isGitTracked(cwd, "recon.json")) {
    throw new Error(
      "Cannot save GITHUB_TOKEN because recon.json is tracked by Git. Run `git rm --cached recon.json`, then rerun `recon publish`.",
    );
  }

  const token = await password({
    message: "Enter GitHub token (Fine-grained PAT, Contents: Read and write)",
    validate(value) {
      if (!value || value.trim().length === 0) {
        return "GitHub token is required.";
      }
    },
  });

  if (isCancel(token)) {
    cancel("Operation cancelled.");
    return null;
  }

  const updatedConfig = withGithubReleaseToken(config, token);

  await writeReconConfig(cwd, updatedConfig);
  log.success("GITHUB_TOKEN saved in recon.json.");

  return updatedConfig;
}

async function promptReplacementNpmToken(
  cwd: string,
  config: ReconConfig,
  error: unknown,
): Promise<ReconConfig | null> {
  note(formatErrorMessage(error), "npm publish access failed");

  const tokenAction = await select<"input" | "cancel">({
    message: "How do you want to continue?",
    initialValue: "input",
    options: [
      {
        value: "input",
        label: "Input npm token",
        hint: "save token to recon.json, then retry access check",
      },
      {
        value: "cancel",
        label: "Cancel publish",
        hint: "no files, commits, tags, or pushes are created",
      },
    ],
  });

  if (isCancel(tokenAction) || tokenAction === "cancel") {
    cancel("Operation cancelled.");
    return null;
  }

  await ensureReconConfigIgnored(cwd);

  if (isGitTracked(cwd, "recon.json")) {
    throw new Error(
      "Cannot save NPM_TOKEN because recon.json is tracked by Git. Run `git rm --cached recon.json`, then rerun `recon publish`.",
    );
  }

  const token = await password({
    message: "Enter npm token (Automation token recommended)",
    validate(value) {
      if (!value || value.trim().length === 0) {
        return "NPM_TOKEN is required.";
      }
    },
  });

  if (isCancel(token)) {
    cancel("Operation cancelled.");
    return null;
  }

  const updatedConfig = withNpmPublishToken(config, token);

  await writeReconConfig(cwd, updatedConfig);
  log.success("NPM_TOKEN saved in recon.json.");

  return updatedConfig;
}

async function promptReleaseSelection(
  config: ReconConfig,
  stableVersion: string,
  prereleaseVersion: string,
): Promise<ReleaseSelection | null> {
  const releaseKind = await select<"stable" | "prerelease">({
    message: "Publish selected targets as release or prerelease?",
    initialValue: "stable",
    options: [
      {
        value: "stable",
        label: "Release",
        hint: `${stableVersion} for selected targets`,
      },
      {
        value: "prerelease",
        label: "Prerelease",
        hint: `${prereleaseVersion} for selected targets`,
      },
    ],
  });

  if (isCancel(releaseKind)) {
    cancel("Operation cancelled.");
    return null;
  }

  if (releaseKind === "stable") {
    return { kind: "stable" };
  }

  const prerelease = config.github.release.prerelease;
  const channelName = await select<string>({
    message: "Choose prerelease channel",
    initialValue: prerelease.defaultChannel,
    options: prerelease.channels.map((channel) => ({
      value: channel.name,
      label: channel.name,
      hint: channel.identifier,
    })),
  });

  if (isCancel(channelName)) {
    cancel("Operation cancelled.");
    return null;
  }

  const channel = prerelease.channels.find((item) => item.name === channelName);

  if (!channel) {
    throw new Error(`Prerelease channel not found: ${channelName}`);
  }

  return {
    kind: "prerelease",
    channel,
  };
}

async function promptCommitMessage(): Promise<string | null> {
  const commitMessage = await text({
    message: "Commit message (Conventional Commit)",
    placeholder: "feat: add release flow",
    validate(value) {
      const commitMessage = value?.trim() ?? "";

      if (commitMessage.length === 0) {
        return "Commit message is required.";
      }

      if (parseConventionalCommit(commitMessage).type === null) {
        return "Use Conventional Commits format, for example `feat: add cli`.";
      }
    },
  });

  if (isCancel(commitMessage)) {
    cancel("Operation cancelled.");
    return null;
  }

  return commitMessage;
}

function getDefaultPrereleaseChannel(config: ReconConfig): PrereleaseChannel {
  const prerelease = config.github.release.prerelease;
  const channel = prerelease.channels.find(
    (item) => item.name === prerelease.defaultChannel,
  );

  if (!channel) {
    throw new Error(
      `Default prerelease channel not found: ${prerelease.defaultChannel}`,
    );
  }

  return channel;
}

function formatGithubDryRunPlan(
  plan: ReturnType<typeof resolveGithubReleaseDryRunPlan>,
): string {
  return `${plan.action} (${plan.reason})`;
}

function formatNpmPublishPlan(
  plan: ReturnType<typeof resolveNpmPublishPlan>,
): string {
  if (plan.action === "publish") {
    return "publish (npm publish requirements are satisfied.)";
  }

  return `${plan.action} (${plan.reason})`;
}

function formatReleaseModeSummary(
  config: ReconConfig,
  selection: ReleaseSelection,
  nextVersion: string,
  options: {
    githubAction: "create" | "skip" | "error";
    npmAction: "publish" | "skip" | "error";
    npmDistTag: string | null;
    isPrerelease: boolean;
  },
): string {
  const lines = [
    `Mode: ${options.isPrerelease ? "prerelease" : "release"}`,
    `Version: ${nextVersion}`,
    `Selected targets: ${formatPublishTargets(config.publish.targets)}`,
  ];

  if (selection.kind === "prerelease") {
    lines.push(`Channel: ${selection.channel.name}`);
    lines.push(`SemVer identifier: ${selection.channel.identifier}`);
  }

  if (config.publish.targets.includes("github")) {
    lines.push(
      `GitHub Release: ${formatGithubReleaseMode(options.githubAction, options.isPrerelease)}`,
    );
  }

  if (config.publish.targets.includes("npm")) {
    lines.push(`npm publish: ${formatNpmPublishMode(options)}`);
  }

  return lines.join("\n");
}

function formatGithubReleaseMode(
  action: "create" | "skip" | "error",
  isPrerelease: boolean,
): string {
  if (action === "create") {
    return isPrerelease ? "prerelease" : "release";
  }

  return action;
}

function formatNpmPublishMode(options: {
  npmAction: "publish" | "skip" | "error";
  npmDistTag: string | null;
}): string {
  if (options.npmAction === "publish" && options.npmDistTag !== null) {
    return `dist-tag ${options.npmDistTag}`;
  }

  return options.npmAction;
}

function resolveNpmDistTag(
  config: ReconConfig,
  selection: ReleaseSelection,
): string {
  const distTag =
    selection.kind === "prerelease"
      ? selection.channel.name
      : config.npm.publish.tag;

  if (!isValidNpmDistTag(distTag)) {
    throw new Error(`Invalid npm dist-tag: ${distTag}`);
  }

  return distTag;
}

function resolveNpmRecoveryDistTag(
  config: ReconConfig,
  version: string,
): string {
  const prereleaseIdentifier = getPrereleaseIdentifier(version);

  if (prereleaseIdentifier === null) {
    return config.npm.publish.tag;
  }

  const channel = config.github.release.prerelease.channels.find(
    (item) => item.identifier === prereleaseIdentifier,
  );
  const distTag = channel?.name ?? prereleaseIdentifier;

  if (!isValidNpmDistTag(distTag)) {
    throw new Error(`Invalid npm dist-tag: ${distTag}`);
  }

  return distTag;
}

function getPrereleaseIdentifier(version: string): string | null {
  const match = /^\d+\.\d+\.\d+-(?<prerelease>[0-9A-Za-z.-]+)$/.exec(version);

  if (!match?.groups) return null;

  const parts = match.groups.prerelease.split(".");
  const lastPart = parts.at(-1);

  if (lastPart !== undefined && /^\d+$/.test(lastPart) && parts.length > 1) {
    return parts.slice(0, -1).join(".");
  }

  return match.groups.prerelease;
}

function getPublishTargetChoice(targets: PublishTarget[]): PublishTargetChoice {
  if (targets.includes("github") && targets.includes("npm")) return "all";
  if (targets.includes("npm")) return "npm";

  return "github";
}

function formatPublishTargets(targets: PublishTarget[]): string {
  if (targets.length === 0) return "git only";

  return targets
    .map((target) => (target === "github" ? "GitHub" : "npm"))
    .join(", ");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCredentialError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();

  return (
    message.includes("token") ||
    message.includes("e401") ||
    message.includes("e403") ||
    message.includes("(401)") ||
    message.includes("(403)") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("permission") ||
    message.includes("access")
  );
}

function getReleaseCommits(
  cwd: string,
  githubRepository: ReturnType<typeof parseGitHubRemote>,
): ReleaseCommit[] {
  return getCommitsSinceLatestTag(cwd).map((commit) => ({
    ...parseConventionalCommit(commit.message),
    sha: commit.sha,
    shortSha: commit.shortSha,
    url:
      githubRepository === null
        ? null
        : buildGithubCommitUrl(githubRepository, commit.sha),
  }));
}

function getChangelogCommitReference(
  commits: ReleaseCommit[],
  config: ReconConfig,
): { sha: string; url: string | null } | undefined {
  const commit = commits.find(
    (item) => classifyCommitForPublish(item, config).kind === "versioning",
  );

  if (!commit) return undefined;

  return {
    sha: commit.shortSha,
    url: commit.url,
  };
}

function formatDetectedCommits(
  commits: ConventionalCommit[],
  config: ReconConfig,
): string {
  if (commits.length === 0) return "No commits found.";

  return commits
    .map((commit) => {
      const type = commit.type ?? "unknown";
      const classification = classifyCommitForPublish(commit, config);
      const releaseType = formatCommitPublishClassification(classification);
      const shortSha =
        typeof commit.shortSha === "string" ? `${commit.shortSha} ` : "";

      return `- ${shortSha}${type}: ${commit.description} (${releaseType})`;
    })
    .join("\n");
}

function formatCommitPublishClassification(
  classification: ReturnType<typeof classifyCommitForPublish>,
): string {
  if (classification.kind === "versioning") {
    return classification.releaseType;
  }

  if (classification.kind === "invalid-visible") {
    return "invalid visible type";
  }

  return classification.kind;
}

async function stageUnstagedFiles(
  cwd: string,
  unstagedFiles: string[],
): Promise<boolean> {
  if (unstagedFiles.length === 0) return true;

  const selectAllValue = "__recon_select_all__";
  const selectedFiles = await multiselect<string>({
    message: "Choose files to stage",
    required: true,
    options: [
      {
        value: selectAllValue,
        label: "Select all",
        hint: `stage ${unstagedFiles.length} files`,
      },
      ...unstagedFiles.map((file) => ({
        value: file,
        label: file,
      })),
    ],
  });

  if (isCancel(selectedFiles)) {
    cancel("Operation cancelled.");
    return false;
  }

  const filesToStage = selectedFiles.includes(selectAllValue)
    ? unstagedFiles
    : selectedFiles;

  stageFiles(cwd, filesToStage);
  note(
    [`Staged files: ${filesToStage.length}`, ...filesToStage].join("\n"),
    "Staged files",
  );

  return true;
}

function formatBranchPushCommand(
  gitContext: ReturnType<typeof getGitContext>,
): string {
  if (gitContext.upstream === null) {
    return `git push -u ${gitContext.remote.name} ${gitContext.branch}`;
  }

  return `git push ${gitContext.remote.name} ${gitContext.branch}`;
}

async function readOptionalTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readRecoveryReleaseNotes(
  cwd: string,
  version: string,
): Promise<string> {
  const changelog = await readOptionalTextFile(join(cwd, "CHANGELOG.md"));
  const releaseLines = getChangelogReleaseSection(changelog, version);

  if (releaseLines.length === 0) {
    return `Release ${version}\n`;
  }

  return `${releaseLines.join("\n").trim()}\n`;
}

function getChangelogReleaseSection(
  content: string,
  version: string,
): string[] {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    line.startsWith(`## [${version}]`),
  );

  if (startIndex === -1) return [];

  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && line.startsWith("## ["),
  );

  return lines.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
