/**
 * Host-owned Live Tally Dashboard HTML shell.
 * Fetches data via postMessage → NELA parent (not direct localhost CORS).
 */

export type TallyLiveFocus =
  | "daybook"
  | "outstanding"
  | "trial_balance"
  | "sales"
  | "cash_bank";

export type TallyLiveDashboardOptions = {
  title?: string;
  fromDate?: string | null;
  toDate?: string | null;
  focus?: TallyLiveFocus;
  companyHint?: string | null;
  hostHint?: string | null;
  portHint?: number | null;
};

export const NELA_TALLY_REQUEST = "nela-tally-request";
export const NELA_TALLY_RESPONSE = "nela-tally-response";
export const NELA_TALLY_SELECTION = "nela-tally-selection";

export type TallyLiveRequestKind =
  | "status"
  | "daybook"
  | "outstanding"
  | "trial_balance"
  | "list_ledgers"
  | "sales"
  | "cash_bank";

export type TallyLiveRequestMessage = {
  type: typeof NELA_TALLY_REQUEST;
  id: string;
  kind: TallyLiveRequestKind;
  fromDate?: string | null;
  toDate?: string | null;
  maxRows?: number;
};

export type TallyLiveResponseMessage = {
  type: typeof NELA_TALLY_RESPONSE;
  id: string;
  ok: boolean;
  kind: TallyLiveRequestKind;
  error?: string | null;
  needsAllow?: boolean;
  data?: unknown;
  meta?: {
    host?: string | null;
    port?: number | null;
    company?: string | null;
    connected?: boolean;
  };
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** YYYYMMDD or YYYY-MM-DD → YYYY-MM-DD for <input type="date"> */
export function toInputDate(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return "";
}

export function normalizeTallyLiveFocus(
  raw: string | null | undefined
): TallyLiveFocus {
  const f = (raw || "").trim().toLowerCase().replace(/-/g, "_");
  if (f === "outstanding") return "outstanding";
  if (f === "trial_balance" || f === "trialbalance") return "trial_balance";
  if (f === "sales") return "sales";
  if (f === "cash_bank" || f === "cashbank" || f === "cash") return "cash_bank";
  return "daybook";
}

/** Default: last 30 days ending today (UTC date parts). */
function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { from: fmt(from), to: fmt(to) };
}

/**
 * Build a self-contained live dashboard HTML page.
 * Charts render client-side from JSON delivered by the NELA host bridge.
 */
export function buildTallyLiveDashboardHtml(
  opts: TallyLiveDashboardOptions = {}
): string {
  const title = (opts.title?.trim() || "Live Tally Dashboard").slice(0, 120);
  const focus = normalizeTallyLiveFocus(opts.focus);
  const defaults = defaultDateRange();
  const from = toInputDate(opts.fromDate) || defaults.from;
  const to = toInputDate(opts.toDate) || defaults.to;
  const company = opts.companyHint?.trim() || "";
  const host = opts.hostHint?.trim() || "127.0.0.1";
  const port = opts.portHint ?? 9000;

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
    .wrap { max-width: 1180px; margin: 0 auto; padding: 1.25rem 1rem 2.5rem; }
    header h1 { margin: 0 0 .25rem; font-size: 1.35rem; font-weight: 700; }
    .sub { color: var(--muted); font-size: .85rem; margin: 0 0 1rem; }
    .toolbar {
      display: flex; flex-wrap: wrap; gap: .6rem; align-items: end;
      padding: .85rem 1rem; background: var(--card); border: 1px solid var(--border);
      border-radius: 14px; margin-bottom: .65rem;
    }
    .toolbar label { display: flex; flex-direction: column; gap: .25rem; font-size: .72rem; color: var(--muted); font-weight: 600; }
    .toolbar input, .toolbar select {
      border: 1px solid var(--border); border-radius: 8px; padding: .4rem .55rem;
      font: inherit; color: var(--txt); background: #fff; min-width: 9rem;
    }
    .presets { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; }
    .preset {
      border: 1px solid var(--border); background: #fff; border-radius: 8px;
      padding: .35rem .55rem; font-size: .72rem; cursor: pointer; color: var(--muted);
    }
    .preset:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); color: var(--accent); }
    .tabs { display: flex; gap: .35rem; flex-wrap: wrap; }
    .tab {
      border: 1px solid var(--border); background: #fff; border-radius: 999px;
      padding: .35rem .75rem; font-size: .78rem; cursor: pointer; color: var(--muted);
    }
    .tab.active { background: color-mix(in srgb, var(--accent) 12%, #fff); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); color: var(--accent); font-weight: 600; }
    button.primary {
      border: none; background: var(--accent); color: #fff; border-radius: 10px;
      padding: .5rem 1rem; font-weight: 600; cursor: pointer; font-size: .85rem;
    }
    button.primary:disabled { opacity: .55; cursor: wait; }
    .chart-toggle {
      border: 1px solid var(--border); background: #fff; border-radius: 6px;
      padding: .15rem .45rem; font-size: .68rem; cursor: pointer; color: var(--muted);
      float: right; margin-top: -2px;
    }
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
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: .75rem; margin-bottom: 1rem;
    }
    .kpi {
      background: var(--card); border: 1px solid var(--border); border-radius: 14px;
      padding: .85rem 1rem;
    }
    .kpi .lbl { font-size: .7rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .kpi .val { font-size: 1.2rem; font-weight: 700; margin-top: .2rem; word-break: break-word; }
    .charts {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: .85rem; margin-bottom: 1rem;
    }
    .chart-card {
      background: var(--card); border: 1px solid var(--border); border-radius: 14px;
      padding: .75rem 1rem 1rem; min-width: 0;
    }
    .chart-card.wide { grid-column: 1 / -1; }
    @media (min-width: 900px) {
      .chart-card.wide { grid-column: span 2; }
    }
    .chart-card h3 { margin: 0 0 .5rem; font-size: .9rem; overflow: hidden; }
    .chart-host { width: 100%; height: 260px; }
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
    #standalone {
      display: none; margin: 0 0 1rem; padding: .75rem 1rem; border-radius: 12px;
      background: #fef2f2; color: var(--danger); font-size: .85rem; border: 1px solid #fecaca;
      line-height: 1.5;
    }
    #standalone strong { display: block; margin-bottom: .25rem; }
  </style>
</head>
<body data-nela-tally-live="1" data-focus="${esc(focus)}">
  <div class="wrap">
    <header>
      <h1>${esc(title)}</h1>
      <p class="sub">Live read-only export via NELA · ${esc(host)}:${port}${company ? " · " + esc(company) : ""}</p>
    </header>

    <div id="standalone" role="alert">
      <strong>Open this dashboard inside NELA</strong>
      Live Tally data cannot load from a browser <code>file://</code> page (each file is its own security origin, and there is no NELA bridge).
      Use the in-app preview or side panel, then press Refresh.
    </div>

    <div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Report">
        <button type="button" class="tab${focus === "daybook" ? " active" : ""}" data-focus="daybook">Day Book</button>
        <button type="button" class="tab${focus === "sales" ? " active" : ""}" data-focus="sales">Sales</button>
        <button type="button" class="tab${focus === "cash_bank" ? " active" : ""}" data-focus="cash_bank">Cash &amp; Bank</button>
        <button type="button" class="tab${focus === "outstanding" ? " active" : ""}" data-focus="outstanding">Outstanding</button>
        <button type="button" class="tab${focus === "trial_balance" ? " active" : ""}" data-focus="trial_balance">Trial Balance</button>
      </div>
      <label>From
        <input type="date" id="fromDate" value="${esc(from)}" />
      </label>
      <label>To
        <input type="date" id="toDate" value="${esc(to)}" />
      </label>
      <div class="presets" aria-label="Period presets">
        <button type="button" class="preset" data-preset="7d">7d</button>
        <button type="button" class="preset" data-preset="30d">30d</button>
        <button type="button" class="preset" data-preset="mtd">MTD</button>
        <button type="button" class="preset" data-preset="fy">This FY</button>
      </div>
      <button type="button" class="primary" id="refreshBtn">Refresh</button>
    </div>

    <div id="status">Loading live data from Tally…</div>
    <div id="mismatch"></div>
    <div class="kpis" id="kpi-grid"></div>
    <div class="charts">
      <div class="chart-card"><h3 id="chart-a-title">Breakdown</h3><div class="chart-host" id="chart-a"></div></div>
      <div class="chart-card"><h3 id="chart-b-title">Trend <button type="button" class="chart-toggle" id="trendToggle" title="Toggle bar/line">Line</button></h3><div class="chart-host" id="chart-b"></div></div>
      <div class="chart-card" id="chart-c-card"><h3 id="chart-c-title">Detail</h3><div class="chart-host" id="chart-c"></div></div>
    </div>
    <div class="table-card">
      <h3 id="table-title">Details</h3>
      <div id="table-wrap"><p class="empty">Waiting for data…</p></div>
    </div>
    <footer>Live via NELA · requires TallyPrime HTTP on this machine · Refresh to reload · figures are not invented</footer>
  </div>
  <script>
(function () {
  var REQ = "${NELA_TALLY_REQUEST}";
  var RES = "${NELA_TALLY_RESPONSE}";
  var SEL = "${NELA_TALLY_SELECTION}";
  var focus = document.body.getAttribute("data-focus") || "daybook";
  var pending = {};
  var charts = { a: null, b: null, c: null };
  var trendMode = "line";
  var lastTrend = null;
  var seq = 0;
  var PALETTE = ["#2563eb", "#0ea5e9", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];
  var embedded = false;
  try {
    embedded = !!(window.parent && window.parent !== window);
  } catch (_e) {
    embedded = false;
  }
  if (!embedded) {
    var banner = document.getElementById("standalone");
    if (banner) banner.style.display = "block";
  }

  function $(id) { return document.getElementById(id); }
  function publishSelection() {
    var from = ($("fromDate") && $("fromDate").value) || null;
    var to = ($("toDate") && $("toDate").value) || null;
    document.body.setAttribute("data-from", from || "");
    document.body.setAttribute("data-to", to || "");
    document.body.setAttribute("data-focus", focus);
    if (!embedded) return;
    try {
      window.parent.postMessage({
        type: SEL,
        fromDate: from,
        toDate: to,
        focus: focus
      }, "*");
    } catch (_e) { /* ignore */ }
  }
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
  function inRange(iso, from, to) {
    if (!iso) return false;
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  }
  function fmtUtc(d) {
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function applyPreset(key) {
    var to = new Date();
    var from = new Date(to);
    if (key === "7d") from.setUTCDate(from.getUTCDate() - 7);
    else if (key === "30d") from.setUTCDate(from.getUTCDate() - 30);
    else if (key === "mtd") from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    else if (key === "fy") {
      var y = to.getUTCFullYear();
      var m = to.getUTCMonth();
      var fyStartYear = m >= 3 ? y : y - 1;
      from = new Date(Date.UTC(fyStartYear, 3, 1));
    }
    $("fromDate").value = fmtUtc(from);
    $("toDate").value = fmtUtc(to);
    refresh();
  }
  function request(kind, extra) {
    return new Promise(function (resolve) {
      if (!embedded) {
        resolve({
          ok: false,
          error: "Open this live dashboard inside NELA (in-app preview). Browsers block file:// Tally bridges."
        });
        return;
      }
      var id = "t" + (++seq) + "-" + Date.now();
      pending[id] = resolve;
      var msg = Object.assign({ type: REQ, id: id, kind: kind }, extra || {});
      try { window.parent.postMessage(msg, "*"); }
      catch (e) {
        delete pending[id];
        resolve({ ok: false, error: "Could not reach NELA host bridge." });
      }
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          resolve({ ok: false, error: "Timed out waiting for NELA / Tally (60s)." });
        }
      }, 60000);
    });
  }
  window.addEventListener("message", function (ev) {
    var data = ev.data;
    if (!data || data.type !== RES || !data.id) return;
    var resolve = pending[data.id];
    if (!resolve) return;
    delete pending[data.id];
    resolve(data);
  });

  function ensureCharts() {
    if (typeof echarts === "undefined") return;
    ["a", "b", "c"].forEach(function (k) {
      if (!charts[k]) charts[k] = echarts.init($("chart-" + k), null, { renderer: "svg" });
    });
  }
  function resizeCharts() {
    ["a", "b", "c"].forEach(function (k) { if (charts[k]) charts[k].resize(); });
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
  function setChartTitles(a, b, c) {
    $("chart-a-title").textContent = a;
    $("chart-b-title").childNodes[0].nodeValue = b + " ";
    $("chart-c-title").textContent = c;
  }
  /** @param {{type:string,labels?:string[],values?:number[],series?:{name:string,values:number[]}[], rotate?:boolean}} cfg */
  function setChart(slot, cfg) {
    ensureCharts();
    var chart = charts[slot];
    if (!chart || !cfg) return;
    var type = cfg.type || "bar";
    var labels = cfg.labels || [];
    var values = cfg.values || [];
    var option;
    if (type === "pie") {
      option = {
        color: PALETTE,
        tooltip: { trigger: "item" },
        series: [{
          type: "pie",
          radius: ["35%", "65%"],
          data: labels.map(function (l, i) { return { name: l, value: values[i] || 0 }; })
        }]
      };
    } else if (type === "grouped_bar" && cfg.series && cfg.series.length) {
      option = {
        color: PALETTE,
        tooltip: { trigger: "axis" },
        legend: { top: 0 },
        grid: { left: 48, right: 16, top: 36, bottom: cfg.rotate ? 72 : 32 },
        xAxis: { type: "category", data: labels, axisLabel: cfg.rotate ? { rotate: 30 } : {} },
        yAxis: { type: "value" },
        series: cfg.series.map(function (s) {
          return { name: s.name, type: "bar", data: s.values || [] };
        })
      };
    } else {
      var seriesType = type === "line" ? "line" : "bar";
      option = {
        color: PALETTE,
        tooltip: { trigger: "axis" },
        grid: { left: 48, right: 16, top: 24, bottom: cfg.rotate ? 72 : 32 },
        xAxis: { type: "category", data: labels, axisLabel: cfg.rotate ? { rotate: 30 } : {} },
        yAxis: { type: "value" },
        series: [{
          type: seriesType,
          data: values,
          smooth: seriesType === "line",
          areaStyle: seriesType === "line" ? { opacity: 0.08 } : undefined,
          itemStyle: { color: "#2563eb" }
        }]
      };
    }
    chart.setOption(option, true);
  }
  function applyTrendChart() {
    if (!lastTrend) return;
    setChart("b", {
      type: trendMode,
      labels: lastTrend.labels,
      values: lastTrend.values,
      rotate: lastTrend.rotate
    });
    var btn = $("trendToggle");
    if (btn) btn.textContent = trendMode === "line" ? "Bar" : "Line";
  }

  function renderDaybook(payload, from, to, meta) {
    var lines = (payload && payload.lines) || [];
    var filtered = [];
    var outside = 0;
    for (var i = 0; i < lines.length; i++) {
      var iso = normalizeDate(lines[i].date);
      if (from || to) {
        if (inRange(iso, from, to)) filtered.push(lines[i]);
        else outside++;
      } else {
        filtered.push(lines[i]);
      }
    }
    if (outside > 0) {
      setMismatch("Data mismatch: Tally returned " + lines.length + " vouchers; " + outside +
        " fall outside " + (from || "…") + " → " + (to || "…") + ". Charts use in-range rows only (" + filtered.length + ").");
    } else {
      setMismatch("");
    }

    var total = 0;
    var byType = {};
    var byDay = {};
    var byParty = {};
    for (var j = 0; j < filtered.length; j++) {
      var row = filtered[j];
      var amt = Math.abs(parseAmt(row.amount));
      if (Number.isFinite(amt)) total += amt;
      var vt = (row.voucherType || row.voucher_type || "Other").trim() || "Other";
      byType[vt] = (byType[vt] || 0) + (Number.isFinite(amt) ? amt : 0);
      var day = normalizeDate(row.date) || "unknown";
      byDay[day] = (byDay[day] || 0) + (Number.isFinite(amt) ? amt : 1);
      var party = (row.party || "Unknown").trim() || "Unknown";
      byParty[party] = (byParty[party] || 0) + (Number.isFinite(amt) ? amt : 0);
    }
    var dayKeys = Object.keys(byDay).sort();
    var avgDay = dayKeys.length ? total / dayKeys.length : 0;
    setKpis([
      { label: "Vouchers", value: String(filtered.length) },
      { label: "Total value", value: money(total) },
      { label: "Avg / day", value: money(avgDay) },
      { label: "Types", value: String(Object.keys(byType).length) },
      { label: "Company", value: (meta && meta.company) || "—" }
    ]);
    setChartTitles("Amount by voucher type", "Activity by day", "Top parties");
    $("table-title").textContent = "Voucher detail";
    var typeLabels = Object.keys(byType);
    setChart("a", { type: "pie", labels: typeLabels, values: typeLabels.map(function (k) { return byType[k]; }) });
    lastTrend = { labels: dayKeys, values: dayKeys.map(function (d) { return byDay[d]; }), rotate: false };
    applyTrendChart();
    var parties = Object.keys(byParty).map(function (k) { return { name: k, val: byParty[k] }; })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 12);
    setChart("c", {
      type: "bar",
      labels: parties.map(function (p) { return p.name.slice(0, 18); }),
      values: parties.map(function (p) { return p.val; }),
      rotate: true
    });
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

  function renderOutstanding(payload, meta) {
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
    function topN(list, n) {
      return list.map(function (l) {
        return { name: l.name, val: Math.abs(parseAmt(l.closingBalance || l.closing_balance)) };
      }).filter(function (x) { return Number.isFinite(x.val); })
        .sort(function (a, b) { return b.val - a.val; }).slice(0, n);
    }
    var rTot = sum(recv);
    var pTot = sum(pay);
    setKpis([
      { label: "Receivables", value: money(rTot) },
      { label: "Payables", value: money(pTot) },
      { label: "Net (R−P)", value: money(rTot - pTot) },
      { label: "Debtors", value: String(recv.length) },
      { label: "Creditors", value: String(pay.length) }
    ]);
    setChartTitles("Receivables vs payables", "Top debtors", "Top creditors");
    $("table-title").textContent = "Outstanding ledgers";
    setChart("a", { type: "pie", labels: ["Receivables", "Payables"], values: [rTot, pTot] });
    var debtors = topN(recv, 12);
    lastTrend = {
      labels: debtors.map(function (c) { return c.name.slice(0, 18); }),
      values: debtors.map(function (c) { return c.val; }),
      rotate: true
    };
    trendMode = "bar";
    applyTrendChart();
    var creditors = topN(pay, 12);
    setChart("c", {
      type: "bar",
      labels: creditors.map(function (c) { return c.name.slice(0, 18); }),
      values: creditors.map(function (c) { return c.val; }),
      rotate: true
    });
    setTable(
      ["Ledger", "Group", "Balance"],
      recv.concat(pay).map(function (l) {
        return [l.name, l.parent || "—", money(parseAmt(l.closingBalance || l.closing_balance))];
      })
    );
  }

  function renderTrial(payload, meta) {
    setMismatch("");
    var rows = (payload && (payload.rows || payload.ledgers)) || [];
    var debitTot = 0;
    var creditTot = 0;
    var enriched = rows.map(function (r) {
      var d = Math.abs(parseAmt(r.debit));
      var c = Math.abs(parseAmt(r.credit));
      var closing = parseAmt(r.closingBalance || r.closing_balance);
      if (Number.isFinite(d) && d > 0) debitTot += d;
      else if (Number.isFinite(closing) && closing < 0) debitTot += Math.abs(closing);
      if (Number.isFinite(c) && c > 0) creditTot += c;
      else if (Number.isFinite(closing) && closing > 0 && !(Number.isFinite(d) && d > 0)) creditTot += closing;
      var debit = Number.isFinite(d) ? d : (Number.isFinite(closing) && closing < 0 ? Math.abs(closing) : 0);
      var credit = Number.isFinite(c) ? c : (Number.isFinite(closing) && closing > 0 ? closing : 0);
      var net = Math.abs(Number.isFinite(closing) ? closing : debit - credit);
      return { name: r.name, debit: debit, credit: credit, net: net, raw: r };
    });
    setKpis([
      { label: "Accounts", value: String(rows.length) },
      { label: "Debit (Dr)", value: money(debitTot) },
      { label: "Credit (Cr)", value: money(creditTot) },
      { label: "Imbalance", value: money(Math.abs(debitTot - creditTot)) },
      { label: "Company", value: (meta && meta.company) || "—" }
    ]);
    setChartTitles("Debit vs credit", "Top accounts", "Dr / Cr (top accounts)");
    $("table-title").textContent = "Trial balance";
    setChart("a", { type: "pie", labels: ["Debit", "Credit"], values: [debitTot || 0, creditTot || 0] });
    var top = enriched.filter(function (x) { return x.net > 0; })
      .sort(function (a, b) { return b.net - a.net; }).slice(0, 12);
    lastTrend = {
      labels: top.map(function (c) { return c.name.slice(0, 18); }),
      values: top.map(function (c) { return c.net; }),
      rotate: true
    };
    trendMode = "bar";
    applyTrendChart();
    setChart("c", {
      type: "grouped_bar",
      labels: top.map(function (c) { return c.name.slice(0, 14); }),
      series: [
        { name: "Debit", values: top.map(function (c) { return c.debit; }) },
        { name: "Credit", values: top.map(function (c) { return c.credit; }) }
      ],
      rotate: true
    });
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

  function renderSales(payload, meta) {
    setMismatch("");
    var lines = (payload && payload.lines) || [];
    var summary = (payload && payload.summary) || {};
    var total = Number(summary.total);
    if (!Number.isFinite(total)) {
      total = 0;
      for (var i = 0; i < lines.length; i++) {
        var a = Math.abs(parseAmt(lines[i].amount));
        if (Number.isFinite(a)) total += a;
      }
    }
    var byDay = summary.byDay || summary.by_day || [];
    var byParty = summary.byParty || summary.by_party || [];
    var voucherCount = summary.voucherCount != null ? summary.voucherCount : (summary.voucher_count != null ? summary.voucher_count : lines.length);
    var partyCount = summary.partyCount != null ? summary.partyCount : (summary.party_count != null ? summary.party_count : byParty.length);
    var avgTicket = voucherCount ? total / voucherCount : 0;
    setKpis([
      { label: "Sales total", value: money(total) },
      { label: "Vouchers", value: String(voucherCount) },
      { label: "Avg ticket", value: money(avgTicket) },
      { label: "Customers", value: String(partyCount) },
      { label: "Company", value: (meta && meta.company) || "—" }
    ]);
    setChartTitles("Top vs rest", "Sales by day", "Top customers");
    $("table-title").textContent = "Sales vouchers";
    var topParties = byParty.slice(0, 8);
    var topSum = 0;
    for (var t = 0; t < topParties.length; t++) topSum += Number(topParties[t].amount) || 0;
    var rest = Math.max(0, total - topSum);
    setChart("a", {
      type: "pie",
      labels: ["Top customers", "Other"],
      values: [topSum, rest]
    });
    lastTrend = {
      labels: byDay.map(function (d) { return d.name; }),
      values: byDay.map(function (d) { return Number(d.amount) || 0; }),
      rotate: false
    };
    trendMode = "line";
    applyTrendChart();
    setChart("c", {
      type: "bar",
      labels: byParty.slice(0, 12).map(function (p) { return String(p.name).slice(0, 18); }),
      values: byParty.slice(0, 12).map(function (p) { return Number(p.amount) || 0; }),
      rotate: true
    });
    setTable(
      ["Date", "Party", "Amount", "Narration"],
      lines.map(function (r) {
        return [
          normalizeDate(r.date) || (r.date || "—"),
          r.party || "—",
          money(parseAmt(r.amount)),
          (r.narration || "—").toString().slice(0, 120)
        ];
      })
    );
  }

  function renderCashBank(payload, meta) {
    setMismatch("");
    var cash = (payload && payload.cash) || {};
    var bank = (payload && payload.bank) || {};
    var cashTot = Number(cash.total) || 0;
    var bankTot = Number(bank.total) || 0;
    var cashLedgers = cash.ledgers || [];
    var bankLedgers = bank.ledgers || [];
    var movement = (payload && payload.movement) || [];
    var movementByDay = payload.movementByDay || payload.movement_by_day || [];
    setKpis([
      { label: "Cash", value: money(cashTot) },
      { label: "Bank", value: money(bankTot) },
      { label: "Combined", value: money(cashTot + bankTot) },
      { label: "Ledgers", value: String((cash.count || cashLedgers.length) + (bank.count || bankLedgers.length)) },
      { label: "Movements", value: String(movement.length) }
    ]);
    setChartTitles("Cash vs bank", "Movement by day", "Top bank ledgers");
    $("table-title").textContent = "Cash & bank ledgers · recent movement";
    setChart("a", { type: "pie", labels: ["Cash", "Bank"], values: [cashTot, bankTot] });
    lastTrend = {
      labels: movementByDay.map(function (d) { return d.name; }),
      values: movementByDay.map(function (d) { return Number(d.amount) || 0; }),
      rotate: false
    };
    trendMode = "line";
    applyTrendChart();
    var topBank = bankLedgers.map(function (l) {
      return { name: l.name, val: Math.abs(parseAmt(l.closingBalance || l.closing_balance)) };
    }).filter(function (x) { return Number.isFinite(x.val); })
      .sort(function (a, b) { return b.val - a.val; }).slice(0, 12);
    setChart("c", {
      type: "bar",
      labels: topBank.map(function (c) { return c.name.slice(0, 18); }),
      values: topBank.map(function (c) { return c.val; }),
      rotate: true
    });
    var ledgerRows = cashLedgers.concat(bankLedgers).map(function (l) {
      return [l.name, l.parent || "—", money(parseAmt(l.closingBalance || l.closing_balance))];
    });
    var moveRows = movement.slice(0, 40).map(function (r) {
      return [
        normalizeDate(r.date) || (r.date || "—"),
        r.voucherType || r.voucher_type || "—",
        r.party || "—",
        money(parseAmt(r.amount))
      ];
    });
    var wrap = $("table-wrap");
    var html = "";
    if (ledgerRows.length) {
      html += "<table><thead><tr><th>Ledger</th><th>Group</th><th>Balance</th></tr></thead><tbody>" +
        ledgerRows.slice(0, 40).map(function (r) {
          return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
    }
    if (moveRows.length) {
      html += "<p style='margin:1rem 0 .4rem;font-size:.8rem;color:#64748b;font-weight:600'>Recent Payment / Receipt / Contra</p>";
      html += "<table><thead><tr><th>Date</th><th>Type</th><th>Party</th><th>Amount</th></tr></thead><tbody>" +
        moveRows.map(function (r) {
          return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
    }
    wrap.innerHTML = html || '<p class="empty">No cash/bank rows in this window.</p>';
  }

  async function refresh() {
    if (!embedded) {
      setStatus("Use NELA’s in-app preview — live Tally will not load from a browser file:// page.", "error");
      return;
    }
    var btn = $("refreshBtn");
    btn.disabled = true;
    setStatus("Refreshing from Tally…");
    var from = $("fromDate").value || null;
    var to = $("toDate").value || null;
    publishSelection();
    try {
      var st = await request("status");
      if (!st.ok) {
        setStatus(st.error || "Tally not connected. Start TallyPrime with HTTP enabled and Connect in NELA.", "error");
        btn.disabled = false;
        return;
      }
      var meta = st.meta || {};
      var kind = focus;
      if (["daybook", "outstanding", "trial_balance", "sales", "cash_bank"].indexOf(kind) < 0) kind = "daybook";
      var res = await request(kind, { fromDate: from, toDate: to, maxRows: 200 });
      if (!res.ok) {
        if (res.needsAllow) {
          setStatus("Reconnect Tally in Settings, then Refresh.", "warn");
        } else {
          setStatus(res.error || "Export failed. Is Tally running on the connected port?", "error");
        }
        btn.disabled = false;
        return;
      }
      var where = (meta.host || "127.0.0.1") + ":" + (meta.port || "?");
      var when = new Date().toLocaleTimeString();
      setStatus("Connected · " + where + (meta.company ? " · " + meta.company : "") + " · refreshed " + when);
      if (kind === "daybook") renderDaybook(res.data, from, to, meta);
      else if (kind === "outstanding") renderOutstanding(res.data, meta);
      else if (kind === "trial_balance") renderTrial(res.data, meta);
      else if (kind === "sales") renderSales(res.data, meta);
      else if (kind === "cash_bank") renderCashBank(res.data, meta);
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e), "error");
    }
    btn.disabled = false;
    resizeCharts();
  }

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      focus = tab.getAttribute("data-focus") || "daybook";
      document.body.setAttribute("data-focus", focus);
      publishSelection();
      refresh();
    });
  });
  document.querySelectorAll(".preset").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyPreset(btn.getAttribute("data-preset") || "30d");
    });
  });
  $("trendToggle").addEventListener("click", function () {
    trendMode = trendMode === "line" ? "bar" : "line";
    applyTrendChart();
  });
  $("refreshBtn").addEventListener("click", refresh);
  ["fromDate", "toDate"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener("change", publishSelection);
    el.addEventListener("input", publishSelection);
  });
  window.addEventListener("resize", resizeCharts);
  publishSelection();
  refresh();
})();
  </script>
</body>
</html>`;
}
