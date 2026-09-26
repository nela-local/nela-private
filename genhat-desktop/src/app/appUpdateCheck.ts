/**
 * Soft update check via the public NELA website releases API.
 *
 * Full VS Code-style silent in-place updates need Tauri updater + code signing
 * per OS (not configured). This path notifies and opens the platform installer.
 */

import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

export type ReleaseAsset = {
  name: string;
  download_url: string;
  size: number;
  type: string;
  github_asset_id?: number;
};

export type ReleasesData = {
  versions: Array<{
    version: string;
    platforms: Record<string, ReleaseAsset[]>;
  }>;
  latestVersion: string | null;
};

export type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  platform: "Windows" | "Linux" | "macOS";
  arch: "amd64" | "arm64";
  /** Absolute URL that redirects to the signed installer download. */
  downloadUrl: string;
  /** Public download page fallback. */
  downloadPageUrl: string;
  assetName?: string;
};

const SITE_BASES = [
  "https://nela-webpage.vercel.app",
  "https://nela.ai",
] as const;

const DISMISS_KEY = "nela.dismissedUpdateVersion";
const SNOOZE_KEY = "nela.updateSnoozeUntil";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, "");
}

/** Compare semver-ish strings. Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(/[.+-]/)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pb = normalizeVersion(b)
    .split(/[.+-]/)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
      continue;
    }
    const sx = String(x);
    const sy = String(y);
    if (sx !== sy) return sx < sy ? -1 : 1;
  }
  return 0;
}

export function detectPlatform(): "Windows" | "Linux" | "macOS" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "Windows";
  if (ua.includes("mac")) return "macOS";
  return "Linux";
}

export function detectArch(): "amd64" | "arm64" {
  const ua = navigator.userAgent.toLowerCase();
  if (
    ua.includes("arm64") ||
    ua.includes("aarch64") ||
    // Apple Silicon Chromium often reports "Mac" without arm64 in UA;
    // WebKit on Apple Silicon: platform may be MacIntel historically.
    (ua.includes("mac") && ua.includes("apple"))
  ) {
    // Prefer arm64 on modern Macs when UA hints Apple; fall back amd64 otherwise.
    if (ua.includes("arm") || ua.includes("aarch")) return "arm64";
  }
  // Tauri on Apple Silicon may still expose MacIntel in some builds.
  const platform =
    typeof navigator.platform === "string" ? navigator.platform.toLowerCase() : "";
  if (platform.includes("arm") || platform.includes("aarch")) return "arm64";
  return "amd64";
}

export function getDismissedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function dismissUpdateVersion(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, normalizeVersion(version));
  } catch {
    /* ignore */
  }
}

export function snoozeUpdatePrompt(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* ignore */
  }
}

export function isUpdateSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

async function fetchReleasesFrom(base: string): Promise<ReleasesData> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${base}/api/releases`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      // Avoid stale CDN/browser cache — homepage update check must see new releases.
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`releases ${res.status}`);
    return (await res.json()) as ReleasesData;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchReleasesData(): Promise<{
  data: ReleasesData;
  base: string;
}> {
  let lastErr: unknown;
  for (const base of SITE_BASES) {
    try {
      const data = await fetchReleasesFrom(base);
      if (data?.latestVersion) return { data, base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Unable to reach NELA releases API");
}

function pickAsset(
  data: ReleasesData,
  latestVersion: string,
  platform: "Windows" | "Linux" | "macOS"
): ReleaseAsset | undefined {
  const entry = data.versions.find(
    (v) => normalizeVersion(v.version) === normalizeVersion(latestVersion)
  );
  const assets = entry?.platforms[platform] ?? [];
  if (assets.length === 0) return undefined;
  const prefer =
    platform === "Windows"
      ? ["exe", "msi"]
      : platform === "Linux"
        ? ["deb", "AppImage"]
        : ["dmg"];
  for (const type of prefer) {
    const hit = assets.find((a) => a.type === type);
    if (hit) return hit;
  }
  return assets[0];
}

/**
 * Returns update info when a newer release exists; otherwise null.
 * Does not apply dismiss/snooze filters — callers decide.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  const currentVersion = await getVersion();
  const { data, base } = await fetchReleasesData();
  const latest = data.latestVersion;
  if (!latest) return null;
  if (compareVersions(latest, currentVersion) <= 0) return null;

  const platform = detectPlatform();
  const arch = detectArch();
  const asset = pickAsset(data, latest, platform);
  const downloadUrl = asset
    ? `${base}/api/internal/installer-download?${new URLSearchParams({
        version: latest.startsWith("v") ? latest : `v${normalizeVersion(latest)}`,
        platform,
        asset: asset.name,
        source: "desktop-update",
      }).toString()}`
    : `${base}/api/latest/${platform}/${arch}`;

  return {
    currentVersion: normalizeVersion(currentVersion),
    latestVersion: normalizeVersion(latest),
    platform,
    arch,
    downloadUrl,
    downloadPageUrl: `${base}/download`,
    assetName: asset?.name,
  };
}

/** Startup path: respects dismiss + snooze. */
export async function checkForAppUpdatePrompt(): Promise<AppUpdateInfo | null> {
  if (isUpdateSnoozed()) return null;
  const info = await checkForAppUpdate();
  if (!info) return null;
  const dismissed = getDismissedUpdateVersion();
  if (dismissed && normalizeVersion(dismissed) === info.latestVersion) {
    return null;
  }
  return info;
}

export async function openAppUpdateDownload(info: AppUpdateInfo): Promise<void> {
  try {
    await openUrl(info.downloadUrl);
  } catch {
    await openUrl(info.downloadPageUrl);
  }
}
