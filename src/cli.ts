#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { cancel, log } from "@clack/prompts";

import { parseCliArgs } from "./cli-args.js";
import { runInit } from "./commands/init.js";
import { runPublish } from "./commands/publish.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (args.command === "help") {
    printHelp();
    return;
  }

  if (args.command === "version") {
    console.log(packageJson.version);
    return;
  }

  if (args.command === "init") {
    await runInit(cwd);
    return;
  }

  if (args.command === "publish") {
    await runPublish({ cwd, dryRun: args.dryRun });
    return;
  }

  cancel(`Unknown command: ${args.rawCommand}`);
  printHelp();
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`██████╗  ███████╗ ██████╗  ██████╗  ███╗   ██╗
██╔══██╗ ██╔════╝██╔════╝ ██╔═══██╗ ████╗  ██║
██████╔╝ █████╗  ██║      ██║   ██║ ██╔██╗ ██║
██╔══██╗ ██╔══╝  ██║      ██║   ██║ ██║╚██╗██║
██║  ██║ ███████╗╚██████╗ ╚██████╔╝ ██║ ╚████║
╚═╝  ╚═╝ ╚══════╝ ╚═════╝  ╚═════╝  ╚═╝  ╚═══╝

Usage:
  recon -h, --help          Show help
  recon -v, --version       Show package version
  recon init                Create recon.json
  recon publish             Commit, version, changelog, tag, and push release
  recon publish --dry       Preview release without changing files
  recon publish --dry-run   Preview release without changing files
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  log.error(message);
  process.exitCode = 1;
});
