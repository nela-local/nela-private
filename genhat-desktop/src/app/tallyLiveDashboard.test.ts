import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTallyLiveDashboardHtml,
  toInputDate,
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

  it("normalizes input dates", () => {
    assert.equal(toInputDate("20100601"), "2010-06-01");
    assert.equal(toInputDate("2010-07-31"), "2010-07-31");
    assert.equal(toInputDate(""), "");
  });
});
