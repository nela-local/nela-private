import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeTallyRequest } from "./tallyConnectIntent.js";
import { buildCloudChatTools } from "./cloudTools.js";
import { normalizeTallyLiveFocus } from "../tallyLiveDashboard.js";

describe("tallyConnectIntent", () => {
  it("detects explicit Tally and dashboard asks", () => {
    assert.equal(looksLikeTallyRequest("Connect my TallyPrime company"), true);
    assert.equal(
      looksLikeTallyRequest("Build a receivables dashboard from outstanding balances"),
      true
    );
    assert.equal(looksLikeTallyRequest("What's the weather?"), false);
  });
});

describe("tally tools gating", () => {
  it("includes tally tools only when enabled", () => {
    const off = buildCloudChatTools({ tallyEnabled: false });
    assert.equal(
      off.some((t) => t.function.name === "tally_outstanding"),
      false
    );
    const on = buildCloudChatTools({ tallyEnabled: true });
    assert.equal(on.some((t) => t.function.name === "tally_status"), true);
    assert.equal(on.some((t) => t.function.name === "tally_list_ledgers"), true);
    assert.equal(on.some((t) => t.function.name === "tally_trial_balance"), true);
    assert.equal(on.some((t) => t.function.name === "tally_daybook"), true);
    assert.equal(on.some((t) => t.function.name === "tally_outstanding"), true);
    assert.equal(on.some((t) => t.function.name === "tally_sales"), true);
    assert.equal(on.some((t) => t.function.name === "tally_cash_bank"), true);
    assert.equal(on.some((t) => t.function.name === "tally_live_dashboard"), true);
    assert.equal(on.some((t) => t.function.name === "tally_export_excel"), true);
  });

  it("live dashboard focus enum includes sales and cash_bank", () => {
    const on = buildCloudChatTools({ tallyEnabled: true });
    const live = on.find((t) => t.function.name === "tally_live_dashboard");
    assert.ok(live);
    const params = live.function.parameters as {
      properties?: Record<string, { enum?: string[] }>;
    };
    assert.deepEqual(params.properties?.focus?.enum, [
      "daybook",
      "outstanding",
      "trial_balance",
      "sales",
      "cash_bank",
    ]);
  });
});

describe("normalizeTallyLiveFocus", () => {
  it("maps known focuses", () => {
    assert.equal(normalizeTallyLiveFocus("sales"), "sales");
    assert.equal(normalizeTallyLiveFocus("cash-bank"), "cash_bank");
    assert.equal(normalizeTallyLiveFocus("trial_balance"), "trial_balance");
    assert.equal(normalizeTallyLiveFocus("unknown"), "daybook");
  });
});
