use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const IDE_HOME_ENV: &str = "IDE_HOME";

pub fn ide_home_dir() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os(IDE_HOME_ENV) {
        let path = PathBuf::from(path);
        if path.as_os_str().is_empty() {
            return Err(format!("{IDE_HOME_ENV} must not be empty"));
        }
        return Ok(path);
    }

    let home = user_home_dir().ok_or_else(|| "Cannot determine user home directory".to_string())?;
    Ok(home.join(".ide"))
}

pub fn workspace_registry_path() -> Result<PathBuf, String> {
    Ok(ide_home_dir()?.join("workspaces.json"))
}

pub fn settings_path() -> Result<PathBuf, String> {
    Ok(ide_home_dir()?.join("settings.json"))
}

pub fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot determine parent directory for {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Cannot create directory '{}': {e}", parent.display()))
}

pub fn write_json_pretty(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Cannot serialize JSON for '{}': {e}", path.display()))?;
    fs::write(path, content).map_err(|e| format!("Cannot write '{}': {e}", path.display()))
}

pub fn now_rfc3339() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    unix_seconds_to_rfc3339(seconds)
}

fn unix_seconds_to_rfc3339(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let second_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = second_of_day / 3_600;
    let minute = (second_of_day % 3_600) / 60;
    let second = second_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

// Howard Hinnant's civil calendar conversion for days since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2).div_euclid(153);
    let d = doy - (153 * mp + 2).div_euclid(5) + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
}

fn user_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        env::var_os("USERPROFILE").map(PathBuf::from).or_else(|| {
            match (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
                (Some(drive), Some(path)) => Some(PathBuf::from(drive).join(path)),
                _ => None,
            }
        })
    }

    #[cfg(not(windows))]
    {
        env::var_os("HOME").map(PathBuf::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn temp_ide_home() -> PathBuf {
        env::temp_dir().join(format!(
            "ide-desktop-config-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn registry_and_settings_paths_use_ide_home_override() {
        let _guard = test_lock();
        let home = temp_ide_home();
        env::set_var(IDE_HOME_ENV, &home);

        assert_eq!(
            workspace_registry_path().unwrap(),
            home.join("workspaces.json")
        );
        assert_eq!(settings_path().unwrap(), home.join("settings.json"));

        env::remove_var(IDE_HOME_ENV);
        let _ = fs::remove_dir_all(home);
    }
}
