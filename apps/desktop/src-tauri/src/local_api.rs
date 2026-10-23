//! Rust's way into the local API. Signed in, the desktop app answers the website's `/api/*` itself
//! with `createLocalApi` from `packages/client`, which runs in the webview because it is the
//! website's TypeScript code (docs/dev/handoff-no-website.md). Rust code that needs it (the local
//! copy) emits `local-api-request`; the webview runs the request and answers with the
//! `local_api_respond` command (commands/local_api.rs), raw body bytes plus id, status and content
//! type in headers.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

pub const REQUEST_EVENT: &str = "local-api-request";
pub const ID_HEADER: &str = "x-local-api-id";
pub const STATUS_HEADER: &str = "x-local-api-status";
pub const CONTENT_TYPE_HEADER: &str = "x-local-api-content-type";

/// Reading a file back from Drive can take a while; nothing waits forever.
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalApiResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

impl LocalApiResponse {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RequestEvent {
    id: u64,
    method: String,
    path: String,
    body: Option<String>,
}

#[derive(Default)]
pub struct LocalApiBridge {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<LocalApiResponse>>>,
}

impl LocalApiBridge {
    fn pending(&self) -> std::sync::MutexGuard<'_, HashMap<u64, oneshot::Sender<LocalApiResponse>>> {
        match self.pending.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    pub fn register(&self) -> (u64, oneshot::Receiver<LocalApiResponse>) {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending().insert(id, tx);
        (id, rx)
    }

    /// Hands the answer to the waiting caller. False for an unknown or already finished id.
    pub fn resolve(&self, id: u64, response: LocalApiResponse) -> bool {
        match self.pending().remove(&id) {
            Some(tx) => tx.send(response).is_ok(),
            None => false,
        }
    }

    pub fn forget(&self, id: u64) {
        self.pending().remove(&id);
    }
}

/// Runs `method path` through the webview's local API. `body` is a JSON string.
pub async fn call(
    app: &AppHandle,
    method: &str,
    path: &str,
    body: Option<String>,
) -> Result<LocalApiResponse, String> {
    let bridge = app.state::<LocalApiBridge>();
    let (id, rx) = bridge.register();
    let event = RequestEvent {
        id,
        method: method.to_string(),
        path: path.to_string(),
        body,
    };
    if let Err(err) = app.emit(REQUEST_EVENT, event) {
        bridge.forget(id);
        return Err(format!("Couldn't reach the app window: {}", err));
    }
    match tokio::time::timeout(TIMEOUT, rx).await {
        Ok(Ok(response)) => Ok(response),
        Ok(Err(_)) => Err("The app window stopped answering.".to_string()),
        Err(_) => {
            bridge.forget(id);
            Err("The app window didn't answer in time.".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(body: &str) -> LocalApiResponse {
        LocalApiResponse {
            status: 200,
            content_type: Some("application/json".into()),
            body: body.as_bytes().to_vec(),
        }
    }

    #[test]
    fn answers_reach_the_caller_that_asked() {
        let bridge = LocalApiBridge::default();
        let (a, mut rx_a) = bridge.register();
        let (b, mut rx_b) = bridge.register();
        assert_ne!(a, b);

        assert!(bridge.resolve(b, ok("b")));
        assert!(bridge.resolve(a, ok("a")));
        assert_eq!(rx_a.try_recv().unwrap().text(), "a");
        assert_eq!(rx_b.try_recv().unwrap().text(), "b");
    }

    #[test]
    fn an_answer_counts_once_and_late_answers_are_dropped() {
        let bridge = LocalApiBridge::default();
        let (id, _rx) = bridge.register();
        assert!(bridge.resolve(id, ok("first")));
        assert!(!bridge.resolve(id, ok("second")));

        let (late, _rx) = bridge.register();
        bridge.forget(late);
        assert!(!bridge.resolve(late, ok("too late")));
        assert!(!bridge.resolve(999, ok("never asked")));
    }

    #[test]
    fn success_is_2xx() {
        let mut r = ok("");
        assert!(r.is_success());
        r.status = 204;
        assert!(r.is_success());
        r.status = 401;
        assert!(!r.is_success());
    }
}
