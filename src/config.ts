import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn";
export type GithubReleaseEnabled = boolean | "auto";
export type PublishTarget = "github" | "npm";
export type NpmPublishEnabled = boolean | "auto";
export type NpmPublishAccess = "public" | "restricted";

export interface PrereleaseChannel {
  name: string;
  identifier: string;
}

export interface PrereleaseConfig {
  defaultChannel: string;
  channels: PrereleaseChannel[];
}

export interface GithubReleaseConfig {
  GITHUB_TOKEN: string;
  enabled: GithubReleaseEnabled;
  prerelease: PrereleaseConfig;
}

export interface NpmPublishConfig {
  NPM_TOKEN: string;
  enabled: NpmPublishEnabled;
  registry: string;
  access: NpmPublishAccess;
  tag: string;
}

export type ChangelogType =
  | {
      type: string;
      section: string;
      hidden?: false;
    }
  | {
      type: string;
      hidden: true;
    };

export interface ReconConfig {
  $schema?: string;
  packageManager: PackageManager;
  publish: {
    targets: PublishTarget[];
  };
  changelog: {
    types: ChangelogType[];
  };
  github: {
    release: GithubReleaseConfig;
  };
  npm: {
    publish: NpmPublishConfig;
  };
}

export const defaultReconConfig: ReconConfig = {
  $schema: "https://licentora.com/recon-schema.json",
  packageManager: "npm",
  publish: {
    targets: ["github"],
  },
  changelog: {
    types: [
      { type: "feat", section: "Features" },
      { type: "fix", section: "Bug Fixes" },
      { type: "perf", section: "Performance Improvements" },
      { type: "docs", hidden: true },
      { type: "chore", hidden: true },
      { type: "style", hidden: true },
      { type: "test", hidden: true },
    ],
  },
  github: {
    release: {
      GITHUB_TOKEN: "",
      enabled: "auto",
      prerelease: {
        defaultChannel: "beta",
        channels: [
          { name: "alpha", identifier: "alpha" },
          { name: "beta", identifier: "beta" },
          { name: "rc", identifier: "rc" },
        ],
      },
    },
  },
  npm: {
    publish: {
      NPM_TOKEN: "",
      enabled: false,
      registry: "https://registry.npmjs.org/",
      access: "public",
      tag: "latest",
    },
  },
};

export function createDefaultReconConfig(
  packageManager: PackageManager = "npm",
  options: {
    githubReleaseEnabled?: GithubReleaseEnabled;
    defaultPrereleaseChannel?: string;
    publishTargets?: PublishTarget[];
    npmPublishEnabled?: NpmPublishEnabled;
  } = {},
): ReconConfig {
  const githubRelease = {
    ...defaultReconConfig.github.release,
    enabled:
      options.githubReleaseEnabled ?? defaultReconConfig.github.release.enabled,
    prerelease: {
      ...defaultReconConfig.github.release.prerelease,
      defaultChannel:
        options.defaultPrereleaseChannel ??
        defaultReconConfig.github.release.prerelease.defaultChannel,
      channels: defaultReconConfig.github.release.prerelease.channels.map(
        (channel) => ({
          ...channel,
        }),
      ),
    },
  };

  return {
    ...defaultReconConfig,
    packageManager,
    publish: {
      targets: normalizePublishTargets(
        options.publishTargets ?? defaultReconConfig.publish.targets,
      ),
    },
    changelog: {
      types: defaultReconConfig.changelog.types.map((typeConfig) => ({
        ...typeConfig,
      })),
    },
    github: {
      release: githubRelease,
    },
    npm: {
      publish: {
        ...defaultReconConfig.npm.publish,
        enabled:
          options.npmPublishEnabled ?? defaultReconConfig.npm.publish.enabled,
      },
    },
  };
}

export function validateReconConfig(config: unknown): ReconConfig {
  if (!isRecord(config)) {
    throw new Error("recon.json must contain an object.");
  }

  if (!isPackageManager(config.packageManager)) {
    throw new Error(
      `Unsupported package manager: ${String(config.packageManager)}`,
    );
  }

  if (!isRecord(config.changelog)) {
    throw new Error("recon.json must include changelog config.");
  }

  if (
    !Array.isArray(config.changelog.types) ||
    config.changelog.types.length === 0
  ) {
    throw new Error(
      "recon.json changelog.types must contain at least one type.",
    );
  }

  for (const typeConfig of config.changelog.types) {
    if (!isRecord(typeConfig) || typeof typeConfig.type !== "string") {
      throw new Error("Each changelog type must define a type.");
    }

    if (!/^[a-z][a-z0-9-]*$/.test(typeConfig.type)) {
      throw new Error(`Invalid changelog type: ${typeConfig.type}`);
    }

    if (typeConfig.hidden === true) {
      if ("section" in typeConfig) {
        throw new Error(
          `Hidden changelog type ${typeConfig.type} must not define a section.`,
        );
      }

      continue;
    }

    if (
      typeof typeConfig.section !== "string" ||
      typeConfig.section.length === 0
    ) {
      throw new Error(
        `Visible changelog type ${typeConfig.type} must define a section.`,
      );
    }
  }

  return {
    ...config,
    packageManager: config.packageManager,
    publish: validatePublishConfig(config),
    changelog: config.changelog,
    github: {
      release: validateGithubReleaseConfig(config.github),
    },
    npm: {
      publish: validateNpmPublishConfig(config.npm),
    },
  } as unknown as ReconConfig;
}

export async function readReconConfig(cwd: string): Promise<ReconConfig> {
  const configPath = join(cwd, "recon.json");
  const content = await readTextFile(
    configPath,
    "recon.json not found. Run `recon init` first.",
  );

  return validateReconConfig(JSON.parse(content));
}

export async function writeReconConfig(
  cwd: string,
  config: ReconConfig,
): Promise<void> {
  await writeFile(
    join(cwd, "recon.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

export function isPackageManager(value: unknown): value is PackageManager {
  return value === "npm" || value === "pnpm" || value === "yarn";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateGithubReleaseConfig(github: unknown): GithubReleaseConfig {
  if (github === undefined) {
    return { ...defaultReconConfig.github.release };
  }

  if (!isRecord(github)) {
    throw new Error("github must contain an object.");
  }

  if (github.release === undefined) {
    return { ...defaultReconConfig.github.release };
  }

  if (!isRecord(github.release)) {
    throw new Error("github.release must contain an object.");
  }

  const release = github.release;
  const token =
    typeof release.GITHUB_TOKEN === "string" ? release.GITHUB_TOKEN : "";
  const enabled = release.enabled ?? defaultReconConfig.github.release.enabled;

  if (enabled !== true && enabled !== false && enabled !== "auto") {
    throw new Error("github.release.enabled must be true, false, or auto.");
  }

  return {
    GITHUB_TOKEN: token,
    enabled,
    prerelease: validatePrereleaseConfig(release),
  };
}

function validatePublishConfig(config: Record<string, unknown>): {
  targets: PublishTarget[];
} {
  if (isRecord(config.publish)) {
    const targets = config.publish.targets;

    if (!Array.isArray(targets)) {
      throw new Error("publish.targets must contain an array.");
    }

    return {
      targets: normalizePublishTargets(targets),
    };
  }

  const githubRelease = validateGithubReleaseConfig(config.github);

  return {
    targets: githubRelease.enabled === false ? [] : ["github"],
  };
}

export function normalizePublishTargets(targets: unknown[]): PublishTarget[] {
  const normalizedTargets = targets.filter(
    (target): target is PublishTarget =>
      target === "github" || target === "npm",
  );
  const uniqueTargets = [...new Set(normalizedTargets)];

  if (uniqueTargets.length !== targets.length) {
    throw new Error("publish.targets must only contain github or npm.");
  }

  return uniqueTargets;
}

function validateNpmPublishConfig(npm: unknown): NpmPublishConfig {
  if (npm === undefined) {
    return { ...defaultReconConfig.npm.publish };
  }

  if (!isRecord(npm)) {
    throw new Error("npm must contain an object.");
  }

  if (npm.publish === undefined) {
    return { ...defaultReconConfig.npm.publish };
  }

  if (!isRecord(npm.publish)) {
    throw new Error("npm.publish must contain an object.");
  }

  const publish = npm.publish;
  const token = typeof publish.NPM_TOKEN === "string" ? publish.NPM_TOKEN : "";
  const enabled = publish.enabled ?? defaultReconConfig.npm.publish.enabled;
  const registry =
    typeof publish.registry === "string" && publish.registry.length > 0
      ? normalizeNpmRegistry(publish.registry)
      : defaultReconConfig.npm.publish.registry;
  const access = publish.access ?? defaultReconConfig.npm.publish.access;
  const tag =
    typeof publish.tag === "string" && publish.tag.length > 0
      ? publish.tag
      : defaultReconConfig.npm.publish.tag;

  if (enabled !== true && enabled !== false && enabled !== "auto") {
    throw new Error("npm.publish.enabled must be true, false, or auto.");
  }

  if (access !== "public" && access !== "restricted") {
    throw new Error("npm.publish.access must be public or restricted.");
  }

  if (!isValidNpmDistTag(tag)) {
    throw new Error(`Invalid npm dist-tag: ${tag}`);
  }

  return {
    NPM_TOKEN: token,
    enabled,
    registry,
    access,
    tag,
  };
}

function validatePrereleaseConfig(
  release: Record<string, unknown>,
): PrereleaseConfig {
  if (isRecord(release.prerelease)) {
    return validatePrereleaseObject(release.prerelease);
  }

  if (typeof release.prerelease === "boolean") {
    const identifier =
      typeof release.prereleaseIdentifier === "string"
        ? release.prereleaseIdentifier
        : defaultReconConfig.github.release.prerelease.defaultChannel;

    if (!isValidPrereleaseIdentifier(identifier)) {
      throw new Error(`Invalid prerelease identifier: ${identifier}`);
    }

    const channels = [
      ...defaultReconConfig.github.release.prerelease.channels.map(
        (channel) => ({
          ...channel,
        }),
      ),
    ];

    if (!channels.some((channel) => channel.name === identifier)) {
      channels.push({ name: identifier, identifier });
    }

    return {
      defaultChannel: identifier,
      channels,
    };
  }

  if (release.prerelease === undefined) {
    return {
      defaultChannel:
        defaultReconConfig.github.release.prerelease.defaultChannel,
      channels: defaultReconConfig.github.release.prerelease.channels.map(
        (channel) => ({
          ...channel,
        }),
      ),
    };
  }

  throw new Error("github.release.prerelease must contain an object.");
}

function validatePrereleaseObject(
  value: Record<string, unknown>,
): PrereleaseConfig {
  if (typeof value.defaultChannel !== "string") {
    throw new Error("github.release.prerelease.defaultChannel is required.");
  }

  if (!Array.isArray(value.channels) || value.channels.length === 0) {
    throw new Error("github.release.prerelease.channels must not be empty.");
  }

  const channels = value.channels.map((channel) => {
    if (!isRecord(channel)) {
      throw new Error("Each prerelease channel must contain an object.");
    }

    if (typeof channel.name !== "string" || channel.name.length === 0) {
      throw new Error("Each prerelease channel must define a name.");
    }

    if (typeof channel.identifier !== "string") {
      throw new Error(
        `Prerelease channel ${channel.name} must define an identifier.`,
      );
    }

    if (!isValidPrereleaseIdentifier(channel.identifier)) {
      throw new Error(`Invalid prerelease identifier: ${channel.identifier}`);
    }

    return {
      name: channel.name,
      identifier: channel.identifier,
    };
  });

  if (!channels.some((channel) => channel.name === value.defaultChannel)) {
    throw new Error(
      "github.release.prerelease.defaultChannel must match a channel.",
    );
  }

  return {
    defaultChannel: value.defaultChannel,
    channels,
  };
}

function isValidPrereleaseIdentifier(identifier: string): boolean {
  const parts = identifier.split(".");

  return parts.every((part) => {
    if (!/^[0-9A-Za-z-]+$/.test(part)) return false;
    if (/^\d+$/.test(part) && part.length > 1 && part.startsWith("0")) {
      return false;
    }

    return true;
  });
}

export function isValidNpmDistTag(tag: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(tag);
}

function normalizeNpmRegistry(registry: string): string {
  let url: URL;

  try {
    url = new URL(registry);
  } catch {
    throw new Error(`Invalid npm registry URL: ${registry}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("npm.publish.registry must use http or https.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "npm.publish.registry must not include credentials, query, or hash.",
    );
  }

  if (url.hostname.length === 0) {
    throw new Error("npm.publish.registry must include a hostname.");
  }

  if (!/^[A-Za-z0-9._~!$'()*+,;=:@/-]*$/.test(url.pathname)) {
    throw new Error("npm.publish.registry contains unsupported characters.");
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }

  return url.toString();
}

async function readTextFile(
  filePath: string,
  missingMessage: string,
): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(missingMessage);
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
