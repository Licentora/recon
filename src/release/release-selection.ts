import type { PrereleaseChannel } from "../config.js";
import type { ReleaseType } from "./conventional-commits.js";
import { bumpPrereleaseVersion, bumpVersion } from "./semver.js";

export type ReleaseSelection =
  | {
      kind: "stable";
    }
  | {
      kind: "prerelease";
      channel: PrereleaseChannel;
    };

export interface ResolvedReleaseVersion {
  version: string;
  isPrerelease: boolean;
}

export function resolveNextVersion(
  currentVersion: string,
  releaseType: ReleaseType,
  selection: ReleaseSelection,
): ResolvedReleaseVersion {
  if (selection.kind === "stable") {
    return {
      version: bumpVersion(currentVersion, releaseType),
      isPrerelease: false,
    };
  }

  return {
    version: bumpPrereleaseVersion(
      currentVersion,
      releaseType,
      selection.channel.identifier,
    ),
    isPrerelease: true,
  };
}
