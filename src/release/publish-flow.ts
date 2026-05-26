import type { ReconConfig } from "../config.js";
import type {
  ConventionalCommit,
  ReleaseType,
} from "./conventional-commits.js";

export type CommitPublishClassification =
  | {
      kind: "versioning";
      releaseType: ReleaseType;
    }
  | {
      kind: "hidden";
    }
  | {
      kind: "unconfigured";
    }
  | {
      kind: "invalid-visible";
      reason: string;
    };

export type PublishFlow =
  | {
      kind: "versioning";
      releaseType: ReleaseType;
    }
  | {
      kind: "push-only";
    }
  | {
      kind: "none";
      reason: string;
    }
  | {
      kind: "error";
      reason: string;
    };

export function classifyPublishFlow(
  commits: ConventionalCommit[],
  config: ReconConfig,
): PublishFlow {
  if (commits.length === 0) {
    return {
      kind: "none",
      reason: "No commits found since the latest tag.",
    };
  }

  const classifications = commits.map((commit) =>
    classifyCommitForPublish(commit, config),
  );
  const invalid = classifications.find(
    (classification) => classification.kind === "invalid-visible",
  );

  if (invalid?.kind === "invalid-visible") {
    return {
      kind: "error",
      reason: invalid.reason,
    };
  }

  const releaseTypes = classifications
    .map((classification) =>
      classification.kind === "versioning" ? classification.releaseType : null,
    )
    .filter((releaseType): releaseType is ReleaseType => releaseType !== null);

  if (releaseTypes.length > 0) {
    return {
      kind: "versioning",
      releaseType: getHighestReleaseType(releaseTypes),
    };
  }

  if (
    classifications.length > 0 &&
    classifications.every((classification) => classification.kind === "hidden")
  ) {
    return {
      kind: "push-only",
    };
  }

  return {
    kind: "none",
    reason: "No configured release commits found.",
  };
}

export function classifyCommitForPublish(
  commit: ConventionalCommit,
  config: ReconConfig,
): CommitPublishClassification {
  const typeConfig = config.changelog.types.find(
    (item) => item.type === commit.type,
  );

  if (!typeConfig) {
    return {
      kind: "unconfigured",
    };
  }

  if (typeConfig.hidden === true) {
    return {
      kind: "hidden",
    };
  }

  if (commit.releaseType !== null) {
    return {
      kind: "versioning",
      releaseType: commit.releaseType,
    };
  }

  return {
    kind: "invalid-visible",
    reason: `Visible changelog type ${typeConfig.type} does not define a SemVer release mapping. Use feat, fix, perf, or a breaking change marker, or mark ${typeConfig.type} as hidden.`,
  };
}

function getHighestReleaseType(releaseTypes: ReleaseType[]): ReleaseType {
  if (releaseTypes.includes("major")) return "major";
  if (releaseTypes.includes("minor")) return "minor";

  return "patch";
}
