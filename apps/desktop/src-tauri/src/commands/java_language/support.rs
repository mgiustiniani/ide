//! Shared Tauri-free synchronization support.

use std::sync::{Mutex, MutexGuard};

pub(super) fn lock<'a, T>(mutex: &'a Mutex<T>, name: &str) -> Result<MutexGuard<'a, T>, String> {
    mutex.lock().map_err(|_| format!("{name} lock is poisoned"))
}
