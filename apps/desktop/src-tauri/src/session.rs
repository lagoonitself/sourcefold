use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

static SESSION_PATH_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

/// The signed-in account, as the webview's Supabase client last reported it (`session_set`).
/// The webview keeps the Supabase session and refreshes it; this file only lets the extension
/// (`/api/session`, the native host) and Claude borrow the current access token. It never holds
/// the Supabase refresh token: sharing that would break Supabase's refresh-token rotation.
///
/// Files from before 2026-10-23 (`web_url` + an `sf_` token) don't parse, so they read as signed
/// out and the app asks to sign in again once.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub supabase_url: String,
    pub publishable_key: String,
    pub access_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    pub user_id: String,
    pub email: Option<String>,
    pub signed_in_at: String,
}

/// What the extension gets from `/api/session` and the native host's `get_session`.
pub fn session_json(session: Option<&Session>) -> Value {
    match session {
        Some(s) => json!({
            "signedIn": true,
            "supabaseUrl": s.supabase_url,
            "supabasePublishableKey": s.publishable_key,
            "accessToken": s.access_token,
            "expiresAt": s.expires_at,
            "userId": s.user_id,
            "email": s.email,
        }),
        None => json!({ "signedIn": false }),
    }
}

pub fn app_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Sourcefold")
}

pub fn set_session_path_override(path: Option<PathBuf>) {
    if let Ok(mut lock) = SESSION_PATH_OVERRIDE.write() {
        *lock = path;
    }
}

pub fn session_file_path() -> PathBuf {
    if let Ok(lock) = SESSION_PATH_OVERRIDE.read() {
        if let Some(p) = lock.as_ref() {
            return p.clone();
        }
    }
    if let Ok(env_path) = std::env::var("SOURCEFOLD_SESSION_FILE") {
        if !env_path.trim().is_empty() {
            return PathBuf::from(env_path);
        }
    }
    app_data_dir().join("session.json")
}

pub fn load_session() -> Option<Session> {
    load_session_from(&session_file_path())
}

pub fn load_session_from(path: &Path) -> Option<Session> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Session>(&content).ok()
}

pub fn save_session(session: &Session) -> io::Result<()> {
    save_session_to(&session_file_path(), session)
}

pub fn save_session_to(path: &Path, session: &Session) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_string_pretty(session)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    fs::write(path, data)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(path, perms);
    }

    Ok(())
}

pub fn clear_session() -> io::Result<()> {
    clear_session_from(&session_file_path())
}

pub fn clear_session_from(path: &Path) -> io::Result<()> {
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
pub static TEST_SESSION_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// A signed-in session for tests.
#[cfg(test)]
pub fn test_session() -> Session {
    Session {
        supabase_url: "https://project.supabase.co".to_string(),
        publishable_key: "sb_publishable_test".to_string(),
        access_token: "eyJ.test.token".to_string(),
        expires_at: 4_102_444_800,
        user_id: "00000000-0000-4000-8000-000000000001".to_string(),
        email: Some("user@example.com".to_string()),
        signed_in_at: "2026-10-23T00:00:00Z".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_load_and_clear_session() {
        let temp_dir = std::env::temp_dir().join(format!("sf_test_session_{}", uuid::Uuid::new_v4()));
        let session_file = temp_dir.join("session.json");

        assert_eq!(load_session_from(&session_file), None);

        let session = test_session();
        save_session_to(&session_file, &session).expect("failed to save session");

        let loaded = load_session_from(&session_file).expect("failed to load session");
        assert_eq!(loaded, session);

        clear_session_from(&session_file).expect("failed to clear session");
        assert_eq!(load_session_from(&session_file), None);

        // Clearing an already removed session should succeed
        assert!(clear_session_from(&session_file).is_ok());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn an_old_website_session_reads_as_signed_out() {
        let temp_dir = std::env::temp_dir().join(format!("sf_test_old_session_{}", uuid::Uuid::new_v4()));
        let session_file = temp_dir.join("session.json");
        fs::create_dir_all(&temp_dir).unwrap();
        fs::write(
            &session_file,
            r#"{"web_url":"https://web.sourcefold.app","token":"sf_abc","email":"a@b.c","signed_in_at":"2026-10-15T00:00:00Z"}"#,
        )
        .unwrap();
        assert_eq!(load_session_from(&session_file), None);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn the_extension_gets_the_access_token_and_never_a_refresh_token() {
        let value = session_json(Some(&test_session()));
        assert_eq!(value["signedIn"], true);
        assert_eq!(value["accessToken"], "eyJ.test.token");
        assert_eq!(value["supabaseUrl"], "https://project.supabase.co");
        assert_eq!(value["supabasePublishableKey"], "sb_publishable_test");
        assert_eq!(value["userId"], "00000000-0000-4000-8000-000000000001");
        assert!(value.get("refreshToken").is_none());
        assert_eq!(session_json(None), json!({ "signedIn": false }));
    }

    #[test]
    fn test_app_data_dir() {
        let dir = app_data_dir();
        assert!(dir.ends_with("Sourcefold"));
    }

    #[test]
    fn test_session_path_override() {
        let _guard = super::TEST_SESSION_MUTEX.lock().unwrap();
        let temp_dir = std::env::temp_dir().join(format!("sf_test_override_{}", uuid::Uuid::new_v4()));
        let session_file = temp_dir.join("injected_session.json");

        set_session_path_override(Some(session_file.clone()));
        assert_eq!(session_file_path(), session_file);

        let session = test_session();
        save_session(&session).expect("failed to save session with override");
        let loaded = load_session().expect("failed to load session with override");
        assert_eq!(loaded, session);

        clear_session().expect("failed to clear session with override");
        assert_eq!(load_session(), None);

        set_session_path_override(None);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
