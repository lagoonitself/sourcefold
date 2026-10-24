//! The model that writes TL;DRs (docs/dev/PLAN-tldr.md). Three ways in, picked in Settings → TL;DR:
//!
//! - **ChatGPT**: Sign in with ChatGPT, using the user's ChatGPT plan (`chatgpt.rs`).
//! - **OpenRouter** and **OpenCode** (Zen): an API key the user pastes (`openai_compat.rs`).
//!
//! Secrets (ChatGPT tokens, API keys) live only in files in the app data folder and are never
//! returned to the webview: it sees `AiStatus`, model lists and finished answers.

pub mod chatgpt;
pub mod openai_compat;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

const SETTINGS_FILE: &str = "ai_settings.json";
const KEYS_FILE: &str = "ai_keys.json";
pub(crate) const USER_AGENT: &str = concat!("Sourcefold/", env!("CARGO_PKG_VERSION"));

static DIR_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

/// Tests point every AI file at a temporary folder.
pub fn set_dir_override(path: Option<PathBuf>) {
    if let Ok(mut lock) = DIR_OVERRIDE.write() {
        *lock = path;
    }
}

pub(crate) fn data_dir() -> PathBuf {
    if let Ok(lock) = DIR_OVERRIDE.read() {
        if let Some(p) = lock.as_ref() {
            return p.clone();
        }
    }
    crate::session::app_data_dir()
}

pub(crate) fn read_json<T: for<'de> Deserialize<'de>>(name: &str) -> Option<T> {
    let text = fs::read_to_string(data_dir().join(name)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Writes through a temporary file, so a crash never leaves half a file.
pub(crate) fn write_json<T: Serialize>(name: &str, value: &T) -> Result<(), String> {
    let path = data_dir().join(name);
    write_json_at(&path, value)
}

fn write_json_at<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Chatgpt,
    Openrouter,
    Opencode,
}

impl Provider {
    pub fn parse(value: &str) -> Result<Provider, AiError> {
        match value {
            "chatgpt" => Ok(Provider::Chatgpt),
            "openrouter" => Ok(Provider::Openrouter),
            "opencode" => Ok(Provider::Opencode),
            _ => Err(AiError::bad_request("Unknown provider.")),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Chatgpt => "ChatGPT",
            Provider::Openrouter => "OpenRouter",
            Provider::Opencode => "OpenCode",
        }
    }
}

/// A model the user picked: the id sent to the provider and the name shown ("Written by …").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelChoice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiSettings {
    #[serde(default)]
    pub provider: Option<Provider>,
    #[serde(default)]
    pub chatgpt_model: Option<ModelChoice>,
    #[serde(default)]
    pub openrouter_model: Option<ModelChoice>,
    #[serde(default)]
    pub opencode_model: Option<ModelChoice>,
}

impl AiSettings {
    pub fn load() -> AiSettings {
        read_json(SETTINGS_FILE).unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        write_json(SETTINGS_FILE, self)
    }

    pub fn model(&self, provider: Provider) -> Option<&ModelChoice> {
        match provider {
            Provider::Chatgpt => self.chatgpt_model.as_ref(),
            Provider::Openrouter => self.openrouter_model.as_ref(),
            Provider::Opencode => self.opencode_model.as_ref(),
        }
    }

    pub fn set_model(&mut self, provider: Provider, model: Option<ModelChoice>) {
        match provider {
            Provider::Chatgpt => self.chatgpt_model = model,
            Provider::Openrouter => self.openrouter_model = model,
            Provider::Opencode => self.opencode_model = model,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiKeys {
    #[serde(default)]
    pub openrouter: Option<String>,
    #[serde(default)]
    pub opencode: Option<String>,
}

impl ApiKeys {
    pub fn load() -> ApiKeys {
        read_json(KEYS_FILE).unwrap_or_default()
    }

    pub fn get(&self, provider: Provider) -> Option<&str> {
        match provider {
            Provider::Openrouter => self.openrouter.as_deref(),
            Provider::Opencode => self.opencode.as_deref(),
            Provider::Chatgpt => None,
        }
        .filter(|k| !k.is_empty())
    }

    pub fn set(provider: Provider, key: Option<String>) -> Result<(), String> {
        let mut keys = ApiKeys::load();
        match provider {
            Provider::Openrouter => keys.openrouter = key,
            Provider::Opencode => keys.opencode = key,
            Provider::Chatgpt => return Err("ChatGPT uses sign-in, not a key.".into()),
        }
        write_json(KEYS_FILE, &keys)
    }
}

/// Checks a pasted key: trimmed, one line, printable, a sane length.
pub fn normalize_api_key(raw: &str) -> Result<String, AiError> {
    let key = raw.trim().trim_matches('"').trim();
    let key = key.strip_prefix("Bearer ").unwrap_or(key).trim();
    if key.is_empty() {
        return Err(AiError::bad_request("Paste the API key."));
    }
    if key.len() > 400 || key.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AiError::bad_request("That doesn't look like an API key."));
    }
    Ok(key.to_string())
}

/// The last 4 characters of a key, for "Key ending in …".
fn key_hint(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// What the webview sees. Never a token or a key.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProviderStatus {
    pub id: Provider,
    pub name: &'static str,
    /// Signed in (ChatGPT) or a key is saved (the others).
    pub connected: bool,
    /// The ChatGPT account's email, or "Key ending in abcd".
    pub account: Option<String>,
    /// ChatGPT only: whether "Use your ChatGPT plan" was allowed on the consent page.
    pub plan_usage: Option<bool>,
    pub model: Option<ModelChoice>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AiStatus {
    /// The provider TL;DRs are written with, if any is picked.
    pub provider: Option<Provider>,
    /// True when the picked provider is connected and can be used.
    pub ready: bool,
    pub providers: Vec<ProviderStatus>,
}

pub fn status() -> AiStatus {
    let settings = AiSettings::load();
    let keys = ApiKeys::load();
    let chat = chatgpt::account();
    let providers = vec![
        ProviderStatus {
            id: Provider::Chatgpt,
            name: Provider::Chatgpt.label(),
            connected: chat.is_some(),
            account: chat.as_ref().and_then(|a| a.email.clone()),
            plan_usage: chat.as_ref().map(|a| a.plan_usage),
            model: settings.chatgpt_model.clone(),
        },
        ProviderStatus {
            id: Provider::Openrouter,
            name: Provider::Openrouter.label(),
            connected: keys.get(Provider::Openrouter).is_some(),
            account: keys.get(Provider::Openrouter).map(|k| format!("Key ending in {}", key_hint(k))),
            plan_usage: None,
            model: settings.openrouter_model.clone(),
        },
        ProviderStatus {
            id: Provider::Opencode,
            name: Provider::Opencode.label(),
            connected: keys.get(Provider::Opencode).is_some(),
            account: keys.get(Provider::Opencode).map(|k| format!("Key ending in {}", key_hint(k))),
            plan_usage: None,
            model: settings.opencode_model.clone(),
        },
    ];
    let ready = settings
        .provider
        .and_then(|p| providers.iter().find(|s| s.id == p))
        .map(|s| s.connected && s.plan_usage != Some(false))
        .unwrap_or(false);
    AiStatus { provider: settings.provider, ready, providers }
}

/// Picks the provider when none is picked yet (the first one the user connects).
pub fn adopt_provider_if_unset(provider: Provider) -> Result<(), String> {
    let mut settings = AiSettings::load();
    if settings.provider.is_none() {
        settings.provider = Some(provider);
        settings.save()?;
    }
    Ok(())
}

/// One model in a provider's list.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    /// Costs nothing to use (OpenRouter `:free` and zero-priced models, OpenCode `-free` models).
    pub free: bool,
    /// Price in US dollars per million input and output tokens, when the provider lists it.
    pub price_in: Option<f64>,
    pub price_out: Option<f64>,
    pub context: Option<u64>,
}

/// What failed, so the webview knows whether to pause, retry or ask the user to act.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AiError {
    /// `not_configured`, `auth`, `not_eligible`, `limit`, `unavailable`, `bad_request`,
    /// `cancelled`, `network` or `other`.
    pub code: &'static str,
    pub message: String,
    /// Seconds to wait before trying again, when the provider said.
    pub retry_after: Option<u64>,
}

impl AiError {
    pub fn new(code: &'static str, message: impl Into<String>) -> AiError {
        AiError { code, message: message.into(), retry_after: None }
    }
    pub fn bad_request(message: impl Into<String>) -> AiError {
        AiError::new("bad_request", message)
    }
    pub fn other(message: impl Into<String>) -> AiError {
        AiError::new("other", message)
    }
    pub fn network(err: impl std::fmt::Display) -> AiError {
        AiError::new("network", format!("Couldn't reach the AI service: {}", err))
    }
}

impl From<String> for AiError {
    fn from(message: String) -> AiError {
        AiError::other(message)
    }
}

/// A finished answer.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Completion {
    pub text: String,
    /// The model's name, for "Written by …".
    pub model: String,
    pub provider: Provider,
}

/// The model to use: the one picked, or a sensible default from the provider's list (saved, so
/// the user sees it in Settings).
async fn model_for(provider: Provider) -> Result<ModelChoice, AiError> {
    let mut settings = AiSettings::load();
    if let Some(model) = settings.model(provider) {
        return Ok(model.clone());
    }
    let models = list_models(provider).await?;
    let pick = default_model(provider, &models)
        .ok_or_else(|| AiError::new("not_configured", format!("Pick a model for {} in Settings → TL;DR.", provider.label())))?;
    let choice = ModelChoice { id: pick.id.clone(), name: pick.name.clone() };
    settings.set_model(provider, Some(choice.clone()));
    settings.save()?;
    Ok(choice)
}

/// GPT-6 Luna when the list has it (fast and cheap, made for summaries); on OpenCode, else the
/// first free model; otherwise the first in the list.
pub fn default_model(provider: Provider, models: &[ModelInfo]) -> Option<ModelInfo> {
    let luna = models.iter().find(|m| m.id.contains("gpt-6-luna") || m.id.ends_with("luna"));
    if let Some(m) = luna {
        return Some(m.clone());
    }
    if provider != Provider::Chatgpt {
        if let Some(m) = models.iter().find(|m| m.free) {
            return Some(m.clone());
        }
    }
    models.first().cloned()
}

pub async fn list_models(provider: Provider) -> Result<Vec<ModelInfo>, AiError> {
    match provider {
        Provider::Chatgpt => chatgpt::list_models().await,
        Provider::Openrouter | Provider::Opencode => {
            let keys = ApiKeys::load();
            openai_compat::list_models(provider, keys.get(provider)).await
        }
    }
}

/// Sends `instructions` and `input` to the picked provider and model.
pub async fn complete(instructions: &str, input: &str) -> Result<Completion, AiError> {
    let provider = AiSettings::load()
        .provider
        .ok_or_else(|| AiError::new("not_configured", "Pick how TL;DRs are written in Settings → TL;DR."))?;
    let model = model_for(provider).await?;
    let text = match provider {
        Provider::Chatgpt => chatgpt::complete(&model.id, instructions, input).await?,
        Provider::Openrouter | Provider::Opencode => {
            let keys = ApiKeys::load();
            let key = keys.get(provider).ok_or_else(|| {
                AiError::new("not_configured", format!("Add your {} API key in Settings → TL;DR.", provider.label()))
            })?;
            openai_compat::complete(provider, key, &model.id, instructions, input).await?
        }
    };
    Ok(Completion { text, model: model.name, provider })
}

#[cfg(test)]
pub(crate) mod test_dir {
    use std::sync::Mutex;

    /// AI tests share one override folder; this keeps them from running at the same time.
    pub static LOCK: Mutex<()> = Mutex::new(());

    pub fn with_temp_dir<T>(f: impl FnOnce() -> T) -> T {
        let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = std::env::temp_dir().join(format!("sourcefold-ai-test-{}", uuid::Uuid::new_v4()));
        super::set_dir_override(Some(dir.clone()));
        let out = f();
        super::set_dir_override(None);
        let _ = std::fs::remove_dir_all(dir);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, free: bool) -> ModelInfo {
        ModelInfo { id: id.into(), name: id.into(), free, price_in: None, price_out: None, context: None }
    }

    #[test]
    fn api_keys_are_trimmed_and_checked() {
        assert_eq!(normalize_api_key("  \"sk-or-v1-abc\" ").unwrap(), "sk-or-v1-abc");
        assert_eq!(normalize_api_key("Bearer sk-abc").unwrap(), "sk-abc");
        assert!(normalize_api_key("   ").is_err());
        assert!(normalize_api_key("two words").is_err());
    }

    #[test]
    fn default_model_prefers_luna_then_free() {
        let list = vec![model("a/big", false), model("b/small:free", true), model("openai/gpt-6-luna", false)];
        assert_eq!(default_model(Provider::Openrouter, &list).unwrap().id, "openai/gpt-6-luna");
        let list = vec![model("big-pickle", false), model("deepseek-v4.1-flash-free", true)];
        assert_eq!(default_model(Provider::Opencode, &list).unwrap().id, "deepseek-v4.1-flash-free");
        assert_eq!(default_model(Provider::Chatgpt, &list).unwrap().id, "big-pickle");
        assert!(default_model(Provider::Chatgpt, &[]).is_none());
    }

    #[test]
    fn status_never_shows_keys_and_adopts_the_first_provider() {
        test_dir::with_temp_dir(|| {
            let before = status();
            assert_eq!(before.provider, None);
            assert!(!before.ready);

            ApiKeys::set(Provider::Openrouter, Some("sk-or-v1-secret1234".into())).unwrap();
            adopt_provider_if_unset(Provider::Openrouter).unwrap();
            adopt_provider_if_unset(Provider::Opencode).unwrap();

            let after = status();
            assert_eq!(after.provider, Some(Provider::Openrouter));
            assert!(after.ready);
            let json = serde_json::to_string(&after).unwrap();
            assert!(!json.contains("secret"));
            assert!(json.contains("Key ending in 1234"));
        });
    }
}
