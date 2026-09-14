import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeTallyRequest } from "./tallyConnectIntent.js";
import { buildCloudChatTools } from "./cloudTools.js";

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
    assert.equal(on.some((t) => t.function.name === "tally_live_dashboard"), true);
  });
});
