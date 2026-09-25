//! G-Counter helpers for multi-device observation counts.

use serde_json::{Map, Value};
use std::collections::HashMap;

pub fn empty_counts_json() -> String {
    "{}".to_string()
}

pub fn parse_counts(json: &str) -> HashMap<String, u64> {
    serde_json::from_str::<HashMap<String, u64>>(json).unwrap_or_default()
}

pub fn counts_to_json(counts: &HashMap<String, u64>) -> String {
    serde_json::to_string(counts).unwrap_or_else(|_| "{}".to_string())
}

/// State-based G-Counter union: device_counts[d] = max(local[d], incoming[d]).
pub fn merge_counts(
    local: &HashMap<String, u64>,
    incoming: &HashMap<String, u64>,
) -> HashMap<String, u64> {
    let mut out = local.clone();
    for (k, v) in incoming {
        let entry = out.entry(k.clone()).or_insert(0);
        *entry = (*entry).max(*v);
    }
    out
}

pub fn sum_counts(counts: &HashMap<String, u64>) -> i64 {
    counts.values().copied().sum::<u64>() as i64
}

pub fn bump_device(counts: &mut HashMap<String, u64>, device_id: &str, by: u64) {
    let entry = counts.entry(device_id.to_string()).or_insert(0);
    *entry = entry.saturating_add(by);
}

pub fn counts_from_value(v: &Value) -> HashMap<String, u64> {
    match v {
        Value::Object(map) => map
            .iter()
            .filter_map(|(k, val)| val.as_u64().map(|n| (k.clone(), n)))
            .collect(),
        _ => HashMap::new(),
    }
}

pub fn counts_to_value(counts: &HashMap<String, u64>) -> Value {
    let mut map = Map::new();
    for (k, v) in counts {
        map.insert(k.clone(), Value::from(*v));
    }
    Value::Object(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_is_idempotent() {
        let mut a = HashMap::new();
        a.insert("d1".into(), 2);
        a.insert("d2".into(), 1);
        let mut b = HashMap::new();
        b.insert("d1".into(), 5);
        b.insert("d3".into(), 3);
        let m1 = merge_counts(&a, &b);
        let m2 = merge_counts(&m1, &b);
        assert_eq!(m1, m2);
        assert_eq!(m1.get("d1"), Some(&5));
        assert_eq!(sum_counts(&m1), 9);
    }
}
