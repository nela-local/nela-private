//! Lazy confidence decay, asymmetric updates, and promotion rules.

use crate::memory::types::{DELTA_NEG, DELTA_POS, LAMBDA, PROMOTE_C, PROMOTE_N, C_OMIT};
use chrono::{NaiveDateTime, Utc};

/// Effective confidence with lazy exponential decay.
pub fn c_eff(stored: f64, last_observed_at: &str, now: Option<chrono::DateTime<Utc>>) -> f64 {
    let delta_days = elapsed_days(last_observed_at, now);
    let eff = stored * (-LAMBDA * delta_days).exp();
    eff.clamp(0.0, 1.0)
}

pub fn should_omit(eff: f64) -> bool {
    eff < C_OMIT
}

pub fn reinforce_positive(eff: f64) -> f64 {
    (eff + DELTA_POS * (1.0 - eff)).clamp(0.0, 1.0)
}

pub fn reinforce_negative(eff: f64) -> f64 {
    (eff - DELTA_NEG).max(0.0)
}

pub fn should_promote(observation_count: i64, eff: f64) -> bool {
    observation_count >= PROMOTE_N && eff >= PROMOTE_C
}

fn elapsed_days(last_observed_at: &str, now: Option<chrono::DateTime<Utc>>) -> f64 {
    let now = now.unwrap_or_else(Utc::now);
    if let Some(ts) = parse_sqlite_datetime(last_observed_at) {
        let dur = now.signed_duration_since(ts.and_utc());
        (dur.num_milliseconds() as f64 / 86_400_000.0).max(0.0)
    } else {
        0.0
    }
}

fn parse_sqlite_datetime(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim();
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok().or_else(|| {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok()
    }).or_else(|| {
        chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.naive_utc())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone};

    #[test]
    fn zero_delta_preserves_confidence() {
        let now = Utc::now();
        let stamp = now.format("%Y-%m-%d %H:%M:%S").to_string();
        let e = c_eff(0.9, &stamp, Some(now));
        assert!((e - 0.9).abs() < 1e-6);
    }

    #[test]
    fn half_life_approx_twenty_days() {
        let now = Utc.with_ymd_and_hms(2026, 1, 21, 0, 0, 0).unwrap();
        let then = (now - Duration::days(20)).format("%Y-%m-%d %H:%M:%S").to_string();
        let e = c_eff(1.0, &then, Some(now));
        // e^(-0.035*20) ≈ 0.4966
        assert!((e - 0.5).abs() < 0.02);
    }

    #[test]
    fn omit_below_threshold() {
        assert!(should_omit(0.19));
        assert!(!should_omit(0.20));
    }

    #[test]
    fn positive_asymptotic() {
        let n = reinforce_positive(0.5);
        assert!((n - 0.625).abs() < 1e-9);
    }

    #[test]
    fn negative_floor() {
        assert_eq!(reinforce_negative(0.3), 0.0);
        assert!((reinforce_negative(0.9) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn promote_gate() {
        assert!(!should_promote(2, 0.9));
        assert!(!should_promote(3, 0.79));
        assert!(should_promote(3, 0.80));
    }
}
