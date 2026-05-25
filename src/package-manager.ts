import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { PackageManager } from "./config.js";

export interface CommandSpec {
  command: string;
  args: string[];
}

export function getLockfileUpdateCommand(
  packageManager: PackageManager,
): CommandSpec {
  if (packageManager === "npm") {
    return {
      command: "npm",
      args: ["install", "--package-lock-only"],
    };
  }

  if (packageManager === "pnpm") {
    return {
      command: "pnpm",
      args: ["install", "--lockfile-only"],
    };
  }

  return {
    command: "yarn",
    args: ["install", "--mode", "update-lockfile"],
  };
}

export function updateLockfile(
  cwd: string,
  packageManager: PackageManager,
): void {
  const { command, args } = getLockfileUpdateCommand(packageManager);
  const executable = getExecutableInvocation(command, args);

  execFileSync(executable.command, executable.args, {
    cwd,
    stdio: "inherit",
  });
}

export function getExecutableInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CommandSpec {
  if (
    platform === "win32" &&
    (command === "npm" || command === "pnpm" || command === "yarn")
  ) {
    return {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        getExecutableCommand(command, platform),
        ...args,
      ],
    };
  }

  return {
    command,
    args,
  };
}

export function getExecutableCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (
    platform === "win32" &&
    (command === "npm" || command === "pnpm" || command === "yarn")
  ) {
    return `${command}.cmd`;
  }

  return command;
}

export function getPackageManagerLockfile(
  packageManager: PackageManager,
): string {
  if (packageManager === "npm") return "package-lock.json";
  if (packageManager === "pnpm") return "pnpm-lock.yaml";

  return "yarn.lock";
}

export function getReleaseFilePaths(
  cwd: string,
  packageManager: PackageManager,
  includeChangelog: boolean,
): string[] {
  const files = ["package.json"];
  const lockfile = getPackageManagerLockfile(packageManager);

  if (existsSync(join(cwd, lockfile))) {
    files.push(lockfile);
  }

  if (includeChangelog) {
    files.push("CHANGELOG.md");
  }

  return files;
}
