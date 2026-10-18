//! Settings → Claude → "Add to Claude Desktop". Finds the `Sourcefold-Claude.mcpb` extension bundle
//! and opens it with the system, which hands it to Claude Desktop's install dialog.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;

const BUNDLE_NAME: &str = "Sourcefold-Claude.mcpb";
const DOWNLOAD_URL: &str =
    "https://github.com/lagoonitself/sourcefold/releases/latest/download/Sourcefold-Claude.mcpb";
const MAX_BUNDLE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_REDIRECTS: usize = 10;

const DOWNLOAD_FAILED: &str =
    "Couldn't download the Claude extension. Check your connection and try again.";
const OPEN_FAILED: &str =
    "Couldn't open the Claude extension. Install Claude Desktop first: claude.com/download";

/// Where the bundle came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BundleSource {
    /// Shipped inside the app (release builds).
    Bundled,
    /// Built in this repository (debug builds only).
    Dev,
    /// Downloaded from the latest release.
    Downloaded,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeExtensionOpened {
    pub source: BundleSource,
}

/// The first bundle that already exists on this computer: the app's resource folder, then (debug
/// builds pass one) the repository's build output. Nothing is downloaded here.
pub fn find_local_bundle(
    resource_dir: Option<&Path>,
    dev_bundle: Option<&Path>,
) -> Option<(PathBuf, BundleSource)> {
    if let Some(dir) = resource_dir {
        let path = dir.join(BUNDLE_NAME);
        if path.is_file() {
            return Some((path, BundleSource::Bundled));
        }
    }
    if let Some(path) = dev_bundle {
        if path.is_file() {
            return Some((path.to_path_buf(), BundleSource::Dev));
        }
    }
    None
}

/// `apps/mcp/dist/Sourcefold-Claude.mcpb` next to this source tree. Release builds never look there.
#[cfg(debug_assertions)]
fn dev_bundle_path() -> Option<PathBuf> {
    Some(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("mcp")
            .join("dist")
            .join(BUNDLE_NAME),
    )
}

#[cfg(not(debug_assertions))]
fn dev_bundle_path() -> Option<PathBuf> {
    None
}

/// Downloads `url` into a new folder under `parent` and returns the file's path. Follows redirects
/// (a release download is one), refuses more than `max_bytes`, and checks the file is a zip (an
/// `.mcpb` is one) so an error page is never handed to Claude Desktop.
async fn download_bundle(
    url: &str,
    parent: &Path,
    max_bytes: u64,
    https_only: bool,
) -> Result<PathBuf, String> {
    if https_only && !url.starts_with("https://") {
        return Err("The download must use https.".to_string());
    }
    let redirect = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS || (https_only && attempt.url().scheme() != "https")
        {
            attempt.stop()
        } else {
            attempt.follow()
        }
    });
    let client = reqwest::Client::builder()
        .redirect(redirect)
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Sourcefold-Desktop")
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("The download answered {}.", response.status()));
    }
    if response.content_length().is_some_and(|len| len > max_bytes) {
        return Err("The download is too large.".to_string());
    }

    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() as u64 + chunk.len() as u64 > max_bytes {
            return Err("The download is too large.".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    if !body.starts_with(b"PK") {
        return Err("The download isn't an extension bundle.".to_string());
    }

    let dir = parent.join(format!("sourcefold-claude-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(BUNDLE_NAME);
    std::fs::write(&path, &body).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub async fn open_claude_extension(app: tauri::AppHandle) -> Result<ClaudeExtensionOpened, String> {
    use tauri_plugin_opener::OpenerExt;

    let resource_dir = app.path().resource_dir().ok();
    let dev_bundle = dev_bundle_path();

    let (path, source) = match find_local_bundle(resource_dir.as_deref(), dev_bundle.as_deref()) {
        Some(found) => found,
        None => {
            let path = download_bundle(DOWNLOAD_URL, &std::env::temp_dir(), MAX_BUNDLE_BYTES, true)
                .await
                .map_err(|e| {
                    eprintln!("[Sourcefold] Claude extension download failed: {}", e);
                    DOWNLOAD_FAILED.to_string()
                })?;
            (path, BundleSource::Downloaded)
        }
    };

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| {
            eprintln!("[Sourcefold] Couldn't open {}: {}", path.display(), e);
            OPEN_FAILED.to_string()
        })?;

    Ok(ClaudeExtensionOpened { source })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::Arc;
    use tiny_http::{Header, Response, Server, StatusCode};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sf_claude_{}_{}", name, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn looks_in_the_resource_folder_first_then_the_dev_build() {
        let resources = temp_dir("res");
        let dist = temp_dir("dist");
        let dev = dist.join(BUNDLE_NAME);

        // Nothing anywhere.
        assert_eq!(find_local_bundle(Some(&resources), Some(&dev)), None);
        assert_eq!(find_local_bundle(None, None), None);

        // Only the dev build.
        std::fs::write(&dev, b"PK dev").unwrap();
        assert_eq!(find_local_bundle(Some(&resources), Some(&dev)), Some((dev.clone(), BundleSource::Dev)));
        // A release build passes no dev path and so never uses it.
        assert_eq!(find_local_bundle(Some(&resources), None), None);

        // Both: the bundled one wins.
        let bundled = resources.join(BUNDLE_NAME);
        std::fs::write(&bundled, b"PK bundled").unwrap();
        assert_eq!(
            find_local_bundle(Some(&resources), Some(&dev)),
            Some((bundled.clone(), BundleSource::Bundled))
        );

        // A folder with the bundle's name doesn't count.
        std::fs::remove_file(&bundled).unwrap();
        std::fs::create_dir(&bundled).unwrap();
        assert_eq!(find_local_bundle(Some(&resources), Some(&dev)), Some((dev, BundleSource::Dev)));

        let _ = std::fs::remove_dir_all(&resources);
        let _ = std::fs::remove_dir_all(&dist);
    }

    #[test]
    fn source_names_match_the_frontend() {
        assert_eq!(serde_json::to_value(BundleSource::Bundled).unwrap(), "bundled");
        assert_eq!(serde_json::to_value(BundleSource::Dev).unwrap(), "dev");
        assert_eq!(serde_json::to_value(BundleSource::Downloaded).unwrap(), "downloaded");
        let reply = serde_json::to_value(ClaudeExtensionOpened { source: BundleSource::Dev }).unwrap();
        assert_eq!(reply, serde_json::json!({ "source": "dev" }));
    }

    /// Serves `/bundle` (a zip-looking file), `/old` (a redirect to it), `/page` (not a zip),
    /// `/big` (too large for the test's cap) and 404 for everything else, on a free local port.
    fn serve(requests: usize) -> (String, Arc<Server>) {
        let server = Arc::new(Server::http("127.0.0.1:0").unwrap());
        let base = format!("http://127.0.0.1:{}", server.server_addr().to_ip().unwrap().port());
        let worker = server.clone();
        std::thread::spawn(move || {
            for _ in 0..requests {
                let Ok(request) = worker.recv() else { break };
                let response: Response<Cursor<Vec<u8>>> = match request.url() {
                    "/bundle" => Response::from_data(b"PK\x03\x04 bundle".to_vec()),
                    "/page" => Response::from_data(b"<html>not found</html>".to_vec()),
                    "/big" => Response::from_data(vec![b'P'; 4096]),
                    "/old" => Response::new(
                        StatusCode(302),
                        vec![Header::from_bytes(&b"Location"[..], &b"/bundle"[..]).unwrap()],
                        Cursor::new(Vec::new()),
                        Some(0),
                        None,
                    ),
                    _ => Response::from_data(Vec::new()).with_status_code(404),
                };
                let _ = request.respond(response);
            }
        });
        (base, server)
    }

    #[tokio::test]
    async fn downloads_follows_redirects_and_checks_the_file() {
        let parent = temp_dir("dl");
        let (base, _server) = serve(6);

        let path = download_bundle(&format!("{}/bundle", base), &parent, 1024, false).await.unwrap();
        assert!(path.starts_with(&parent));
        assert_eq!(path.file_name().unwrap(), BUNDLE_NAME);
        assert_eq!(std::fs::read(&path).unwrap(), b"PK\x03\x04 bundle");

        let via_redirect = download_bundle(&format!("{}/old", base), &parent, 1024, false).await.unwrap();
        assert_eq!(std::fs::read(&via_redirect).unwrap(), b"PK\x03\x04 bundle");
        assert_ne!(via_redirect, path);

        assert!(download_bundle(&format!("{}/missing", base), &parent, 1024, false).await.is_err());
        assert!(download_bundle(&format!("{}/page", base), &parent, 1024, false).await.is_err());
        assert!(download_bundle(&format!("{}/big", base), &parent, 1000, false).await.is_err());

        // Plain http is refused when https is required.
        assert!(download_bundle(&format!("{}/bundle", base), &parent, 1024, true).await.is_err());

        let _ = std::fs::remove_dir_all(&parent);
    }
}
