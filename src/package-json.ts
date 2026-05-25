import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface PackageJson {
  version?: unknown;
  [key: string]: unknown;
}

export async function readPackageVersion(cwd: string): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(join(cwd, "package.json"), "utf8"),
  ) as PackageJson;

  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must include a version field.");
  }

  return packageJson.version;
}

export async function updatePackageJsonFileVersion(
  cwd: string,
  version: string,
): Promise<void> {
  const packageJsonPath = join(cwd, "package.json");
  const content = await readFile(packageJsonPath, "utf8");

  await writeFile(packageJsonPath, updatePackageJsonVersion(content, version));
}

export function updatePackageJsonVersion(
  content: string,
  version: string,
): string {
  const packageJson = JSON.parse(content) as PackageJson;

  if (typeof packageJson.version !== "string") {
    throw new Error("package.json must include a version field.");
  }

  packageJson.version = version;

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}
