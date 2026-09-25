import { useCloudStore } from "../../stores/cloudStore";
import { useModelStore } from "../../stores/modelStore";
import type { IntelligenceMode } from "../intelligenceModes";

/**
 * Cloud tiers that may request reasoning tokens.
 * Fast keeps tools but never streams thinking; Auto uses Fast-class latency.
 */
const CLOUD_REASONING_TIERS: ReadonlySet<IntelligenceMode> = new Set([
  "smart",
  "deep",
]);

export function intelligenceModeAllowsCloudReasoning(
  mode: IntelligenceMode
): boolean {
  return CLOUD_REASONING_TIERS.has(mode);
}

/**
 * Reasoning tokens are requested only for cloud (or auto→cloud) chat on
 * Smart / Deep (Pro). Local preferred mode, Fast, and Auto never enable thinking.
 * Tool calls are unaffected.
 */
export function shouldStreamCloudReasoning(thinkingEnabled: boolean): boolean {
  if (!thinkingEnabled) return false;
  const preferredMode = useCloudStore.getState().preferredMode;
  if (preferredMode !== "cloud" && preferredMode !== "auto") return false;
  const intelligenceMode = useModelStore.getState().intelligenceMode;
  return intelligenceModeAllowsCloudReasoning(intelligenceMode);
}
