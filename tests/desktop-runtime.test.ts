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
import { redactDesktopLog } from "../src/desktop/logger.js";

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
    expect(externalHttpUrl("https://aiquimist.ai/")).toBe("https://aiquimist.ai/");
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
    const [styles, html] = await Promise.all([
      readFile(new URL("../src/web/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../index.html", import.meta.url), "utf8"),
    ]);
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).not.toMatch(/@import\s+url\(['\"]https?:/i);
    expect(html).not.toMatch(/http-equiv=["']Content-Security-Policy["']/i);
  });

  it("uses protocol activation and dynamic runtime origins instead of a fixed Perceptrum port", async () => {
    const [application, sessions] = await Promise.all([
      readFile(new URL("../src/server/app.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/server/calibrationSessions.ts", import.meta.url), "utf8"),
    ]);
    expect(`${application}\n${sessions}`).not.toContain("127.0.0.1:4000");
    expect(sessions).toContain('searchParams.set("qualOrigin"');
    expect(sessions).toContain("runtimeOrigin");
  });

  it("redacts credentials and complete URL query strings from desktop logs", () => {
    const redacted = redactDesktopLog('Bearer abcdefghijklmnopqrstuvwxyz123456 https://127.0.0.1/run?nonce=secret&plan=private {"apiKey":"key-value"} OPENAI_API_KEY=top-secret');
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(redacted).not.toContain("nonce=secret");
    expect(redacted).not.toContain("key-value");
    expect(redacted).not.toContain("top-secret");
    expect(redacted).toContain("?[redacted]");
  });

  it("uses the original proportional Aiquimist logo as the canonical external brand link", async () => {
    const [application, styles, logo] = await Promise.all([
      readFile(new URL("../src/web/App.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/web/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../public/brand/aiquimist-logo-white.png", import.meta.url)),
    ]);
    expect(application).toContain('href="https://aiquimist.ai/"');
    expect(application).toContain('target="_blank" rel="noreferrer"');
    expect(application).toContain('src="/brand/aiquimist-logo-white.png"');
    expect(styles).toContain("aspect-ratio:8.84");
    expect(styles).toContain("width:121%");
    expect(styles).toContain("height:auto");
    expect(logo.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(logo.readUInt32BE(16)).toBe(1080);
    expect(logo.readUInt32BE(20)).toBe(1080);
  });
});
