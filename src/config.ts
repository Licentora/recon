import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn";
export type GithubReleaseEnabled = boolean | "auto";

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
  changelog: {
    types: ChangelogType[];
  };
  github: {
    release: GithubReleaseConfig;
  };
}

export const defaultReconConfig: ReconConfig = {
  $schema: "https://licentora.com/recon-schema.json",
  packageManager: "npm",
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
};

export function createDefaultReconConfig(
  packageManager: PackageManager = "npm",
  options: {
    githubReleaseEnabled?: GithubReleaseEnabled;
    defaultPrereleaseChannel?: string;
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
    changelog: {
      types: defaultReconConfig.changelog.types.map((typeConfig) => ({
        ...typeConfig,
      })),
    },
    github: {
      release: githubRelease,
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
    changelog: config.changelog,
    github: {
      release: validateGithubReleaseConfig(config.github),
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
