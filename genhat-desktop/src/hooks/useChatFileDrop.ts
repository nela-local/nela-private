import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { acceptDroppedChatPaths } from "../app/ragUiActions";

/**
 * Listen for OS file drag-and-drop on the NELA window (Tauri paths, not
 * HTML5 File blobs) and attach them to the chat composer.
 */
export function useChatFileDrop(enabled: boolean): { dragActive: boolean } {
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDragActive(false);
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragActive(true);
          return;
        }
        if (payload.type === "leave") {
          setDragActive(false);
          return;
        }
        if (payload.type === "drop") {
          setDragActive(false);
          const paths = payload.paths ?? [];
          if (paths.length === 0) return;
          void acceptDroppedChatPaths(paths);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch((err) => {
        console.warn("Chat file drop listener unavailable:", err);
      });

    return () => {
      cancelled = true;
      setDragActive(false);
      unlisten?.();
    };
  }, [enabled]);

  return { dragActive };
}
