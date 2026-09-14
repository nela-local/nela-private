//! Localhost-only HTTP POST to Tally XML gateway.

use std::time::Duration;

pub const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// Only loopback hosts are allowed in v1.
pub fn ensure_localhost(host: &str) -> Result<(), String> {
    let h = host.trim().to_lowercase();
    if h == "127.0.0.1" || h == "localhost" || h == "::1" {
        return Ok(());
    }
    Err(
        "Tally connector only allows localhost (127.0.0.1 / localhost). Remote LAN hosts are not enabled yet."
            .into(),
    )
}

pub async fn tally_http_post(host: &str, port: u16, xml: &str) -> Result<String, String> {
    tally_http_post_with_timeouts(host, port, xml, Duration::from_secs(5), Duration::from_secs(15))
        .await
}

/// Fast probe for port scanning (short connect + total timeout).
pub async fn tally_http_probe(host: &str, port: u16, xml: &str) -> Result<String, String> {
    tally_http_post_with_timeouts(
        host,
        port,
        xml,
        Duration::from_millis(400),
        Duration::from_millis(900),
    )
    .await
}

async fn tally_http_post_with_timeouts(
    host: &str,
    port: u16,
    xml: &str,
    connect_timeout: Duration,
    timeout: Duration,
) -> Result<String, String> {
    ensure_localhost(host)?;
    if !(1..=65535).contains(&port) {
        return Err("Invalid Tally port.".into());
    }
    let url = format!("http://{}:{}/", host.trim(), port);
    let client = reqwest::Client::builder()
        .connect_timeout(connect_timeout)
        .timeout(timeout)
        .no_proxy()
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let res = client
        .post(&url)
        .header("Content-Type", "text/xml; charset=utf-8")
        .header("Accept", "text/xml, application/xml, */*")
        .body(xml.to_string())
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                format!(
                    "Could not reach Tally at {url}. Is TallyPrime running with HTTP Server enabled on port {port}?"
                )
            } else {
                format!("Tally request failed: {e}")
            }
        })?;

    if !res.status().is_success() {
        return Err(format!(
            "Tally HTTP error {} — check HTTP Server settings.",
            res.status()
        ));
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed reading Tally response: {e}"))?;
    let truncated = bytes.len() > MAX_RESPONSE_BYTES;
    let slice = if truncated {
        &bytes[..MAX_RESPONSE_BYTES]
    } else {
        &bytes
    };
    let mut text = String::from_utf8_lossy(slice).into_owned();
    if truncated {
        text.push_str("\n<!-- NELA: response truncated -->");
    }
    Ok(text)
}
