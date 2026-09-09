import React, { useMemo, useSyncExternalStore } from "react";

/** Intrinsic animation stage size from logo-dark-clean.html */
const STAGE_W = 449;
const STAGE_H = 555;

/** Fallback matches dark --color-void-900 in index.css */
const FALLBACK_COVER = "#08080c";

function readCoverColor(): string {
  if (typeof document === "undefined") return FALLBACK_COVER;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-void-900")
    .trim();
  return raw || FALLBACK_COVER;
}

function subscribeTheme(onStoreChange: () => void) {
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  return () => observer.disconnect();
}

interface NelaLoadingIconProps {
  /** Display height in px (width follows the 449×555 stage aspect). Default 32 to match chat avatars. */
  size?: number;
  className?: string;
}

export default function NelaLoadingIcon({
  size = 32,
  className = "",
}: NelaLoadingIconProps) {
  const cover = useSyncExternalStore(subscribeTheme, readCoverColor, () => FALLBACK_COVER);
  const scale = size / STAGE_H;
  const displayW = Math.round(STAGE_W * scale);

  const src = useMemo(
    () => `/logo-dark-clean.html?cover=${encodeURIComponent(cover)}`,
    [cover]
  );

  return (
    <div
      className={`relative overflow-hidden shrink-0 ${className}`}
      style={{ width: displayW, height: size }}
      role="status"
      aria-label="NELA is generating a response"
    >
      <iframe
        src={src}
        title="NELA loading"
        tabIndex={-1}
        aria-hidden
        scrolling="no"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: STAGE_W,
          height: STAGE_H,
          border: "none",
          outline: "none",
          overflow: "hidden",
          pointerEvents: "none",
          background: "transparent",
          colorScheme: "normal",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}
