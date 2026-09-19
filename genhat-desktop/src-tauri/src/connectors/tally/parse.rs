//! Lightweight XML extractors for Tally export responses.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closing_balance: Option<String>,
    /// Trial Balance debit column (when present).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debit: Option<String>,
    /// Trial Balance credit column (when present).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaybookLine {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voucher_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub party: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub narration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutstandingBucket {
    pub group: String,
    pub ledgers: Vec<LedgerRow>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutstandingSummary {
    pub receivables: OutstandingBucket,
    pub payables: OutstandingBucket,
}

pub fn response_ok(xml: &str) -> bool {
    let upper = xml.to_uppercase();
    upper.contains("<STATUS>1</STATUS>")
        || upper.contains("<STATUS>1</STATUS>")
        || (upper.contains("<ENVELOPE") && !upper.contains("<STATUS>0</STATUS>"))
}

fn tag_value<'a>(block: &'a str, tag: &str) -> Option<&'a str> {
    let lower = block.to_lowercase();
    let tag_l = tag.to_lowercase();
    let open_exact = format!("<{tag_l}>");
    let open_attr = format!("<{tag_l} ");
    let close_l = format!("</{tag_l}>");

    let open_at = lower
        .find(&open_exact)
        .map(|i| (i, open_exact.len()))
        .or_else(|| {
            let i = lower.find(&open_attr)?;
            let gt = lower[i..].find('>')?;
            Some((i, gt + 1))
        })?;
    let content_start = open_at.0 + open_at.1;
    let rel_end = lower[content_start..].find(&close_l)?;
    let raw = block[content_start..content_start + rel_end].trim();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

fn iter_blocks<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let lower = xml.to_lowercase();
    let open_l = format!("<{}", tag.to_lowercase());
    let close_l = format!("</{}>", tag.to_lowercase());
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find(&open_l) {
        let start = search_from + rel;
        // Ensure tag boundary (not LEDGERENTRIES when looking for LEDGER)
        let after_name = start + open_l.len();
        let boundary = lower.as_bytes().get(after_name).copied().unwrap_or(b'>');
        if boundary != b'>' && boundary != b' ' && boundary != b'\n' && boundary != b'\r' && boundary != b'\t' {
            search_from = after_name;
            continue;
        }
        let gt = lower[after_name..].find('>').map(|g| after_name + g + 1);
        let Some(content_start) = gt else {
            break;
        };
        if let Some(rel_end) = lower[content_start..].find(&close_l) {
            let end = content_start + rel_end;
            out.push(&xml[start..end + close_l.len()]);
            search_from = end + close_l.len();
        } else {
            break;
        }
    }
    out
}

fn attr_value<'a>(block: &'a str, attr: &str) -> Option<&'a str> {
    let lower = block.to_lowercase();
    let key = format!("{}=\"", attr.to_lowercase());
    let i = lower.find(&key)?;
    let start = i + key.len();
    let rest = &block[start..];
    let end = rest.find('"')?;
    let v = rest[..end].trim();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

fn field_value<'a>(block: &'a str, tag: &str) -> Option<&'a str> {
    tag_value(block, tag).or_else(|| attr_value(block, tag))
}

pub fn parse_company_names(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    for b in iter_blocks(xml, "COMPANY") {
        if let Some(name) = field_value(b, "NAME").map(|s| s.trim().to_string()) {
            if !name.is_empty() && !out.iter().any(|x| x == &name) {
                out.push(name);
            }
        }
    }
    out
}

/// Prefer exact match, else unique case-insensitive contains / starts-with.
pub fn resolve_company_name(requested: &str, available: &[String]) -> Result<String, String> {
    let req = requested.trim();
    if req.is_empty() {
        return Err("Empty company name.".into());
    }
    if let Some(exact) = available.iter().find(|c| c.as_str() == req) {
        return Ok(exact.clone());
    }
    let req_l = req.to_lowercase();
    let ci: Vec<&String> = available
        .iter()
        .filter(|c| c.to_lowercase() == req_l)
        .collect();
    if ci.len() == 1 {
        return Ok(ci[0].clone());
    }
    let contains: Vec<&String> = available
        .iter()
        .filter(|c| c.to_lowercase().contains(&req_l) || req_l.contains(&c.to_lowercase()))
        .collect();
    if contains.len() == 1 {
        return Ok(contains[0].clone());
    }
    if contains.len() > 1 {
        let preview: Vec<&str> = contains.iter().take(5).map(|s| s.as_str()).collect();
        return Err(format!(
            "Company “{req}” is ambiguous. Use the exact name from Tally, e.g. {}",
            preview.join(" · ")
        ));
    }
    let preview: Vec<&str> = available.iter().take(5).map(|s| s.as_str()).collect();
    Err(format!(
        "No company matching “{req}”. Leave Company blank to use the company loaded in Tally, or pick exact name like: {}",
        if preview.is_empty() {
            "(none listed — load a company in Tally first)".to_string()
        } else {
            preview.join(" · ")
        }
    ))
}

pub fn parse_active_company(xml: &str) -> Option<String> {
    // From STATICVARIABLES echo or first COMPANY block.
    if let Some(v) = tag_value(xml, "SVCURRENTCOMPANY") {
        let t = v.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    parse_company_names(xml).into_iter().next()
}

pub fn parse_ledgers(xml: &str, max_rows: usize) -> (Vec<LedgerRow>, bool) {
    let blocks = iter_blocks(xml, "LEDGER");
    let truncated = blocks.len() > max_rows;
    let rows = blocks
        .into_iter()
        .take(max_rows)
        .filter_map(|b| {
            let name = attr_value(b, "NAME")
                .or_else(|| field_value(b, "NAME"))?
                .trim()
                .to_string();
            if name.is_empty() {
                return None;
            }
            let closing = field_value(b, "CLOSINGBALANCE")
                .or_else(|| field_value(b, "AMOUNT"))
                .and_then(|s| normalize_amount(s.trim()));
            Some(LedgerRow {
                name,
                parent: field_value(b, "PARENT")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                closing_balance: closing,
                debit: None,
                credit: None,
            })
        })
        .collect();
    (rows, truncated)
}

/// Tally "Trial Balance" Data export uses DSPACCNAME / DSPACCINFO pairs (not LEDGER).
pub fn parse_trial_balance(xml: &str, max_rows: usize) -> (Vec<LedgerRow>, bool) {
    let lower = xml.to_lowercase();
    let mut rows = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("<dspaccname") {
        let name_start = search_from + rel;
        let name_gt = match lower[name_start..].find('>') {
            Some(g) => name_start + g + 1,
            None => break,
        };
        let name_close = match lower[name_gt..].find("</dspaccname>") {
            Some(c) => name_gt + c,
            None => break,
        };
        let name_block = &xml[name_start..name_close + "</dspaccname>".len()];
        let name = tag_value(name_block, "DSPDISPNAME")
            .or_else(|| tag_value(name_block, "NAME"))
            .map(|s| html_unescape(s.trim()))
            .filter(|s| !s.is_empty());

        let after_name = name_close + "</dspaccname>".len();
        let info_rel = lower[after_name..].find("<dspaccinfo");
        let Some(info_rel) = info_rel else {
            search_from = after_name;
            continue;
        };
        let info_start = after_name + info_rel;
        // Don't jump to a later account's info if something else is in between at distance —
        // require the next DSPACCINFO before the next DSPACCNAME.
        if let Some(next_name) = lower[after_name..].find("<dspaccname") {
            if next_name < info_rel {
                search_from = after_name;
                continue;
            }
        }
        let info_gt = match lower[info_start..].find('>') {
            Some(g) => info_start + g + 1,
            None => break,
        };
        let info_close = match lower[info_gt..].find("</dspaccinfo>") {
            Some(c) => info_gt + c,
            None => break,
        };
        let info_block = &xml[info_start..info_close + "</dspaccinfo>".len()];
        let debit = tag_value(info_block, "DSPCLDRAMTA")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let credit = tag_value(info_block, "DSPCLCRAMTA")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if let Some(name) = name {
            let net = net_balance(debit.as_deref(), credit.as_deref());
            rows.push(LedgerRow {
                name,
                parent: Some("Trial Balance".into()),
                closing_balance: net,
                debit,
                credit,
            });
        }
        search_from = info_close + "</dspaccinfo>".len();
        if rows.len() >= max_rows {
            let truncated = lower[search_from..].contains("<dspaccname");
            return (rows, truncated);
        }
    }
    (rows, false)
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// Extract a numeric amount from Tally CLOSINGBALANCE text.
/// Handles plain values and multi-currency forms like
/// `-$44524.70 @ ₹ 54/$ = -₹ 2404333.80`.
fn normalize_amount(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let plain = t.replace(',', "");
    if plain.parse::<f64>().is_ok() {
        return Some(plain);
    }
    // Prefer the base amount after the last '=' when present.
    let focus = plain.rsplit('=').next().unwrap_or(&plain).trim();
    let mut cleaned = String::new();
    let mut seen_digit = false;
    let mut seen_dot = false;
    for ch in focus.chars() {
        if ch == '-' || ch == '+' {
            if cleaned.is_empty() {
                cleaned.push(ch);
            }
        } else if ch.is_ascii_digit() {
            cleaned.push(ch);
            seen_digit = true;
        } else if ch == '.' && !seen_dot {
            cleaned.push(ch);
            seen_dot = true;
        } else if seen_digit {
            break;
        }
    }
    if cleaned.parse::<f64>().is_ok() {
        Some(cleaned)
    } else {
        Some(t.to_string())
    }
}

fn net_balance(debit: Option<&str>, credit: Option<&str>) -> Option<String> {
    let parse = |s: &str| -> Option<f64> {
        let t = s.replace(',', "").trim().to_string();
        if t.is_empty() {
            return None;
        }
        t.parse::<f64>().ok()
    };
    let d = debit.and_then(parse).unwrap_or(0.0);
    let c = credit.and_then(parse).unwrap_or(0.0);
    if debit.is_none() && credit.is_none() {
        return None;
    }
    // Tally often already signs Debit amounts negative in DSPCLDRAMTA.
    Some(format!("{:.2}", d + c))
}

pub fn parse_daybook(xml: &str, max_rows: usize) -> (Vec<DaybookLine>, bool) {
    let blocks = iter_blocks(xml, "VOUCHER");
    let truncated = blocks.len() > max_rows;
    let lines = blocks
        .into_iter()
        .take(max_rows)
        .map(|b| {
            let voucher_type = tag_value(b, "VOUCHERTYPENAME")
                .or_else(|| attr_value(b, "VCHTYPE"))
                .map(|s| s.to_string());
            let amount = tag_value(b, "AMOUNT")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    // Sum first ALLLEDGERENTRIES amount when top-level AMOUNT is absent.
                    let entries = iter_blocks(b, "ALLLEDGERENTRIES.LIST");
                    let mut total: f64 = 0.0;
                    let mut any = false;
                    for e in entries {
                        if let Some(a) = tag_value(e, "AMOUNT") {
                            if let Ok(n) = a.replace(',', "").trim().parse::<f64>() {
                                // Prefer the expense / first non-party leg magnitude:
                                // use absolute max for display when multiple legs.
                                if !any || n.abs() > total.abs() {
                                    total = n;
                                }
                                any = true;
                            }
                        }
                    }
                    if any {
                        Some(format!("{total:.2}"))
                    } else {
                        None
                    }
                });
            DaybookLine {
                date: tag_value(b, "DATE").map(|s| s.to_string()),
                voucher_type,
                party: tag_value(b, "PARTYLEDGERNAME")
                    .or_else(|| tag_value(b, "PARTYNAME"))
                    .map(|s| s.to_string()),
                amount,
                narration: tag_value(b, "NARRATION").map(|s| s.to_string()),
            }
        })
        .filter(|l| {
            l.date.is_some()
                || l.voucher_type.is_some()
                || l.party.is_some()
                || l.amount.is_some()
        })
        .collect();
    (lines, truncated)
}

pub fn parse_outstanding_from_ledgers(
    receivables: Vec<LedgerRow>,
    payables: Vec<LedgerRow>,
) -> OutstandingSummary {
    OutstandingSummary {
        receivables: OutstandingBucket {
            group: "Sundry Debtors".into(),
            count: receivables.len(),
            ledgers: receivables,
        },
        payables: OutstandingBucket {
            group: "Sundry Creditors".into(),
            count: payables.len(),
            ledgers: payables,
        },
    }
}
