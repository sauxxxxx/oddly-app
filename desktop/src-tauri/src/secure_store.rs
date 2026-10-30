//! Stores the Supabase session in the OS keychain (Windows Credential Manager,
//! macOS Keychain, Secret Service on Linux) instead of browser localStorage.
//!
//! Windows caps a credential at 2560 bytes and a session is larger than that, so
//! values are split across `<key>.0`, `<key>.1`, … with `<key>` holding the chunk count.

use keyring::{Entry, Error};

const SERVICE: &str = "com.oddly.desktop";
/// Characters per chunk. Credential Manager stores UTF-16, so 1000 chars stays
/// below the 2560-byte limit for ASCII values such as JWTs.
const CHUNK_CHARS: usize = 1000;

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Keys come from the web layer, so keep them to a known, harmless shape.
fn check_key(key: &str) -> Result<(), String> {
    let ok = key.starts_with("oddly.")
        && key.len() <= 100
        && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if ok {
        Ok(())
    } else {
        Err("invalid storage key".into())
    }
}

fn chunk_count(key: &str) -> Result<Option<usize>, String> {
    match entry(key)?.get_password() {
        Ok(head) => Ok(head.strip_prefix("chunks:").and_then(|n| n.parse().ok())),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secure_get(key: String) -> Result<Option<String>, String> {
    check_key(&key)?;
    let Some(count) = chunk_count(&key)? else {
        return Ok(None);
    };

    let mut value = String::new();
    for i in 0..count {
        match entry(&format!("{key}.{i}"))?.get_password() {
            Ok(part) => value.push_str(&part),
            // A missing chunk means a half-written value; treat it as absent.
            Err(Error::NoEntry) => return Ok(None),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(Some(value))
}

#[tauri::command]
pub fn secure_set(key: String, value: String) -> Result<(), String> {
    check_key(&key)?;
    let previous = chunk_count(&key)?.unwrap_or(0);

    let chars: Vec<char> = value.chars().collect();
    let chunks: Vec<String> = chars.chunks(CHUNK_CHARS).map(|c| c.iter().collect()).collect();

    for (i, chunk) in chunks.iter().enumerate() {
        entry(&format!("{key}.{i}"))?.set_password(chunk).map_err(|e| e.to_string())?;
    }
    entry(&key)?.set_password(&format!("chunks:{}", chunks.len())).map_err(|e| e.to_string())?;

    for i in chunks.len()..previous {
        let _ = entry(&format!("{key}.{i}"))?.delete_credential();
    }
    Ok(())
}

#[tauri::command]
pub fn secure_delete(key: String) -> Result<(), String> {
    check_key(&key)?;
    let count = chunk_count(&key)?.unwrap_or(0);
    for i in 0..count {
        let _ = entry(&format!("{key}.{i}"))?.delete_credential();
    }
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
