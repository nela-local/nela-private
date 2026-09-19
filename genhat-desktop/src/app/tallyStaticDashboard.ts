/**
 * Static (baked) Tally dashboard HTML for download/export.
 * Values are embedded at export time — no NELA bridge or live Tally connector.
 */

import { Api } from "../api";
import { grantTallySessionTrust } from "../stores/tallyAccessConfirmStore";
import { toInputDate, type TallyLiveFocus } from "./tallyLiveDashboard";

export type TallyStaticMeta = {
  title: string;
  fromDate: string;
  toDate: string;
  focus: TallyLiveFocus;
};

export type TallySnapshotTabError = {
  error: string;
};

export type TallyDashboardSnapshot = {
  company: string | null;
  host: string | null;
  port: number | null;
  exportedAt: string;
  fromDate: string;
  toDate: string;
  focus: TallyLiveFocus;
  daybook: unknown | TallySnapshotTabError;
  outstanding: unknown | TallySnapshotTabError;
  trial_balance: unknown | TallySnapshotTabError;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when HTML is a live Tally dashboard shell (needs NELA bridge). */
export function isLiveTallyDashboardHtml(html: string): boolean {
  return /data-nela-tally-live\s*=\s*["']?1["']?/i.test(html.slice(0, 8000));
}

function attrValue(html: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i");
  const m = html.match(re);
  return m?.[1]?.trim() ?? "";
}

function inputValue(html: string, id: string): string {
  const re = new RegExp(
    `<input[^>]*\\bid=["']${id}["'][^>]*\\bvalue=["']([^"']*)["']`,
    "i"
  );
  const m = html.match(re);
  if (m) return m[1].trim();
  // value may appear before id
  const re2 = new RegExp(
    `<input[^>]*\\bvalue=["']([^"']*)["'][^>]*\\bid=["']${id}["']`,
    "i"
  );
  const m2 = html.match(re2);
  return m2?.[1]?.trim() ?? "";
}

function titleFromHtml(html: string): string {
  const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (t?.[1]?.trim()) return t[1].trim();
  const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  return h1?.[1]?.trim() || "Tally Dashboard";
}

function parseFocus(raw: string): TallyLiveFocus {
  if (raw === "outstanding" || raw === "trial_balance") return raw;
  return "daybook";
}

/** Extract title / date range / focus from a live dashboard HTML shell. */
export function parseLiveTallyDashboardMeta(html: string): TallyStaticMeta {
  const focus = parseFocus(attrValue(html, "data-focus"));
  const fromDate = toInputDate(inputValue(html, "fromDate")) || "";
  const toDate = toInputDate(inputValue(html, "toDate")) || "";
  return {
    title: titleFromHtml(html).slice(0, 120),
    fromDate,
    toDate,
    focus,
  };
}

function asTabError(e: unknown): TallySnapshotTabError {
  const msg = e instanceof Error ? e.message : String(e);
  return { error: msg || "Export failed." };
}

function isTabError(v: unknown): v is TallySnapshotTabError {
  return Boolean(v && typeof v === "object" && "error" in v && !("ok" in v));
}

/**
 * Fetch all three report tabs from Tally for a static snapshot.
 * Throws if Tally is not connected.
 */
export async function fetchTallyDashboardSnapshot(opts: {
  fromDate?: string | null;
  toDate?: string | null;
  focus?: TallyLiveFocus;
}): Promise<TallyDashboardSnapshot> {
  grantTallySessionTrust();

  const status = await Api.tallyStatus();
  if (!status.connected) {
    throw new Error(
      "Tally is not connected. Connect in Settings first (HTTP on localhost), then download again."
    );
  }

  const fromDate = toInputDate(opts.fromDate) || null;
  const toDate = toInputDate(opts.toDate) || null;
  const focus = opts.focus ?? "daybook";

  const [daybookRes, outstandingRes, trialRes] = await Promise.all([
    Api.tallyDaybook({
      fromDate,
      toDate,
      maxRows: 200,
    }).catch(asTabError),
    Api.tallyOutstanding({ maxRows: 100 }).catch(asTabError),
    Api.tallyTrialBalance({
      fromDate,
      toDate,
      maxRows: 200,
    }).catch(asTabError),
  ]);

  const wrapReport = (
    res: { ok?: boolean; error?: string | null } | TallySnapshotTabError
  ): unknown | TallySnapshotTabError => {
    if (isTabError(res)) return res;
    if (res && typeof res === "object" && res.ok === false) {
      return { error: res.error || "Tally export failed." };
    }
    return res;
  };

  return {
    company: status.company ?? null,
    host: status.host ?? null,
    port: status.port ?? null,
    exportedAt: new Date().toISOString(),
    fromDate: fromDate || "",
    toDate: toDate || "",
    focus,
    daybook: wrapReport(daybookRes as { ok?: boolean; error?: string | null }),
    outstanding: wrapReport(
      outstandingRes as { ok?: boolean; error?: string | null }
    ),
    trial_balance: wrapReport(
      trialRes as { ok?: boolean; error?: string | null }
    ),
  };
}

export type BuildTallyStaticDashboardOptions = {
  title?: string;
  snapshot: TallyDashboardSnapshot;
};

/**
 * Build a self-contained static dashboard HTML page with baked Tally values.
 * Opens in any browser (needs network only for ECharts CDN).
 */
export function buildTallyStaticDashboardHtml(
  opts: BuildTallyStaticDashboardOptions
): string {
  const snap = opts.snapshot;
  const title = (opts.title?.trim() || "Tally Dashboard Snapshot").slice(0, 120);
  const focus = snap.focus ?? "daybook";
  const from = snap.fromDate || "";
  const to = snap.toDate || "";
  const company = snap.company?.trim() || "";
  const host = snap.host?.trim() || "127.0.0.1";
  const port = snap.port ?? 9000;
  const exportedLabel = (() => {
    try {
      return new Date(snap.exportedAt).toLocaleString();
    } catch {
      return snap.exportedAt;
    }
  })();

  const snapshotJson = JSON.stringify(snap).replace(/</g, "\\u003c");

  const rangeLabel =
    from || to
      ? `${esc(from || "…")} → ${esc(to || "…")}`
      : "All dates";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>
  <style>
    :root {
      --bg: #f8fafc;
      --card: #ffffff;
      --txt: #0f172a;
      --muted: #64748b;
      --accent: #2563eb;
      --border: #e2e8f0;
      --danger: #b91c1c;
      --warn: #b45309;
      --ok: #047857;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--txt);
      line-height: 1.45;
    }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 1.25rem 1rem 2.5rem; }
    header h1 { margin: 0 0 .25rem; font-size: 1.35rem; font-weight: 700; }
    .sub { color: var(--muted); font-size: .85rem; margin: 0 0 1rem; }
    .toolbar {
      display: flex; flex-wrap: wrap; gap: .6rem; align-items: end;
      padding: .85rem 1rem; background: var(--card); border: 1px solid var(--border);
      border-radius: 14px; margin-bottom: 1rem;
    }
    .toolbar label { display: flex; flex-direction: column; gap: .25rem; font-size: .72rem; color: var(--muted); font-weight: 600; }
    .toolbar .date-label {
      border: 1px solid var(--border); border-radius: 8px; padding: .4rem .55rem;
      font: inherit; color: var(--txt); background: #f1f5f9; min-width: 9rem;
    }
    .tabs { display: flex; gap: .35rem; flex-wrap: wrap; }
    .tab {
      border: 1px solid var(--border); background: #fff; border-radius: 999px;
      padding: .35rem .75rem; font-size: .78rem; cursor: pointer; color: var(--muted);
    }
    .tab.active { background: color-mix(in srgb, var(--accent) 12%, #fff); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); color: var(--accent); font-weight: 600; }
    #status {
      margin: 0 0 1rem; padding: .55rem .75rem; border-radius: 10px;
      background: #eff6ff; color: #1e3a8a; font-size: .8rem; border: 1px solid #bfdbfe;
    }
    #status.error { background: #fef2f2; color: var(--danger); border-color: #fecaca; }
    #status.warn { background: #fffbeb; color: var(--warn); border-color: #fde68a; }
    #mismatch {
      display: none; margin: 0 0 1rem; padding: .55rem .75rem; border-radius: 10px;
      background: #fffbeb; color: var(--warn); font-size: .8rem; border: 1px solid #fde68a;
    }
    .kpis {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: .75rem; margin-bottom: 1rem;
    }
    .kpi {
      background: var(--card); border: 1px solid var(--border); border-radius: 14px;
      padding: .85rem 1rem;
    }
    .kpi .lbl { font-size: .7rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .kpi .val { font-size: 1.35rem; font-weight: 700; margin-top: .2rem; }
    .charts {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: .85rem; margin-bottom: 1rem;
    }
    .chart-card {
      background: var(--card); border: 1px solid var(--border); border-radius: 14px;
      padding: .75rem 1rem 1rem;
    }
    .chart-card h3 { margin: 0 0 .5rem; font-size: .9rem; }
    .chart-host { width: 100%; height: 280px; }
    .table-card {
      background: var(--card); border: 1px solid var(--border); border-radius: 14px;
      padding: .75rem 1rem 1rem; overflow: auto;
    }
    .table-card h3 { margin: 0 0 .5rem; font-size: .9rem; }
    table { width: 100%; border-collapse: collapse; font-size: .8rem; }
    th, td { text-align: left; padding: .45rem .4rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-size: .7rem; text-transform: uppercase; letter-spacing: .03em; }
    footer { margin-top: 1.25rem; color: var(--muted); font-size: .72rem; }
    .empty { color: var(--muted); font-size: .85rem; padding: 1rem 0; }
  </style>
</head>
<body data-nela-tally-static="1" data-focus="${esc(focus)}">
  <div class="wrap">
    <header>
      <h1>${esc(title)}</h1>
      <p class="sub">Snapshot exported ${esc(exportedLabel)} · ${esc(host)}:${port}${company ? " · " + esc(company) : ""}</p>
    </header>

    <div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Report">
        <button type="button" class="tab${focus === "daybook" ? " active" : ""}" data-focus="daybook">Day Book</button>
        <button type="button" class="tab${focus === "outstanding" ? " active" : ""}" data-focus="outstanding">Outstanding</button>
        <button type="button" class="tab${focus === "trial_balance" ? " active" : ""}" data-focus="trial_balance">Trial Balance</button>
      </div>
      <label>Period
        <div class="date-label">${rangeLabel}</div>
      </label>
    </div>

    <div id="status">Loading snapshot…</div>
    <div id="mismatch"></div>
    <div class="kpis" id="kpi-grid"></div>
    <div class="charts">
      <div class="chart-card"><h3 id="chart-mix-title">Breakdown</h3><div class="chart-host" id="chart-mix"></div></div>
      <div class="chart-card"><h3 id="chart-trend-title">Trend</h3><div class="chart-host" id="chart-trend"></div></div>
    </div>
    <div class="table-card">
      <h3 id="table-title">Details</h3>
      <div id="table-wrap"><p class="empty">Waiting for data…</p></div>
    </div>
    <footer>Static snapshot · figures baked at export · does not require Tally or NELA · tabs switch among exported reports</footer>
  </div>
  <script type="application/json" id="tally-snapshot">${snapshotJson}</script>
  <script>
(function () {
  var focus = document.body.getAttribute("data-focus") || "daybook";
  var chartMix = null;
  var chartTrend = null;
  var snap = null;
  try {
    var el = document.getElementById("tally-snapshot");
    snap = el ? JSON.parse(el.textContent || "{}") : {};
  } catch (_e) {
    snap = {};
  }
  var from = (snap && snap.fromDate) || "";
  var to = (snap && snap.toDate) || "";
  var meta = {
    company: (snap && snap.company) || null,
    host: (snap && snap.host) || null,
    port: (snap && snap.port) || null
  };

  function $(id) { return document.getElementById(id); }
  function setStatus(msg, kind) {
    var el = $("status");
    el.textContent = msg;
    el.className = kind || "";
  }
  function setMismatch(msg) {
    var el = $("mismatch");
    if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
    el.style.display = "block";
    el.textContent = msg;
  }
  function money(n) {
    if (!Number.isFinite(n)) return "—";
    return "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  function parseAmt(s) {
    if (s == null || s === "") return NaN;
    var t = String(s).replace(/,/g, "").trim();
    var n = parseFloat(t);
    if (Number.isFinite(n)) return n;
    var eq = t.lastIndexOf("=");
    var focusAmt = eq >= 0 ? t.slice(eq + 1) : t;
    var m = focusAmt.match(/[+-]?\\d+(?:\\.\\d+)?/);
    if (!m) m = t.match(/[+-]?\\d+(?:\\.\\d+)?/);
    if (!m) return NaN;
    n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : NaN;
  }
  function normalizeDate(s) {
    if (!s) return "";
    var d = String(s).replace(/\\D/g, "");
    if (d.length === 8) return d.slice(0,4) + "-" + d.slice(4,6) + "-" + d.slice(6,8);
    if (/^\\d{4}-\\d{2}-\\d{2}/.test(String(s))) return String(s).slice(0, 10);
    return "";
  }
  function inRange(iso, fromD, toD) {
    if (!iso) return false;
    if (fromD && iso < fromD) return false;
    if (toD && iso > toD) return false;
    return true;
  }
  function ensureCharts() {
    if (typeof echarts === "undefined") return;
    if (!chartMix) chartMix = echarts.init($("chart-mix"), null, { renderer: "svg" });
    if (!chartTrend) chartTrend = echarts.init($("chart-trend"), null, { renderer: "svg" });
  }
  function setKpis(items) {
    var grid = $("kpi-grid");
    grid.innerHTML = items.map(function (it) {
      return '<div class="kpi"><div class="lbl">' + it.label + '</div><div class="val">' + it.value + '</div></div>';
    }).join("");
  }
  function setTable(headers, rows) {
    var wrap = $("table-wrap");
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">No rows in this window.</p>';
      return;
    }
    var th = headers.map(function (h) { return "<th>" + h + "</th>"; }).join("");
    var body = rows.slice(0, 80).map(function (r) {
      return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
    }).join("");
    wrap.innerHTML = "<table><thead><tr>" + th + "</tr></thead><tbody>" + body + "</tbody></table>";
  }
  function isErr(payload) {
    return payload && typeof payload === "object" && payload.error && !payload.lines && !payload.rows && !payload.receivables;
  }
  function showTabError(payload) {
    setMismatch("");
    setKpis([]);
    $("chart-mix-title").textContent = "Breakdown";
    $("chart-trend-title").textContent = "Trend";
    $("table-title").textContent = "Details";
    if (chartMix) chartMix.clear();
    if (chartTrend) chartTrend.clear();
    $("table-wrap").innerHTML = '<p class="empty">' + (payload && payload.error ? payload.error : "No data for this tab.") + "</p>";
    setStatus(payload && payload.error ? payload.error : "Tab unavailable in this snapshot.", "error");
  }

  function renderDaybook(payload, fromD, toD, metaObj) {
    var lines = (payload && payload.lines) || [];
    var filtered = [];
    var outside = 0;
    for (var i = 0; i < lines.length; i++) {
      var iso = normalizeDate(lines[i].date);
      if (fromD || toD) {
        if (inRange(iso, fromD, toD)) filtered.push(lines[i]);
        else outside++;
      } else {
        filtered.push(lines[i]);
      }
    }
    if (outside > 0) {
      setMismatch("Data mismatch: Tally returned " + lines.length + " vouchers; " + outside +
        " fall outside " + (fromD || "…") + " → " + (toD || "…") + ". Charts use in-range rows only (" + filtered.length + ").");
    } else {
      setMismatch("");
    }

    var total = 0;
    var byType = {};
    var byDay = {};
    for (var j = 0; j < filtered.length; j++) {
      var row = filtered[j];
      var amt = Math.abs(parseAmt(row.amount));
      if (Number.isFinite(amt)) total += amt;
      var vt = (row.voucherType || row.voucher_type || "Other").trim() || "Other";
      byType[vt] = (byType[vt] || 0) + (Number.isFinite(amt) ? amt : 0);
      var day = normalizeDate(row.date) || "unknown";
      byDay[day] = (byDay[day] || 0) + (Number.isFinite(amt) ? amt : 1);
    }
    setKpis([
      { label: "Vouchers", value: String(filtered.length) },
      { label: "Total value", value: money(total) },
      { label: "Types", value: String(Object.keys(byType).length) },
      { label: "Company", value: (metaObj && metaObj.company) || "—" }
    ]);
    $("chart-mix-title").textContent = "Amount by voucher type";
    $("chart-trend-title").textContent = "Activity by day";
    $("table-title").textContent = "Voucher detail";
    ensureCharts();
    var typeLabels = Object.keys(byType);
    var typeVals = typeLabels.map(function (k) { return byType[k]; });
    if (chartMix) {
      chartMix.setOption({
        tooltip: { trigger: "item" },
        series: [{ type: "pie", radius: ["35%", "65%"], data: typeLabels.map(function (l, i) { return { name: l, value: typeVals[i] }; }) }]
      }, true);
    }
    var days = Object.keys(byDay).sort();
    if (chartTrend) {
      chartTrend.setOption({
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: days },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: days.map(function (d) { return byDay[d]; }), itemStyle: { color: "#2563eb" } }]
      }, true);
    }
    setTable(
      ["Date", "Type", "Party", "Amount", "Narration"],
      filtered.map(function (r) {
        return [
          normalizeDate(r.date) || (r.date || "—"),
          r.voucherType || r.voucher_type || "—",
          r.party || "—",
          money(parseAmt(r.amount)),
          (r.narration || "—").toString().slice(0, 120)
        ];
      })
    );
  }

  function renderOutstanding(payload, metaObj) {
    setMismatch("");
    var recv = (payload && payload.receivables && payload.receivables.ledgers) || [];
    var pay = (payload && payload.payables && payload.payables.ledgers) || [];
    function sum(list) {
      var t = 0;
      for (var i = 0; i < list.length; i++) {
        var a = Math.abs(parseAmt(list[i].closingBalance || list[i].closing_balance));
        if (Number.isFinite(a)) t += a;
      }
      return t;
    }
    var rTot = sum(recv);
    var pTot = sum(pay);
    setKpis([
      { label: "Receivables", value: money(rTot) },
      { label: "Payables", value: money(pTot) },
      { label: "Debtors", value: String(recv.length) },
      { label: "Creditors", value: String(pay.length) }
    ]);
    $("chart-mix-title").textContent = "Receivables vs payables";
    $("chart-trend-title").textContent = "Top parties";
    $("table-title").textContent = "Outstanding ledgers";
    ensureCharts();
    if (chartMix) {
      chartMix.setOption({
        tooltip: { trigger: "item" },
        series: [{ type: "pie", radius: ["35%", "65%"], data: [
          { name: "Receivables", value: rTot },
          { name: "Payables", value: pTot }
        ]}]
      }, true);
    }
    var combined = recv.concat(pay).map(function (l) {
      return { name: l.name, val: Math.abs(parseAmt(l.closingBalance || l.closing_balance)), parent: l.parent || "" };
    }).filter(function (x) { return Number.isFinite(x.val); }).sort(function (a, b) { return b.val - a.val; }).slice(0, 12);
    if (chartTrend) {
      chartTrend.setOption({
        tooltip: { trigger: "axis" },
        grid: { left: 40, right: 16, top: 24, bottom: 64 },
        xAxis: { type: "category", data: combined.map(function (c) { return c.name.slice(0, 18); }), axisLabel: { rotate: 30 } },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: combined.map(function (c) { return c.val; }), itemStyle: { color: "#2563eb" } }]
      }, true);
    }
    setTable(
      ["Ledger", "Group", "Balance"],
      recv.concat(pay).map(function (l) {
        return [l.name, l.parent || "—", money(parseAmt(l.closingBalance || l.closing_balance))];
      })
    );
  }

  function renderTrial(payload, metaObj) {
    setMismatch("");
    var rows = (payload && (payload.rows || payload.ledgers)) || [];
    var debitTot = 0;
    var creditTot = 0;
    for (var i = 0; i < rows.length; i++) {
      var d = Math.abs(parseAmt(rows[i].debit));
      var c = Math.abs(parseAmt(rows[i].credit));
      var closing = parseAmt(rows[i].closingBalance || rows[i].closing_balance);
      if (Number.isFinite(d) && d > 0) debitTot += d;
      else if (Number.isFinite(closing) && closing < 0) debitTot += Math.abs(closing);
      if (Number.isFinite(c) && c > 0) creditTot += c;
      else if (Number.isFinite(closing) && closing > 0 && !(Number.isFinite(d) && d > 0)) creditTot += closing;
    }
    setKpis([
      { label: "Accounts", value: String(rows.length) },
      { label: "Debit (Dr)", value: money(debitTot) },
      { label: "Credit (Cr)", value: money(creditTot) },
      { label: "Company", value: (metaObj && metaObj.company) || "—" }
    ]);
    $("chart-mix-title").textContent = "Debit vs credit";
    $("chart-trend-title").textContent = "Top accounts";
    $("table-title").textContent = "Trial balance";
    ensureCharts();
    if (chartMix) {
      chartMix.setOption({
        tooltip: { trigger: "item" },
        series: [{ type: "pie", radius: ["35%", "65%"], data: [
          { name: "Debit", value: debitTot || 0 },
          { name: "Credit", value: creditTot || 0 }
        ]}]
      }, true);
    }
    var top = rows.map(function (r) {
      var d = Math.abs(parseAmt(r.debit));
      var c = Math.abs(parseAmt(r.credit));
      var net = Math.abs(parseAmt(r.closingBalance || r.closing_balance));
      var val = Math.max(
        Number.isFinite(d) ? d : 0,
        Number.isFinite(c) ? c : 0,
        Number.isFinite(net) ? net : 0
      );
      return { name: r.name, val: val };
    }).filter(function (x) { return Number.isFinite(x.val) && x.val > 0; }).sort(function (a, b) { return b.val - a.val; }).slice(0, 12);
    if (chartTrend) {
      chartTrend.setOption({
        tooltip: { trigger: "axis" },
        grid: { left: 40, right: 16, top: 24, bottom: 64 },
        xAxis: { type: "category", data: top.map(function (c) { return c.name.slice(0, 18); }), axisLabel: { rotate: 30 } },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: top.map(function (c) { return c.val; }), itemStyle: { color: "#2563eb" } }]
      }, true);
    }
    setTable(
      ["Account", "Debit (Dr)", "Credit (Cr)", "Net"],
      rows.slice(0, 80).map(function (r) {
        return [
          r.name,
          money(parseAmt(r.debit)),
          money(parseAmt(r.credit)),
          money(parseAmt(r.closingBalance || r.closing_balance))
        ];
      })
    );
  }

  function showFocus() {
    var where = (meta.host || "127.0.0.1") + ":" + (meta.port || "?");
    var when = (snap && snap.exportedAt) ? new Date(snap.exportedAt).toLocaleString() : "";
    var kind = focus === "outstanding" ? "outstanding" : focus === "trial_balance" ? "trial_balance" : "daybook";
    var payload = snap && snap[kind];
    if (isErr(payload)) {
      showTabError(payload);
      return;
    }
    setStatus("Snapshot · " + where + (meta.company ? " · " + meta.company : "") + (when ? " · exported " + when : ""));
    if (kind === "daybook") renderDaybook(payload, from, to, meta);
    else if (kind === "outstanding") renderOutstanding(payload, meta);
    else renderTrial(payload, meta);
    if (chartMix) chartMix.resize();
    if (chartTrend) chartTrend.resize();
  }

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      focus = tab.getAttribute("data-focus") || "daybook";
      document.body.setAttribute("data-focus", focus);
      showFocus();
    });
  });
  window.addEventListener("resize", function () {
    if (chartMix) chartMix.resize();
    if (chartTrend) chartTrend.resize();
  });
  showFocus();
})();
  </script>
</body>
</html>`;
}

/**
 * Build a static snapshot HTML from a live dashboard shell + live Tally fetch.
 * `selection` overrides dates/focus from the on-disk shell (e.g. iframe preview period).
 */
export async function materializeTallyDashboardSnapshot(
  liveHtml: string,
  selection?: {
    fromDate?: string | null;
    toDate?: string | null;
    focus?: TallyLiveFocus;
  }
): Promise<{ html: string; snapshot: TallyDashboardSnapshot; title: string }> {
  const meta = parseLiveTallyDashboardMeta(liveHtml);
  const fromDate = (selection?.fromDate ?? meta.fromDate) || null;
  const toDate = (selection?.toDate ?? meta.toDate) || null;
  const focus = selection?.focus ?? meta.focus;
  const snapshot = await fetchTallyDashboardSnapshot({
    fromDate,
    toDate,
    focus,
  });
  const title = meta.title;
  const html = buildTallyStaticDashboardHtml({
    title,
    snapshot,
  });
  return { html, snapshot, title };
}

/** UTF-8 string → base64 for Api.saveBinaryFile. */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
