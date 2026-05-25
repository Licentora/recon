import { execFileSync } from "node:child_process";

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
  runGit(["commit", "-m", message], cwd, {
    stdio: "inherit",
  });
}

export function getLatestCommitSummary(cwd: string): string {
  return runGit(["log", "-1", "--format=%h %s"], cwd).trim();
}

export function commitRelease(cwd: string, version: string): void {
  runGit(["commit", "-m", `chore(release): ${version}`], cwd, {
    stdio: "inherit",
  });
}

export function createReleaseTag(cwd: string, version: string): void {
  runGit(["tag", "-a", version, "-m", `Release ${version}`], cwd, {
    stdio: "inherit",
  });
}

export function pushRelease(
  cwd: string,
  remote: string,
  branch: string,
  tag: string,
): void {
  runGit(["push", remote, branch], cwd, { stdio: "inherit" });
  runGit(["push", remote, `refs/tags/${tag}`], cwd, { stdio: "inherit" });
}

export function getCommitMessagesSinceLatestTag(cwd: string): string[] {
  if (!hasCommitHistory(cwd)) return [];

  const latestTag = getLatestTag(cwd);
  const range = latestTag ? `${latestTag}..HEAD` : "HEAD";
  const output = runGit(["log", range, "--format=%B%x1e"], cwd);

  return output
    .split("\x1e")
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
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
    throw new Error("Git remote is required before publishing.");
  }

  return {
    name,
    url: runGit(["remote", "get-url", name], cwd).trim(),
  };
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

function runGit(
  args: string[],
  cwd: string,
  options: { stdio?: "pipe" | "inherit" } = {},
): string {
  try {
    const result = execFileSync("git", args, {
      cwd,
      encoding: options.stdio === "inherit" ? undefined : "utf8",
      stdio: options.stdio ?? "pipe",
    });

    return typeof result === "string" ? result : "";
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Git command failed.");
  }
}
