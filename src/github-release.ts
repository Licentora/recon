import type { GithubReleaseConfig, ReconConfig } from "./config.js";

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

export interface GithubReleaseAccessOptions {
  repository: GitHubRepository;
  token: string;
  tag: string;
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
  const httpsMatch =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);

  if (httpsMatch && isValidGitHubRepository(httpsMatch[1], httpsMatch[2])) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    };
  }

  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
    remoteUrl,
  );

  if (sshMatch && isValidGitHubRepository(sshMatch[1], sshMatch[2])) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  const sshUrlMatch =
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);

  if (sshUrlMatch && isValidGitHubRepository(sshUrlMatch[1], sshUrlMatch[2])) {
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

export function shouldPromptForGithubToken(
  config: GithubReleaseConfig,
  options: { dryRun: boolean },
): boolean {
  if (options.dryRun || config.enabled === false) return false;

  return resolveGithubTokenFromConfig(config) === null;
}

export function withGithubReleaseToken(
  config: ReconConfig,
  token: string,
): ReconConfig {
  return {
    ...config,
    github: {
      ...config.github,
      release: {
        ...config.github.release,
        GITHUB_TOKEN: token.trim(),
      },
    },
  };
}

export function withGithubReleaseSkipped(config: ReconConfig): ReconConfig {
  return {
    ...config,
    publish: {
      targets: config.publish.targets.filter((target) => target !== "github"),
    },
    github: {
      ...config.github,
      release: {
        ...config.github.release,
        enabled: false,
      },
    },
  };
}

export function buildGithubCommitUrl(
  repository: GitHubRepository,
  sha: string,
): string {
  return `https://github.com/${repository.owner}/${repository.repo}/commit/${sha}`;
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

export function buildGithubRepositoryRequest({
  repository,
  token,
}: {
  repository: GitHubRepository;
  token: string;
}): { url: string; init: RequestInit } {
  return {
    url: `https://api.github.com/repos/${repository.owner}/${repository.repo}`,
    init: {
      method: "GET",
      headers: createGithubHeaders(token),
    },
  };
}

export function buildGithubReleaseByTagRequest({
  repository,
  token,
  tag,
}: GithubReleaseAccessOptions): { url: string; init: RequestInit } {
  return {
    url: `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases/tags/${encodeURIComponent(tag)}`,
    init: {
      method: "GET",
      headers: createGithubHeaders(token),
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

export async function preflightGithubReleaseAccess(
  options: GithubReleaseAccessOptions,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await assertGithubRepositoryAccess(options, fetchImpl);

  const releaseExists = await hasGithubReleaseForTag(options, fetchImpl);

  if (releaseExists) {
    throw new Error(`GitHub Release already exists for tag ${options.tag}.`);
  }
}

export async function hasGithubReleaseForTag(
  options: GithubReleaseAccessOptions,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const request = buildGithubReleaseByTagRequest(options);
  const response = await fetchImpl(request.url, request.init);

  if (response.ok) return true;

  const responseText = await response.text();

  if (response.status === 404) return false;

  throw new Error(
    `GitHub Release API failed (${response.status}): ${formatGithubApiError(
      responseText,
      response.status,
    )}`,
  );
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
        response.status,
      )}`,
    );
  }
}

async function assertGithubRepositoryAccess(
  options: GithubReleaseAccessOptions,
  fetchImpl: FetchLike,
): Promise<void> {
  const request = buildGithubRepositoryRequest(options);
  const response = await fetchImpl(request.url, request.init);
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `GitHub repository access check failed (${response.status}): ${formatGithubApiError(
        responseText,
        response.status,
      )}`,
    );
  }

  if (!hasWritableRepositoryPermission(responseText)) {
    throw new Error(
      "GITHUB_TOKEN can access this repository but does not appear to have write permission. Grant Contents: Read and write permission for this repository.",
    );
  }
}

function createGithubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "recon-cli",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function normalizeToken(token: string | undefined): string | null {
  if (token === undefined || token.trim().length === 0) return null;

  const normalizedToken = token.trim();

  if (/[\r\n]/.test(normalizedToken)) {
    throw new Error("GITHUB_TOKEN must not contain line breaks.");
  }

  return normalizedToken;
}

function hasWritableRepositoryPermission(responseText: string): boolean {
  try {
    const parsed = JSON.parse(responseText) as {
      permissions?: {
        admin?: unknown;
        maintain?: unknown;
        push?: unknown;
      };
    };

    if (!parsed.permissions) return true;

    return (
      parsed.permissions.admin === true ||
      parsed.permissions.maintain === true ||
      parsed.permissions.push === true
    );
  } catch {
    return true;
  }
}

function formatGithubApiError(responseText: string, status: number): string {
  let message = responseText.length > 0 ? responseText : "Unknown error";

  try {
    const parsed = JSON.parse(responseText) as { message?: unknown };

    if (typeof parsed.message === "string") {
      message = parsed.message;
    }
  } catch {
    // Fall through to raw response body.
  }

  if (status === 401 || status === 403) {
    return `${message}. Make sure GITHUB_TOKEN can access this repository and has Contents: Read and write permission. For fine-grained tokens, select the target repository explicitly.`;
  }

  return message;
}

function isValidGitHubRepository(owner: string, repo: string): boolean {
  return (
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) &&
    /^[A-Za-z0-9._-]+$/.test(repo)
  );
}
