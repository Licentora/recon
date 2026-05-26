import { rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCommandQuiet } from "./command.js";
import type { NpmPublishConfig, ReconConfig } from "./config.js";
import { getExecutableInvocation } from "./package-manager.js";

export type NpmPublishPlan =
  | { action: "publish" }
  | { action: "skip"; reason: string }
  | { action: "error"; reason: string };

export interface PublishToNpmOptions {
  cwd: string;
  config: NpmPublishConfig;
  distTag: string;
}

export interface NpmPublishPreflightOptions extends PublishToNpmOptions {
  packageName: string;
  version: string;
}

export function resolveNpmTokenFromConfig(
  config: NpmPublishConfig,
): string | null {
  const token = config.NPM_TOKEN.trim();

  if (/[\r\n]/.test(token)) {
    throw new Error("NPM_TOKEN must not contain line breaks.");
  }

  return token.length > 0 ? token : null;
}

export function shouldPromptForNpmToken(
  config: NpmPublishConfig,
  options: { dryRun: boolean },
): boolean {
  if (options.dryRun || config.enabled === false) return false;

  return resolveNpmTokenFromConfig(config) === null;
}

export function withNpmPublishToken(
  config: ReconConfig,
  token: string,
): ReconConfig {
  return {
    ...config,
    npm: {
      ...config.npm,
      publish: {
        ...config.npm.publish,
        NPM_TOKEN: token.trim(),
      },
    },
  };
}

export function withNpmPublishSkipped(config: ReconConfig): ReconConfig {
  return {
    ...config,
    publish: {
      targets: config.publish.targets.filter((target) => target !== "npm"),
    },
    npm: {
      ...config.npm,
      publish: {
        ...config.npm.publish,
        enabled: false,
      },
    },
  };
}

export function resolveNpmPublishPlan(
  config: NpmPublishConfig,
  context: { token: string | null },
): NpmPublishPlan {
  if (config.enabled === false) {
    return {
      action: "skip",
      reason: "npm publish disabled in recon.json.",
    };
  }

  if (context.token === null) {
    return {
      action: config.enabled === "auto" ? "skip" : "error",
      reason: "NPM token not found.",
    };
  }

  return { action: "publish" };
}

export async function publishToNpm({
  cwd,
  config,
  distTag,
}: PublishToNpmOptions): Promise<void> {
  await withTemporaryNpmConfig(config, distTag, async (userConfigPath) => {
    const command = getExecutableInvocation("npm", [
      "publish",
      "--access",
      config.access,
      "--tag",
      distTag,
    ]);

    runCommandQuiet(command.command, command.args, {
      cwd,
      env: createNpmEnv(userConfigPath),
    });
  });
}

export async function preflightNpmPublish({
  cwd,
  config,
  distTag,
  packageName,
  version,
}: NpmPublishPreflightOptions): Promise<void> {
  validatePackageNameForPublish(packageName);

  await withTemporaryNpmConfig(config, distTag, async (userConfigPath) => {
    runNpm(["whoami"], cwd, userConfigPath);

    const packageSpec = `${packageName}@${version}`;

    try {
      runNpm(["view", packageSpec, "version"], cwd, userConfigPath);
      throw new Error(
        `npm package version already exists: ${packageName}@${version}`,
      );
    } catch (error) {
      if (isExpectedNpmNotFound(error)) return;

      throw error;
    }
  });
}

async function withTemporaryNpmConfig(
  config: NpmPublishConfig,
  distTag: string,
  callback: (userConfigPath: string) => void,
): Promise<void> {
  const token = resolveNpmTokenFromConfig(config);

  if (token === null) {
    throw new Error("NPM token not found.");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "recon-npm-"));
  const userConfigPath = join(tempDir, ".npmrc");

  try {
    await writeFile(
      userConfigPath,
      createNpmrcContent(config, token, distTag),
      { mode: 0o600 },
    );

    callback(userConfigPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function createNpmrcContent(
  config: NpmPublishConfig,
  token: string,
  distTag: string = config.tag,
): string {
  return [
    `registry=${config.registry}`,
    `tag=${distTag}`,
    `${getRegistryAuthPrefix(config.registry)}:_authToken=${token}`,
    "",
  ].join("\n");
}

export function getRegistryAuthPrefix(registry: string): string {
  const url = new URL(registry);
  const pathname = url.pathname.endsWith("/")
    ? url.pathname
    : `${url.pathname}/`;

  return `//${url.host}${pathname}`;
}

function runNpm(args: string[], cwd: string, userConfigPath: string): void {
  const command = getExecutableInvocation("npm", args);

  runCommandQuiet(command.command, command.args, {
    cwd,
    env: createNpmEnv(userConfigPath),
  });
}

function createNpmEnv(userConfigPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NPM_CONFIG_USERCONFIG: userConfigPath,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_LOGLEVEL: "error",
  };
}

function validatePackageNameForPublish(packageName: string): void {
  const packageNamePattern =
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

  if (!packageNamePattern.test(packageName)) {
    throw new Error(`Invalid npm package name: ${packageName}`);
  }
}

function isExpectedNpmNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const output = error.message;

  return (
    output.includes("E404") ||
    output.includes("404 Not Found") ||
    output.includes("is not in this registry")
  );
}
