import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupCalibrationWorkspace,
  calibrationDiskReserveBytes,
  createCalibrationWorkspace,
  prepareCalibrationTemporaryFile,
  readCalibrationWorkspace,
  refreshRegisteredCalibrationTemporaryFiles,
  reclaimCalibrationPhaseFiles,
  registerCalibrationTemporaryFile,
  setCalibrationWorkspaceOwner,
} from "../src/server/calibrationTemporaryFiles.js";
import { CalibrationKernelService } from "../src/server/calibrationKernelService.js";

const generatedRoots: string[] = [];
afterEach(async () => {
  for (const root of generatedRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "qual-hardware-calibration-test-"));
  generatedRoots.push(root);
  return createCalibrationWorkspace({
    root,
    sessionId: "00000000-0000-4000-8000-000000000100",
    runId: "00000000-0000-4000-8000-000000000101",
    appVersion: "test",
  });
}

describe("session-owned calibration temporary files", () => {
  it("removes every registered temporary file and only the exact session directory", async () => {
    const created = await workspace();
    await writeFile(join(created.directory, "synthetic-media.bin"), Buffer.alloc(4_096, 7));
    await registerCalibrationTemporaryFile(created, "synthetic-media.bin");
    await writeFile(join(created.root, "unrelated.txt"), "preserve me");

    await expect(cleanupCalibrationWorkspace(created.root, created.manifest.sessionId)).resolves.toEqual({ bytesRemoved: 4_096 });
    expect(await readdir(created.root)).toEqual(["unrelated.txt"]);
    expect(await readFile(join(created.root, "unrelated.txt"), "utf8")).toBe("preserve me");
  });

  it("rejects traversal and never registers a path outside the workspace", async () => {
    const created = await workspace();
    await expect(registerCalibrationTemporaryFile(created, "../outside.bin")).rejects.toThrow("invalid_relative_path");
    await expect(registerCalibrationTemporaryFile(created, "/tmp/outside.bin")).rejects.toThrow("nested_or_reserved_path");
  });

  it("preserves the workspace when an unregistered file is present", async () => {
    const created = await workspace();
    await writeFile(join(created.directory, "registered.bin"), "registered");
    await registerCalibrationTemporaryFile(created, "registered.bin");
    await writeFile(join(created.directory, "foreign.bin"), "must not be deleted");

    await expect(cleanupCalibrationWorkspace(created.root, created.manifest.sessionId)).rejects.toThrow("unregistered_entry:foreign.bin");
    expect(await readFile(join(created.directory, "foreign.bin"), "utf8")).toBe("must not be deleted");
  });

  it.runIf(process.platform !== "win32")("refuses symbolic links even when their names appear in the manifest", async () => {
    const created = await workspace();
    const outside = join(created.root, "outside.txt");
    await writeFile(outside, "outside");
    await symlink(outside, join(created.directory, "link.bin"));
    await expect(registerCalibrationTemporaryFile(created, "link.bin")).rejects.toThrow("must_be_regular");
    expect(await readFile(outside, "utf8")).toBe("outside");
  });

  it("requires the ownership marker and exact UUID before cleanup", async () => {
    const created = await workspace();
    const manifest = JSON.parse(await readFile(created.manifestPath, "utf8")) as Record<string, unknown>;
    manifest.marker = "foreign";
    await writeFile(created.manifestPath, JSON.stringify(manifest));
    await expect(readCalibrationWorkspace(created.root, created.manifest.sessionId)).rejects.toThrow("manifest_not_owned");
    await expect(cleanupCalibrationWorkspace(created.root, created.manifest.sessionId)).rejects.toThrow("manifest_not_owned");
  });

  it("rejects an invalid session UUID before resolving or touching a directory", async () => {
    const created = await workspace();
    await expect(readCalibrationWorkspace(created.root, "../outside")).rejects.toThrow("invalid_session_id");
    await expect(cleanupCalibrationWorkspace(created.root, "not-a-uuid")).rejects.toThrow("invalid_session_id");
    expect(await readdir(created.root)).toEqual([created.manifest.sessionId]);
  });

  it("preserves a session directory whose ownership manifest is missing", async () => {
    const created = await workspace();
    await writeFile(join(created.directory, "unknown.bin"), "preserve");
    await unlink(created.manifestPath);
    await expect(cleanupCalibrationWorkspace(created.root, created.manifest.sessionId)).rejects.toThrow();
    expect(await readFile(join(created.directory, "unknown.bin"), "utf8")).toBe("preserve");
  });

  it("never reports a present manifest-less session directory as successfully cleaned", async () => {
    const root = await mkdtemp(join(tmpdir(), "qual-hardware-calibration-service-test-"));
    generatedRoots.push(root);
    const sessionId = "00000000-0000-4000-8000-000000000177";
    await mkdir(join(root, sessionId));
    await writeFile(join(root, sessionId, "unknown.bin"), "preserve");
    const service = new CalibrationKernelService({
      temporaryRoot: root,
      evidenceDirectory: join(root, "evidence"),
      resourceRoot: new URL("..", import.meta.url).pathname,
      appVersion: "test",
    });
    const cleanup = await service.retryCleanup(sessionId);
    expect(cleanup.state).toBe("failed");
    expect(cleanup.remainingBytes).toBeGreaterThan(0);
    expect(await readFile(join(root, sessionId, "unknown.bin"), "utf8")).toBe("preserve");
  });

  it.runIf(process.platform !== "win32")("refuses a session UUID symlink that points outside the controlled root", async () => {
    const root = await mkdtemp(join(tmpdir(), "qual-hardware-calibration-symlink-root-"));
    const outside = await mkdtemp(join(tmpdir(), "qual-hardware-calibration-symlink-outside-"));
    generatedRoots.push(root, outside);
    await mkdir(join(outside, "owned"));
    const sessionId = "00000000-0000-4000-8000-000000000155";
    await symlink(join(outside, "owned"), join(root, sessionId));
    await expect(readCalibrationWorkspace(root, sessionId)).rejects.toThrow("outside_controlled_root");
    expect(await readdir(join(outside, "owned"))).toEqual([]);
  });

  it("recovers a predeclared mutable file after an interrupted writer", async () => {
    const created = await workspace();
    const path = await prepareCalibrationTemporaryFile(created, "pipeline-probe.sqlite");
    await writeFile(path, Buffer.alloc(8_192, 9));

    await expect(cleanupCalibrationWorkspace(created.root, created.manifest.sessionId)).rejects.toThrow("hash_changed");
    await refreshRegisteredCalibrationTemporaryFiles(created.root, created.manifest.sessionId);
    await expect(cleanupCalibrationWorkspace(created.root, created.manifest.sessionId)).resolves.toEqual({ bytesRemoved: 8_192 });
  });

  it("refreshes the live phase manifest before checkpoint reclamation", async () => {
    const created = await workspace();
    setCalibrationWorkspaceOwner(created, "discovery-1", 2);
    const path = await prepareCalibrationTemporaryFile(created, "media-0-0-0.mkv");
    await writeFile(path, Buffer.alloc(4_096, 3));

    await refreshRegisteredCalibrationTemporaryFiles(created.root, created.manifest.sessionId, created);
    await expect(reclaimCalibrationPhaseFiles(created, "discovery-1", 2))
      .resolves.toEqual({ bytesRemoved: 4_096, filesRemoved: 1 });
  });

  it("serializes many concurrent manifest registrations without corrupting JSON", async () => {
    const created = await workspace();
    const count = 64;
    await Promise.all(Array.from({ length: count }, (_, index) =>
      prepareCalibrationTemporaryFile(created, `concurrent-${index}.bin`)));
    const reopened = await readCalibrationWorkspace(created.root, created.manifest.sessionId);
    expect(reopened.manifest.files).toHaveLength(count);
    expect(new Set(reopened.manifest.files.map((entry) => entry.relativePath)).size).toBe(count);
    await expect(cleanupCalibrationWorkspace(created.root, created.manifest.sessionId))
      .resolves.toEqual({ bytesRemoved: 0 });
  });

  it("refreshes mutable hashes only for an explicitly interrupted-session recovery", async () => {
    const created = await workspace();
    const path = await prepareCalibrationTemporaryFile(created, "telemetry.jsonl");
    await writeFile(path, "partial telemetry");
    const service = new CalibrationKernelService({
      temporaryRoot: created.root,
      evidenceDirectory: join(created.root, "evidence"),
      resourceRoot: new URL("..", import.meta.url).pathname,
      appVersion: "test",
    });
    const normal = await service.retryCleanup(created.manifest.sessionId);
    expect(normal.state).toBe("failed");
    expect(await readFile(path, "utf8")).toBe("partial telemetry");
    const recovered = await service.retryCleanup(created.manifest.sessionId, true);
    expect(recovered.state).toBe("completed");
    expect(recovered.remainingBytes).toBe(0);
  });

  it("does not refresh or remove an unregistered file during interrupted-session recovery", async () => {
    const created = await workspace();
    await prepareCalibrationTemporaryFile(created, "known.bin");
    await writeFile(join(created.directory, "foreign.bin"), "preserve");

    await expect(refreshRegisteredCalibrationTemporaryFiles(created.root, created.manifest.sessionId)).rejects.toThrow("unregistered_entry:foreign.bin");
    expect(await readFile(join(created.directory, "foreign.bin"), "utf8")).toBe("preserve");
  });

  it("reclaims only the committed phase while retaining shared files for terminal cleanup", async () => {
    const created = await workspace();
    const retained = await prepareCalibrationTemporaryFile(created, "pipeline.sqlite", { retain: true });
    await writeFile(retained, "database");
    await registerCalibrationTemporaryFile(created, "pipeline.sqlite", { retain: true });
    setCalibrationWorkspaceOwner(created, "discovery-4", 2);
    const phaseFile = await prepareCalibrationTemporaryFile(created, "media-4.mkv");
    await writeFile(phaseFile, Buffer.alloc(2_048, 4));
    await registerCalibrationTemporaryFile(created, "media-4.mkv");

    await expect(reclaimCalibrationPhaseFiles(created, "discovery-4", 2)).resolves.toEqual({ bytesRemoved: 2_048, filesRemoved: 1 });
    expect(await readFile(retained, "utf8")).toBe("database");
    await expect(readFile(phaseFile)).rejects.toMatchObject({ code: "ENOENT" });
    const manifest = await readCalibrationWorkspace(created.root, created.manifest.sessionId);
    expect(manifest.manifest.files.find((entry) => entry.relativePath === "media-4.mkv")?.state).toBe("deleted");
    expect(manifest.manifest.files.find((entry) => entry.relativePath === "pipeline.sqlite")?.state).toBe("retained");
  });

  it("clamps the 15% disk reserve between 10 and 50 GiB", () => {
    const gib = 1024 ** 3;
    expect(calibrationDiskReserveBytes(20 * gib)).toBe(10 * gib);
    expect(calibrationDiskReserveBytes(100 * gib)).toBe(15 * gib);
    expect(calibrationDiskReserveBytes(1_000 * gib)).toBe(50 * gib);
  });
});
