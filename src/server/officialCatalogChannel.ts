import type { CatalogPublication, SignedCatalogBundle } from "../shared/types.js";
import { signedCatalogBundleSchema } from "../shared/catalogSchemas.js";
import { OFFICIAL_CATALOG_CHANNEL } from "../shared/catalogChannel.js";
import { sha256, verifyCatalogBundle } from "./catalogPublication.js";
import type { PlannerStore } from "./store.js";

const MAX_BUNDLE_BYTES = 20_000_000;

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubReleaseAsset[];
}

export interface OfficialCatalogChannelOptions {
  owner?: string;
  repository?: string;
  releasePrefix?: string;
  apiBaseUrl?: string;
  keyRing?: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
}

export interface OfficialCatalogRefreshResult {
  publication: CatalogPublication | null;
  applied: boolean;
  etag: string | null;
  checkedReleaseCount: number;
}

function releaseOrder(tag: string, prefix: string): number {
  const match = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{4})-(\\d{2})-(\\d{2})\\.(\\d+)$`).exec(tag);
  if (!match) return -1;
  return Number(`${match[1]}${match[2]}${match[3]}`) * 1_000 + Number(match[4]);
}

function assertOfficialHttps(urlValue: string, allowedHosts: Set<string>): URL {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || url.username || url.password) throw new Error("official_catalog_url_rejected");
  return url;
}

async function responseTextLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BUNDLE_BYTES) throw new Error("catalog_bundle_too_large");
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_BUNDLE_BYTES) throw new Error("catalog_bundle_too_large");
  return raw;
}

async function fetchOfficialAsset(
  fetchImpl: typeof fetch,
  initialUrl: URL,
  allowedHosts: Set<string>,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetchImpl(current, { redirect: "manual", cache: "no-store", headers, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === 5) throw new Error("official_catalog_redirect_rejected");
    current = assertOfficialHttps(new URL(location, current).toString(), allowedHosts);
  }
  throw new Error("official_catalog_redirect_rejected");
}

function assertContentType(response: Response, allowed: readonly string[]): void {
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!allowed.includes(contentType)) throw new Error("official_catalog_content_type_rejected");
}

export class OfficialCatalogChannel {
  readonly owner: string;
  readonly repository: string;
  readonly releasePrefix: string;
  readonly apiBaseUrl: string;
  private readonly keyRing: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;
  private readonly allowedHosts: Set<string>;

  constructor(options: OfficialCatalogChannelOptions = {}) {
    this.owner = options.owner ?? OFFICIAL_CATALOG_CHANNEL.owner;
    this.repository = options.repository ?? OFFICIAL_CATALOG_CHANNEL.repository;
    this.releasePrefix = options.releasePrefix ?? OFFICIAL_CATALOG_CHANNEL.releasePrefix;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.keyRing = options.keyRing ?? OFFICIAL_CATALOG_CHANNEL.keyRing;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowedHosts = new Set([new URL(this.apiBaseUrl).hostname, "github.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com", "release-assets.githubusercontent.com"]);
  }

  get releasesUrl(): string {
    return `${this.apiBaseUrl.replace(/\/$/, "")}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repository)}/releases?per_page=100`;
  }

  async refresh(store: PlannerStore): Promise<OfficialCatalogRefreshResult> {
    const active = await store.getActiveCatalogPublication();
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "QualHardwareDesktop/1.0", "x-github-api-version": "2022-11-28" };
    if (active?.etag) headers["if-none-match"] = active.etag;
    const response = await this.fetchImpl(assertOfficialHttps(this.releasesUrl, this.allowedHosts), {
      redirect: "error", cache: "no-store", headers, signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304) return { publication: active, applied: false, etag: active?.etag ?? null, checkedReleaseCount: 0 };
    if (!response.ok) throw new Error(`catalog_releases_http_${response.status}`);
    const etag = response.headers.get("etag");
    const releasePages: GitHubRelease[] = JSON.parse(await responseTextLimited(response)) as GitHubRelease[];
    const pageHeaders = { ...headers };
    delete pageHeaders["if-none-match"];
    for (let page = 2; releasePages.length === (page - 1) * 100 && page <= 20; page += 1) {
      const pageResponse = await this.fetchImpl(assertOfficialHttps(`${this.releasesUrl}&page=${page}`, this.allowedHosts), {
        redirect: "error", cache: "no-store", headers: pageHeaders, signal: AbortSignal.timeout(15_000),
      });
      if (!pageResponse.ok) throw new Error(`catalog_releases_http_${pageResponse.status}`);
      const pageValues = JSON.parse(await responseTextLimited(pageResponse)) as GitHubRelease[];
      releasePages.push(...pageValues);
      if (pageValues.length < 100) break;
    }
    const releases = releasePages
      .filter((release) => !release.draft && !release.prerelease && release.tag_name.startsWith(this.releasePrefix) && release.published_at)
      .sort((left, right) => releaseOrder(left.tag_name, this.releasePrefix) - releaseOrder(right.tag_name, this.releasePrefix));

    const candidates: Array<{ envelope: SignedCatalogBundle; raw: string; hash: string }> = [];
    for (const release of releases) {
      const asset = release.assets.find((candidate) => candidate.name === "catalog-bundle.json");
      const sumsAsset = release.assets.find((candidate) => candidate.name === "SHA256SUMS");
      if (!asset || !sumsAsset) throw new Error("catalog_release_assets_missing");
      const bundleResponse = await fetchOfficialAsset(this.fetchImpl, assertOfficialHttps(asset.browser_download_url, this.allowedHosts), this.allowedHosts, { accept: "application/json", "user-agent": "QualHardwareDesktop/1.0" }, 30_000);
      if (!bundleResponse.ok) throw new Error(`catalog_bundle_http_${bundleResponse.status}`);
      assertContentType(bundleResponse, ["application/json", "application/octet-stream"]);
      const raw = await responseTextLimited(bundleResponse);
      const sumsResponse = await fetchOfficialAsset(this.fetchImpl, assertOfficialHttps(sumsAsset.browser_download_url, this.allowedHosts), this.allowedHosts, { accept: "text/plain", "user-agent": "QualHardwareDesktop/1.0" }, 15_000);
      if (!sumsResponse.ok) throw new Error(`catalog_checksums_http_${sumsResponse.status}`);
      assertContentType(sumsResponse, ["text/plain", "application/octet-stream"]);
      const sums = await responseTextLimited(sumsResponse);
      const expectedHash = sums.split(/\r?\n/).map((line) => /^([a-fA-F0-9]{64})\s+\*?catalog-bundle\.json$/.exec(line.trim())?.[1]?.toLowerCase()).find(Boolean);
      const rawHash = sha256(raw);
      if (!expectedHash || expectedHash !== rawHash) throw new Error("catalog_bundle_checksum_mismatch");
      const envelope = signedCatalogBundleSchema.parse(JSON.parse(raw)) as SignedCatalogBundle;
      const publicKey = this.keyRing[envelope.keyId];
      if (!publicKey) throw new Error("catalog_unknown_signing_key");
      const payload = verifyCatalogBundle(envelope, publicKey);
      if (payload.publicationId !== release.tag_name) throw new Error("catalog_release_identity_mismatch");
      if (Date.parse(payload.publishedAt) > Date.now() + 5 * 60_000) throw new Error("catalog_future_release_rejected");
      candidates.push({ envelope, raw, hash: rawHash });
    }
    candidates.sort((left, right) => left.envelope.payload.sequence - right.envelope.payload.sequence);
    let previousHash: string | null = null;
    let previousSequence = 0;
    for (const candidate of candidates) {
      const payload = candidate.envelope.payload;
      if (payload.sequence !== previousSequence + 1) throw new Error("catalog_sequence_gap");
      if (payload.previousBundleSha256 !== previousHash) throw new Error("catalog_chain_broken");
      previousSequence = payload.sequence; previousHash = candidate.hash;
    }
    const latest = candidates.at(-1);
    if (!latest || (active && latest.envelope.payload.sequence <= active.sequence)) return { publication: active, applied: false, etag, checkedReleaseCount: releases.length };
    if (active) {
      const successor = candidates.find((candidate) => candidate.envelope.payload.sequence === active.sequence + 1);
      if (!successor || successor.envelope.payload.previousBundleSha256 !== active.bundleSha256) throw new Error("catalog_active_chain_broken");
    }
    const publication = await store.activateCatalogBundle(latest.envelope, latest.hash, etag);
    return { publication, applied: true, etag, checkedReleaseCount: releases.length };
  }

  async importRaw(store: PlannerStore, raw: string): Promise<CatalogPublication> {
    if (Buffer.byteLength(raw) > MAX_BUNDLE_BYTES) throw new Error("catalog_bundle_too_large");
    const envelope = signedCatalogBundleSchema.parse(JSON.parse(raw)) as SignedCatalogBundle;
    const publicKey = this.keyRing[envelope.keyId];
    if (!publicKey) throw new Error("catalog_unknown_signing_key");
    const payload = verifyCatalogBundle(envelope, publicKey);
    if (Date.parse(payload.publishedAt) > Date.now() + 5 * 60_000) throw new Error("catalog_future_release_rejected");
    const active = await store.getActiveCatalogPublication();
    if (active && payload.sequence <= active.sequence) throw new Error("catalog_bundle_rollback_rejected");
    if (active && payload.previousBundleSha256 !== active.bundleSha256) throw new Error("catalog_active_chain_broken");
    if (!active && (payload.sequence !== 1 || payload.previousBundleSha256 !== null)) throw new Error("catalog_initial_chain_missing");
    return store.activateCatalogBundle(envelope, sha256(raw), null);
  }
}
