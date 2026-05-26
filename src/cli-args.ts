export type CliCommand = "help" | "version" | "init" | "publish" | "unknown";

export interface CliArgs {
  command: CliCommand;
  dryRun: boolean;
  initTarget?: "github" | "npm";
  rawCommand?: string;
}

export function parseCliArgs(args: string[]): CliArgs {
  const [command, ...flags] = args;

  if (!command || command === "-h" || command === "--help") {
    return { command: "help", dryRun: false };
  }

  if (command === "-v" || command === "--version") {
    return { command: "version", dryRun: false };
  }

  if (command === "init") {
    const validFlags = new Set(["--github", "-gh", "--npm", "-n"]);
    const unknownFlag = flags.find((flag) => !validFlags.has(flag));

    if (unknownFlag) {
      return {
        command: "unknown",
        dryRun: false,
        rawCommand: `init ${unknownFlag}`,
      };
    }

    const hasGithubFlag = flags.includes("--github") || flags.includes("-gh");
    const hasNpmFlag = flags.includes("--npm") || flags.includes("-n");

    if (hasGithubFlag && hasNpmFlag) {
      return {
        command: "unknown",
        dryRun: false,
        rawCommand: "init --github --npm",
      };
    }

    return {
      command: "init",
      dryRun: false,
      initTarget: hasGithubFlag ? "github" : hasNpmFlag ? "npm" : undefined,
    };
  }

  if (command === "publish") {
    const validFlags = new Set(["--dry", "--dry-run"]);
    const unknownFlag = flags.find((flag) => !validFlags.has(flag));

    if (unknownFlag) {
      return {
        command: "unknown",
        dryRun: false,
        rawCommand: `publish ${unknownFlag}`,
      };
    }

    return {
      command: "publish",
      dryRun: flags.some((flag) => validFlags.has(flag)),
    };
  }

  return {
    command: "unknown",
    dryRun: false,
    rawCommand: command,
  };
}
