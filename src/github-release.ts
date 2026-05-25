import type { GithubReleaseConfig } from "./config.js";

export interface GitHubRepository {
  owner: string;
  repo: string;
}

export interface GithubReleaseCreateOptions {
  repository: GitHubRepository;
  token: string;
  tag: string;
  notes: string;
  prerelease: boolean;
}

export type GithubReleasePlan =
  | { action: "create" }
  | { action: "skip"; reason: string }
  | { action: "error"; reason: string };

export type GithubReleaseDryRunPlan =
  | { action: "create"; reason: string }
  | { action: "error"; reason: string }
  | { action: "skip"; reason: string };

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export function parseGitHubRemote(remoteUrl: string): GitHubRepository | null {
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(
    remoteUrl,
  );

  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    };
  }

  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);

  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  const sshUrlMatch =
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);

  if (sshUrlMatch) {
    return {
      owner: sshUrlMatch[1],
      repo: sshUrlMatch[2],
    };
  }

  return null;
}

export function resolveGithubTokenFromConfig(
  config: GithubReleaseConfig,
): string | null {
  return normalizeToken(config.GITHUB_TOKEN);
}

export function buildGithubReleaseRequest({
  repository,
  token,
  tag,
  notes,
  prerelease,
}: GithubReleaseCreateOptions): { url: string; init: RequestInit } {
  return {
    url: `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases`,
    init: {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "recon-cli",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: notes,
        draft: false,
        prerelease,
      }),
    },
  };
}

export function resolveGithubReleasePlan(
  config: GithubReleaseConfig,
  context: {
    token: string | null;
    repository: GitHubRepository | null;
  },
): GithubReleasePlan {
  if (config.enabled === false) {
    return {
      action: "skip",
      reason: "GitHub Release disabled in recon.json.",
    };
  }

  if (context.token === null) {
    return {
      action: config.enabled === "auto" ? "skip" : "error",
      reason: "GitHub token not found.",
    };
  }

  if (context.repository === null) {
    return {
      action: config.enabled === "auto" ? "skip" : "error",
      reason: "GitHub remote not found.",
    };
  }

  return { action: "create" };
}

export function resolveGithubReleaseDryRunPlan(
  config: GithubReleaseConfig,
  context: {
    token: string | null;
    repository: GitHubRepository | null;
  },
): GithubReleaseDryRunPlan {
  const plan = resolveGithubReleasePlan(config, context);

  if (plan.action === "create") {
    return {
      action: "create",
      reason: "GitHub Release requirements are satisfied.",
    };
  }

  return plan;
}

export async function createGithubRelease(
  options: GithubReleaseCreateOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const request = buildGithubReleaseRequest(options);
  const response = await fetchImpl(request.url, request.init);

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `GitHub Release API failed (${response.status}): ${formatGithubApiError(
        responseText,
      )}`,
    );
  }
}

function normalizeToken(token: string | undefined): string | null {
  if (token === undefined || token.trim().length === 0) return null;

  return token.trim();
}

function formatGithubApiError(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { message?: unknown };

    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // Fall through to raw response body.
  }

  return responseText.length > 0 ? responseText : "Unknown error";
}
