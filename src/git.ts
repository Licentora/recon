import { runCommandQuiet } from "./command.js";

export interface GitStatus {
  staged: string[];
  unstaged: string[];
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitContext {
  branch: string;
  remote: GitRemote;
  latestTag: string | null;
  upstream: string | null;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
}

export function parseGitStatusPorcelain(output: string): GitStatus {
  const staged = new Set<string>();
  const unstaged = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) continue;

    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const filePath = normalizePorcelainPath(line.slice(3));

    if (indexStatus === "?" && worktreeStatus === "?") {
      unstaged.add(filePath);
      continue;
    }

    if (indexStatus !== " " && indexStatus !== "?") {
      staged.add(filePath);
    }

    if (worktreeStatus !== " " && worktreeStatus !== "?") {
      unstaged.add(filePath);
    }
  }

  return {
    staged: [...staged],
    unstaged: [...unstaged],
  };
}

export function getGitContext(cwd: string): GitContext {
  ensureGitRepository(cwd);

  return {
    branch: getCurrentBranch(cwd),
    remote: getDefaultRemote(cwd),
    latestTag: getLatestTag(cwd),
    upstream: getCurrentBranchUpstream(cwd),
  };
}

export function getGitStatus(cwd: string): GitStatus {
  return parseGitStatusPorcelain(runGit(["status", "--porcelain"], cwd));
}

export function stageFiles(cwd: string, files: string[]): void {
  if (files.length === 0) return;

  runGit(["add", "--", ...files], cwd);
}

export function stageReleaseFiles(cwd: string, files: string[]): void {
  stageFiles(cwd, files);
}

export function commitWithMessage(cwd: string, message: string): void {
  runGit(["commit", "-m", message], cwd);
}

export function getLatestCommitSummary(cwd: string): string {
  return runGit(["log", "-1", "--format=%h %s"], cwd).trim();
}

export function commitRelease(cwd: string, version: string): void {
  runGit(["commit", "-m", `chore(release): ${version}`], cwd);
}

export function createReleaseTag(cwd: string, version: string): void {
  runGit(["tag", "-a", version, "-m", `Release ${version}`], cwd);
}

export function pushRelease(
  cwd: string,
  remote: string,
  branch: string,
  tag: string,
  options: { setUpstream?: boolean } = {},
): void {
  runGit(
    options.setUpstream
      ? ["push", "-u", remote, branch]
      : ["push", remote, branch],
    cwd,
  );
  runGit(["push", remote, `refs/tags/${tag}`], cwd);
}

export function getCommitMessagesSinceLatestTag(cwd: string): string[] {
  return getCommitsSinceLatestTag(cwd).map((commit) => commit.message);
}

export function getCommitsSinceLatestTag(cwd: string): GitCommit[] {
  if (!hasCommitHistory(cwd)) return [];

  const latestTag = getLatestTag(cwd);
  const range = latestTag ? `${latestTag}..HEAD` : "HEAD";
  const output = runGit(["log", range, "--format=%H%x1f%h%x1f%B%x1e"], cwd);

  return parseGitLogOutput(output);
}

export function getAllCommits(cwd: string): GitCommit[] {
  if (!isGitRepository(cwd) || !hasCommitHistory(cwd)) return [];

  return parseGitLogOutput(runGit(["log", "--format=%H%x1f%h%x1f%B%x1e"], cwd));
}

function parseGitLogOutput(output: string): GitCommit[] {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha = "", shortSha = "", ...messageParts] = record.split("\x1f");

      return {
        sha,
        shortSha,
        message: messageParts.join("\x1f").trim(),
      };
    })
    .filter((commit) => commit.sha.length > 0 && commit.message.length > 0);
}

function normalizePorcelainPath(filePath: string): string {
  const renameSeparator = " -> ";

  if (filePath.includes(renameSeparator)) {
    return filePath.slice(
      filePath.indexOf(renameSeparator) + renameSeparator.length,
    );
  }

  return filePath;
}

function ensureGitRepository(cwd: string): void {
  const output = runGit(["rev-parse", "--is-inside-work-tree"], cwd).trim();

  if (output !== "true") {
    throw new Error("Current directory is not inside a Git repository.");
  }
}

function isGitRepository(cwd: string): boolean {
  try {
    ensureGitRepository(cwd);
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(cwd: string): string {
  const branch = runGit(["branch", "--show-current"], cwd).trim();

  if (branch.length === 0) {
    throw new Error("Cannot publish from a detached HEAD.");
  }

  return branch;
}

function getDefaultRemote(cwd: string): GitRemote {
  const [name] = runGit(["remote"], cwd)
    .split(/\r?\n/)
    .map((remoteName) => remoteName.trim())
    .filter(Boolean);

  if (!name) {
    throw new Error(
      "Git remote is required before publishing. Add one with `git remote add origin <repository-url>`, then rerun `recon publish`.",
    );
  }

  return {
    name,
    url: runGit(["remote", "get-url", name], cwd).trim(),
  };
}

function getCurrentBranchUpstream(cwd: string): string | null {
  try {
    const upstream = runGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      cwd,
    ).trim();

    return upstream.length > 0 ? upstream : null;
  } catch {
    return null;
  }
}

function getLatestTag(cwd: string): string | null {
  try {
    return runGit(["describe", "--tags", "--abbrev=0"], cwd).trim();
  } catch {
    return null;
  }
}

function hasCommitHistory(cwd: string): boolean {
  try {
    runGit(["rev-parse", "--verify", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

function runGit(args: string[], cwd: string): string {
  try {
    return runCommandQuiet("git", args, { cwd });
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Git command failed.");
  }
}
