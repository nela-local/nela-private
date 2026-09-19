/**
 * HTML artifact download / export helpers (PPTX, PDF, DOCX, HTML).
 */

import { save } from "@tauri-apps/plugin-dialog";
import { Api } from "../api";
import {
  exportPresentation,
  presentationExportBaseName,
  writePresentationExport,
  type DeckExportFormat,
} from "./exportDeck";
import { documentExportBaseName, htmlToDocxBase64 } from "./htmlToDocx";
import { isPresentationPreviewHtml } from "./presentationPreviewSelect";
import {
  isLiveTallyDashboardHtml,
  materializeTallyDashboardSnapshot,
  utf8ToBase64,
} from "./tallyStaticDashboard";
import {
  getTallyLiveSelection,
  tallySnapshotFileBase,
  type TallyLiveSelection,
} from "./tallyLiveSelection";

function baseNameFromPath(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? "artifact";
  return name.replace(/\.[^.]+$/, "");
}

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function looksLikePresentationTitle(title?: string, path?: string): boolean {
  const hay = `${title ?? ""} ${path ?? ""}`;
  return /\b(slide|deck|presentation|pptx?|pitch)\b/i.test(hay);
}

export async function isHtmlPresentationArtifact(path: string): Promise<boolean> {
  const ext = extensionOf(path);
  if (ext !== "html" && ext !== "htm") return false;
  try {
    const html = await Api.readFileText(path);
    return isPresentationPreviewHtml(html);
  } catch {
    return false;
  }
}

function ensureExtension(path: string, ext: string): string {
  const current = extensionOf(path);
  if (current === ext) return path;
  if (["html", "htm", "pdf", "pptx", "ppt", "docx", "doc"].includes(current)) {
    return path.replace(/\.[^.]+$/, `.${ext}`);
  }
  return `${path}.${ext}`;
}

export type DownloadArtifactOptions = {
  /** Current live dashboard period from the preview iframe (preferred over shell defaults). */
  tallySelection?: TallyLiveSelection | null;
};

/**
 * Copy the artifact to a user-chosen path.
 * Slide decks default to PowerPoint; ordinary HTML pages default to .html
 * (Word is offered as an optional export, not the default).
 */
export async function downloadArtifactCopy(
  sourcePath: string,
  options?: DownloadArtifactOptions
): Promise<string | null> {
  const ext = extensionOf(sourcePath) || "bin";

  if (ext === "html" || ext === "htm") {
    try {
      const html = await Api.readFileText(sourcePath);
      if (isPresentationPreviewHtml(html)) {
        return downloadPresentationArtifact(sourcePath, html);
      }
      return downloadHtmlDocumentArtifact(sourcePath, html, options);
    } catch (err) {
      console.warn("Could not inspect HTML artifact for export:", err);
    }
  }

  const filterName =
    ext === "html" || ext === "htm"
      ? "HTML Document"
      : ext === "xlsx" || ext === "xls"
        ? "Spreadsheet"
        : ext === "pptx" || ext === "ppt"
          ? "Presentation"
          : "File";

  const targetPath = await save({
    defaultPath: `${baseNameFromPath(sourcePath)}.${ext}`,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (!targetPath) return null;

  await Api.copyFileToPath(sourcePath, targetPath);
  return targetPath;
}

async function downloadPresentationArtifact(
  sourcePath: string,
  html: string
): Promise<string | null> {
  const base = presentationExportBaseName(html, sourcePath);
  const targetPath = await save({
    defaultPath: `${base}.pptx`,
    filters: [
      { name: "PowerPoint Presentation", extensions: ["pptx"] },
      { name: "PDF Document", extensions: ["pdf"] },
      { name: "HTML Document", extensions: ["html"] },
      { name: "Word Document", extensions: ["docx"] },
    ],
  });
  if (!targetPath) return null;

  let format: DeckExportFormat | "html" | "docx" = "pptx";
  const picked = extensionOf(targetPath);
  if (picked === "pptx" || picked === "ppt") format = "pptx";
  else if (picked === "pdf") format = "pdf";
  else if (picked === "docx" || picked === "doc") format = "docx";
  else if (picked === "html" || picked === "htm") format = "html";
  else format = "pptx";

  const finalPath = ensureExtension(
    targetPath,
    format === "html" ? "html" : format
  );
  if (format === "html") {
    await Api.copyFileToPath(sourcePath, finalPath);
  } else if (format === "docx") {
    const base64 = await htmlToDocxBase64(html);
    await Api.saveBinaryFile(finalPath, base64);
  } else {
    await writePresentationExport(sourcePath, finalPath, format);
  }
  return finalPath;
}

function resolveTallySelection(
  options?: DownloadArtifactOptions
): TallyLiveSelection {
  const remembered = getTallyLiveSelection();
  const override = options?.tallySelection ?? {};
  const pick = (
    primary: string | null | undefined,
    fallback: string | null | undefined
  ) => {
    const a = primary?.trim();
    if (a) return a;
    const b = fallback?.trim();
    return b || null;
  };
  return {
    fromDate: pick(override.fromDate, remembered.fromDate),
    toDate: pick(override.toDate, remembered.toDate),
    focus: override.focus ?? remembered.focus,
    company: pick(override.company, remembered.company),
  };
}

async function downloadHtmlDocumentArtifact(
  sourcePath: string,
  html: string,
  options?: DownloadArtifactOptions
): Promise<string | null> {
  const isLiveTally = isLiveTallyDashboardHtml(html);

  // Live Tally: fetch snapshot for the preview's current period first, then save.
  if (isLiveTally) {
    const selection = resolveTallySelection(options);
    const { html: exportHtml, snapshot, title } =
      await materializeTallyDashboardSnapshot(html, selection);
    const defaultName = tallySnapshotFileBase({
      company: snapshot.company || selection.company,
      fromDate: snapshot.fromDate,
      toDate: snapshot.toDate,
      titleFallback: `${title}-snapshot`,
    });
    const targetPath = await save({
      defaultPath: `${defaultName}.html`,
      filters: [
        { name: "HTML Document", extensions: ["html"] },
        { name: "Word Document", extensions: ["docx"] },
      ],
    });
    if (!targetPath) return null;

    const picked = extensionOf(targetPath);
    if (picked === "docx" || picked === "doc") {
      const finalPath = ensureExtension(targetPath, "docx");
      const base64 = await htmlToDocxBase64(exportHtml);
      await Api.saveBinaryFile(finalPath, base64);
      return finalPath;
    }

    const finalPath = ensureExtension(targetPath, "html");
    await Api.saveBinaryFile(finalPath, utf8ToBase64(exportHtml));
    return finalPath;
  }

  const base = documentExportBaseName(html, sourcePath);
  const targetPath = await save({
    defaultPath: `${base}.html`,
    filters: [
      { name: "HTML Document", extensions: ["html"] },
      { name: "Word Document", extensions: ["docx"] },
    ],
  });
  if (!targetPath) return null;

  const picked = extensionOf(targetPath);
  if (picked === "docx" || picked === "doc") {
    const finalPath = ensureExtension(targetPath, "docx");
    const base64 = await htmlToDocxBase64(html);
    await Api.saveBinaryFile(finalPath, base64);
    return finalPath;
  }

  const finalPath = ensureExtension(targetPath, "html");
  await Api.copyFileToPath(sourcePath, finalPath);
  return finalPath;
}

export async function exportArtifactDeck(
  htmlPath: string,
  format: DeckExportFormat
): Promise<string | null> {
  return exportPresentation(htmlPath, format);
}

export async function exportArtifactDocx(
  htmlPath: string,
  options?: DownloadArtifactOptions
): Promise<string | null> {
  let html = await Api.readFileText(htmlPath);
  let defaultBase: string;
  if (isLiveTallyDashboardHtml(html)) {
    const selection = resolveTallySelection(options);
    const materialized = await materializeTallyDashboardSnapshot(html, selection);
    html = materialized.html;
    defaultBase = tallySnapshotFileBase({
      company: materialized.snapshot.company || selection.company,
      fromDate: materialized.snapshot.fromDate,
      toDate: materialized.snapshot.toDate,
      titleFallback: `${materialized.title}-snapshot`,
    });
  } else {
    defaultBase = isPresentationPreviewHtml(html)
      ? presentationExportBaseName(html, htmlPath)
      : documentExportBaseName(html, htmlPath);
  }
  const targetPath = await save({
    defaultPath: `${defaultBase}.docx`,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!targetPath) return null;
  const finalPath = ensureExtension(targetPath, "docx");
  const base64 = await htmlToDocxBase64(html);
  await Api.saveBinaryFile(finalPath, base64);
  return finalPath;
}

/** True when the user asked for a Word/DOCX deliverable (not just any document). */
export function wantsWordDocument(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(word|docx?)\b|\bmicrosoft\s+word\b/.test(t)) return false;
  return /\b(document|file|essay|report|paper|convert|save|create|make|generate|write|export|download)\b/.test(
    t
  );
}

/**
 * Convert a saved HTML artifact into a sibling .docx in the artifacts folder
 * (no save dialog). Used when the user asked for Word and the model emitted HTML.
 */
export async function materializeHtmlAsDocxArtifact(
  htmlPath: string
): Promise<string> {
  const html = await Api.readFileText(htmlPath);
  const base = documentExportBaseName(html, htmlPath);
  const stamp = Date.now().toString(36);
  const dir = htmlPath.replace(/[/\\][^/\\]+$/, "");
  const sep = htmlPath.includes("\\") ? "\\" : "/";
  const dest = `${dir}${sep}${base}-${stamp}.docx`;
  const base64 = await htmlToDocxBase64(html);
  await Api.saveBinaryFile(dest, base64);
  return dest;
}

export { looksLikePresentationTitle };
