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
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let open_u = format!("<{tag}");
    // Case-insensitive search for open tag
    let lower = block.to_lowercase();
    let tag_l = tag.to_lowercase();
    let open_l = format!("<{tag_l}>");
    let close_l = format!("</{tag_l}>");
    let start = lower.find(&open_l).or_else(|| {
        // Allow attributes: <NAME TYPE="…">
        let pat = format!("<{tag_l}");
        let i = lower.find(&pat)?;
        let after = &block[i..];
        let gt = after.find('>')?;
        Some(i + gt + 1 - open.len().min(0)) // placeholder
    });
    // Simpler path: exact then casefold via finding
    if let Some(i) = block.find(&open) {
        let rest = &block[i + open.len()..];
        if let Some(j) = rest.find(&close) {
            return Some(rest[..j].trim());
        }
    }
    // Case-insensitive
    if let Some(i) = lower.find(&open_l) {
        let after_open = i + open_l.len();
        if let Some(rel) = lower[after_open..].find(&close_l) {
            return Some(block[after_open..after_open + rel].trim());
        }
    }
    let _ = (open_u, start);
    None
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
            let name = field_value(b, "NAME")?.to_string();
            if name.is_empty() {
                return None;
            }
            Some(LedgerRow {
                name,
                parent: field_value(b, "PARENT").map(|s| s.to_string()),
                closing_balance: field_value(b, "CLOSINGBALANCE")
                    .or_else(|| field_value(b, "AMOUNT"))
                    .map(|s| s.to_string()),
            })
        })
        .collect();
    (rows, truncated)
}

pub fn parse_daybook(xml: &str, max_rows: usize) -> (Vec<DaybookLine>, bool) {
    let blocks = iter_blocks(xml, "VOUCHER");
    let truncated = blocks.len() > max_rows;
    let lines = blocks
        .into_iter()
        .take(max_rows)
        .map(|b| DaybookLine {
            date: tag_value(b, "DATE").map(|s| s.to_string()),
            voucher_type: tag_value(b, "VOUCHERTYPENAME").map(|s| s.to_string()),
            party: tag_value(b, "PARTYLEDGERNAME")
                .or_else(|| tag_value(b, "PARTYNAME"))
                .map(|s| s.to_string()),
            amount: tag_value(b, "AMOUNT").map(|s| s.to_string()),
            narration: tag_value(b, "NARRATION").map(|s| s.to_string()),
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
