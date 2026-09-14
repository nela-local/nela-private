/**
 * Host-owned Live Tally Dashboard HTML shell.
 * Fetches data via postMessage → NELA parent (not direct localhost CORS).
 */

export type TallyLiveFocus = "daybook" | "outstanding" | "trial_balance";

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

export type TallyLiveRequestKind =
  | "status"
  | "daybook"
  | "outstanding"
  | "trial_balance"
  | "list_ledgers";

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
  const focus = opts.focus ?? "daybook";
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
    .wrap { max-width: 1100px; margin: 0 auto; padding: 1.25rem 1rem 2.5rem; }
    header h1 { margin: 0 0 .25rem; font-size: 1.35rem; font-weight: 700; }
    .sub { color: var(--muted); font-size: .85rem; margin: 0 0 1rem; }
    .toolbar {
      display: flex; flex-wrap: wrap; gap: .6rem; align-items: end;
      padding: .85rem 1rem; background: var(--card); border: 1px solid var(--border);
      border-radius: 14px; margin-bottom: 1rem;
    }
    .toolbar label { display: flex; flex-direction: column; gap: .25rem; font-size: .72rem; color: var(--muted); font-weight: 600; }
    .toolbar input, .toolbar select {
      border: 1px solid var(--border); border-radius: 8px; padding: .4rem .55rem;
      font: inherit; color: var(--txt); background: #fff; min-width: 9rem;
    }
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
        <button type="button" class="tab${focus === "outstanding" ? " active" : ""}" data-focus="outstanding">Outstanding</button>
        <button type="button" class="tab${focus === "trial_balance" ? " active" : ""}" data-focus="trial_balance">Trial Balance</button>
      </div>
      <label>From
        <input type="date" id="fromDate" value="${esc(from)}" />
      </label>
      <label>To
        <input type="date" id="toDate" value="${esc(to)}" />
      </label>
      <button type="button" class="primary" id="refreshBtn">Refresh</button>
    </div>

    <div id="status">Loading live data from Tally…</div>
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
    <footer>Live via NELA · requires TallyPrime HTTP on this machine · Refresh to reload · figures are not invented</footer>
  </div>
  <script>
(function () {
  var REQ = "${NELA_TALLY_REQUEST}";
  var RES = "${NELA_TALLY_RESPONSE}";
  var focus = document.body.getAttribute("data-focus") || "daybook";
  var pending = {};
  var chartMix = null;
  var chartTrend = null;
  var seq = 0;
  // Live bridge only works when this page is previewed inside NELA (iframe/srcDoc).
  // Top-level file:// in Chrome/Firefox is a unique origin and has no host bridge.
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
    return Number.isFinite(n) ? n : NaN;
  }
  /** Tally dates: YYYYMMDD or already ISO */
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
      { label: "Company", value: (meta && meta.company) || "—" }
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

  function renderTrial(payload, meta) {
    setMismatch("");
    var rows = (payload && (payload.rows || payload.ledgers)) || [];
    var total = 0;
    var byParent = {};
    for (var i = 0; i < rows.length; i++) {
      var a = Math.abs(parseAmt(rows[i].closingBalance || rows[i].closing_balance));
      if (Number.isFinite(a)) total += a;
      var p = (rows[i].parent || "Other").trim() || "Other";
      byParent[p] = (byParent[p] || 0) + (Number.isFinite(a) ? a : 0);
    }
    setKpis([
      { label: "Rows", value: String(rows.length) },
      { label: "Abs. total", value: money(total) },
      { label: "Groups", value: String(Object.keys(byParent).length) },
      { label: "Company", value: (meta && meta.company) || "—" }
    ]);
    $("chart-mix-title").textContent = "By parent group";
    $("chart-trend-title").textContent = "Top ledgers";
    $("table-title").textContent = "Trial balance rows";
    ensureCharts();
    var parents = Object.keys(byParent).sort(function (a, b) { return byParent[b] - byParent[a]; }).slice(0, 8);
    if (chartMix) {
      chartMix.setOption({
        tooltip: { trigger: "item" },
        series: [{ type: "pie", radius: ["35%", "65%"], data: parents.map(function (p) { return { name: p, value: byParent[p] }; }) }]
      }, true);
    }
    var top = rows.map(function (r) {
      return { name: r.name, val: Math.abs(parseAmt(r.closingBalance || r.closing_balance)) };
    }).filter(function (x) { return Number.isFinite(x.val); }).sort(function (a, b) { return b.val - a.val; }).slice(0, 12);
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
      ["Ledger", "Parent", "Closing"],
      rows.slice(0, 80).map(function (r) {
        return [r.name, r.parent || "—", money(parseAmt(r.closingBalance || r.closing_balance))];
      })
    );
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
    try {
      var st = await request("status");
      if (!st.ok) {
        setStatus(st.error || "Tally not connected. Start TallyPrime with HTTP enabled and Connect in NELA.", "error");
        btn.disabled = false;
        return;
      }
      var meta = st.meta || {};
      var kind = focus === "outstanding" ? "outstanding" : focus === "trial_balance" ? "trial_balance" : "daybook";
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
      else renderTrial(res.data, meta);
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e), "error");
    }
    btn.disabled = false;
    if (chartMix) chartMix.resize();
    if (chartTrend) chartTrend.resize();
  }

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      focus = tab.getAttribute("data-focus") || "daybook";
      document.body.setAttribute("data-focus", focus);
      refresh();
    });
  });
  $("refreshBtn").addEventListener("click", refresh);
  window.addEventListener("resize", function () {
    if (chartMix) chartMix.resize();
    if (chartTrend) chartTrend.resize();
  });
  refresh();
})();
  </script>
</body>
</html>`;
}
