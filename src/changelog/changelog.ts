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

    for (const commit of section.commits) {
      lines.push(`- ${commit.description}`);
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
