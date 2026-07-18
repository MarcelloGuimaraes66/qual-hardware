import { basename, resolve } from "node:path";

export const QUAL_HARDWARE_SQLITE_FILENAME = "qual-hardware.sqlite";
export const QUAL_HARDWARE_SQLITE_SCHEMA_VERSION = 1;

/**
 * Prevents Qual Hardware from opening a Perceptrum or generic shared database.
 * The local file must always keep the dedicated Qual Hardware filename.
 */
export function assertDedicatedSqlitePath(databasePath: string): string {
  if (!databasePath.trim() || databasePath === ":memory:") {
    throw new Error(`Use a file-backed ${QUAL_HARDWARE_SQLITE_FILENAME} database.`);
  }
  const resolved = resolve(databasePath);
  if (basename(resolved).toLowerCase() !== QUAL_HARDWARE_SQLITE_FILENAME) {
    throw new Error(
      `Qual Hardware refuses database file '${basename(resolved) || "(missing)"}'. ` +
      `Use the dedicated '${QUAL_HARDWARE_SQLITE_FILENAME}' file; Perceptrum databases are never allowed.`,
    );
  }
  return resolved;
}
