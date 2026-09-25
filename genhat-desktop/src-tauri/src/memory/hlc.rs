//! Hybrid Logical Clock: `physical_ms:counter:device_id`.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlcTimestamp {
    pub physical_ms: u64,
    pub counter: u32,
    pub device_id: String,
}

impl HlcTimestamp {
    pub fn format(&self) -> String {
        format!("{}:{}:{}", self.physical_ms, self.counter, self.device_id)
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        let mut parts = s.splitn(3, ':');
        let physical_ms = parts
            .next()
            .ok_or_else(|| "missing physical_ms".to_string())?
            .parse::<u64>()
            .map_err(|e| format!("bad physical_ms: {e}"))?;
        let counter = parts
            .next()
            .ok_or_else(|| "missing counter".to_string())?
            .parse::<u32>()
            .map_err(|e| format!("bad counter: {e}"))?;
        let device_id = parts
            .next()
            .ok_or_else(|| "missing device_id".to_string())?
            .to_string();
        Ok(Self {
            physical_ms,
            counter,
            device_id,
        })
    }

    /// Total order: physical_ms, then counter, then device_id lexicographic.
    pub fn cmp_hlc(&self, other: &Self) -> std::cmp::Ordering {
        self.physical_ms
            .cmp(&other.physical_ms)
            .then(self.counter.cmp(&other.counter))
            .then(self.device_id.cmp(&other.device_id))
    }
}

pub struct HlcClock {
    device_id: String,
    last: Mutex<(u64, u32)>,
}

impl HlcClock {
    pub fn new(device_id: String) -> Self {
        Self {
            device_id,
            last: Mutex::new((0, 0)),
        }
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn tick(&self) -> HlcTimestamp {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut guard = self.last.lock().expect("hlc lock");
        let (last_ms, last_counter) = *guard;
        let (physical_ms, counter) = if now_ms > last_ms {
            (now_ms, 0)
        } else {
            (last_ms, last_counter.saturating_add(1))
        };
        *guard = (physical_ms, counter);
        HlcTimestamp {
            physical_ms,
            counter,
            device_id: self.device_id.clone(),
        }
    }

    /// Advance clock on receiving a remote HLC (for sync merges).
    pub fn receive(&self, remote: &HlcTimestamp) -> HlcTimestamp {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut guard = self.last.lock().expect("hlc lock");
        let (last_ms, last_counter) = *guard;
        let physical_ms = now_ms.max(remote.physical_ms).max(last_ms);
        let counter = if physical_ms == last_ms && physical_ms == remote.physical_ms {
            last_counter.max(remote.counter).saturating_add(1)
        } else if physical_ms == last_ms {
            last_counter.saturating_add(1)
        } else if physical_ms == remote.physical_ms {
            remote.counter.saturating_add(1)
        } else {
            0
        };
        *guard = (physical_ms, counter);
        HlcTimestamp {
            physical_ms,
            counter,
            device_id: self.device_id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_are_monotonic_under_burst() {
        let clock = HlcClock::new("dev-a".into());
        let mut prev = clock.tick();
        for _ in 0..50 {
            let next = clock.tick();
            assert!(next.cmp_hlc(&prev) == std::cmp::Ordering::Greater);
            prev = next;
        }
    }

    #[test]
    fn roundtrip_format_parse() {
        let t = HlcTimestamp {
            physical_ms: 1_700_000_000_000,
            counter: 3,
            device_id: "abc".into(),
        };
        assert_eq!(HlcTimestamp::parse(&t.format()).unwrap(), t);
    }
}
