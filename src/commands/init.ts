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
  type PackageManager,
  readReconConfig,
  type ReconConfig,
  writeReconConfig,
} from "../config.js";
import { ensureReconConfigIgnored, isGitTracked } from "../ignore-files.js";

export async function runInit(cwd: string): Promise<void> {
  intro("recon init");

  let githubReleaseEnabled: GithubReleaseEnabled = "auto";
  let defaultPrereleaseChannel = "beta";
  let config: ReconConfig;

  await ensureReconConfigIgnored(cwd);

  if (existsSync(join(cwd, "recon.json"))) {
    log.warn("recon.json already exists. Skipping config file creation.");
    config = await readReconConfig(cwd);
    githubReleaseEnabled = config.github.release.enabled;
  } else {
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
      return;
    }

    const githubReleaseMode = await select<"auto" | "always" | "disabled">({
      message: "How should GitHub Release be configured?",
      initialValue: "auto",
      options: [
        {
          value: "auto",
          label: "Auto",
          hint: "create release if token is available",
        },
        {
          value: "always",
          label: "Always",
          hint: "always create release",
        },
        {
          value: "disabled",
          label: "Disabled",
          hint: "skip GitHub Release",
        },
      ],
    });

    if (isCancel(githubReleaseMode)) {
      cancel("Operation cancelled.");
      return;
    }

    githubReleaseEnabled = mapGithubReleaseMode(githubReleaseMode);

    const selectedDefaultChannel = await select<"alpha" | "beta" | "rc">({
      message: "Default prerelease channel?",
      initialValue: "beta",
      options: [
        { value: "alpha", label: "alpha" },
        { value: "beta", label: "beta" },
        { value: "rc", label: "rc" },
      ],
    });

    if (isCancel(selectedDefaultChannel)) {
      cancel("Operation cancelled.");
      return;
    }

    defaultPrereleaseChannel = selectedDefaultChannel;

    config = createDefaultReconConfig(packageManager, {
      githubReleaseEnabled,
      defaultPrereleaseChannel,
    });

    await writeReconConfig(cwd, config);
    log.success("recon.json created.");
  }

  if (githubReleaseEnabled === false) {
    log.info("GitHub Release disabled. Token setup skipped.");
    outro("Recon setup complete.");
    return;
  }

  const shouldSetupToken = await confirm({
    message: "Save GITHUB_TOKEN in recon.json now?",
    initialValue: true,
  });

  if (isCancel(shouldSetupToken)) {
    cancel("Operation cancelled.");
    return;
  }

  if (shouldSetupToken) {
    const updatedConfig = await setupConfigToken(cwd, config);

    if (updatedConfig === null) return;

    if (updatedConfig !== config) {
      await writeReconConfig(cwd, updatedConfig);
      log.success("GITHUB_TOKEN saved in recon.json.");
    }
  }

  outro("Recon setup complete.");
}

async function setupConfigToken(
  cwd: string,
  config: ReconConfig,
): Promise<ReconConfig | null> {
  if (isGitTracked(cwd, "recon.json")) {
    log.warn(
      "recon.json is already tracked by Git. Run `git rm --cached recon.json` before writing secrets.",
    );
    return config;
  }

  if (config.github.release.GITHUB_TOKEN.trim().length > 0) {
    const tokenAction = await select<"keep" | "replace">({
      message: "GITHUB_TOKEN already exists in recon.json",
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
      log.info("Keeping existing GITHUB_TOKEN.");
      return config;
    }
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

function mapGithubReleaseMode(
  mode: "auto" | "always" | "disabled",
): GithubReleaseEnabled {
  if (mode === "always") return true;
  if (mode === "disabled") return false;

  return "auto";
}
