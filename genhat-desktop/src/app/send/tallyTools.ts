/**
 * Host-side Tally tools: confirm in chat, then read-only XML exports.
 */

import { Api } from "../../api";
import {
  buildTallyLiveDashboardHtml,
  normalizeTallyLiveFocus,
} from "../tallyLiveDashboard";
import {
  cancelTallyAccessConfirm,
  grantTallySessionTrust,
  isTallySessionTrusted,
  openTallyAccessConfirm,
  type TallyAccessKind,
} from "../../stores/tallyAccessConfirmStore";
import {
  buildTallyExcelWorkbook,
  parseTallyExportArgs,
} from "./tallyExcelExport";

function clampMax(raw: unknown, fallback: number, hardMax: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.min(hardMax, Math.floor(raw)));
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(1, Math.min(hardMax, n));
  }
  return fallback;
}

function purposeOf(args: Record<string, unknown>, fallback: string): string {
  const raw = args.purpose;
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

function optStr(args: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function withConfirm<T>(
  kind: TallyAccessKind,
  request: {
    purpose: string;
    group?: string | null;
    fromDate?: string | null;
    toDate?: string | null;
    voucherType?: string | null;
    maxRows?: number;
  },
  run: () => Promise<T>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
    waitingLabel: string;
    runningLabel: string;
  }
): Promise<T | { ok: false; reason: string }> {
  if (options?.signal?.aborted) {
    return { ok: false, reason: "user_cancelled" };
  }

  const trusted = isTallySessionTrusted();

  if (!trusted) {
    options?.onStatus?.(options.waitingLabel);
  }
  const onAbort = () => {
    cancelTallyAccessConfirm();
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (trusted) {
      options?.onStatus?.(options.runningLabel);
      const result = await run();
      options?.onStatus?.(null);
      return result;
    }

    const decision = await openTallyAccessConfirm({
      kind,
      purpose: request.purpose,
      group: request.group ?? null,
      fromDate: request.fromDate ?? null,
      toDate: request.toDate ?? null,
      voucherType: request.voucherType ?? null,
      maxRows: request.maxRows,
    });
    if (!decision.confirmed) {
      options?.onStatus?.(null);
      return { ok: false, reason: "user_cancelled" };
    }

    options?.onStatus?.(options.runningLabel);
    const result = await run();
    options?.onStatus?.(null);
    return result;
  } catch (err) {
    options?.onStatus?.(null);
    const message =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : "Tally request failed.";
    return { ok: false, reason: message };
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

export async function executeTallyListLedgers(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
) {
  const group = optStr(args, "group", "parent");
  const maxRows = clampMax(args.max_rows ?? args.maxRows, 100, 200);
  const purpose = purposeOf(
    args,
    group ? `List Tally ledgers under “${group}”` : "List Tally ledgers"
  );
  return withConfirm(
    "list_ledgers",
    { purpose, group, maxRows },
    () => Api.tallyListLedgers({ group, maxRows }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow Tally ledger export…",
      runningLabel: "Reading ledgers from Tally…",
    }
  );
}

export async function executeTallyTrialBalance(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
) {
  const fromDate = optStr(args, "from_date", "fromDate", "from");
  const toDate = optStr(args, "to_date", "toDate", "to");
  const maxRows = clampMax(args.max_rows ?? args.maxRows, 150, 200);
  const purpose = purposeOf(args, "Export Tally trial balance");
  return withConfirm(
    "trial_balance",
    { purpose, fromDate, toDate, maxRows },
    () => Api.tallyTrialBalance({ fromDate, toDate, maxRows }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow trial balance export…",
      runningLabel: "Reading trial balance from Tally…",
    }
  );
}

export async function executeTallyDaybook(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
) {
  const fromDate = optStr(args, "from_date", "fromDate", "from");
  const toDate = optStr(args, "to_date", "toDate", "to");
  const voucherType = optStr(args, "voucher_type", "voucherType");
  const maxRows = clampMax(args.max_rows ?? args.maxRows, 80, 100);
  const purpose = purposeOf(args, "Export Tally day book");
  return withConfirm(
    "daybook",
    { purpose, fromDate, toDate, voucherType, maxRows },
    () =>
      Api.tallyDaybook({
        fromDate,
        toDate,
        voucherType,
        maxRows,
      }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow day book export…",
      runningLabel: "Reading day book from Tally…",
    }
  );
}

export async function executeTallyOutstanding(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
) {
  const maxRows = clampMax(args.max_rows ?? args.maxRows, 40, 100);
  const purpose = purposeOf(
    args,
    "Export Tally receivables and payables (Sundry Debtors / Creditors)"
  );
  return withConfirm(
    "outstanding",
    { purpose, maxRows },
    () => Api.tallyOutstanding({ maxRows }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow outstanding export…",
      runningLabel: "Reading outstanding from Tally…",
    }
  );
}

export async function executeTallySales(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
) {
  const fromDate = optStr(args, "from_date", "fromDate", "from");
  const toDate = optStr(args, "to_date", "toDate", "to");
  const maxRows = clampMax(args.max_rows ?? args.maxRows, 100, 200);
  const purpose = purposeOf(args, "Export Tally sales vouchers and summaries");
  return withConfirm(
    "sales",
    { purpose, fromDate, toDate, maxRows },
    () => Api.tallySales({ fromDate, toDate, maxRows }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow sales export…",
      runningLabel: "Reading sales from Tally…",
    }
  );
}

export async function executeTallyCashBank(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
  }
) {
  const fromDate = optStr(args, "from_date", "fromDate", "from");
  const toDate = optStr(args, "to_date", "toDate", "to");
  const maxRows = clampMax(args.max_rows ?? args.maxRows, 80, 100);
  const purpose = purposeOf(
    args,
    "Export Tally cash & bank balances and Payment/Receipt/Contra movement"
  );
  return withConfirm(
    "cash_bank",
    { purpose, fromDate, toDate, maxRows },
    () => Api.tallyCashBank({ fromDate, toDate, maxRows }),
    {
      ...options,
      waitingLabel: "Waiting for you to allow cash & bank export…",
      runningLabel: "Reading cash & bank from Tally…",
    }
  );
}

export async function executeTallyLiveDashboard(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
    onArtifact?: (artifact: {
      path: string;
      kind: string;
      warning?: string;
    }) => void;
  }
): Promise<
  | { ok: true; path: string; kind: string; live: true }
  | { ok: false; reason: string }
> {
  const fromDate = optStr(args, "from_date", "fromDate", "from");
  const toDate = optStr(args, "to_date", "toDate", "to");
  const title =
    optStr(args, "title") || "Live Tally Dashboard";
  const focus = normalizeTallyLiveFocus(optStr(args, "focus") || "daybook");

  if (options?.signal?.aborted) {
    return { ok: false, reason: "user_cancelled" };
  }

  // Live dashboards are read-only and auto-approved (no Allow card).
  grantTallySessionTrust();
  options?.onStatus?.("Opening live Tally dashboard…");
  try {
    const status = await Api.tallyStatus();
    if (!status.connected) {
      options?.onStatus?.(null);
      return {
        ok: false,
        reason:
          "Tally is not connected. Connect in Settings first (HTTP on localhost).",
      };
    }
    const html = buildTallyLiveDashboardHtml({
      title,
      fromDate,
      toDate,
      focus,
      companyHint: status.company,
      hostHint: status.host,
      portHint: status.port ?? undefined,
    });
    const artifact = await Api.generateHtml({
      title,
      archetype: "landing",
      sections: [],
      html,
      output_name: title,
    });
    options?.onArtifact?.(artifact);
    options?.onStatus?.(null);
    return {
      ok: true as const,
      path: artifact.path,
      kind: artifact.kind ?? "html",
      live: true as const,
    };
  } catch (e) {
    options?.onStatus?.(null);
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function executeTallyExportExcel(
  args: Record<string, unknown>,
  options?: {
    signal?: AbortSignal;
    onStatus?: (message: string | null) => void;
    onArtifact?: (artifact: {
      path: string;
      kind: string;
      warning?: string;
    }) => void;
    /** Attached spreadsheet paths from this turn (fallback for template_path). */
    attachmentSpreadsheetPaths?: string[];
  }
): Promise<
  | {
      ok: true;
      path: string;
      kind: string;
      report: string;
      rowCount: number;
      truncated: boolean;
      company: string | null;
      pivot: unknown;
      templateMatched?: boolean;
      templateMapping?: string[];
    }
  | { ok: false; reason: string }
> {
  const parsed = parseTallyExportArgs(args);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.error };
  }
  const exportArgs = parsed.value;
  // If user asked to match format but omitted path, use first attached spreadsheet.
  if (
    exportArgs.matchTemplate &&
    !exportArgs.templatePath &&
    !exportArgs.templateHeaders?.length &&
    options?.attachmentSpreadsheetPaths?.length
  ) {
    exportArgs.templatePath = options.attachmentSpreadsheetPaths[0] ?? null;
  }
  const purpose = purposeOf(
    args,
    exportArgs.matchTemplate
      ? `Export Tally ${exportArgs.report.replace(/_/g, " ")} matching example Excel format`
      : `Export Tally ${exportArgs.report.replace(/_/g, " ")} to Excel`
  );

  const confirmed = await withConfirm(
    "export_excel",
    {
      purpose,
      group: exportArgs.group,
      fromDate: exportArgs.fromDate,
      toDate: exportArgs.toDate,
      voucherType: exportArgs.voucherType,
      maxRows: exportArgs.maxRows,
    },
    async () => {
      options?.onStatus?.(
        exportArgs.matchTemplate
          ? "Matching example Excel format from Tally…"
          : "Building Excel workbook from Tally…"
      );
      const built = await buildTallyExcelWorkbook(exportArgs, {
        fallbackTemplatePaths: options?.attachmentSpreadsheetPaths,
      });
      if (!built.ok) {
        return { ok: false as const, reason: built.error };
      }
      const artifact = await Api.generateSpreadsheet({
        ops: [],
        sheets: built.sheets,
        output_name: built.title,
      });
      options?.onArtifact?.(artifact);
      return {
        ok: true as const,
        path: artifact.path,
        kind: artifact.kind ?? "xlsx",
        report: built.report,
        rowCount: built.rowCount,
        truncated: built.truncated,
        company: built.company,
        pivot: built.pivotApplied,
        templateMatched: built.templateMatched,
        templateMapping: built.templateMappingNotes,
      };
    },
    {
      ...options,
      waitingLabel: "Waiting for you to allow Tally Excel export…",
      runningLabel: "Exporting Tally data to Excel…",
    }
  );

  if (
    confirmed &&
    typeof confirmed === "object" &&
    "ok" in confirmed &&
    confirmed.ok === false &&
    "reason" in confirmed
  ) {
    return { ok: false, reason: String(confirmed.reason) };
  }
  if (
    confirmed &&
    typeof confirmed === "object" &&
    "ok" in confirmed &&
    confirmed.ok === true
  ) {
    return confirmed;
  }
  return { ok: false, reason: "Tally Excel export failed." };
}
