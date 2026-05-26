import { execFileSync } from "node:child_process";

interface RunCommandQuietOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export function runCommandQuiet(
  command: string,
  args: string[],
  options: RunCommandQuietOptions,
): string {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(formatCommandError(command, args, error));
  }
}

function formatCommandError(
  command: string,
  args: string[],
  error: unknown,
): string {
  const output = getCommandOutput(error);
  const commandText = [command, ...args].join(" ");

  if (output.length === 0) {
    return `Command failed: ${commandText}`;
  }

  return [`Command failed: ${commandText}`, trimCommandOutput(output)].join(
    "\n",
  );
}

function getCommandOutput(error: unknown): string {
  if (!isRecord(error)) return "";

  const stdout = bufferLikeToString(error.stdout);
  const stderr = bufferLikeToString(error.stderr);

  return [stdout, stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
}

function bufferLikeToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");

  return "";
}

function trimCommandOutput(output: string): string {
  const lines = output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const selectedLines = lines.slice(-20);

  return selectedLines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
