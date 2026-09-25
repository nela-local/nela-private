import { useAuthStore } from "../stores/authStore";
import { useCloudStore } from "../stores/cloudStore";
import { isPremiumAccount } from "./premiumAccess";

/**
 * Tally Connector access: paid Cloud (Starter/Pro) AND active add-on.
 * Missing addons field (old servers) → locked.
 */
export function hasTallyConnectorAccess(): boolean {
  const entitlement = useCloudStore.getState().entitlement;
  const profile = useAuthStore.getState().profile;
  if (!isPremiumAccount({ profile, entitlement })) return false;
  return Boolean(entitlement?.addons?.tallyConnector?.active);
}

/** Why Tally is locked — drives upgrade modal copy. */
export function tallyUpgradeReason(): "tally_needs_cloud" | "tally" {
  const entitlement = useCloudStore.getState().entitlement;
  const profile = useAuthStore.getState().profile;
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
