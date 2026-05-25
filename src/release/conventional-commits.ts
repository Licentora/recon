export type ReleaseType = "major" | "minor" | "patch";

export interface ConventionalCommit {
  raw: string;
  type: string | null;
  scope: string | null;
  description: string;
  isBreaking: boolean;
  releaseType: ReleaseType | null;
}

const conventionalHeaderPattern =
  /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/;

const breakingFooterPattern = /(^|\n)BREAKING[ -]CHANGE: .+/m;

export function parseConventionalCommit(message: string): ConventionalCommit {
  const raw = message.trim();
  const header = raw.split(/\r?\n/, 1)[0] ?? "";
  const match = conventionalHeaderPattern.exec(header);

  if (!match?.groups) {
    return {
      raw,
      type: null,
      scope: null,
      description: header,
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
