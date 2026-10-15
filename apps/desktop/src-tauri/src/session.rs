use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use serde::{Deserialize, Serialize};

static SESSION_PATH_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub web_url: String,
    pub token: String,
    pub email: Option<String>,
    pub signed_in_at: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_save_load_and_clear_session() {
        let temp_dir = std::env::temp_dir().join(format!("sf_test_session_{}", uuid::Uuid::new_v4()));
        let session_file = temp_dir.join("session.json");

        assert_eq!(load_session_from(&session_file), None);

        let session = Session {
            web_url: "https://test.sourcefold.app".to_string(),
            token: "sf_test_token_12345".to_string(),
            email: Some("user@example.com".to_string()),
            signed_in_at: "2026-10-15T00:00:00Z".to_string(),
        };

        save_session_to(&session_file, &session).expect("failed to save session");

        let loaded = load_session_from(&session_file).expect("failed to load session");
        assert_eq!(loaded, session);

        clear_session_from(&session_file).expect("failed to clear session");
        assert_eq!(load_session_from(&session_file), None);

        // Clearing an already removed session should succeed
        assert!(clear_session_from(&session_file).is_ok());

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
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

        let session = Session {
            web_url: "https://override.sourcefold.app".to_string(),
            token: "token_override_xyz".to_string(),
            email: Some("injected@example.com".to_string()),
            signed_in_at: "2026-10-15T12:00:00Z".to_string(),
        };

        save_session(&session).expect("failed to save session with override");
        let loaded = load_session().expect("failed to load session with override");
        assert_eq!(loaded, session);

        clear_session().expect("failed to clear session with override");
        assert_eq!(load_session(), None);

        set_session_path_override(None);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
