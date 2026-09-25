import React from "react";
import { Crown, X, Sparkles, Calculator } from "lucide-react";
import { useCloudStore } from "../stores/cloudStore";
import "./PremiumUpgradeModal.css";

const PremiumUpgradeModal: React.FC = () => {
  const open = useCloudStore((s) => s.upgradeModalOpen);
  const reason = useCloudStore((s) => s.upgradeModalReason);
  const closeUpgradeModal = useCloudStore((s) => s.closeUpgradeModal);
  const openPricingPage = useCloudStore((s) => s.openPricingPage);
  const openAddonCheckout = useCloudStore((s) => s.openAddonCheckout);
  const loading = useCloudStore((s) => s.loading);
  const error = useCloudStore((s) => s.error);

  if (!open) return null;

  const isCredits = reason === "credits";
  const isTallyNeedsCloud = reason === "tally_needs_cloud";
  const isTally = reason === "tally";

  const title = isCredits
    ? "Buy credits"
    : isTallyNeedsCloud
      ? "Cloud plan required"
      : isTally
        ? "Tally Connector"
        : "Upgrade to Premium";

  return (
    <div className="premium-upgrade-overlay" onClick={closeUpgradeModal}>
      <div
        className="premium-upgrade-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="premium-upgrade-title"
        data-tour="premium-upgrade-modal"
      >
        <div className="premium-upgrade-header">
          <div className="premium-upgrade-title" id="premium-upgrade-title">
            {isTally || isTallyNeedsCloud ? (
              <Calculator size={18} />
            ) : (
              <Crown size={18} />
            )}
            <span>{title}</span>
          </div>
          <button
            type="button"
            className="premium-upgrade-close"
            onClick={closeUpgradeModal}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="premium-upgrade-body">
          <div className="premium-upgrade-hero">
            <Sparkles size={28} />
          </div>
          {isCredits ? (
            <>
              <p>
                Your credit balance is empty. Buy a pack or wait for your next
                monthly grant to keep using <strong>Smart</strong> and{" "}
                <strong>Deep</strong> in Cloud.
              </p>
              <p className="premium-upgrade-hint">
                Fast on the free lane still works within your rolling limit.
                Local Private mode stays free on this device.
              </p>
            </>
          ) : isTallyNeedsCloud ? (
            <>
              <p>
                Tally Connector needs a paid Cloud plan (Starter or Pro) before
                you can buy the add-on and connect TallyPrime.
              </p>
              <p className="premium-upgrade-hint">
                Upgrade Cloud first, then unlock Tally at ₹299/mo or ₹2,999/yr.
              </p>
            </>
          ) : isTally ? (
            <>
              <p>
                Connect TallyPrime on this device for read-only ledgers,
                daybook, trial balance, and live dashboards you approve in chat.
              </p>
              <p className="premium-upgrade-hint">
                ₹299/month · ₹2,999/year. Requires an active paid Cloud plan.
              </p>
            </>
          ) : (
            <>
              <p>
                Upgrade to Premium or buy credits to use <strong>Smart</strong>{" "}
                and <strong>Deep</strong> in Cloud. Fast stays included on Free.
              </p>
              <p className="premium-upgrade-hint">
                Local Private mode keeps Fast, Smart, and Deep free on this
                device.
              </p>
            </>
          )}
          {error ? (
            <p className="premium-upgrade-hint" style={{ color: "#f87171" }}>
              {error}
            </p>
          ) : null}
        </div>
        <div className="premium-upgrade-actions">
          <button
            type="button"
            className="premium-upgrade-btn ghost"
            onClick={closeUpgradeModal}
          >
            Not now
          </button>
          {isTally ? (
            <>
              <button
                type="button"
                className="premium-upgrade-btn primary"
                disabled={loading}
                onClick={() =>
                  void openAddonCheckout("tally_connector", "month")
                }
              >
                Monthly · ₹299
              </button>
              <button
                type="button"
                className="premium-upgrade-btn primary"
                disabled={loading}
                onClick={() =>
                  void openAddonCheckout("tally_connector", "year")
                }
              >
                Yearly · ₹2,999
              </button>
            </>
          ) : (
            <button
              type="button"
              className="premium-upgrade-btn primary"
              disabled={loading}
              onClick={() => void openPricingPage()}
            >
              <Crown size={15} />
              {isCredits
                ? "Buy credits"
                : isTallyNeedsCloud
                  ? "View Cloud pricing"
                  : "View pricing"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PremiumUpgradeModal;
