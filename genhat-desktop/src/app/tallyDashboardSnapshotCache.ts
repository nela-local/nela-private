/**
 * Sidecar static snapshots for live Tally dashboards.
 * When Tally is unreachable, viewers show the last successfully baked copy —
 * built from live report payloads already shown in the UI (or a full materialize).
 */

import { Api } from "../api";
import {
  buildTallyStaticDashboardHtml,
  isLiveTallyDashboardHtml,
  materializeTallyDashboardSnapshot,
  parseLiveTallyDashboardMeta,
  utf8ToBase64,
  type TallyDashboardSnapshot,
} from "./tallyStaticDashboard";
import { prepareArtifactHtmlPreview } from "./artifactHtmlPreview";
import type { TallyLiveFocus } from "./tallyLiveDashboard";
import { getTallyLiveSelection } from "./tallyLiveSelection";

/** Absolute path for the cached static snapshot beside a live dashboard HTML. */
export function tallySnapshotCachePath(liveHtmlPath: string): string {
  const trimmed = liveHtmlPath.trim();
  if (/\.html?$/i.test(trimmed)) {
    return trimmed.replace(/\.html?$/i, ".snapshot.html");
  }
  return `${trimmed}.snapshot.html`;
}

export async function readTallySnapshotCache(
  liveHtmlPath: string
): Promise<string | null> {
  const cachePath = tallySnapshotCachePath(liveHtmlPath);
  try {
    const html = await Api.readFileText(cachePath);
    if (!html?.trim()) return null;
    return prepareArtifactHtmlPreview(html);
  } catch {
    return null;
  }
}

export async function writeTallySnapshotCache(
  liveHtmlPath: string,
  staticHtml: string
): Promise<void> {
  const cachePath = tallySnapshotCachePath(liveHtmlPath);
  await Api.saveBinaryFile(cachePath, utf8ToBase64(staticHtml));
}

/**
 * Fetch a fresh static snapshot from Tally and write the sidecar.
 * Returns the prepared static HTML, or null if Tally is unreachable.
 */
export async function refreshTallySnapshotCache(
  liveHtmlPath: string,
  liveHtml: string
): Promise<string | null> {
  if (!isLiveTallyDashboardHtml(liveHtml)) return null;
  try {
    const { html } = await materializeTallyDashboardSnapshot(liveHtml);
    await writeTallySnapshotCache(liveHtmlPath, html);
    return prepareArtifactHtmlPreview(html);
  } catch {
    return null;
  }
}

type LiveSnapshotDraft = {
  title: string;
  snapshot: TallyDashboardSnapshot;
};

/** In-memory drafts keyed by live artifact path (last shown live data). */
const liveDrafts = new Map<string, LiveSnapshotDraft>();

function emptyTabError(msg = "Not loaded in this session"): { error: string } {
  return { error: msg };
}

function ensureDraft(
  path: string,
  liveHtml: string | null | undefined
): LiveSnapshotDraft {
  const existing = liveDrafts.get(path);
  if (existing) return existing;

  const meta = liveHtml ? parseLiveTallyDashboardMeta(liveHtml) : null;
  const sel = getTallyLiveSelection();
  const draft: LiveSnapshotDraft = {
    title: meta?.title || "Tally Dashboard",
    snapshot: {
      company: sel.company ?? null,
      host: null,
      port: null,
      exportedAt: new Date().toISOString(),
      fromDate: sel.fromDate || meta?.fromDate || "",
      toDate: sel.toDate || meta?.toDate || "",
      focus: sel.focus || meta?.focus || "daybook",
      daybook: emptyTabError(),
      outstanding: emptyTabError(),
      trial_balance: emptyTabError(),
    },
  };
  liveDrafts.set(path, draft);
  return draft;
}

function hasUsableTab(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  if ("error" in (v as object) && !("ok" in (v as object))) return false;
  return true;
}

/** True when at least one report tab has real data worth showing offline. */
export function draftHasShownData(path: string): boolean {
  const draft = liveDrafts.get(path);
  if (!draft) return false;
  const s = draft.snapshot;
  return (
    hasUsableTab(s.daybook) ||
    hasUsableTab(s.outstanding) ||
    hasUsableTab(s.trial_balance)
  );
}

/**
 * Record a successful live report so we can rebuild a static snapshot
 * of exactly what the user already saw — no second Tally round-trip.
 */
export async function recordLiveTallyReportSuccess(opts: {
  artifactPath: string;
  liveHtml?: string | null;
  kind: "daybook" | "outstanding" | "trial_balance";
  data: unknown;
  meta?: {
    host?: string | null;
    port?: number | null;
    company?: string | null;
  };
  fromDate?: string | null;
  toDate?: string | null;
  focus?: TallyLiveFocus;
}): Promise<string | null> {
  const path = opts.artifactPath.trim();
  if (!path) return null;

  const draft = ensureDraft(path, opts.liveHtml);
  const snap = draft.snapshot;
  snap.exportedAt = new Date().toISOString();
  if (opts.meta?.company) snap.company = opts.meta.company;
  if (opts.meta?.host != null) snap.host = opts.meta.host;
  if (opts.meta?.port != null) snap.port = opts.meta.port;
  if (opts.fromDate != null && opts.fromDate !== "") snap.fromDate = opts.fromDate;
  if (opts.toDate != null && opts.toDate !== "") snap.toDate = opts.toDate;
  if (opts.focus) snap.focus = opts.focus;

  if (opts.kind === "daybook") snap.daybook = opts.data;
  else if (opts.kind === "outstanding") snap.outstanding = opts.data;
  else snap.trial_balance = opts.data;

  liveDrafts.set(path, draft);

  try {
    const html = buildTallyStaticDashboardHtml({
      title: draft.title,
      snapshot: { ...snap },
    });
    await writeTallySnapshotCache(path, html);
    return prepareArtifactHtmlPreview(html);
  } catch {
    return null;
  }
}

/**
 * Build static HTML from the in-memory draft (last shown live data), if any.
 * Falls back to reading the on-disk sidecar.
 */
export async function loadLastShownTallySnapshot(
  artifactPath: string
): Promise<string | null> {
  const path = artifactPath.trim();
  const draft = liveDrafts.get(path);
  if (draft && draftHasShownData(path)) {
    try {
      const html = buildTallyStaticDashboardHtml({
        title: draft.title,
        snapshot: { ...draft.snapshot },
      });
      // Persist so later sessions / gallery reopen still work.
      void writeTallySnapshotCache(path, html).catch(() => undefined);
      return prepareArtifactHtmlPreview(html);
    } catch {
      /* fall through to disk */
    }
  }
  return readTallySnapshotCache(path);
}

export type DashboardPreviewMode = "live" | "snapshot" | "static";

export type ResolvedDashboardPreview = {
  html: string;
  mode: DashboardPreviewMode;
  /** Shown when using a cached snapshot because live Tally failed. */
  offlineNotice: string | null;
};

export const TALLY_OFFLINE_NOTICE =
  "Tally is offline — showing previously loaded data.";

/**
 * Resolve HTML for gallery preview / enlarged view.
 * Live Tally shells use a cached snapshot when Tally is disconnected.
 */
export async function resolveDashboardPreviewHtml(
  path: string
): Promise<ResolvedDashboardPreview> {
  const raw = await Api.readFileText(path);
  const prepared = prepareArtifactHtmlPreview(raw);

  if (!isLiveTallyDashboardHtml(raw)) {
    return { html: prepared, mode: "static", offlineNotice: null };
  }

  let connected = false;
  try {
    const status = await Api.tallyStatus();
    connected = Boolean(status.connected);
  } catch {
    connected = false;
  }

  if (connected) {
    // Seed/refresh disk cache in the background (bridge will also cache live tabs).
    void refreshTallySnapshotCache(path, raw);
    return { html: prepared, mode: "live", offlineNotice: null };
  }

  const cached = await loadLastShownTallySnapshot(path);
  if (cached) {
    return {
      html: cached,
      mode: "snapshot",
      offlineNotice: TALLY_OFFLINE_NOTICE,
    };
  }

  return {
    html: prepared,
    mode: "live",
    offlineNotice:
      "Tally is offline and no previously loaded data is available yet.",
  };
}
