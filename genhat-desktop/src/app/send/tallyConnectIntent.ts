/** Detect when the user wants Tally accounting data or a Tally dashboard. */

export function looksLikeTallyRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (/\btally(?:prime)?\b/.test(t)) return true;
  if (
    /\b(trial\s*balance|day\s*book|sundry\s+debtors|sundry\s+creditors|receivables?|payables?|outstanding\s+(?:invoices?|bills?|balances?))\b/.test(
      t
    ) &&
    /\b(dashboard|report|ledger|accounts?|gst|balance\s*sheet|profit|loss|voucher|excel|spreadsheet|pivot|export|same\s+format|this\s+format)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(same\s+format|this\s+format|like\s+this|match\s+(?:this\s+)?(?:excel|spreadsheet|sheet|format))\b/.test(
      t
    ) &&
    /\b(tally|day\s*book|trial\s*balance|outstanding|ledger)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(accounting\s+dashboard|finance\s+dashboard|receivables?\s+dashboard|payables?\s+dashboard)\b/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}
