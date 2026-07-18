import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assertDedicatedDatabaseUrl,
  QUAL_HARDWARE_DATABASE_NAME,
  QUAL_HARDWARE_SCHEMA_NAME,
} from "../src/server/database.js";

describe("dedicated Qual Hardware database boundary", () => {
  it("accepts only the dedicated qual_hardware PostgreSQL database", () => {
    const dedicated = "postgres://qual_hardware:secret@database:5432/qual_hardware";
    expect(assertDedicatedDatabaseUrl(dedicated)).toBe(dedicated);
    expect(assertDedicatedDatabaseUrl("postgresql://admin:secret@localhost:5432/qual_hardware?sslmode=require"))
      .toContain(`/${QUAL_HARDWARE_DATABASE_NAME}`);

    expect(() => assertDedicatedDatabaseUrl("postgres://user:secret@database:5432/perceptrum"))
      .toThrow("Use the dedicated 'qual_hardware' database");
    expect(() => assertDedicatedDatabaseUrl("postgres://user:secret@database:5432/postgres"))
      .toThrow("Use the dedicated 'qual_hardware' database");
    expect(() => assertDedicatedDatabaseUrl("mysql://user:secret@database/qual_hardware"))
      .toThrow("postgres or postgresql");
  });

  it("guards and namespaces the SQL schema", async () => {
    const sql = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
    expect(sql).toContain("current_database() <> 'qual_hardware'");
    expect(sql).toContain(`CREATE SCHEMA IF NOT EXISTS ${QUAL_HARDWARE_SCHEMA_NAME}`);
    expect(sql).toContain("qual_hardware.scenarios");
    expect(sql).not.toContain("capacity_scenarios");
    expect(sql.toLowerCase()).not.toContain("perceptrum");
  });

  it("provisions an independent database, role, volume and network in Compose", async () => {
    const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("POSTGRES_DB: qual_hardware");
    expect(compose).toContain("POSTGRES_USER: qual_hardware");
    expect(compose).toContain("qual_hardware_database:/var/lib/postgresql/data");
    expect(compose).toContain("qual_hardware_private:");
    expect(compose.toLowerCase()).not.toContain("perceptrum");
  });
});
