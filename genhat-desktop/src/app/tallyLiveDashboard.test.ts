import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTallyLiveDashboardHtml,
  toInputDate,
  normalizeTallyLiveFocus,
  NELA_TALLY_REQUEST,
  NELA_TALLY_RESPONSE,
} from "./tallyLiveDashboard.js";

describe("tallyLiveDashboard", () => {
  it("builds a live shell with bridge protocol and controls", () => {
    const html = buildTallyLiveDashboardHtml({
      title: "Live Day Book",
      fromDate: "20100601",
      toDate: "2010-07-31",
      focus: "daybook",
      companyHint: "QUADRAGEN VETHEALTH PVT. LTD., - (10-13)",
      hostHint: "127.0.0.1",
      portHint: 9000,
    });
    assert.match(html, /data-nela-tally-live="1"/);
    assert.match(html, /id="standalone"/);
    assert.match(html, /var embedded/);
    assert.match(html, new RegExp(NELA_TALLY_REQUEST));
    assert.match(html, new RegExp(NELA_TALLY_RESPONSE));
    assert.match(html, /id="refreshBtn"/);
    assert.match(html, /echarts@5\.5\.1/);
    assert.match(html, /2010-06-01/);
    assert.match(html, /2010-07-31/);
    assert.match(html, /QUADRAGEN/);
  });

  it("includes five tabs, period presets, and three chart hosts", () => {
    const html = buildTallyLiveDashboardHtml({ focus: "sales" });
    assert.match(html, /data-focus="sales"/);
    assert.match(html, /data-focus="daybook"/);
    assert.match(html, /data-focus="cash_bank"/);
    assert.match(html, /data-focus="outstanding"/);
    assert.match(html, /data-focus="trial_balance"/);
    assert.match(html, /data-preset="7d"/);
    assert.match(html, /data-preset="mtd"/);
    assert.match(html, /data-preset="fy"/);
    assert.match(html, /id="chart-a"/);
    assert.match(html, /id="chart-b"/);
    assert.match(html, /id="chart-c"/);
    assert.match(html, /id="trendToggle"/);
    assert.match(html, /function setChart/);
    assert.match(html, /grouped_bar/);
    assert.match(html, /type === "line"/);
    assert.match(html, /renderSales/);
    assert.match(html, /renderCashBank/);
    assert.match(html, /type: many \? "scroll" : "plain"/);
    assert.match(html, /center: \["50%", many \? "40%" : "44%"\]/);
  });

  it("normalizes input dates and focuses", () => {
    assert.equal(toInputDate("20100601"), "2010-06-01");
    assert.equal(toInputDate("2010-07-31"), "2010-07-31");
    assert.equal(toInputDate(""), "");
    assert.equal(normalizeTallyLiveFocus("cash_bank"), "cash_bank");
    assert.equal(normalizeTallyLiveFocus("Sales"), "sales");
  });
});
