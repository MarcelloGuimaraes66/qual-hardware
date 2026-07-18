export const QUAL_HARDWARE_DATABASE_NAME = "qual_hardware";
export const QUAL_HARDWARE_SCHEMA_NAME = "qual_hardware";

/**
 * Prevents Qual Hardware from ever being pointed at a Perceptrum or shared database.
 * PostgreSQL provisioning must create the dedicated `qual_hardware` database first.
 */
export function assertDedicatedDatabaseUrl(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL for the dedicated qual_hardware database.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (databaseName !== QUAL_HARDWARE_DATABASE_NAME) {
    throw new Error(
      `Qual Hardware refuses database '${databaseName || "(missing)"}'. ` +
      `Use the dedicated '${QUAL_HARDWARE_DATABASE_NAME}' database; Perceptrum databases are never allowed.`,
    );
  }
  return connectionString;
}
