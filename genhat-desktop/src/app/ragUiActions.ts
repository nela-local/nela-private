import { Api } from "../api";
import type { IngestionStatus } from "../types";
import type { RagSourceSelection } from "../stores/ragSourcePickerStore";
import { openRagSourcePicker } from "../stores/ragSourcePickerStore";
import { useChatModeStore } from "../stores/chatModeStore";
import { useUIStore } from "../stores/uiStore";
import { loadRagDocs } from "./workspaceBridge";
import { attachmentFileName, sameAttachmentPath } from "./attachmentDisplay";

export const DOCUMENT_PICKER_EXTENSIONS = [
  "pdf", "docx", "pptx", "xlsx", "xls", "ods",
  "txt", "md", "csv", "tsv", "json", "xml", "html", "htm",
  "rs", "py", "js", "ts", "jsx", "tsx", "java", "c", "cpp",
  "h", "go", "rb", "sh", "toml", "yaml", "yml", "css",
  "scss", "sql", "log", "ini", "cfg",
  "png", "jpg", "jpeg", "webp", "gif", "bmp",
  "mp3", "wav", "m4a", "ogg", "flac",
];

export const IMAGE_PICKER_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp", "gif", "bmp",
];

export function fileExtension(path: string): string {
  const base = path.split(/[/\\]/).pop() || path;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isChatAttachablePath(path: string): boolean {
  return DOCUMENT_PICKER_EXTENSIONS.includes(fileExtension(path));
}

export function isImageAttachablePath(path: string): boolean {
  return IMAGE_PICKER_EXTENSIONS.includes(fileExtension(path));
}

/**
 * Inspect and merge absolute paths into the chat composer attachment list.
 * Shared by the + picker and drag-and-drop.
 */
export async function acceptDirectDocumentPaths(paths: string[]): Promise<void> {
  const chatModeStore = useChatModeStore.getState();
  const uiStore = useUIStore.getState();
  if (paths.length === 0) return;

  const currentPaths = chatModeStore.directDocumentPaths;
  const merged = new Set(currentPaths);
  for (const filePath of paths) {
    merged.add(filePath);
  }
  const nextPaths = Array.from(merged);

  try {
    const inspected = await Api.inspectAttachments(nextPaths);
    const accepted: string[] = [];
    for (const original of nextPaths) {
      const item =
        inspected.find((entry) => sameAttachmentPath(entry.path, original)) ??
        inspected.find(
          (entry) =>
            attachmentFileName(entry.path, entry.name) ===
            attachmentFileName(original)
        );
      if (!item || item.error || item.kind === "unsupported") {
        uiStore.showError(
          item?.error || `Unsupported file: ${attachmentFileName(original)}`
        );
        continue;
      }
      chatModeStore.setAttachmentMeta(original, {
        ...item,
        path: original,
        name: item.name || attachmentFileName(original),
      });
      accepted.push(original);
    }
    chatModeStore.setDirectDocumentPaths(accepted);
  } catch (inspectErr) {
    const message =
      inspectErr instanceof Error ? inspectErr.message : String(inspectErr);
    uiStore.showError(message || "Couldn't inspect those files.");
  }
}

/** Attach OS-dropped paths to the active chat mode (text docs or vision image). */
export async function acceptDroppedChatPaths(paths: string[]): Promise<void> {
  const chatModeStore = useChatModeStore.getState();
  const uiStore = useUIStore.getState();
  const mode = chatModeStore.chatMode;

  if (mode === "vision") {
    const images = paths.filter(isImageAttachablePath);
    if (images.length === 0) {
      uiStore.showError("Drop an image file (JPG, PNG, WebP, GIF, or BMP).");
      return;
    }
    const selected = images[0];
    try {
      chatModeStore.setImagePath(selected);
      const dataUrl = await Api.readImageBase64(selected);
      chatModeStore.setImagePreview(dataUrl);
    } catch (err) {
      console.error("Failed to load dropped image:", err);
      uiStore.showError("Couldn't open that image. Please try again.");
    }
    return;
  }

  if (mode !== "text") {
    uiStore.showError("Switch to Chat or Vision mode to attach dropped files.");
    return;
  }

  const allowed = paths.filter(isChatAttachablePath);
  if (allowed.length === 0) {
    uiStore.showError(
      "Those file types aren't supported as chat attachments. Try PDF, Office, images, or text."
    );
    return;
  }
  if (allowed.length < paths.length) {
    const skipped = paths.length - allowed.length;
    uiStore.showError(
      skipped === 1
        ? "One dropped item wasn't a supported file and was skipped."
        : `${skipped} dropped items weren't supported files and were skipped.`
    );
  }

  try {
    await acceptDirectDocumentPaths(allowed);
  } catch (err) {
    console.error("Failed to attach dropped documents:", err);
    uiStore.showError("Couldn't add those documents. Please try again.");
  }
}

export async function selectImage(): Promise<void> {
  const chatModeStore = useChatModeStore.getState();

  try {
    const selection = await openRagSourcePicker({
      allowedExtensions: IMAGE_PICKER_EXTENSIONS,
      filesOnly: true,
      title: "Upload an image",
      confirmLabel: "Use selected",
    });
    if (!selection || selection.filePaths.length === 0) return;
    const selected = selection.filePaths[0];
    chatModeStore.setImagePath(selected);
    const dataUrl = await Api.readImageBase64(selected);
    chatModeStore.setImagePreview(dataUrl);
  } catch (err) {
    console.error("Failed to select image:", err);
  }
}

export async function attachDirectDocuments(): Promise<void> {
  const uiStore = useUIStore.getState();

  try {
    const selection = await openRagSourcePicker({
      allowedExtensions: DOCUMENT_PICKER_EXTENSIONS,
      filesOnly: true,
      title: "Attach files to chat",
      confirmLabel: "Attach selected",
    });
    if (!selection) return;

    const files = selection.filePaths ?? [];
    if (files.length === 0) return;
    await acceptDirectDocumentPaths(files);
  } catch (err) {
    console.error("Failed to select direct documents:", err);
    uiStore.showError("Couldn't add those documents. Please try again.");
  }
}

function getBaseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

async function ingestSelectedSources(selection: RagSourceSelection): Promise<void> {
  const chatModeStore = useChatModeStore.getState();
  const uiStore = useUIStore.getState();

  const filePaths = selection.filePaths ?? [];
  const folderPaths = selection.folderPaths ?? [];
  if (filePaths.length === 0 && folderPaths.length === 0) return;

  // Add placeholder entries to the side panel immediately so users can
  // see what is being indexed while ingestion is still running.
  const allTargets: Array<{ path: string; isFolder: boolean }> = [
    ...filePaths.map((p) => ({ path: p, isFolder: false })),
    ...folderPaths.map((p) => ({ path: p, isFolder: true })),
  ];

  const placeholders: IngestionStatus[] = allTargets.map((t, i) => ({
    doc_id: -(i + 1), // negative IDs to avoid clashing with real docs
    title: getBaseName(t.path),
    file_path: t.path,
    total_chunks: 0,
    embedded_chunks: 0,
    enriched_chunks: 0,
    phase: "ingesting",
  }));

  chatModeStore.setRagDocs((prev) => [...placeholders, ...prev]);
  chatModeStore.setRagIngesting(true);

  try {
    const results = await Promise.allSettled(
      allTargets.map((t) => {
        return t.isFolder
          ? Api.ingestFolder(t.path).then(async () => {
              await loadRagDocs();
            })
          : Api.ingestDocument(t.path).then(async () => {
              await loadRagDocs();
            });
      }),
    );

    await loadRagDocs();

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      alert(
        failures.length === 1
          ? "One document couldn't be added. Please try again."
          : `${failures.length} documents couldn't be added. Please try again.`
      );
    }
  } catch (e) {
    console.error(e);
    uiStore.showError(`Ingest failed: ${e instanceof Error ? e.message : String(e)}`);
    await loadRagDocs();
  } finally {
    chatModeStore.setRagIngesting(false);
    await loadRagDocs();
  }
}

export async function ingestFile(): Promise<void> {
  const chatModeStore = useChatModeStore.getState();
  const uiStore = useUIStore.getState();
  
  try {
    const selection = await openRagSourcePicker({ allowedExtensions: DOCUMENT_PICKER_EXTENSIONS });
    if (!selection) return; // user cancelled
    await ingestSelectedSources(selection);
  } catch (e) {
    console.error(e);
    chatModeStore.setRagIngesting(false);
    await loadRagDocs();
    uiStore.showError("Couldn't add those documents. Please try again.");
  }
}

export async function ingestDir(): Promise<void> {
  const chatModeStore = useChatModeStore.getState();
  const uiStore = useUIStore.getState();
  
  try {
    const selection = await openRagSourcePicker({ allowedExtensions: DOCUMENT_PICKER_EXTENSIONS });
    if (!selection) return;
    await ingestSelectedSources(selection);
  } catch (e) {
    console.error(e);
    chatModeStore.setRagIngesting(false);
    uiStore.showError("Couldn't add that folder. Please try again.");
  }
}

export async function deleteRagDoc(docId: number): Promise<void> {
  const chatModeStore = useChatModeStore.getState();
  const uiStore = useUIStore.getState();
  
  try {
    // Close the viewer if the deleted document is currently open
    const doc = chatModeStore.ragDocs.find((d) => d.doc_id === docId);
    if (doc) {
      const delPath = doc.file_path;
      if (uiStore.pdfViewerData && doc.title === uiStore.pdfViewerData.title) {
        uiStore.setPdfViewerData(null);
      }
      if (uiStore.docViewerFile && uiStore.docViewerFile.filePath === delPath) {
        uiStore.setDocViewerFile(null);
      }
    }

    await Api.deleteRagDocument(docId);
    await loadRagDocs();
  } catch (e) {
    console.error(e);
    uiStore.showError("Couldn't remove that document. Please try again.");
  }
}

export async function deleteAllRagDocs(): Promise<void> {
  const chatModeStore = useChatModeStore.getState();
  const uiStore = useUIStore.getState();
  
  if (chatModeStore.ragDocs.length === 0) return;
  if (!window.confirm("Remove every document from the library? This cannot be undone.")) return;

  try {
    uiStore.setPdfViewerData(null);
    uiStore.setDocViewerFile(null);
    await Api.deleteAllRagDocuments();
    await loadRagDocs();
  } catch (e) {
    console.error(e);
    uiStore.showError("Couldn't clear the library. Please try again.");
  }
}

export async function openDocViewer(doc: IngestionStatus): Promise<void> {
  const uiStore = useUIStore.getState();
  const VIEWABLE_EXTS = new Set([
    "txt", "md", "json", "xml", "html", "htm", "css", "js", "ts", "jsx", "tsx",
    "py", "java", "c", "cpp", "h", "go", "rs", "rb", "sh", "sql", "yaml", "yml", "toml",
    "csv", "tsv", "log", "ini", "cfg"
  ]);
  
  const ext = doc.file_path.split(".").pop()?.toLowerCase() || "";

  if (ext === "pdf") {
    // PDF uses the dedicated PdfViewer
    try {
      uiStore.setPdfLoading(true);
      const data = await Api.readFileBase64(doc.file_path);
      uiStore.setPdfViewerData({ data, title: doc.title });
      uiStore.setDocViewerFile(null); // Clear any other open viewer
    } catch (e) {
      console.error("Failed to load PDF:", e);
      uiStore.showError("Couldn't open that document. Please try again.");
    } finally {
      uiStore.setPdfLoading(false);
    }
  } else if (VIEWABLE_EXTS.has(ext)) {
    // Everything else uses the universal DocumentViewer
    uiStore.setDocViewerFile({ filePath: doc.file_path, title: doc.title });
    uiStore.setPdfViewerData(null); // Clear any PDF viewer
  }
}