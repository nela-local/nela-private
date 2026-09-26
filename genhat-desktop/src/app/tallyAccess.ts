import { useCloudStore } from "../stores/cloudStore";
import { useAuthStore } from "../stores/authStore";
import { isPremiumAccount } from "./premiumAccess";

/**
 * Tally Connector access follows server entitlement.addons.tallyConnector.active
 * (paid Cloud + add-on, or complimentary early-access grant).
 * Missing addons field (old servers) → locked.
 */
export function hasTallyConnectorAccess(): boolean {
  const entitlement = useCloudStore.getState().entitlement;
  return Boolean(entitlement?.addons?.tallyConnector?.active);
}

/** Why Tally is locked — drives upgrade modal copy. */
export function tallyUpgradeReason(): "tally_needs_cloud" | "tally" {
  const entitlement = useCloudStore.getState().entitlement;
  const profile = useAuthStore.getState().profile;
  // If the server already says active, this shouldn't be called — but be safe.
  if (entitlement?.addons?.tallyConnector?.active) return "tally";
  if (!isPremiumAccount({ profile, entitlement })) return "tally_needs_cloud";
  return "tally";
}

/**
 * Open the appropriate upgrade modal if Tally is locked.
 * @returns true if access is allowed
 */
export function requireTallyConnectorAccess(): boolean {
  if (hasTallyConnectorAccess()) return true;
  useCloudStore.getState().openUpgradeModal(tallyUpgradeReason());
  return false;
}
