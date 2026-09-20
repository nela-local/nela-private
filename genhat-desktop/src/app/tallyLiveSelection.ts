/**
 * Last-known live Tally dashboard period (from iframe / bridge).
 * Download prefers this over the dates baked into the HTML shell at generation time.
 */

import { toInputDate, type TallyLiveFocus } from "./tallyLiveDashboard";

export { NELA_TALLY_SELECTION } from "./tallyLiveDashboard";
import { NELA_TALLY_SELECTION } from "./tallyLiveDashboard";

export type TallyLiveSelection = {
  fromDate?: string | null;
  toDate?: string | null;
  focus?: TallyLiveFocus;
  company?: string | null;
};

let lastSelection: TallyLiveSelection = {};

function parseFocus(raw: string | null | undefined): TallyLiveFocus | undefined {
  if (raw === "outstanding" || raw === "trial_balance" || raw === "daybook") {
    return raw;
  }
  return undefined;
}

export function setTallyLiveSelection(partial: TallyLiveSelection): void {
  const next: TallyLiveSelection = { ...lastSelection };
  if (partial.fromDate !== undefined) {
    next.fromDate = toInputDate(partial.fromDate) || partial.fromDate || null;
  }
  if (partial.toDate !== undefined) {
    next.toDate = toInputDate(partial.toDate) || partial.toDate || null;
  }
  if (partial.focus !== undefined) {
    next.focus = partial.focus;
  }
  if (partial.company !== undefined) {
    next.company = partial.company?.trim() || null;
  }
  lastSelection = next;
}

export function getTallyLiveSelection(): TallyLiveSelection {
  return { ...lastSelection };
}

/** Clear remembered selection (e.g. tests). */
export function clearTallyLiveSelection(): void {
  lastSelection = {};
}

export function isTallyLiveSelectionMessage(
  data: unknown
): data is TallyLiveSelection & { type: typeof NELA_TALLY_SELECTION } {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.type === NELA_TALLY_SELECTION;
}

/**
 * Read current from/to/focus from a live dashboard iframe document.
 * Returns null when the frame is not a live Tally page or is inaccessible.
 */
export function readTallyLiveSelectionFromWindow(
  win: Window | null | undefined
): TallyLiveSelection | null {
  if (!win) return null;
  try {
    const doc = win.document;
    if (!doc?.body) return null;
    if (!/data-nela-tally-live/i.test(doc.body.outerHTML.slice(0, 500))) {
      const live = doc.body.getAttribute("data-nela-tally-live");
      if (live !== "1") return null;
    }
    const fromEl = doc.getElementById("fromDate") as HTMLInputElement | null;
    const toEl = doc.getElementById("toDate") as HTMLInputElement | null;
    const focus =
      parseFocus(doc.body.getAttribute("data-focus")) ?? undefined;
    const fromDate = toInputDate(fromEl?.value) || fromEl?.value || null;
    const toDate = toInputDate(toEl?.value) || toEl?.value || null;
    const sel: TallyLiveSelection = { fromDate, toDate, focus };
    setTallyLiveSelection(sel);
    return sel;
  } catch {
    return null;
  }
}

/** Safe filename fragment from company / dates. */
export function tallySnapshotFileBase(opts: {
  company?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  titleFallback?: string;
}): string {
  const scrub = (s: string) =>
    s
      .replace(/[^\w\s.-]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);

  const company = scrub(opts.company?.trim() || "");
  const from = toInputDate(opts.fromDate) || scrub(opts.fromDate?.trim() || "");
  const to = toInputDate(opts.toDate) || scrub(opts.toDate?.trim() || "");

  const parts: string[] = [];
  if (company) parts.push(company);
  if (from && to) parts.push(`${from}_to_${to}`);
  else if (from) parts.push(`from_${from}`);
  else if (to) parts.push(`to_${to}`);

  if (parts.length) return parts.join("_");
  const fallback = scrub(opts.titleFallback || "Tally-Dashboard");
  return fallback || "Tally-Dashboard-snapshot";
}
