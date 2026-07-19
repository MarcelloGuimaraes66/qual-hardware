import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createIdempotentShutdown,
  DESKTOP_SQLITE_FILENAME,
  externalHttpUrl,
  isLocalApplicationUrl,
  resolveDesktopPaths,
  shouldQuitWhenAllWindowsClosed,
} from "../src/desktop/runtime.js";

describe("cross-platform desktop runtime", () => {
  it.each(["win32", "darwin", "linux"] as const)("keeps persistent resources under userData on %s", (platform) => {
    const userData = join("root", platform, "Qual Hardware");
    const paths = resolveDesktopPaths(join("app", platform), userData);
    expect(paths.databaseFile).toBe(join(userData, DESKTOP_SQLITE_FILENAME));
    expect(paths.catalogCacheFile).toBe(join(userData, "catalog-snapshot.json"));
    expect(paths.catalogConfigFile).toBe(join(userData, "catalog-update-config.json"));
  });

  it("uses native last-window behavior", () => {
    expect(shouldQuitWhenAllWindowsClosed("win32")).toBe(true);
    expect(shouldQuitWhenAllWindowsClosed("linux")).toBe(true);
    expect(shouldQuitWhenAllWindowsClosed("darwin")).toBe(false);
  });

  it("accepts only the local application origin and external HTTP(S) links", () => {
    expect(isLocalApplicationUrl("http://127.0.0.1:4178/path", "http://127.0.0.1:4178")).toBe(true);
    expect(isLocalApplicationUrl("http://127.0.0.1:4179/path", "http://127.0.0.1:4178")).toBe(false);
    expect(isLocalApplicationUrl("not a url", "http://127.0.0.1:4178")).toBe(false);
    expect(externalHttpUrl("https://example.com/catalog")).toBe("https://example.com/catalog");
    expect(externalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(externalHttpUrl("invalid")).toBeNull();
  });

  it("runs shutdown resources exactly once", async () => {
    const action = vi.fn(async () => {});
    const shutdown = createIdempotentShutdown(action);
    await Promise.all([shutdown(), shutdown(), shutdown()]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not request remote fonts or styles from the packaged renderer", async () => {
    const styles = await readFile(new URL("../src/web/styles.css", import.meta.url), "utf8");
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).not.toMatch(/@import\s+url\(['\"]https?:/i);
  });
});
