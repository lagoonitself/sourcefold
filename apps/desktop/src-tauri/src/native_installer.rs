use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde_json::json;

pub const HOST_NAME: &str = "com.sourcefold.native";

/// `reg.exe` without a console window; otherwise every call flashes a terminal on screen.
fn reg_command() -> Command {
    let mut command = Command::new("reg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The pinned Sourcefold browser extension ID derived from the extension's stable public key
/// (`key` in `apps/extension/wxt.config.ts`).
pub const PINNED_EXTENSION_ID: &str = "ccgpcafkpkdfndhamegkcafmhfpkajml";

/// Returns all allowed extension IDs, including the pinned ID and any specified via
/// the `SOURCEFOLD_EXTENSION_IDS` environment variable.
pub fn allowed_extension_ids() -> Vec<String> {
    let mut ids = vec![PINNED_EXTENSION_ID.to_string()];

    if let Ok(env_val) = std::env::var("SOURCEFOLD_EXTENSION_IDS") {
        for part in env_val.split(',') {
            let trimmed = part.trim();
            if !trimmed.is_empty() && !ids.iter().any(|id| id == trimmed) {
                ids.push(trimmed.to_string());
            }
        }
    }

    ids
}

/// Checks whether a given extension ID is in the allowlist.
pub fn is_allowed_extension_id(id: &str) -> bool {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return false;
    }
    allowed_extension_ids().iter().any(|allowed| allowed == trimmed)
}

fn manifest_file_name() -> String {
    format!("{}.json", HOST_NAME)
}

/// Registry keys (HKCU) that point Chrome, Chromium and Edge at the host manifest on Windows.
pub fn windows_registry_keys() -> Vec<String> {
    [
        r"HKCU\Software\Google\Chrome\NativeMessagingHosts",
        r"HKCU\Software\Chromium\NativeMessagingHosts",
        r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts",
    ]
    .iter()
    .map(|base| format!(r"{}\{}", base, HOST_NAME))
    .collect()
}

/// Manifest locations for Chrome, Chromium and Microsoft Edge under `home` on macOS.
pub fn macos_manifest_paths_in(home: &Path) -> Vec<PathBuf> {
    let app_support = home.join("Library").join("Application Support");
    [
        app_support.join("Google").join("Chrome"),
        app_support.join("Chromium"),
        app_support.join("Microsoft Edge"),
    ]
    .into_iter()
    .map(|dir| dir.join("NativeMessagingHosts").join(manifest_file_name()))
    .collect()
}

/// Manifest locations for Chrome, Chromium and Microsoft Edge under `home` on Linux.
pub fn linux_manifest_paths_in(home: &Path) -> Vec<PathBuf> {
    let config = home.join(".config");
    ["google-chrome", "chromium", "microsoft-edge"]
        .iter()
        .map(|dir| config.join(dir).join("NativeMessagingHosts").join(manifest_file_name()))
        .collect()
}

/// Returns macOS native messaging manifest paths for Chrome, Chromium, and Microsoft Edge.
pub fn macos_manifest_paths() -> Vec<PathBuf> {
    dirs::home_dir()
        .map(|home| macos_manifest_paths_in(&home))
        .unwrap_or_default()
}

/// Every per-browser manifest location this platform installs to. Windows has none: it uses a
/// single manifest file plus registry keys.
fn browser_manifest_paths() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    if cfg!(windows) {
        Vec::new()
    } else if cfg!(target_os = "macos") {
        macos_manifest_paths_in(&home)
    } else {
        linux_manifest_paths_in(&home)
    }
}

/// Returns the path to the native messaging host manifest file.
pub fn get_manifest_path() -> PathBuf {
    if cfg!(windows) {
        dirs::data_local_dir()
            .or_else(dirs::data_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Sourcefold")
            .join(manifest_file_name())
    } else {
        browser_manifest_paths()
            .into_iter()
            .next()
            .unwrap_or_else(|| PathBuf::from(manifest_file_name()))
    }
}

/// Returns the directory where the manifest is stored.
pub fn get_manifest_dir() -> Result<PathBuf, String> {
    get_manifest_path()
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Failed to determine manifest directory".to_string())
}

/// Returns the path to the current executable.
pub fn get_host_binary_path() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("sourcefold-desktop.exe"))
}

/// Location of the macOS launcher script inside the app's data directory.
pub fn macos_wrapper_path(app_data: &Path) -> PathBuf {
    app_data.join(format!("{}.sh", HOST_NAME))
}

/// Location of the Windows launcher batch script next to the manifest.
pub fn windows_wrapper_path(manifest_dir: &Path) -> PathBuf {
    manifest_dir.join(format!("{}.bat", HOST_NAME))
}

/// Formats an extension ID or origin into the required `chrome-extension://<id>/` origin format.
pub fn normalize_origin(id_or_origin: &str) -> String {
    let trimmed = id_or_origin.trim();
    if trimmed.starts_with("chrome-extension://") {
        if trimmed.ends_with('/') {
            trimmed.to_string()
        } else {
            format!("{}/", trimmed)
        }
    } else {
        format!("chrome-extension://{}/", trimmed)
    }
}

/// Generates the shell script wrapper contents for macOS native messaging host execution.
pub fn generate_macos_wrapper_content(binary_path: &Path) -> String {
    format!(
        "#!/bin/sh\nexec \"{}\" --native-messaging \"$@\"\n",
        binary_path.to_string_lossy()
    )
}

/// Generates the batch script wrapper contents for Windows native messaging host execution.
pub fn generate_windows_wrapper_content(binary_path: &Path) -> String {
    format!(
        "@echo off\r\n\"{}\" --native-messaging %*\r\n",
        binary_path.to_string_lossy()
    )
}

/// Generates the manifest JSON structure for the Native Messaging Host.
pub fn generate_manifest_json(
    host_launch_path: &Path,
    allowed_origins: &[String],
) -> serde_json::Value {
    json!({
        "name": HOST_NAME,
        "description": "Sourcefold Desktop Native Messaging Host",
        "path": host_launch_path.to_string_lossy().to_string(),
        "type": "stdio",
        "allowed_origins": allowed_origins
    })
}

/// Picks the extension IDs the manifest will trust: only allowed IDs, whatever was requested.
fn effective_extension_ids(requested_extension_ids: &[String]) -> Vec<String> {
    if requested_extension_ids.is_empty() {
        allowed_extension_ids()
    } else {
        requested_extension_ids
            .iter()
            .filter(|id| is_allowed_extension_id(id))
            .map(|id| id.trim().to_string())
            .collect()
    }
}

/// Registers the Chrome / Chromium / Edge Native Messaging Host.
///
/// On Windows:
/// 1. Creates a launcher wrapper batch script (`com.sourcefold.native.bat`) in `%LOCALAPPDATA%/Sourcefold/`
///    passing `--native-messaging`.
/// 2. Writes the manifest JSON (`com.sourcefold.native.json`).
/// 3. Registers the manifest under the `HKCU\Software\{Google\Chrome,Chromium,Microsoft\Edge}\NativeMessagingHosts`
///    keys.
///
/// On macOS:
/// 1. Creates a launcher wrapper shell script (`com.sourcefold.native.sh`, chmod 755) in the app's data directory.
/// 2. Writes the manifest pointing to the wrapper script into the Chrome, Chromium, and Microsoft Edge directories.
pub fn install_native_host(requested_extension_ids: &[String]) -> Result<String, String> {
    let effective_ids = effective_extension_ids(requested_extension_ids);
    if effective_ids.is_empty() {
        return Err(
            "No allowed extension IDs available to register the native messaging host."
                .to_string(),
        );
    }

    let binary_path = get_host_binary_path();
    let manifest_path = get_manifest_path();
    let manifest_dir = manifest_path
        .parent()
        .ok_or_else(|| "Failed to determine manifest directory".to_string())?;

    fs::create_dir_all(manifest_dir).map_err(|e| {
        format!("Failed to create manifest directory {:?}: {}", manifest_dir, e)
    })?;

    let host_launch_path = if cfg!(windows) {
        // Chrome runs the executable in `path`; a .bat wrapper always passes `--native-messaging`.
        let bat_path = windows_wrapper_path(manifest_dir);
        fs::write(&bat_path, generate_windows_wrapper_content(&binary_path)).map_err(|e| {
            format!("Failed to write launcher batch script {:?}: {}", bat_path, e)
        })?;
        bat_path
    } else if cfg!(target_os = "macos") {
        let app_data = crate::session::app_data_dir();
        fs::create_dir_all(&app_data).map_err(|e| {
            format!("Failed to create app data directory {:?}: {}", app_data, e)
        })?;

        let sh_path = macos_wrapper_path(&app_data);
        fs::write(&sh_path, generate_macos_wrapper_content(&binary_path)).map_err(|e| {
            format!("Failed to write launcher shell script {:?}: {}", sh_path, e)
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&sh_path, fs::Permissions::from_mode(0o755)).map_err(|e| {
                format!("Failed to make launcher script executable {:?}: {}", sh_path, e)
            })?;
        }

        sh_path
    } else {
        binary_path
    };

    let mut origins: Vec<String> = effective_ids.iter().map(|id| normalize_origin(id)).collect();
    origins.sort();
    origins.dedup();

    let manifest = generate_manifest_json(&host_launch_path, &origins);
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

    fs::write(&manifest_path, &manifest_bytes).map_err(|e| {
        format!("Failed to write manifest file {:?}: {}", manifest_path, e)
    })?;

    // Other browsers (macOS / Linux) get their own copy; best effort, the first one is mandatory.
    for path in browser_manifest_paths() {
        if path == manifest_path {
            continue;
        }
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, &manifest_bytes);
    }

    if cfg!(windows) {
        let manifest_path_str = manifest_path.to_string_lossy().to_string();
        for key in windows_registry_keys() {
            let status = reg_command()
                .args(["add", &key, "/ve", "/t", "REG_SZ", "/d", &manifest_path_str, "/f"])
                .status();

            match status {
                Ok(s) if s.success() => {}
                Ok(s) => {
                    return Err(format!(
                        "reg.exe failed with exit code {:?} while adding {}",
                        s.code(),
                        key
                    ));
                }
                Err(e) => {
                    return Err(format!("Failed to execute reg.exe for {}: {}", key, e));
                }
            }
        }
    }

    Ok(format!("Native messaging host successfully registered at {:?}", manifest_path))
}

/// Checks if the Native Messaging Host is currently installed and registered.
pub fn is_native_host_installed() -> bool {
    let manifest_path = get_manifest_path();
    if !manifest_path.exists() {
        return false;
    }

    if cfg!(windows) {
        // Query the Chrome registry key to confirm it points to an existing manifest
        let chrome_key = windows_registry_keys().into_iter().next().unwrap_or_default();
        reg_command()
            .args(["query", &chrome_key, "/ve"])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    } else {
        true
    }
}

/// Deletes every file in `paths` that exists; a missing file is not an error.
pub fn remove_existing_files(paths: &[PathBuf]) {
    for path in paths {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
}

/// Files that `install_native_host` creates on this machine (manifests and launcher scripts).
fn installed_files() -> Vec<PathBuf> {
    let manifest_path = get_manifest_path();
    let mut files = vec![manifest_path.clone()];
    files.extend(browser_manifest_paths());
    if cfg!(windows) {
        if let Some(dir) = manifest_path.parent() {
            files.push(windows_wrapper_path(dir));
        }
    } else if cfg!(target_os = "macos") {
        files.push(macos_wrapper_path(&crate::session::app_data_dir()));
    }
    files
}

/// Uninstalls / unregisters the Native Messaging Host from every browser it was installed to.
pub fn uninstall_native_host() -> Result<(), String> {
    remove_existing_files(&installed_files());

    if cfg!(windows) {
        for key in windows_registry_keys() {
            let _ = reg_command().args(["delete", &key, "/f"]).status();
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_path() {
        let path = get_manifest_path();
        assert!(path.to_string_lossy().contains("com.sourcefold.native.json"));
    }

    #[test]
    fn test_normalize_origin() {
        assert_eq!(
            normalize_origin("abcdefghijklmnop"),
            "chrome-extension://abcdefghijklmnop/"
        );
        assert_eq!(
            normalize_origin("chrome-extension://abcdefghijklmnop"),
            "chrome-extension://abcdefghijklmnop/"
        );
        assert_eq!(
            normalize_origin("chrome-extension://abcdefghijklmnop/"),
            "chrome-extension://abcdefghijklmnop/"
        );
    }

    #[test]
    fn test_allowed_extension_ids() {
        let ids = allowed_extension_ids();
        assert!(ids.contains(&PINNED_EXTENSION_ID.to_string()));
        assert!(is_allowed_extension_id(PINNED_EXTENSION_ID));
        assert!(is_allowed_extension_id(&format!("  {}  ", PINNED_EXTENSION_ID)));
        assert!(!is_allowed_extension_id("malicious_extension_id_here"));
        assert!(!is_allowed_extension_id(""));
    }

    #[test]
    fn test_effective_extension_ids_drops_unknown_ids() {
        assert_eq!(effective_extension_ids(&[]), allowed_extension_ids());

        let requested = vec!["attacker".to_string(), PINNED_EXTENSION_ID.to_string()];
        assert_eq!(
            effective_extension_ids(&requested),
            vec![PINNED_EXTENSION_ID.to_string()]
        );

        assert!(effective_extension_ids(&["attacker".to_string()]).is_empty());
    }

    #[test]
    fn test_generate_macos_wrapper_content() {
        let bin = Path::new("/Applications/Sourcefold.app/Contents/MacOS/sourcefold-desktop");
        let content = generate_macos_wrapper_content(bin);
        assert_eq!(
            content,
            "#!/bin/sh\nexec \"/Applications/Sourcefold.app/Contents/MacOS/sourcefold-desktop\" --native-messaging \"$@\"\n"
        );
        assert!(content.starts_with("#!/bin/sh\n"));
    }

    #[test]
    fn test_generate_windows_wrapper_content() {
        let bin = Path::new(r"C:\Program Files\Sourcefold\sourcefold-desktop.exe");
        assert_eq!(
            generate_windows_wrapper_content(bin),
            "@echo off\r\n\"C:\\Program Files\\Sourcefold\\sourcefold-desktop.exe\" --native-messaging %*\r\n"
        );
    }

    #[test]
    fn test_wrapper_paths() {
        assert_eq!(
            macos_wrapper_path(Path::new("/data")),
            Path::new("/data").join("com.sourcefold.native.sh")
        );
        assert_eq!(
            windows_wrapper_path(Path::new("/data")),
            Path::new("/data").join("com.sourcefold.native.bat")
        );
    }

    #[test]
    fn test_generate_manifest_json() {
        let launch_path = Path::new("/test/path/com.sourcefold.native.sh");
        let origins = vec![normalize_origin(PINNED_EXTENSION_ID)];
        let manifest = generate_manifest_json(launch_path, &origins);

        assert_eq!(manifest["name"], "com.sourcefold.native");
        assert_eq!(manifest["description"], "Sourcefold Desktop Native Messaging Host");
        assert_eq!(manifest["path"], "/test/path/com.sourcefold.native.sh");
        assert_eq!(manifest["type"], "stdio");
        assert_eq!(
            manifest["allowed_origins"],
            json!(["chrome-extension://ccgpcafkpkdfndhamegkcafmhfpkajml/"])
        );
    }

    #[test]
    fn test_macos_manifest_paths_cover_every_browser() {
        let paths = macos_manifest_paths_in(Path::new("/Users/me"));
        let as_text: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();
        assert_eq!(
            as_text,
            vec![
                "/Users/me/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sourcefold.native.json",
                "/Users/me/Library/Application Support/Chromium/NativeMessagingHosts/com.sourcefold.native.json",
                "/Users/me/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.sourcefold.native.json",
            ]
        );
    }

    #[test]
    fn test_linux_manifest_paths_cover_every_browser() {
        let paths = linux_manifest_paths_in(Path::new("/home/me"));
        let as_text: Vec<String> = paths
            .iter()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();
        assert_eq!(
            as_text,
            vec![
                "/home/me/.config/google-chrome/NativeMessagingHosts/com.sourcefold.native.json",
                "/home/me/.config/chromium/NativeMessagingHosts/com.sourcefold.native.json",
                "/home/me/.config/microsoft-edge/NativeMessagingHosts/com.sourcefold.native.json",
            ]
        );
    }

    #[test]
    fn test_windows_registry_keys_cover_every_browser() {
        assert_eq!(
            windows_registry_keys(),
            vec![
                r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.sourcefold.native",
                r"HKCU\Software\Chromium\NativeMessagingHosts\com.sourcefold.native",
                r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.sourcefold.native",
            ]
        );
    }

    #[test]
    fn test_remove_existing_files_ignores_missing() {
        let dir = std::env::temp_dir().join(format!("sf_native_rm_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let present = dir.join("present.json");
        let missing = dir.join("missing.json");
        fs::write(&present, b"{}").unwrap();

        remove_existing_files(&[present.clone(), missing]);

        assert!(!present.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
