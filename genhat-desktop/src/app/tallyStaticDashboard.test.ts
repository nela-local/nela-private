import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildTallyLiveDashboardHtml, NELA_TALLY_REQUEST } from "./tallyLiveDashboard.js";
import {
  buildTallyStaticDashboardHtml,
  isLiveTallyDashboardHtml,
  parseLiveTallyDashboardMeta,
  type TallyDashboardSnapshot,
} from "./tallyStaticDashboard.js";
import {
  clearTallyLiveSelection,
  getTallyLiveSelection,
  setTallyLiveSelection,
  tallySnapshotFileBase,
} from "./tallyLiveSelection.js";

function sampleSnapshot(
  overrides: Partial<TallyDashboardSnapshot> = {}
): TallyDashboardSnapshot {
  return {
    company: "Demo Co",
    host: "127.0.0.1",
    port: 9000,
    exportedAt: "2024-06-15T12:00:00.000Z",
    fromDate: "2010-06-01",
    toDate: "2010-07-31",
    focus: "daybook",
    daybook: {
      ok: true,
      lines: [
        {
          date: "20100615",
          voucherType: "Sales",
          party: "Acme",
          amount: "1000",
          narration: "Test",
        },
      ],
    },
    outstanding: {
      ok: true,
      receivables: { group: "Sundry Debtors", count: 0, ledgers: [] },
      payables: { group: "Sundry Creditors", count: 0, ledgers: [] },
    },
    trial_balance: {
      ok: true,
      rows: [{ name: "Cash", debit: "500", credit: "", closingBalance: "-500" }],
    },
    ...overrides,
  };
}

describe("tallyStaticDashboard", () => {
  it("detects live tally HTML", () => {
    const live = buildTallyLiveDashboardHtml({ title: "Live" });
    assert.equal(isLiveTallyDashboardHtml(live), true);
    const staticHtml = buildTallyStaticDashboardHtml({
      title: "Snap",
      snapshot: sampleSnapshot(),
    });
    assert.equal(isLiveTallyDashboardHtml(staticHtml), false);
  });

  it("parses title, dates, and focus from a live shell", () => {
    const live = buildTallyLiveDashboardHtml({
      title: "Live Day Book",
      fromDate: "20100601",
      toDate: "2010-07-31",
      focus: "outstanding",
      companyHint: "QUADRAGEN",
    });
    const meta = parseLiveTallyDashboardMeta(live);
    assert.equal(meta.title, "Live Day Book");
    assert.equal(meta.fromDate, "2010-06-01");
    assert.equal(meta.toDate, "2010-07-31");
    assert.equal(meta.focus, "outstanding");
  });

  it("builds a static snapshot without live bridge protocol", () => {
    const html = buildTallyStaticDashboardHtml({
      title: "Exported Dashboard",
      snapshot: sampleSnapshot({ focus: "trial_balance" }),
    });
    assert.match(html, /data-nela-tally-static="1"/);
    assert.doesNotMatch(html, /data-nela-tally-live/);
    assert.doesNotMatch(html, new RegExp(NELA_TALLY_REQUEST));
    assert.doesNotMatch(html, /id="standalone"/);
    assert.doesNotMatch(html, /id="refreshBtn"/);
    assert.match(html, /id="tally-snapshot"/);
    assert.match(html, /Demo Co/);
    assert.match(html, /2010-06-01/);
    assert.match(html, /2010-07-31/);
    assert.match(html, /data-focus="trial_balance"/);
    assert.match(html, /echarts@5\.5\.1/);
    assert.match(html, /Static snapshot/);
    assert.match(html, /Acme/);
  });

  it("includes tab errors in snapshot JSON when present", () => {
    const html = buildTallyStaticDashboardHtml({
      title: "Partial",
      snapshot: sampleSnapshot({
        daybook: { error: "Day book timed out" },
      }),
    });
    assert.match(html, /Day book timed out/);
  });

  it("uses overridden selection period in static snapshot build", () => {
    const html = buildTallyStaticDashboardHtml({
      title: "Custom Period",
      snapshot: sampleSnapshot({
        fromDate: "2024-01-01",
        toDate: "2024-03-31",
        company: "Acme Foods Pvt Ltd",
      }),
    });
    assert.match(html, /2024-01-01/);
    assert.match(html, /2024-03-31/);
    assert.match(html, /Acme Foods Pvt Ltd/);
  });
});

describe("tallyLiveSelection", () => {
  beforeEach(() => {
    clearTallyLiveSelection();
  });

  it("remembers selection updates", () => {
    setTallyLiveSelection({
      fromDate: "2024-04-01",
      toDate: "2024-04-30",
      focus: "daybook",
      company: "Demo Co",
    });
    const sel = getTallyLiveSelection();
    assert.equal(sel.fromDate, "2024-04-01");
    assert.equal(sel.toDate, "2024-04-30");
    assert.equal(sel.company, "Demo Co");
  });

  it("builds filename with company and date range", () => {
    const name = tallySnapshotFileBase({
      company: "QUADRAGEN VETHEALTH PVT. LTD., - (10-13)",
      fromDate: "2010-06-01",
      toDate: "2010-07-31",
    });
    assert.match(name, /QUADRAGEN/);
    assert.match(name, /2010-06-01_to_2010-07-31/);
  });
});
