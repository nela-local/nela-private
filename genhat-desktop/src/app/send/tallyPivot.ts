/**
 * Pre-computed crosstab (pivot) matrices for Tally Excel export.
 * Not native Excel PivotTables — flat aggregated sheets.
 */

export type PivotAggregation = "sum" | "count" | "avg";

export type PivotSpec = {
  rows: string;
  columns?: string | null;
  values: string;
  aggregation?: PivotAggregation;
};

export type CrosstabResult = {
  headers: string[];
  rows: string[][];
};

const ALLOWED_FIELDS: Record<string, ReadonlySet<string>> = {
  daybook: new Set(["date", "month", "voucherType", "party", "amount"]),
  trial_balance: new Set(["name", "debit", "credit", "net"]),
  outstanding: new Set(["side", "name", "parent", "balance"]),
  ledgers: new Set(["name", "parent", "closingBalance"]),
};

export function allowedPivotFields(report: string): ReadonlySet<string> {
  return ALLOWED_FIELDS[report] ?? new Set();
}

export function validatePivotSpec(
  report: string,
  spec: PivotSpec
): string | null {
  const allowed = allowedPivotFields(report);
  if (!allowed.size) return `Unknown report “${report}”.`;
  const check = (field: string, label: string) => {
    if (!allowed.has(field)) {
      return `${label} “${field}” is not valid for ${report}. Allowed: ${[...allowed].join(", ")}.`;
    }
    return null;
  };
  const r = check(spec.rows, "rows");
  if (r) return r;
  const v = check(spec.values, "values");
  if (v) return v;
  if (spec.columns) {
    const c = check(spec.columns, "columns");
    if (c) return c;
  }
  return null;
}

export function defaultPivotForReport(report: string): PivotSpec | null {
  switch (report) {
    case "daybook":
      return {
        rows: "party",
        columns: "month",
        values: "amount",
        aggregation: "sum",
      };
    case "trial_balance":
      return { rows: "name", values: "net", aggregation: "sum" };
    case "outstanding":
      return {
        rows: "name",
        columns: "side",
        values: "balance",
        aggregation: "sum",
      };
    case "ledgers":
      return {
        rows: "parent",
        values: "closingBalance",
        aggregation: "sum",
      };
    default:
      return null;
  }
}

export function parsePivotNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw == null) return null;
  const t = String(raw).replace(/,/g, "").trim();
  if (!t) return null;
  const direct = Number.parseFloat(t);
  if (Number.isFinite(direct)) return direct;
  // Multi-currency: prefer amount after last '=' (base currency).
  const eq = t.lastIndexOf("=");
  const focus = eq >= 0 ? t.slice(eq + 1).trim() : t;
  let cleaned = "";
  let seenDigit = false;
  let seenDot = false;
  for (const ch of focus) {
    if (ch === "-" || ch === "+") {
      if (!cleaned) cleaned += ch;
    } else if (ch >= "0" && ch <= "9") {
      cleaned += ch;
      seenDigit = true;
    } else if (ch === "." && !seenDot) {
      cleaned += ch;
      seenDot = true;
    } else if (seenDigit) {
      break;
    }
  }
  if (!cleaned || cleaned === "-" || cleaned === "+") return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function cellKey(v: unknown): string {
  if (v == null) return "(blank)";
  const s = String(v).trim();
  return s || "(blank)";
}

function formatAgg(n: number): string {
  if (!Number.isFinite(n)) return "";
  // Keep full precision for money-ish values without trailing junk.
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Build a crosstab from record objects.
 * With `columns`: first header is the row field; remaining are unique column keys + Total.
 * Without `columns`: headers are [rowField, aggregation(values)].
 */
export function computeCrosstab(
  records: Array<Record<string, unknown>>,
  spec: PivotSpec
): CrosstabResult {
  const agg: PivotAggregation = spec.aggregation ?? "sum";
  const rowField = spec.rows;
  const colField = spec.columns?.trim() || null;
  const valueField = spec.values;

  type Bucket = { sum: number; count: number };
  const buckets = new Map<string, Map<string, Bucket>>();
  const rowOrder: string[] = [];
  const colOrder: string[] = [];
  const colSeen = new Set<string>();

  for (const rec of records) {
    const rk = cellKey(rec[rowField]);
    const ck = colField ? cellKey(rec[colField]) : "_";
    if (!buckets.has(rk)) {
      buckets.set(rk, new Map());
      rowOrder.push(rk);
    }
    if (colField && !colSeen.has(ck)) {
      colSeen.add(ck);
      colOrder.push(ck);
    }
    const rowMap = buckets.get(rk)!;
    let b = rowMap.get(ck);
    if (!b) {
      b = { sum: 0, count: 0 };
      rowMap.set(ck, b);
    }
    if (agg === "count") {
      b.count += 1;
    } else {
      const n = parsePivotNumber(rec[valueField]);
      if (n != null) {
        b.sum += n;
        b.count += 1;
      }
    }
  }

  const valueOf = (b: Bucket | undefined): number => {
    if (!b) return 0;
    if (agg === "count") return b.count;
    if (agg === "avg") return b.count ? b.sum / b.count : 0;
    return b.sum;
  };

  if (!colField) {
    const valueHeader =
      agg === "count"
        ? `count`
        : agg === "avg"
          ? `avg(${valueField})`
          : `sum(${valueField})`;
    const headers = [rowField, valueHeader];
    const rows = rowOrder.map((rk) => {
      const b = buckets.get(rk)?.get("_");
      return [rk, formatAgg(valueOf(b))];
    });
    return { headers, rows };
  }

  const sortedCols = [...colOrder].sort((a, b) => a.localeCompare(b));
  const headers = [rowField, ...sortedCols, "Total"];
  const rows = rowOrder.map((rk) => {
    const rowMap = buckets.get(rk)!;
    let total = 0;
    const cells = sortedCols.map((ck) => {
      const v = valueOf(rowMap.get(ck));
      total += v;
      return formatAgg(v);
    });
    return [rk, ...cells, formatAgg(total)];
  });
  return { headers, rows };
}

/** Derive YYYY-MM from Tally YYYYMMDD / ISO dates. */
export function tallyMonthKey(dateRaw: unknown): string {
  if (dateRaw == null) return "(blank)";
  const s = String(dateRaw).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  }
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return "(blank)";
}
