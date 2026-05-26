import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  password,
  select,
} from "@clack/prompts";

import {
  createDefaultReconConfig,
  type GithubReleaseEnabled,
  type NpmPublishEnabled,
  type PackageManager,
  type PublishTarget,
  readReconConfig,
  type ReconConfig,
  writeReconConfig,
} from "../config.js";
import { ensureReconConfigIgnored, isGitTracked } from "../ignore-files.js";

interface RunInitOptions {
  target?: PublishTarget;
}

type PublishTargetChoice = "all" | PublishTarget;

export async function runInit(
  cwd: string,
  options: RunInitOptions = {},
): Promise<void> {
  intro(options.target ? `recon init --${options.target}` : "recon init");

  await ensureReconConfigIgnored(cwd);

  let config = await resolveInitialConfig(cwd, options.target);

  if (config === null) return;

  const targets =
    options.target === undefined
      ? await promptPublishTargets(config.publish.targets)
      : addPublishTarget(config.publish.targets, options.target);

  if (targets === null) return;

  config = setPublishTargets(config, targets);

  if (targets.includes("github")) {
    const githubConfig = await configureGithubRelease(cwd, config);

    if (githubConfig === null) return;

    config = githubConfig;
  }

  if (targets.includes("npm")) {
    const npmConfig = await configureNpmPublish(cwd, config);

    if (npmConfig === null) return;

    config = npmConfig;
  }

  await writeReconConfig(cwd, config);
  log.success("recon.json updated.");

  if (!targets.includes("github")) {
    log.info("GitHub Release setup skipped.");
  }

  if (!targets.includes("npm")) {
    log.info("npm publish setup skipped.");
  }

  outro("Recon setup complete.");
}

async function resolveInitialConfig(
  cwd: string,
  target: PublishTarget | undefined,
): Promise<ReconConfig | null> {
  if (existsSync(join(cwd, "recon.json"))) {
    log.warn("recon.json already exists. Updating config.");
    return readReconConfig(cwd);
  }

  const packageManager = await promptPackageManager();

  if (packageManager === null) return null;

  const targets: PublishTarget[] = target === undefined ? ["github"] : [target];

  return createDefaultReconConfig(packageManager, {
    githubReleaseEnabled: targets.includes("github") ? "auto" : false,
    npmPublishEnabled: targets.includes("npm") ? "auto" : false,
    publishTargets: targets,
  });
}

async function promptPackageManager(): Promise<PackageManager | null> {
  const packageManager = await select<PackageManager>({
    message: "Which package manager do you use?",
    initialValue: "npm",
    options: [
      { value: "npm", label: "npm" },
      { value: "pnpm", label: "pnpm" },
      { value: "yarn", label: "yarn" },
    ],
  });

  if (isCancel(packageManager)) {
    cancel("Operation cancelled.");
    return null;
  }

  return packageManager;
}

async function promptPublishTargets(
  currentTargets: PublishTarget[],
): Promise<PublishTarget[] | null> {
  const selectedTargets = await select<PublishTargetChoice>({
    message: "Where should recon publish this project?",
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

async function configureGithubRelease(
  cwd: string,
  config: ReconConfig,
): Promise<ReconConfig | null> {
  const githubReleaseMode = await select<"auto" | "always">({
    message: "How should GitHub Release be configured?",
    initialValue: config.github.release.enabled === true ? "always" : "auto",
    options: [
      {
        value: "auto",
        label: "Auto",
        hint: "create release if token is available",
      },
      {
        value: "always",
        label: "Always",
        hint: "fail if token or GitHub remote is missing",
      },
    ],
  });

  if (isCancel(githubReleaseMode)) {
    cancel("Operation cancelled.");
    return null;
  }

  const selectedDefaultChannel = await select<"alpha" | "beta" | "rc">({
    message: "Default prerelease channel?",
    initialValue: getDefaultPrereleaseChannel(config),
    options: [
      { value: "alpha", label: "alpha" },
      { value: "beta", label: "beta" },
      { value: "rc", label: "rc" },
    ],
  });

  if (isCancel(selectedDefaultChannel)) {
    cancel("Operation cancelled.");
    return null;
  }

  const updatedConfig: ReconConfig = {
    ...config,
    github: {
      ...config.github,
      release: {
        ...config.github.release,
        enabled: mapGithubReleaseMode(githubReleaseMode),
        prerelease: {
          ...config.github.release.prerelease,
          defaultChannel: selectedDefaultChannel,
        },
      },
    },
  };

  const shouldSetupToken = await confirm({
    message: "Save GITHUB_TOKEN in recon.json now?",
    initialValue: updatedConfig.github.release.GITHUB_TOKEN.length === 0,
  });

  if (isCancel(shouldSetupToken)) {
    cancel("Operation cancelled.");
    return null;
  }

  if (!shouldSetupToken) return updatedConfig;

  return setupGithubToken(cwd, updatedConfig);
}

async function configureNpmPublish(
  cwd: string,
  config: ReconConfig,
): Promise<ReconConfig | null> {
  const npmPublishMode = await select<"auto" | "always">({
    message: "How should npm publish be configured?",
    initialValue: config.npm.publish.enabled === true ? "always" : "auto",
    options: [
      {
        value: "auto",
        label: "Auto",
        hint: "publish if token is available",
      },
      {
        value: "always",
        label: "Always",
        hint: "fail if token is missing",
      },
    ],
  });

  if (isCancel(npmPublishMode)) {
    cancel("Operation cancelled.");
    return null;
  }

  const updatedConfig: ReconConfig = {
    ...config,
    npm: {
      ...config.npm,
      publish: {
        ...config.npm.publish,
        enabled: mapNpmPublishMode(npmPublishMode),
      },
    },
  };

  const shouldSetupToken = await confirm({
    message: "Save NPM_TOKEN in recon.json now?",
    initialValue: updatedConfig.npm.publish.NPM_TOKEN.length === 0,
  });

  if (isCancel(shouldSetupToken)) {
    cancel("Operation cancelled.");
    return null;
  }

  if (!shouldSetupToken) return updatedConfig;

  return setupNpmToken(cwd, updatedConfig);
}

async function setupGithubToken(
  cwd: string,
  config: ReconConfig,
): Promise<ReconConfig | null> {
  const token = await promptSecretToken({
    cwd,
    currentToken: config.github.release.GITHUB_TOKEN,
    tokenName: "GITHUB_TOKEN",
    inputMessage:
      "Enter GitHub token (Fine-grained PAT, Contents: Read and write)",
  });

  if (token === null) return null;

  return {
    ...config,
    github: {
      ...config.github,
      release: {
        ...config.github.release,
        GITHUB_TOKEN: token,
      },
    },
  };
}

async function setupNpmToken(
  cwd: string,
  config: ReconConfig,
): Promise<ReconConfig | null> {
  const token = await promptSecretToken({
    cwd,
    currentToken: config.npm.publish.NPM_TOKEN,
    tokenName: "NPM_TOKEN",
    inputMessage: "Enter npm token (Automation token recommended)",
  });

  if (token === null) return null;

  return {
    ...config,
    npm: {
      ...config.npm,
      publish: {
        ...config.npm.publish,
        NPM_TOKEN: token,
      },
    },
  };
}

async function promptSecretToken({
  cwd,
  currentToken,
  tokenName,
  inputMessage,
}: {
  cwd: string;
  currentToken: string;
  tokenName: "GITHUB_TOKEN" | "NPM_TOKEN";
  inputMessage: string;
}): Promise<string | null> {
  if (isGitTracked(cwd, "recon.json")) {
    log.warn(
      "recon.json is already tracked by Git. Run `git rm --cached recon.json` before writing secrets.",
    );
    return currentToken;
  }

  if (currentToken.trim().length > 0) {
    const tokenAction = await select<"keep" | "replace">({
      message: `${tokenName} already exists in recon.json`,
      initialValue: "keep",
      options: [
        { value: "keep", label: "Keep existing" },
        { value: "replace", label: "Replace token" },
      ],
    });

    if (isCancel(tokenAction)) {
      cancel("Operation cancelled.");
      return null;
    }

    if (tokenAction === "keep") {
      log.info(`Keeping existing ${tokenName}.`);
      return currentToken;
    }
  }

  const token = await password({
    message: inputMessage,
    validate(value) {
      if (!value || value.trim().length === 0) {
        return `${tokenName} is required.`;
      }
    },
  });

  if (isCancel(token)) {
    cancel("Operation cancelled.");
    return null;
  }

  return token.trim();
}

function setPublishTargets(
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

function addPublishTarget(
  currentTargets: PublishTarget[],
  target: PublishTarget,
): PublishTarget[] {
  return [...new Set([...currentTargets, target])];
}

function getPublishTargetChoice(targets: PublishTarget[]): PublishTargetChoice {
  if (targets.includes("github") && targets.includes("npm")) return "all";
  if (targets.includes("npm")) return "npm";

  return "github";
}

function getDefaultPrereleaseChannel(
  config: ReconConfig,
): "alpha" | "beta" | "rc" {
  const currentChannel = config.github.release.prerelease.defaultChannel;

  if (
    currentChannel === "alpha" ||
    currentChannel === "beta" ||
    currentChannel === "rc"
  ) {
    return currentChannel;
  }

  return "beta";
}

function mapGithubReleaseMode(mode: "auto" | "always"): GithubReleaseEnabled {
  if (mode === "always") return true;

  return "auto";
}

function mapNpmPublishMode(mode: "auto" | "always"): NpmPublishEnabled {
  if (mode === "always") return true;

  return "auto";
}
