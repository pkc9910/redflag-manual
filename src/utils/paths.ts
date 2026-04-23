import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function getRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function getOutputDir(date: string): string {
  return resolve(getRepoRoot(), "output", date);
}
