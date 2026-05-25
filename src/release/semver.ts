import type { ReleaseType } from "./conventional-commits.js";

const semverPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/;
const prereleaseSemverPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)-(?<identifier>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)\.(?<number>0|[1-9]\d*)$/;

export function bumpVersion(version: string, releaseType: ReleaseType): string {
  const match = semverPattern.exec(version);

  if (!match?.groups) {
    const prereleaseMatch = prereleaseSemverPattern.exec(version);

    if (prereleaseMatch?.groups) {
      return [
        prereleaseMatch.groups.major,
        prereleaseMatch.groups.minor,
        prereleaseMatch.groups.patch,
      ].join(".");
    }

    throw new Error(`Invalid SemVer version: ${version}`);
  }

  const major = Number(match.groups.major);
  const minor = Number(match.groups.minor);
  const patch = Number(match.groups.patch);

  if (releaseType === "major") return `${major + 1}.0.0`;
  if (releaseType === "minor") return `${major}.${minor + 1}.0`;

  return `${major}.${minor}.${patch + 1}`;
}

export function bumpPrereleaseVersion(
  version: string,
  releaseType: ReleaseType,
  prereleaseIdentifier: string,
): string {
  if (!isValidPrereleaseIdentifier(prereleaseIdentifier)) {
    throw new Error(`Invalid prerelease identifier: ${prereleaseIdentifier}`);
  }

  const prereleaseMatch = prereleaseSemverPattern.exec(version);

  if (prereleaseMatch?.groups) {
    const major = prereleaseMatch.groups.major;
    const minor = prereleaseMatch.groups.minor;
    const patch = prereleaseMatch.groups.patch;
    const identifier = prereleaseMatch.groups.identifier;
    const number = Number(prereleaseMatch.groups.number);

    if (identifier === prereleaseIdentifier) {
      return `${major}.${minor}.${patch}-${identifier}.${number + 1}`;
    }

    return `${major}.${minor}.${patch}-${prereleaseIdentifier}.0`;
  }

  return `${bumpVersion(version, releaseType)}-${prereleaseIdentifier}.0`;
}

export function isValidPrereleaseIdentifier(identifier: string): boolean {
  const parts = identifier.split(".");

  return parts.every((part) => {
    if (!/^[0-9A-Za-z-]+$/.test(part)) return false;
    if (/^\d+$/.test(part) && part.length > 1 && part.startsWith("0")) {
      return false;
    }

    return true;
  });
}
