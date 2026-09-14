//! Build Export-only Tally XML envelopes (never Import).

pub fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Normalize user/LLM dates into a form Tally accepts (prefer `YYYYMMDD`).
pub fn normalize_tally_date(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    // Already YYYYMMDD
    if s.len() == 8 && s.chars().all(|c| c.is_ascii_digit()) {
        return Some(s.to_string());
    }
    // YYYY-MM-DD or YYYY/MM/DD
    let compact: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if compact.len() == 8 {
        return Some(compact);
    }
    // d-MMM-yyyy / dd-MMM-yyyy (e.g. 1-Jun-2010)
    let parts: Vec<&str> = s.split(['-', '/', ' ']).filter(|p| !p.is_empty()).collect();
    if parts.len() == 3 {
        let day = parts[0].parse::<u32>().ok()?;
        let month = month_from_token(parts[1])?;
        let year = parts[2].parse::<u32>().ok()?;
        if (1..=31).contains(&day) && (1..=12).contains(&month) && year >= 1900 {
            return Some(format!("{year:04}{month:02}{day:02}"));
        }
    }
    // Pass through — Tally may still understand it.
    Some(s.to_string())
}

/// Tally Day Book often prefers `d-MMM-yyyy` over bare YYYYMMDD.
pub fn tally_display_date(raw: &str) -> Option<String> {
    let yyyymmdd = normalize_tally_date(raw)?;
    if yyyymmdd.len() != 8 || !yyyymmdd.chars().all(|c| c.is_ascii_digit()) {
        return Some(yyyymmdd);
    }
    let year: u32 = yyyymmdd[0..4].parse().ok()?;
    let month: u32 = yyyymmdd[4..6].parse().ok()?;
    let day: u32 = yyyymmdd[6..8].parse().ok()?;
    let mon = match month {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        12 => "Dec",
        _ => return None,
    };
    Some(format!("{day}-{mon}-{year}"))
}

fn month_from_token(tok: &str) -> Option<u32> {
    let t = tok.to_ascii_lowercase();
    let n = match t.as_str() {
        "1" | "01" | "jan" | "january" => 1,
        "2" | "02" | "feb" | "february" => 2,
        "3" | "03" | "mar" | "march" => 3,
        "4" | "04" | "apr" | "april" => 4,
        "5" | "05" | "may" => 5,
        "6" | "06" | "jun" | "june" => 6,
        "7" | "07" | "jul" | "july" => 7,
        "8" | "08" | "aug" | "august" => 8,
        "9" | "09" | "sep" | "sept" | "september" => 9,
        "10" | "oct" | "october" => 10,
        "11" | "nov" | "november" => 11,
        "12" | "dec" | "december" => 12,
        _ => return None,
    };
    Some(n)
}

fn static_vars(
    company: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
    extra: &str,
) -> String {
    static_vars_with_date_style(company, from, to, extra, false)
}

fn static_vars_with_date_style(
    company: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
    extra: &str,
    display_dates: bool,
) -> String {
    let mut parts = String::from(
        r#"<STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
"#,
    );
    if let Some(c) = company.filter(|s| !s.is_empty()) {
        parts.push_str(&format!(
            "        <SVCURRENTCOMPANY>{}</SVCURRENTCOMPANY>\n",
            escape_xml(c)
        ));
    }
    let fmt = |raw: &str| -> Option<String> {
        if display_dates {
            tally_display_date(raw)
        } else {
            normalize_tally_date(raw)
        }
    };
    if let Some(f) = from.and_then(fmt) {
        parts.push_str(&format!(
            "        <SVFROMDATE>{}</SVFROMDATE>\n",
            escape_xml(&f)
        ));
    }
    if let Some(t) = to.and_then(fmt) {
        parts.push_str(&format!("        <SVTODATE>{}</SVTODATE>\n", escape_xml(&t)));
    }
    parts.push_str(extra);
    parts.push_str("      </STATICVARIABLES>\n");
    parts
}

/// List companies known to this Tally instance (gateway must be on).
pub fn build_list_companies_export() -> String {
    format!(
        r#"<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Companies</ID>
  </HEADER>
  <BODY>
    <DESC>
{vars}    </DESC>
  </BODY>
</ENVELOPE>
"#,
        vars = static_vars(None, None, None, ""),
    )
}

/// Minimal export to verify HTTP + company context.
pub fn build_ping_export(company: Option<&str>) -> String {
    // List of Ledgers with a tiny fetch — works when a company is loaded.
    build_list_ledgers_export(company, None)
}

pub fn build_list_ledgers_export(company: Option<&str>, child_of: Option<&str>) -> String {
    let mut tdl = String::new();
    let filter = if let Some(parent) = child_of.filter(|s| !s.is_empty()) {
        format!(
            r#"
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="NELA Ledgers" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <CHILDOF>{}</CHILDOF>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
"#,
            escape_xml(parent)
        )
    } else {
        String::new()
    };

    let id = if child_of.filter(|s| !s.is_empty()).is_some() {
        "NELA Ledgers"
    } else {
        "List of Ledgers"
    };

    if !filter.is_empty() {
        tdl = filter;
    }

    format!(
        r#"<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>{id}</ID>
  </HEADER>
  <BODY>
    <DESC>
{vars}{tdl}    </DESC>
  </BODY>
</ENVELOPE>
"#,
        id = id,
        vars = static_vars(company, None, None, ""),
        tdl = tdl,
    )
}

pub fn build_trial_balance_export(
    company: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
) -> String {
    format!(
        r#"<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Trial Balance</ID>
  </HEADER>
  <BODY>
    <DESC>
{vars}    </DESC>
  </BODY>
</ENVELOPE>
"#,
        vars = static_vars_with_date_style(company, from, to, "", true),
    )
}

pub fn build_daybook_export(
    company: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
    voucher_type: Option<&str>,
) -> String {
    let mut extra = String::new();
    let mut tdl = String::new();
    if let Some(vt) = voucher_type.filter(|s| !s.is_empty()) {
        tdl = format!(
            r#"
      <TDL>
        <TDLMESSAGE>
          <SYSTEM TYPE="Formulae" NAME="NELAVchTypeFilter">$VoucherTypeName = "{vt}"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
"#,
            vt = escape_xml(vt)
        );
        extra.push_str(
            "        <!-- voucher type filter applied via TDL when supported -->\n",
        );
    }
    format!(
        r#"<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Day Book</ID>
  </HEADER>
  <BODY>
    <DESC>
{vars}{tdl}    </DESC>
  </BODY>
</ENVELOPE>
"#,
        vars = static_vars_with_date_style(company, from, to, &extra, true),
        tdl = tdl,
    )
}
