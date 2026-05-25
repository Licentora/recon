import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cancel,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  text,
} from "@clack/prompts";

import {
  generateReleaseChangelog,
  prependReleaseChangelog,
} from "../changelog/changelog.js";
import type { PrereleaseChannel, ReconConfig } from "../config.js";
import { readReconConfig } from "../config.js";
import {
  createGithubRelease,
  parseGitHubRemote,
  resolveGithubReleaseDryRunPlan,
  resolveGithubReleasePlan,
  resolveGithubTokenFromConfig,
} from "../github-release.js";
import {
  commitRelease,
  commitWithMessage,
  createReleaseTag,
  getCommitMessagesSinceLatestTag,
  getGitContext,
  getGitStatus,
  getLatestCommitSummary,
  pushRelease,
  stageFiles,
  stageReleaseFiles,
} from "../git.js";
import {
  getHighestReleaseType,
  parseConventionalCommit,
  type ConventionalCommit,
} from "../release/conventional-commits.js";
import {
  type ReleaseSelection,
  resolveNextVersion,
} from "../release/release-selection.js";
import { getReleaseFilePaths, updateLockfile } from "../package-manager.js";
import {
  readPackageVersion,
  updatePackageJsonFileVersion,
} from "../package-json.js";

interface RunPublishOptions {
  cwd: string;
  dryRun: boolean;
}

export async function runPublish({
  cwd,
  dryRun,
}: RunPublishOptions): Promise<void> {
  intro(dryRun ? "recon publish --dry" : "recon publish");

  const config = await readReconConfig(cwd);
  const currentVersion = await readPackageVersion(cwd);
  const gitContext = getGitContext(cwd);
  const status = getGitStatus(cwd);

  note(
    [
      `Branch: ${gitContext.branch}`,
      `Remote: ${gitContext.remote.name} (${gitContext.remote.url})`,
      `Latest tag: ${gitContext.latestTag ?? "none"}`,
      `Staged files: ${status.staged.length}`,
      `Unstaged files: ${status.unstaged.length}`,
    ].join("\n"),
    "Git status",
  );

  if (!dryRun) {
    const shouldContinue = await stageUnstagedFiles(cwd, status.unstaged);

    if (!shouldContinue) return;

    const stagedStatus = getGitStatus(cwd);

    if (stagedStatus.staged.length > 0) {
      note(stagedStatus.staged.join("\n"), "Files ready to commit");
      const commitMessage = await promptCommitMessage();

      if (commitMessage === null) return;

      commitWithMessage(cwd, commitMessage);
      note(getLatestCommitSummary(cwd), "Created commit");
    }
  }

  const commits = getCommitMessagesSinceLatestTag(cwd).map(
    parseConventionalCommit,
  );

  note(formatDetectedCommits(commits), "Detected commits");

  const releaseType = getHighestReleaseType(commits);

  if (!releaseType) {
    outro("Directory clean. No releaseable commits found.");
    return;
  }

  const githubRelease = config.github.release;
  const githubToken = resolveGithubTokenFromConfig(githubRelease);
  const githubRepository = parseGitHubRemote(gitContext.remote.url);
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
    const changelogPreview = generateReleaseChangelog({
      version: stablePreview.version,
      date: formatDate(new Date()),
      commits,
      config,
    });

    note(
      [
        `Current version: ${currentVersion}`,
        `Release type: ${releaseType}`,
        `Stable preview: ${stablePreview.version}`,
        `Prerelease preview: ${prereleasePreview.version}`,
        `GitHub Release: ${formatGithubDryRunPlan(githubDryRunPlan)}`,
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
  });

  const githubPlan = resolveGithubReleasePlan(githubRelease, {
    token: githubToken,
    repository: githubRepository,
  });

  if (githubPlan.action === "error") {
    throw new Error(githubPlan.reason);
  }

  if (githubPlan.action === "skip") {
    log.warn(githubPlan.reason);
  }

  log.step(`Preparing release ${nextVersion}`);

  await updatePackageJsonFileVersion(cwd, nextVersion);
  updateLockfile(cwd, config.packageManager);

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

  stageReleaseFiles(cwd, releaseFiles);
  commitRelease(cwd, nextVersion);
  note(getLatestCommitSummary(cwd), "Release commit");
  createReleaseTag(cwd, nextVersion);
  pushRelease(cwd, gitContext.remote.name, gitContext.branch, tag);

  if (githubPlan.action === "create") {
    if (githubToken === null || githubRepository === null) {
      throw new Error("GitHub Release requirements were not resolved.");
    }

    await createGithubRelease({
      repository: githubRepository,
      token: githubToken,
      tag,
      notes: releaseContent || `Release ${tag}\n`,
      prerelease: resolvedVersion.isPrerelease,
    });
  }

  log.success(`Published ${nextVersion}`);
  outro(`Release ${nextVersion} published.`);
}

async function promptReleaseSelection(
  config: ReconConfig,
  stableVersion: string,
  prereleaseVersion: string,
): Promise<ReleaseSelection | null> {
  const releaseKind = await select<"stable" | "prerelease">({
    message: "Publish as release or prerelease?",
    initialValue: "stable",
    options: [
      {
        value: "stable",
        label: "Release",
        hint: stableVersion,
      },
      {
        value: "prerelease",
        label: "Prerelease",
        hint: prereleaseVersion,
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

function formatDetectedCommits(commits: ConventionalCommit[]): string {
  if (commits.length === 0) return "No commits found.";

  return commits
    .map((commit) => {
      const type = commit.type ?? "unknown";
      const releaseType = commit.releaseType ?? "no release";

      return `- ${type}: ${commit.description} (${releaseType})`;
    })
    .join("\n");
}

async function stageUnstagedFiles(
  cwd: string,
  unstagedFiles: string[],
): Promise<boolean> {
  if (unstagedFiles.length === 0) return true;

  const selectedFiles = await multiselect<string>({
    message: "Choose files to stage",
    required: true,
    options: unstagedFiles.map((file) => ({
      value: file,
      label: file,
    })),
  });

  if (isCancel(selectedFiles)) {
    cancel("Operation cancelled.");
    return false;
  }

  stageFiles(cwd, selectedFiles);
  return true;
}

async function readOptionalTextFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
