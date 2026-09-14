import { openUrl } from "@tauri-apps/plugin-opener";
import { Api } from "../api";

/** Live Tally HTML needs the NELA preview bridge — not a raw browser file:// tab. */
async function isLiveTallyDashboard(path: string): Promise<boolean> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "html" && ext !== "htm") return false;
  try {
    const text = await Api.readFileText(path);
    return /data-nela-tally-live\s*=\s*["']?1["']?/i.test(text.slice(0, 8000));
  } catch {
    return false;
  }
}

/** Open a generated artifact with the OS default application. */
export async function openArtifactInOs(path: string): Promise<void> {
  if (await isLiveTallyDashboard(path)) {
    throw new Error(
      "Live Tally dashboards only work inside NELA’s preview (file:// browsers block the host bridge). Use Refresh in the app."
    );
  }

  try {
    await Api.openPathInOs(path);
    return;
  } catch (primaryErr) {
    console.warn("openPathInOs failed, trying fallbacks:", primaryErr);
  }

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "html" || ext === "htm") {
    const normalized = path.replace(/\\/g, "/");
    const url = normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
    try {
      await openUrl(url);
      return;
    } catch (urlErr) {
      console.warn("file:// open failed:", urlErr);
    }
  }

  await Api.revealInExplorer(path);
}
