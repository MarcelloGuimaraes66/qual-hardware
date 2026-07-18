import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { assertDedicatedDatabaseUrl } from "./database.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: assertDedicatedDatabaseUrl(process.env.DATABASE_URL) });
try {
  const sql = await readFile(resolve(process.cwd(), "database", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Qual Hardware database schema applied.");
} finally {
  await pool.end();
}
