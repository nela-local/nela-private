//! Windows-only helpers to spawn child processes without showing a console window.
//!
//! GUI apps (`windows_subsystem = "windows"`) that spawn console tools (PowerShell,
//! `cmd`, MCP sidecars, etc.) will flash a terminal unless `CREATE_NO_WINDOW` is set.

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// `CREATE_NO_WINDOW` — run without allocating a visible console.
/// Prefer this alone over combining with `DETACHED_PROCESS`, which can interfere
/// with redirected stdin/stdout on some Windows builds.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Hide console window for `std::process::Command` on Windows.
#[cfg(windows)]
pub fn hide_console_std(cmd: &mut std::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// Hide console window for `tokio::process::Command` on Windows.
#[cfg(windows)]
pub fn hide_console_tokio(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn hide_console_std(_cmd: &mut std::process::Command) {}

#[cfg(not(windows))]
pub fn hide_console_tokio(_cmd: &mut tokio::process::Command) {}

/// Lower a process to BelowNormal priority without spawning PowerShell.
#[cfg(windows)]
pub fn set_below_normal_priority(pid: u32) -> bool {
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut std::ffi::c_void;
        fn SetPriorityClass(process: *mut std::ffi::c_void, priority_class: u32) -> i32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }

    unsafe {
        let handle = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let ok = SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS) != 0;
        CloseHandle(handle);
        ok
    }
}
