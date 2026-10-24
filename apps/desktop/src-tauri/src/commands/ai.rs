//! Settings → TL;DR and the TL;DR writer (docs/dev/PLAN-tldr.md). See `crate::ai`.

use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use crate::ai::{
    self, chatgpt, openai_compat, AiError, AiSettings, AiStatus, ApiKeys, Completion, ModelChoice,
    ModelInfo, Provider,
};

#[tauri::command]
pub async fn ai_status() -> Result<AiStatus, AiError> {
    Ok(ai::status())
}

/// Picks the provider TL;DRs are written with (it may still need connecting).
#[tauri::command]
pub async fn ai_set_provider(provider: String) -> Result<AiStatus, AiError> {
    let provider = Provider::parse(&provider)?;
    let mut settings = AiSettings::load();
    settings.provider = Some(provider);
    settings.save()?;
    Ok(ai::status())
}

/// Picks a provider's model; `modelId: null` goes back to the default.
#[tauri::command]
pub async fn ai_set_model(
    provider: String,
    model_id: Option<String>,
    model_name: Option<String>,
) -> Result<AiStatus, AiError> {
    let provider = Provider::parse(&provider)?;
    let choice = match model_id.map(|id| id.trim().to_string()).filter(|id| !id.is_empty()) {
        Some(id) => {
            if id.len() > 200 {
                return Err(AiError::bad_request("That model id is too long."));
            }
            let name = model_name
                .map(|n| n.trim().chars().take(200).collect::<String>())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| id.clone());
            Some(ModelChoice { id, name })
        }
        None => None,
    };
    let mut settings = AiSettings::load();
    settings.set_model(provider, choice);
    settings.save()?;
    Ok(ai::status())
}

/// Saves an OpenRouter or OpenCode key (OpenRouter's is checked first).
#[tauri::command]
pub async fn ai_set_api_key(provider: String, key: String) -> Result<AiStatus, AiError> {
    let provider = Provider::parse(&provider)?;
    if provider == Provider::Chatgpt {
        return Err(AiError::bad_request("ChatGPT uses sign-in, not a key."));
    }
    let key = ai::normalize_api_key(&key)?;
    if provider == Provider::Openrouter {
        openai_compat::check_openrouter_key(&key).await?;
    }
    ApiKeys::set(provider, Some(key))?;
    ai::adopt_provider_if_unset(provider)?;
    Ok(ai::status())
}

#[tauri::command]
pub async fn ai_clear_api_key(provider: String) -> Result<AiStatus, AiError> {
    let provider = Provider::parse(&provider)?;
    ApiKeys::set(provider, None)?;
    Ok(ai::status())
}

#[tauri::command]
pub async fn ai_list_models(provider: String) -> Result<Vec<ModelInfo>, AiError> {
    ai::list_models(Provider::parse(&provider)?).await
}

/// Writes an answer with the picked provider and model. The webview builds `input` from the
/// source (`buildTldrInput`) and reads the answer (`parseTldrAnswer`).
#[tauri::command]
pub async fn ai_complete(instructions: String, input: String) -> Result<Completion, AiError> {
    if instructions.len() > 20_000 || input.len() > 200_000 {
        return Err(AiError::bad_request("That request is too long."));
    }
    ai::complete(&instructions, &input).await
}

/// Opens ChatGPT's sign-in in the browser and waits (up to five minutes) for it to come back.
#[tauri::command]
pub async fn chatgpt_sign_in(app: tauri::AppHandle) -> Result<AiStatus, AiError> {
    let opener = app.clone();
    chatgpt::sign_in(move |url| opener.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())).await?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(ai::status())
}

#[tauri::command]
pub async fn chatgpt_cancel_sign_in() -> Result<(), AiError> {
    chatgpt::cancel_sign_in();
    Ok(())
}

#[tauri::command]
pub async fn chatgpt_sign_out() -> Result<AiStatus, AiError> {
    chatgpt::sign_out().await?;
    Ok(ai::status())
}
