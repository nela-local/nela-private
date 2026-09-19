//! Read-only TallyPrime XML-over-HTTP client (localhost only).
//!
//! Never sends Import / write requests. Host builds Export envelopes;
//! responses are parsed into compact JSON-friendly structs for LLM tools.

mod config;
mod http;
mod parse;
mod xml;

pub use config::{
    disconnect, load_config, save_config, set_app_data_dir, TallyConfig, TallyStatus,
};
pub use http::{ensure_localhost, tally_http_post, tally_http_probe, MAX_RESPONSE_BYTES};
pub use parse::{
    parse_active_company, parse_company_names, parse_daybook, parse_ledgers,
    parse_outstanding_from_ledgers, parse_trial_balance, resolve_company_name, DaybookLine,
    LedgerRow, OutstandingBucket, OutstandingSummary,
};
pub use xml::{
    build_daybook_export, build_list_companies_export, build_list_ledgers_export, build_ping_export,
    build_trial_balance_export, escape_xml, normalize_tally_date, tally_display_date,
};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TallyScanResult {
    pub ok: bool,
    pub host: String,
    /// Ports that responded like Tally XML HTTP (first is preferred).
    pub ports: Vec<u16>,
    pub scanned: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Common Tally HTTP ports + a small band around the default.
fn candidate_ports() -> Vec<u16> {
    let mut ports: Vec<u16> = vec![
        9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010, 9011,
        9999, 9998, 8000, 8080, 8888, 9090, 9400, 9401,
    ];
    ports.sort_unstable();
    ports.dedup();
    ports
}

fn looks_like_tally_response(body: &str) -> bool {
    let upper = body.to_uppercase();
    upper.contains("<ENVELOPE")
        || upper.contains("<RESPONSE")
        || upper.contains("TALLY")
        || upper.contains("<STATUS>")
}

/// Probe localhost candidate ports for a live Tally HTTP server.
pub async fn scan_ports(host: Option<String>) -> Result<TallyScanResult, String> {
    let host = host
        .unwrap_or_else(|| "127.0.0.1".into())
        .trim()
        .to_string();
    ensure_localhost(&host)?;
    let ports = candidate_ports();
    let scanned = ports.len();
    let xml = build_ping_export(None);

    let mut handles = Vec::with_capacity(ports.len());
    for port in ports {
        let host_c = host.clone();
        let xml_c = xml.clone();
        handles.push(tokio::spawn(async move {
            match tally_http_probe(&host_c, port, &xml_c).await {
                Ok(body) if looks_like_tally_response(&body) => Some(port),
                _ => None,
            }
        }));
    }

    let mut found: Vec<u16> = Vec::new();
    for h in handles {
        if let Ok(Some(port)) = h.await {
            found.push(port);
        }
    }
    found.sort_unstable();
    // Prefer 9000 when present, else lowest port.
    if let Some(i) = found.iter().position(|p| *p == 9000) {
        let p = found.remove(i);
        found.insert(0, p);
    }

    Ok(TallyScanResult {
        ok: !found.is_empty(),
        host,
        ports: found,
        scanned,
        error: None,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TallyLedgersResult {
    pub ok: bool,
    pub company: Option<String>,
    pub ledgers: Vec<LedgerRow>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TallyTrialBalanceResult {
    pub ok: bool,
    pub company: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub rows: Vec<LedgerRow>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TallyDaybookResult {
    pub ok: bool,
    pub company: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub lines: Vec<DaybookLine>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TallyOutstandingResult {
    pub ok: bool,
    pub company: Option<String>,
    pub receivables: OutstandingBucket,
    pub payables: OutstandingBucket,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn cfg_or_err() -> Result<TallyConfig, String> {
    let cfg = load_config()?;
    if !cfg.connected {
        return Err(
            "Tally is not connected. Open Settings → Connections and connect Tally (HTTP Server on localhost)."
                .into(),
        );
    }
    Ok(cfg)
}

/// Probe Tally HTTP and optionally persist connection.
pub async fn connect(host: String, port: u16, company: Option<String>) -> Result<TallyStatus, String> {
    ensure_localhost(&host)?;
    let requested = company
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Resolve short names like "Quadragen" → exact Tally company name.
    // Wrong SVCURRENTCOMPANY returns STATUS=1 with zero ledgers (looks "empty").
    let companies_xml = tally_http_post(&host, port, &build_list_companies_export()).await?;
    let available = parse_company_names(&companies_xml);
    let resolved = if let Some(req) = requested.as_deref() {
        Some(resolve_company_name(req, &available)?)
    } else {
        parse_active_company(&companies_xml).or_else(|| available.first().cloned())
    };

    let xml = build_ping_export(resolved.as_deref());
    let body = tally_http_post(&host, port, &xml).await?;
    if !parse::response_ok(&body) && !body.to_uppercase().contains("ENVELOPE") {
        return Err(
            "Tally responded but the XML did not look like a successful export. Is a company loaded?"
                .into(),
        );
    }
    let (ledgers, _) = parse_ledgers(&body, 5);
    if ledgers.is_empty() {
        let hint = if available.is_empty() {
            "Load a company in Tally (Company → Select), then reconnect. Leave Company blank in NELA."
                .to_string()
        } else {
            format!(
                "Tally answered but returned no ledgers for “{}”. Load the right company in Tally, or reconnect with exact name like: {}",
                resolved.as_deref().unwrap_or("(loaded)"),
                available.iter().take(3).cloned().collect::<Vec<_>>().join(" · ")
            )
        };
        return Err(hint);
    }

    let company_final = resolved
        .or_else(|| parse_active_company(&body))
        .or(available.first().cloned());

    let cfg = TallyConfig {
        host: host.trim().to_string(),
        port,
        company: company_final,
        connected: true,
    };
    save_config(&cfg)?;
    Ok(status_from_config(cfg, None))
}

pub fn status() -> Result<TallyStatus, String> {
    match load_config() {
        Ok(cfg) if cfg.connected => Ok(status_from_config(cfg, None)),
        Ok(_) => Ok(TallyStatus {
            connected: false,
            host: None,
            port: None,
            company: None,
            last_error: None,
        }),
        Err(e) => Ok(TallyStatus {
            connected: false,
            host: None,
            port: None,
            company: None,
            last_error: Some(e),
        }),
    }
}

pub async fn ping() -> Result<TallyStatus, String> {
    let cfg = match load_config() {
        Ok(c) if c.connected => c,
        _ => {
            return Ok(TallyStatus {
                connected: false,
                host: None,
                port: None,
                company: None,
                last_error: Some("Not connected".into()),
            });
        }
    };
    match tally_http_post(&cfg.host, cfg.port, &build_ping_export(cfg.company.as_deref())).await {
        Ok(_) => Ok(status_from_config(cfg, None)),
        Err(e) => Ok(status_from_config(cfg, Some(e))),
    }
}

fn status_from_config(cfg: TallyConfig, last_error: Option<String>) -> TallyStatus {
    TallyStatus {
        connected: cfg.connected && last_error.is_none(),
        host: Some(cfg.host),
        port: Some(cfg.port),
        company: cfg.company,
        last_error,
    }
}

pub async fn list_ledgers(
    group: Option<String>,
    max_rows: Option<usize>,
) -> Result<TallyLedgersResult, String> {
    let cfg = cfg_or_err()?;
    let cap = max_rows.unwrap_or(200).clamp(1, 5000);
    let group = group
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let xml = build_list_ledgers_export(cfg.company.as_deref(), group.as_deref());
    match tally_http_post(&cfg.host, cfg.port, &xml).await {
        Ok(body) => {
            let (ledgers, truncated) = parse_ledgers(&body, cap);
            Ok(TallyLedgersResult {
                ok: true,
                company: cfg.company,
                ledgers,
                truncated,
                error: None,
            })
        }
        Err(e) => Ok(TallyLedgersResult {
            ok: false,
            company: cfg.company,
            ledgers: vec![],
            truncated: false,
            error: Some(e),
        }),
    }
}

pub async fn trial_balance(
    from_date: Option<String>,
    to_date: Option<String>,
    max_rows: Option<usize>,
) -> Result<TallyTrialBalanceResult, String> {
    let cfg = cfg_or_err()?;
    let cap = max_rows.unwrap_or(200).clamp(1, 5000);
    let from = from_date.filter(|s| !s.trim().is_empty());
    let to = to_date.filter(|s| !s.trim().is_empty());
    let xml = build_trial_balance_export(cfg.company.as_deref(), from.as_deref(), to.as_deref());
    match tally_http_post(&cfg.host, cfg.port, &xml).await {
        Ok(body) => {
            let (rows, truncated) = parse_trial_balance(&body, cap);
            let empty = rows.is_empty();
            Ok(TallyTrialBalanceResult {
                ok: true,
                company: cfg.company,
                from_date: from,
                to_date: to,
                rows,
                truncated,
                error: if empty {
                    Some(
                        "Trial Balance returned no group rows. Try another date range (e.g. an older FY) or confirm books are open in Tally."
                            .into(),
                    )
                } else {
                    None
                },
            })
        }
        Err(e) => Ok(TallyTrialBalanceResult {
            ok: false,
            company: cfg.company,
            from_date: from,
            to_date: to,
            rows: vec![],
            truncated: false,
            error: Some(e),
        }),
    }
}

pub async fn daybook(
    from_date: Option<String>,
    to_date: Option<String>,
    voucher_type: Option<String>,
    max_rows: Option<usize>,
) -> Result<TallyDaybookResult, String> {
    let cfg = cfg_or_err()?;
    let cap = max_rows.unwrap_or(100).clamp(1, 5000);
    let from = from_date.filter(|s| !s.trim().is_empty());
    let to = to_date.filter(|s| !s.trim().is_empty());
    let vtype = voucher_type
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let xml = build_daybook_export(
        cfg.company.as_deref(),
        from.as_deref(),
        to.as_deref(),
        vtype.as_deref(),
    );
    match tally_http_post(&cfg.host, cfg.port, &xml).await {
        Ok(body) => {
            let (lines, truncated) = parse_daybook(&body, cap);
            Ok(TallyDaybookResult {
                ok: true,
                company: cfg.company,
                from_date: from,
                to_date: to,
                lines,
                truncated,
                error: None,
            })
        }
        Err(e) => Ok(TallyDaybookResult {
            ok: false,
            company: cfg.company,
            from_date: from,
            to_date: to,
            lines: vec![],
            truncated: false,
            error: Some(e),
        }),
    }
}

pub async fn outstanding(max_rows: Option<usize>) -> Result<TallyOutstandingResult, String> {
    let cfg = cfg_or_err()?;
    let cap = max_rows.unwrap_or(50).clamp(1, 5000);
    // Fetch ledgers under Sundry Debtors / Creditors via two collection exports.
    let debtors_xml =
        build_list_ledgers_export(cfg.company.as_deref(), Some("Sundry Debtors"));
    let creditors_xml =
        build_list_ledgers_export(cfg.company.as_deref(), Some("Sundry Creditors"));

    let debtors_body = tally_http_post(&cfg.host, cfg.port, &debtors_xml).await;
    let creditors_body = tally_http_post(&cfg.host, cfg.port, &creditors_xml).await;

    match (debtors_body, creditors_body) {
        (Ok(d), Ok(c)) => {
            let (recv, _) = parse_ledgers(&d, cap);
            let (pay, _) = parse_ledgers(&c, cap);
            let summary = parse_outstanding_from_ledgers(recv, pay);
            Ok(TallyOutstandingResult {
                ok: true,
                company: cfg.company,
                receivables: summary.receivables,
                payables: summary.payables,
                error: None,
            })
        }
        (Err(e), _) | (_, Err(e)) => Ok(TallyOutstandingResult {
            ok: false,
            company: cfg.company,
            receivables: OutstandingBucket::default(),
            payables: OutstandingBucket::default(),
            error: Some(e),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_localhost() {
        assert!(ensure_localhost("127.0.0.1").is_ok());
        assert!(ensure_localhost("localhost").is_ok());
        assert!(ensure_localhost("::1").is_ok());
        assert!(ensure_localhost("192.168.1.5").is_err());
        assert!(ensure_localhost("evil.example.com").is_err());
    }

    #[test]
    fn candidate_ports_include_common_alternates() {
        let ports = candidate_ports();
        assert!(ports.contains(&9000));
        assert!(ports.contains(&9999));
    }

    #[test]
    fn resolves_short_company_name() {
        let available = vec![
            "QUADRAGEN VETHEALTH PVT. LTD., - (10-13)".into(),
            "Other Co".into(),
        ];
        let got = resolve_company_name("Quadragen", &available).unwrap();
        assert!(got.to_uppercase().contains("QUADRAGEN"));
    }

    #[test]
    fn normalizes_human_dates() {
        assert_eq!(
            normalize_tally_date("1-Jun-2010").as_deref(),
            Some("20100601")
        );
        assert_eq!(
            normalize_tally_date("2010-07-31").as_deref(),
            Some("20100731")
        );
        assert_eq!(
            tally_display_date("20100601").as_deref(),
            Some("1-Jun-2010")
        );
    }

    #[test]
    fn parses_ledger_name_attribute() {
        let fixture = r#"
<ENVELOPE><BODY><DATA><COLLECTION>
 <LEDGER NAME="3 A PHARMA" RESERVEDNAME="">
  <LANGUAGENAME.LIST><NAME.LIST><NAME>3 A PHARMA</NAME></NAME.LIST></LANGUAGENAME.LIST>
 </LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>"#;
        let (rows, _) = parse_ledgers(fixture, 10);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "3 A PHARMA");
    }

    #[test]
    fn daybook_xml_uses_display_dates() {
        let xml = build_daybook_export(None, Some("20100601"), Some("20100731"), None);
        assert!(xml.contains("1-Jun-2010"));
        assert!(xml.contains("31-Jul-2010"));
        assert!(xml.contains("Day Book"));
    }

    #[test]
    fn ping_xml_is_export_only() {
        let xml = build_ping_export(Some("Demo Co"));
        assert!(xml.contains("Export") || xml.contains("EXPORT"));
        assert!(!xml.to_lowercase().contains("import"));
        assert!(xml.contains("SVCURRENTCOMPANY"));
        assert!(xml.contains("Demo Co"));
    }

    #[test]
    fn parses_ledger_fixture() {
        let fixture = r#"<?xml version="1.0"?>
<ENVELOPE>
 <HEADER><STATUS>1</STATUS></HEADER>
 <BODY>
  <DATA>
   <COLLECTION>
    <LEDGER>
     <NAME>Cash</NAME>
     <PARENT>Cash-in-Hand</PARENT>
     <CLOSINGBALANCE>-15000.00</CLOSINGBALANCE>
    </LEDGER>
    <LEDGER>
     <NAME>Acme Pvt Ltd</NAME>
     <PARENT>Sundry Debtors</PARENT>
     <CLOSINGBALANCE>42000.50</CLOSINGBALANCE>
    </LEDGER>
   </COLLECTION>
  </DATA>
 </BODY>
</ENVELOPE>"#;
        let (rows, truncated) = parse_ledgers(fixture, 200);
        assert!(!truncated);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "Cash");
        assert_eq!(rows[1].closing_balance.as_deref(), Some("42000.50"));
    }

    #[test]
    fn parses_ledgers_with_attribute_tags() {
        let fixture = r#"
<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>
    <LEDGER NAME="3 A PHARMA" RESERVEDNAME="">
     <PARENT TYPE="String">Sundry Debtors</PARENT>
     <CLOSINGBALANCE TYPE="Amount">-50231.00</CLOSINGBALANCE>
    </LEDGER>
    <LEDGER NAME="Cash" RESERVEDNAME="">
     <PARENT TYPE="String">Cash-in-Hand</PARENT>
     <CLOSINGBALANCE TYPE="Amount"></CLOSINGBALANCE>
    </LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>"#;
        let (rows, _) = parse_ledgers(fixture, 200);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "3 A PHARMA");
        assert_eq!(rows[0].parent.as_deref(), Some("Sundry Debtors"));
        assert_eq!(rows[0].closing_balance.as_deref(), Some("-50231.00"));
        assert_eq!(rows[1].closing_balance, None);
    }

    #[test]
    fn normalizes_multicurrency_closing_balance() {
        let fixture = r#"
<ENVELOPE><BODY><DATA><COLLECTION>
    <LEDGER NAME="3 A PHARMA" RESERVEDNAME="">
     <PARENT TYPE="String">Sundry Debtors</PARENT>
     <CLOSINGBALANCE TYPE="Amount">-$44524.70 @ ? 54/$ = -? 2404333.80</CLOSINGBALANCE>
    </LEDGER>
</COLLECTION></DATA></BODY></ENVELOPE>"#;
        let (rows, _) = parse_ledgers(fixture, 10);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].closing_balance.as_deref(), Some("-2404333.80"));
    }

    #[test]
    fn parses_trial_balance_dsp_format() {
        let fixture = r#"
<ENVELOPE>
 <DSPACCNAME>
  <DSPDISPNAME>Capital Account</DSPDISPNAME>
 </DSPACCNAME>
 <DSPACCINFO>
  <DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT>
  <DSPCLCRAMT><DSPCLCRAMTA>8582919.86</DSPCLCRAMTA></DSPCLCRAMT>
 </DSPACCINFO>
 <DSPACCNAME>
  <DSPDISPNAME>Fixed Assets</DSPDISPNAME>
 </DSPACCNAME>
 <DSPACCINFO>
  <DSPCLDRAMT><DSPCLDRAMTA>-1376244.00</DSPCLDRAMTA></DSPCLDRAMT>
  <DSPCLCRAMT><DSPCLCRAMTA></DSPCLCRAMTA></DSPCLCRAMT>
 </DSPACCINFO>
 <DSPACCNAME>
  <DSPDISPNAME>Profit &amp; Loss A/c</DSPDISPNAME>
 </DSPACCNAME>
 <DSPACCINFO>
  <DSPCLDRAMT><DSPCLDRAMTA>-3802919.86</DSPCLDRAMTA></DSPCLDRAMT>
  <DSPCLCRAMT><DSPCLCRAMTA></DSPCLCRAMTA></DSPCLCRAMT>
 </DSPACCINFO>
</ENVELOPE>"#;
        let (rows, _) = parse_trial_balance(fixture, 200);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].name, "Capital Account");
        assert_eq!(rows[0].credit.as_deref(), Some("8582919.86"));
        assert_eq!(rows[0].closing_balance.as_deref(), Some("8582919.86"));
        assert_eq!(rows[1].name, "Fixed Assets");
        assert_eq!(rows[1].debit.as_deref(), Some("-1376244.00"));
        assert_eq!(rows[2].name, "Profit & Loss A/c");
    }

    #[test]
    fn parses_daybook_vchtype_attr_and_entries() {
        let fixture = r#"
<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY>
<VOUCHER VCHTYPE="Journal" ACTION="Create">
 <DATE>20140409</DATE>
 <PARTYLEDGERNAME>PRESENTS</PARTYLEDGERNAME>
 <NARRATION>towards purchase of T-Shirts</NARRATION>
 <ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>BUSINESS PROMOTION</LEDGERNAME>
  <AMOUNT>-25557.00</AMOUNT>
 </ALLLEDGERENTRIES.LIST>
 <ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>PRESENTS</LEDGERNAME>
  <AMOUNT>25557.00</AMOUNT>
 </ALLLEDGERENTRIES.LIST>
</VOUCHER>
</BODY></ENVELOPE>"#;
        let (lines, _) = parse_daybook(fixture, 100);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].voucher_type.as_deref(), Some("Journal"));
        assert_eq!(lines[0].party.as_deref(), Some("PRESENTS"));
        // First ledger leg is the expense side (-25557); abs-max keeps that magnitude/sign.
        assert_eq!(lines[0].amount.as_deref(), Some("-25557.00"));
    }

    #[test]
    fn parses_daybook_fixture() {
        let fixture = r#"
<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY>
<VOUCHER>
 <DATE>20260401</DATE>
 <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
 <PARTYLEDGERNAME>Acme Pvt Ltd</PARTYLEDGERNAME>
 <AMOUNT>10000</AMOUNT>
</VOUCHER>
<VOUCHER>
 <DATE>20260402</DATE>
 <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
 <PARTYLEDGERNAME>Vendor X</PARTYLEDGERNAME>
 <AMOUNT>-2500</AMOUNT>
</VOUCHER>
</BODY></ENVELOPE>"#;
        let (lines, _) = parse_daybook(fixture, 100);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].voucher_type.as_deref(), Some("Sales"));
    }
}
