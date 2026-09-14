//! Thermal & power governor — the "no space heater" mandate (revamp.md §3).
//!
//! Centrally tracks:
//!   - Battery / AC power state (best-effort, fails open → AC assumed)
//!   - Thermal pressure flag (set externally when sustained high temps detected)
//!
//! Provides:
//!   - `inference_threads()` — safe thread count for the current state
//!   - `indexer_duty_cycle()` — DutyCycleGuard configured for current state
//!   - `on_battery()` — direct battery check
//!   - `HostProfile` — device-agnostic sizing for threads / RAM / batches
//!
//! ## Module layout
//! - `cancel` — per-request `CancellationToken`
//! - `duty`   — `DutyCycleGuard` for background loops
//! - `host`   — hardware probing and adaptive resource policy

pub mod cancel;
pub mod duty;
pub mod host;

pub use cancel::CancellationToken;
pub use duty::DutyCycleGuard;
pub use host::HostProfile;

use std::sync::atomic::{AtomicBool, Ordering};

/// Idle timeout (seconds) after which the active SLM is evicted from memory.
/// After eviction, idle RAM drops to < 150 MB (revamp.md §3.1 / §6.2).
pub const IDLE_EVICT_SECS: u64 = 180;

/// Count physical CPU cores (not SMT/hyperthread logical processors).
///
/// Prefer [`HostProfile::detect`] when you also need RAM / batch policy.
pub fn physical_core_count() -> usize {
    HostProfile::detect().physical_cores
}

/// One-shot AC/battery probe (no `Governor` instance required).
pub fn probe_on_battery() -> bool {
    detect_battery()
}

/// Central thermal and power governor.
///
/// Stored as `Arc<Governor>` in Tauri app state so every subsystem can read
/// current power/thermal conditions without additional IPC.
#[derive(Debug)]
pub struct Governor {
    /// True when the system is running on battery power.
    battery: AtomicBool,
    /// True when sustained thermal pressure has been flagged.
    thermal_pressure: AtomicBool,
}

impl Default for Governor {
    fn default() -> Self {
        Self::new()
    }
}

impl Governor {
    /// Create a new governor. Detects current battery state at construction.
    pub fn new() -> Self {
        let battery = detect_battery();
        let gov = Self {
            battery: AtomicBool::new(battery),
            thermal_pressure: AtomicBool::new(false),
        };
        let host = HostProfile::detect();
        log::info!(
            "Governor initialized: on_battery={}, physical_cores={}, logical_cores={}, \
             total_ram_mb={}, inference_threads={}, memory_budget_mb={}",
            battery,
            host.physical_cores,
            host.logical_cores,
            host.total_ram_mb,
            gov.inference_threads(),
            host.memory_budget_mb()
        );
        gov
    }

    /// Refresh the battery state. Call periodically from the lifecycle loop.
    pub fn refresh(&self) {
        let b = detect_battery();
        self.battery.store(b, Ordering::Relaxed);
    }

    /// Returns `true` when running on battery power.
    pub fn on_battery(&self) -> bool {
        self.battery.load(Ordering::Relaxed)
    }

    /// Returns `true` when thermal pressure is detected.
    pub fn thermal_pressure(&self) -> bool {
        self.thermal_pressure.load(Ordering::Relaxed)
    }

    /// Set or clear the thermal pressure flag.
    pub fn set_thermal_pressure(&self, v: bool) {
        self.thermal_pressure.store(v, Ordering::Relaxed);
    }

    /// Safe inference thread count for the current power/thermal state.
    ///
    /// Delegates to [`HostProfile`] so the formula is identical on every
    /// machine — only the measured core count changes.
    pub fn inference_threads(&self) -> usize {
        HostProfile::detect().inference_threads(self.on_battery(), self.thermal_pressure())
    }

    /// Build a `DutyCycleGuard` tuned for the current power state.
    pub fn indexer_duty_cycle(&self) -> DutyCycleGuard {
        if self.on_battery() {
            DutyCycleGuard::battery()
        } else {
            DutyCycleGuard::ac_power()
        }
    }
}

// ── Battery detection (best-effort, fails open → AC assumed) ─────────────────

fn detect_battery() -> bool {
    #[cfg(target_os = "linux")]
    return detect_battery_linux();

    #[cfg(target_os = "macos")]
    return detect_battery_macos();

    #[cfg(windows)]
    return detect_battery_windows();

    #[allow(unreachable_code)]
    false
}

#[cfg(target_os = "linux")]
fn detect_battery_linux() -> bool {
    // Check ACPI AC adapter: `online=1` means AC power (not on battery).
    let ac_paths = [
        "/sys/class/power_supply/AC/online",
        "/sys/class/power_supply/ACAD/online",
        "/sys/class/power_supply/AC0/online",
    ];
    for path in &ac_paths {
        if let Ok(s) = std::fs::read_to_string(path) {
            return s.trim() == "0"; // 0 = AC offline = on battery
        }
    }
    // Fallback: look for any BAT* with status=Discharging.
    if let Ok(entries) = std::fs::read_dir("/sys/class/power_supply") {
        for entry in entries.flatten() {
            let status_path = entry.path().join("status");
            if let Ok(s) = std::fs::read_to_string(status_path) {
                if s.trim().eq_ignore_ascii_case("Discharging") {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn detect_battery_macos() -> bool {
    // `pmset -g batt` prints "Now drawing from 'Battery Power'" when on battery.
    match std::process::Command::new("pmset")
        .args(["-g", "batt"])
        .output()
    {
        Ok(output) => String::from_utf8_lossy(&output.stdout).contains("Battery Power"),
        Err(_) => false,
    }
}

#[cfg(windows)]
fn detect_battery_windows() -> bool {
    // Native Win32 probe — never spawn PowerShell (GUI builds flash a console otherwise).
    // ACLineStatus: 0 = offline (battery), 1 = online (AC), 255 = unknown.
    #[repr(C)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }

    let mut status = SystemPowerStatus {
        ac_line_status: 255,
        battery_flag: 0,
        battery_life_percent: 0,
        system_status_flag: 0,
        battery_life_time: 0,
        battery_full_life_time: 0,
    };
    let ok = unsafe { GetSystemPowerStatus(&mut status) } != 0;
    if !ok {
        return false;
    }
    status.ac_line_status == 0
}

/// Managed state wrapper for use with Tauri's state system.
pub struct GovernorState(pub std::sync::Arc<Governor>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_core_count_is_sane() {
        let physical = physical_core_count();
        let logical = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        assert!(physical >= 1);
        assert!(
            physical <= logical,
            "physical ({physical}) must be ≤ logical ({logical})"
        );
    }

    #[test]
    fn inference_threads_stay_within_physical_cores() {
        let gov = Governor::new();
        let n = gov.inference_threads();
        let physical = physical_core_count();
        assert!(n >= 1);
        assert!(n <= physical);
    }
}
