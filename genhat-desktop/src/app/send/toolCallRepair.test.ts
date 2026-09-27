import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractQueriesFromFacetDump,
  looksLikeFacetPlannerPayload,
  looksLikeMisplacedToolOrPlannerPayload,
  looksLikeTruncatedFacetPlannerText,
  stripLeakedToolPayloads,
} from "./toolCallRepair.js";

describe("stripLeakedToolPayloads", () => {
  it("removes the truncated facet tail the user saw", () => {
    const raw = `(revenue, net income, YoY change) for the detailed workbook sheet."}]}`;
    assert.equal(stripLeakedToolPayloads(raw).trim(), "");
    assert.equal(looksLikeTruncatedFacetPlannerText(raw), true);
  });

  it("removes a full facet plan but keeps surrounding prose", () => {
    const plan = JSON.stringify({
      facets: [
        { name: "Revenue", query: "Infosys FY26 revenue", profile: "news" },
        { name: "Profit", query: "Infosys FY26 net income" },
      ],
    });
    const out = stripLeakedToolPayloads(`Here is the summary.\n${plan}\nRevenue grew 6%.`);
    assert.doesNotMatch(out, /facets|"query"/);
    assert.match(out, /Here is the summary\./);
    assert.match(out, /Revenue grew 6%\./);
  });

  it("removes XML tool-call markup", () => {
    const raw = `Checking.\n<tool_call>local_shell <arg_key>argv</arg_key> <arg_value>["ls"]</arg_value> </tool_call>`;
    assert.equal(stripLeakedToolPayloads(raw).trim(), "Checking.");
  });

  it("preserves JSON inside code fences", () => {
    const raw = 'Example:\n```json\n{"facets":[{"name":"a","query":"b"}]}\n```';
    assert.equal(stripLeakedToolPayloads(raw), raw);
  });

  it("leaves normal prose untouched", () => {
    const raw = "Revenue was ₹1,234.56 crore, up 4.20% YoY.";
    assert.equal(stripLeakedToolPayloads(raw), raw);
  });
});

describe("looksLikeMisplacedToolOrPlannerPayload", () => {
  it("detects facet planner JSON like the Morgan Stanley leak", () => {
    const raw = JSON.stringify({
      facets: [
        {
          name: "Earnings overview",
          query: "Morgan Stanley Q2 2026 earnings results",
          profile: "news",
        },
        {
          name: "Key financial metrics",
          query: "Morgan Stanley Q2 2026 revenue net income EPS",
          profile: "news",
        },
      ],
    });
    assert.equal(looksLikeMisplacedToolOrPlannerPayload(raw), true);
    assert.equal(looksLikeFacetPlannerPayload(JSON.parse(raw)), true);
  });

  it("detects fenced facet plans", () => {
    const raw =
      '```json\n{"facets":[{"name":"a","query":"b","profile":"news"}]}\n```';
    assert.equal(looksLikeMisplacedToolOrPlannerPayload(raw), true);
  });

  it("detects truncated facet fragments that leak into chat", () => {
    const frag = `2026 revenue","profile":"news"}]}`;
    assert.equal(looksLikeTruncatedFacetPlannerText(frag), true);
    assert.equal(looksLikeMisplacedToolOrPlannerPayload(frag), true);
    const mid =
      '{"facets":[{"name":"x","query":"Morgan Stanley Q2 2026 revenue","profile":"news"}]}';
    assert.equal(looksLikeMisplacedToolOrPlannerPayload(mid), true);
  });

  it("detects Anthropic-style XML tool_call leaks in chat", () => {
    const leak = `Python isn't available on this machine.
<tool_call>local_shell
<arg_key>argv</arg_key>
<arg_value>["ls", "/tmp"]</arg_value>
</tool_call>`;
    assert.equal(looksLikeMisplacedToolOrPlannerPayload(leak), true);
  });

  it("allows normal prose answers", () => {
    assert.equal(
      looksLikeMisplacedToolOrPlannerPayload(
        "Morgan Stanley reported strong Q2 results across wealth and institutional securities."
      ),
      false
    );
  });

  it("flags tool-shaped JSON without a host-valid tool field", () => {
    assert.equal(
      looksLikeMisplacedToolOrPlannerPayload(
        JSON.stringify({ query: "morgan stanley earnings", depth: "standard" })
      ),
      true
    );
  });
});

describe("extractQueriesFromFacetDump", () => {
  it("pulls queries from facet JSON", () => {
    const raw = JSON.stringify({
      facets: [
        { name: "a", query: "MS Q2 2026 earnings", profile: "news" },
        { name: "b", query: "MS Q2 2026 revenue", profile: "news" },
      ],
    });
    assert.deepEqual(extractQueriesFromFacetDump(raw), [
      "MS Q2 2026 earnings",
      "MS Q2 2026 revenue",
    ]);
  });
});
