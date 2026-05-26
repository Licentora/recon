import type { ReconConfig } from "../config.js";
import type { ConventionalCommit } from "../release/conventional-commits.js";

interface GenerateReleaseChangelogOptions {
  version: string;
  date: string;
  commits: ConventionalCommit[];
  config: ReconConfig;
  commitReference?: ChangelogCommitReference;
}

export interface ChangelogCommitReference {
  sha: string;
  url?: string | null;
}

export function generateReleaseChangelog({
  version,
  date,
  commits,
  config,
  commitReference,
}: GenerateReleaseChangelogOptions): string {
  const sections = config.changelog.types
    .filter((typeConfig) => typeConfig.hidden !== true)
    .map((typeConfig) => ({
      type: typeConfig.type,
      section: typeConfig.section,
      commits: commits.filter((commit) => commit.type === typeConfig.type),
    }))
    .filter((section) => section.commits.length > 0);

  if (sections.length === 0) return "";

  const lines = [formatReleaseHeading(version, date, commitReference), ""];

  for (const section of sections) {
    lines.push(`### ${section.section}`, "");

    const entries = section.commits.map((commit) =>
      formatCommitChangelogEntry(commit),
    );

    for (const [index, entry] of entries.entries()) {
      lines.push(...entry);

      const nextEntry = entries[index + 1];

      if (nextEntry && (entry.length > 1 || nextEntry.length > 1)) {
        lines.push("");
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatReleaseHeading(
  version: string,
  date: string,
  commitReference: ChangelogCommitReference | undefined,
): string {
  const prefix = `## [${version}] - ${date}`;

  if (!commitReference) return prefix;

  if (commitReference.url) {
    return `${prefix} [(${commitReference.sha})](${commitReference.url})`;
  }

  return `${prefix} (${commitReference.sha})`;
}

function formatCommitChangelogEntry(commit: ConventionalCommit): string[] {
  const lines = [`- ${commit.description}`];
  const details = [commit.body, commit.footer]
    .map((detail) => detail.trim())
    .filter(Boolean);

  if (details.length === 0) return lines;

  for (const [index, detail] of details.entries()) {
    const blocks = splitMarkdownBlocks(detail);

    for (const [blockIndex, block] of blocks.entries()) {
      const isFirstDetailBlock = index === 0 && blockIndex === 0;
      const isListBlock = startsWithMarkdownList(block);

      if (!isFirstDetailBlock || !isListBlock) {
        lines.push("");
      }

      lines.push(...formatDetailBlock(block, isListBlock));
    }

    if (index < details.length - 1) {
      lines.push("");
    }
  }

  return lines;
}

function formatDetailBlock(value: string, isListBlock: boolean): string[] {
  if (!isListBlock) return value.split(/\r?\n/);

  return value.split(/\r?\n/).map((line) => (line ? `  ${line}` : ""));
}

function splitMarkdownBlocks(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function startsWithMarkdownList(value: string): boolean {
  const firstLine = value.split(/\r?\n/).find((line) => line.trim().length > 0);

  return firstLine ? /^(?:[-*+]|\d+\.)\s+/.test(firstLine.trimStart()) : false;
}

export function prependReleaseChangelog(
  currentContent: string,
  releaseContent: string,
): string {
  const normalizedRelease = ensureTrailingBlankLine(releaseContent.trimEnd());
  const normalizedCurrent = currentContent.trim();

  if (normalizedCurrent.length === 0) {
    return `# Changelog\n\n${normalizedRelease}`;
  }

  if (!normalizedCurrent.startsWith("# Changelog")) {
    return `# Changelog\n\n${normalizedRelease}${normalizedCurrent}\n`;
  }

  const withoutTitle = normalizedCurrent.replace(/^# Changelog\s*/, "");

  return `# Changelog\n\n${normalizedRelease}${withoutTitle.trimStart()}\n`;
}

function ensureTrailingBlankLine(value: string): string {
  return `${value}\n\n`;
}
