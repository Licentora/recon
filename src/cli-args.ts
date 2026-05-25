export type CliCommand = "help" | "version" | "init" | "publish" | "unknown";

export interface CliArgs {
  command: CliCommand;
  dryRun: boolean;
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
    return { command: "init", dryRun: false };
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
