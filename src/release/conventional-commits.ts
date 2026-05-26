export type ReleaseType = "major" | "minor" | "patch";

export interface ConventionalCommit {
  raw: string;
  type: string | null;
  scope: string | null;
  description: string;
  body: string;
  footer: string;
  isBreaking: boolean;
  releaseType: ReleaseType | null;
  sha?: string;
  shortSha?: string;
  url?: string | null;
}

const conventionalHeaderPattern =
  /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/;

const breakingFooterPattern = /(^|\n)BREAKING[ -]CHANGE: .+/m;

export function parseConventionalCommit(message: string): ConventionalCommit {
  const raw = message.trim();
  const header = raw.split(/\r?\n/, 1)[0] ?? "";
  const match = conventionalHeaderPattern.exec(header);
  const details = splitCommitDetails(raw);

  if (!match?.groups) {
    return {
      raw,
      type: null,
      scope: null,
      description: header,
      body: details.body,
      footer: details.footer,
      isBreaking: false,
      releaseType: null,
    };
  }

  const type = match.groups.type;
  const description = match.groups.description;
  const isBreaking =
    match.groups.breaking === "!" || breakingFooterPattern.test(raw);

  return {
    raw,
    type,
    scope: match.groups.scope ?? null,
    description,
    body: details.body,
    footer: details.footer,
    isBreaking,
    releaseType: getReleaseType(type, isBreaking),
  };
}

export function getHighestReleaseType(
  commits: ConventionalCommit[],
): ReleaseType | null {
  const releaseTypes = commits
    .map((commit) => commit.releaseType)
    .filter((releaseType): releaseType is ReleaseType => releaseType !== null);

  if (releaseTypes.includes("major")) return "major";
  if (releaseTypes.includes("minor")) return "minor";
  if (releaseTypes.includes("patch")) return "patch";

  return null;
}

function getReleaseType(type: string, isBreaking: boolean): ReleaseType | null {
  if (isBreaking) return "major";
  if (type === "feat") return "minor";
  if (type === "fix" || type === "perf") return "patch";

  return null;
}

function splitCommitDetails(raw: string): { body: string; footer: string } {
  const [, ...detailLines] = raw.split(/\r?\n/);
  const detailText = detailLines.join("\n").trim();

  if (detailText.length === 0) {
    return { body: "", footer: "" };
  }

  const blocks = detailText
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const lastBlock = blocks.at(-1);

  if (lastBlock && isFooterBlock(lastBlock)) {
    return {
      body: blocks.slice(0, -1).join("\n\n"),
      footer: lastBlock,
    };
  }

  return {
    body: blocks.join("\n\n"),
    footer: "",
  };
}

function isFooterBlock(block: string): boolean {
  const lines = block.split("\n").map((line) => line.trimEnd());
  let hasFooterLine = false;

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    if (isFooterLine(line)) {
      hasFooterLine = true;
      continue;
    }

    if (!hasFooterLine) return false;
  }

  return hasFooterLine;
}

function isFooterLine(line: string): boolean {
  return /^(?:BREAKING CHANGE|[A-Za-z0-9-]+)(?:: | #).+/.test(line);
}
