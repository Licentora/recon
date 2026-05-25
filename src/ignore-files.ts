import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function ensureIgnoreEntriesContent(
  content: string | null,
  entries: string[],
): string {
  if (content === null) {
    return entries.map((entry) => `${entry}\n`).join("");
  }

  const existingEntries = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const missingEntries = entries.filter(
    (entry) => !existingEntries.includes(entry),
  );

  if (missingEntries.length === 0) {
    return ensureTrailingNewline(content);
  }

  return `${ensureTrailingNewline(content)}${missingEntries
    .map((entry) => `${entry}\n`)
    .join("")}`;
}

export async function ensureIgnoreFileEntries(
  cwd: string,
  fileName: string,
  entries: string[],
): Promise<void> {
  const filePath = join(cwd, fileName);
  const currentContent = existsSync(filePath)
    ? await readFile(filePath, "utf8")
    : null;

  await writeFile(
    filePath,
    ensureIgnoreEntriesContent(currentContent, entries),
  );
}

export async function ensureReconConfigIgnored(cwd: string): Promise<void> {
  await ensureIgnoreFileEntries(cwd, ".gitignore", [
    "recon.json",
    "node_modules/",
    "dist/",
    "build/",
  ]);
  await ensureIgnoreFileEntries(cwd, ".npmignore", ["recon.json"]);
}

export function isGitTracked(cwd: string, fileName: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", fileName], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}
