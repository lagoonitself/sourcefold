//! OpenRouter and OpenCode Zen: both speak OpenAI's Chat Completions with a bearer API key.
//!
//! - OpenRouter: `https://openrouter.ai/api/v1` (models list needs no key; `/key` checks one).
//! - OpenCode Zen: `https://opencode.ai/zen/v1` (its unified `/chat/completions` serves every model).

use std::time::Duration;

use serde_json::{json, Value};

use super::{AiError, ModelInfo, Provider, USER_AGENT};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
const OPENROUTER_REFERER: &str = "https://github.com/lagoonitself/sourcefold";

fn base_url(provider: Provider) -> &'static str {
    match provider {
        Provider::Openrouter => "https://openrouter.ai/api/v1",
        Provider::Opencode => "https://opencode.ai/zen/v1",
        Provider::Chatgpt => unreachable!("ChatGPT has its own client"),
    }
}

fn client() -> Result<reqwest::Client, AiError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(AiError::network)
}

fn with_headers(provider: Provider, req: reqwest::RequestBuilder, key: Option<&str>) -> reqwest::RequestBuilder {
    let req = match key {
        Some(k) => req.bearer_auth(k),
        None => req,
    };
    if provider == Provider::Openrouter {
        req.header("HTTP-Referer", OPENROUTER_REFERER).header("X-Title", "Sourcefold")
    } else {
        req
    }
}

fn price_per_million(value: Option<&Value>) -> Option<f64> {
    let per_token = match value? {
        Value::String(s) => s.parse::<f64>().ok()?,
        Value::Number(n) => n.as_f64()?,
        _ => return None,
    };
    if per_token < 0.0 {
        return None;
    }
    Some((per_token * 1_000_000.0 * 1000.0).round() / 1000.0)
}

/// "deepseek-v4.1-flash-free" → "Deepseek v4.1 flash free": OpenCode lists ids only.
fn name_from_id(id: &str) -> String {
    let spaced = id.replace(['-', '_'], " ");
    let mut chars = spaced.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Reads a `/models` answer (`{ data: [...] }`) into the list the Settings menu shows.
pub fn parse_models(provider: Provider, body: &Value) -> Vec<ModelInfo> {
    let Some(list) = body.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out: Vec<ModelInfo> = list
        .iter()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.trim();
            if id.is_empty() || id == "test" {
                return None;
            }
            // Text out only: TL;DRs are text (OpenRouter lists image and audio models too).
            if let Some(outputs) = m.pointer("/architecture/output_modalities").and_then(Value::as_array) {
                if !outputs.iter().any(|o| o.as_str() == Some("text")) {
                    return None;
                }
            }
            let price_in = price_per_million(m.pointer("/pricing/prompt"));
            let price_out = price_per_million(m.pointer("/pricing/completion"));
            let free = id.ends_with(":free")
                || id.ends_with("-free")
                || (price_in == Some(0.0) && price_out == Some(0.0));
            let name = m
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(String::from)
                .unwrap_or_else(|| name_from_id(id));
            Some(ModelInfo {
                id: id.to_string(),
                name,
                free,
                price_in,
                price_out,
                context: m.get("context_length").and_then(Value::as_u64),
            })
        })
        .collect();
    if provider == Provider::Openrouter {
        // OpenRouter has hundreds; alphabetical by name is easiest to scan with the search box.
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }
    out
}

pub async fn list_models(provider: Provider, key: Option<&str>) -> Result<Vec<ModelInfo>, AiError> {
    let url = format!("{}/models", base_url(provider));
    let res = with_headers(provider, client()?.get(&url), key)
        .send()
        .await
        .map_err(AiError::network)?;
    let status = res.status().as_u16();
    let retry = retry_after(&res);
    let text = res.text().await.map_err(AiError::network)?;
    if !(200..300).contains(&status) {
        return Err(http_error(provider, status, &text, retry));
    }
    let body: Value = serde_json::from_str(&text)
        .map_err(|_| AiError::other(format!("{} sent a model list Sourcefold couldn't read.", provider.label())))?;
    Ok(parse_models(provider, &body))
}

/// OpenRouter only: checks a key before saving it (`GET /key`).
pub async fn check_openrouter_key(key: &str) -> Result<(), AiError> {
    let res = with_headers(Provider::Openrouter, client()?.get("https://openrouter.ai/api/v1/key"), Some(key))
        .send()
        .await
        .map_err(AiError::network)?;
    let status = res.status().as_u16();
    if (200..300).contains(&status) {
        return Ok(());
    }
    let text = res.text().await.unwrap_or_default();
    Err(http_error(Provider::Openrouter, status, &text, None))
}

fn retry_after(res: &reqwest::Response) -> Option<u64> {
    res.headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
}

fn error_message(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let message = value
        .pointer("/error/message")
        .or_else(|| value.get("message"))
        .or_else(|| value.get("detail"))
        .and_then(Value::as_str)?;
    let trimmed = message.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(300).collect())
}

/// An HTTP failure as something the user can act on.
pub fn http_error(provider: Provider, status: u16, body: &str, retry: Option<u64>) -> AiError {
    let name = provider.label();
    let detail = error_message(body);
    let with_detail = |text: String| match &detail {
        Some(d) => format!("{} ({})", text, d),
        None => text,
    };
    let mut err = match status {
        401 | 403 => AiError::new("auth", with_detail(format!("{} refused the API key. Check it in Settings → TL;DR.", name))),
        402 => AiError::new("limit", with_detail(format!("Your {} credits ran out.", name))),
        429 => AiError::new("limit", with_detail(format!("{} is rate limiting requests.", name))),
        400 | 404 | 422 => AiError::bad_request(with_detail(format!("{} couldn't use this model or request.", name))),
        500..=599 => AiError::new("unavailable", with_detail(format!("{} is having trouble right now.", name))),
        _ => AiError::other(with_detail(format!("{} answered with status {}.", name, status))),
    };
    err.retry_after = retry;
    err
}

/// The text of a Chat Completions answer: `choices[0].message.content` as a string or as parts.
pub fn answer_text(body: &Value) -> Option<String> {
    let content = body.pointer("/choices/0/message/content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => return None,
    };
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

pub async fn complete(
    provider: Provider,
    key: &str,
    model: &str,
    instructions: &str,
    input: &str,
) -> Result<String, AiError> {
    let url = format!("{}/chat/completions", base_url(provider));
    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": instructions },
            { "role": "user", "content": input },
        ],
        "stream": false,
    });
    let res = with_headers(provider, client()?.post(&url), Some(key))
        .json(&body)
        .send()
        .await
        .map_err(AiError::network)?;
    let status = res.status().as_u16();
    let retry = retry_after(&res);
    let text = res.text().await.map_err(AiError::network)?;
    if !(200..300).contains(&status) {
        return Err(http_error(provider, status, &text, retry));
    }
    let value: Value = serde_json::from_str(&text)
        .map_err(|_| AiError::other(format!("{} sent an answer Sourcefold couldn't read.", provider.label())))?;
    // OpenRouter can answer 200 with an error object (a provider failed mid-way).
    if value.pointer("/error/message").is_some() {
        let code = value.pointer("/error/code").and_then(Value::as_u64).unwrap_or(500) as u16;
        return Err(http_error(provider, code, &text, retry));
    }
    answer_text(&value).ok_or_else(|| AiError::new("unavailable", format!("{} sent an empty answer. Try again.", provider.label())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_openrouter_models() {
        let body = json!({ "data": [
            { "id": "z/paid", "name": "Zeta Paid", "pricing": { "prompt": "0.0000001", "completion": "0.0000005" }, "context_length": 128000,
              "architecture": { "output_modalities": ["text"] } },
            { "id": "a/free:free", "name": "Alpha: Free", "pricing": { "prompt": "0", "completion": "0" } },
            { "id": "img/maker", "name": "Image Maker", "architecture": { "output_modalities": ["image"] } },
        ]});
        let models = parse_models(Provider::Openrouter, &body);
        assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["a/free:free", "z/paid"]);
        assert!(models[0].free);
        assert!(!models[1].free);
        assert_eq!(models[1].price_in, Some(0.1));
        assert_eq!(models[1].price_out, Some(0.5));
        assert_eq!(models[1].context, Some(128000));
    }

    #[test]
    fn reads_opencode_models() {
        let body = json!({ "object": "list", "data": [
            { "id": "big-pickle", "object": "model" },
            { "id": "deepseek-v4.1-flash-free", "object": "model" },
            { "id": "test", "object": "model" },
        ]});
        let models = parse_models(Provider::Opencode, &body);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].name, "Big pickle");
        assert!(models[1].free);
    }

    #[test]
    fn reads_answers_as_text_or_parts() {
        assert_eq!(answer_text(&json!({ "choices": [{ "message": { "content": " {\"gist\":\"x\"} " } }] })).unwrap(), "{\"gist\":\"x\"}");
        assert_eq!(
            answer_text(&json!({ "choices": [{ "message": { "content": [{ "type": "text", "text": "a" }, { "text": "b" }] } }] })).unwrap(),
            "ab"
        );
        assert!(answer_text(&json!({ "choices": [{ "message": { "content": null } }] })).is_none());
    }

    #[test]
    fn maps_http_errors() {
        assert_eq!(http_error(Provider::Openrouter, 401, "{}", None).code, "auth");
        let limit = http_error(Provider::Openrouter, 402, r#"{"error":{"message":"Insufficient credits"}}"#, None);
        assert_eq!(limit.code, "limit");
        assert!(limit.message.contains("Insufficient credits"));
        assert_eq!(http_error(Provider::Opencode, 429, "", Some(30)).retry_after, Some(30));
        assert_eq!(http_error(Provider::Opencode, 503, "", None).code, "unavailable");
        assert_eq!(http_error(Provider::Opencode, 404, "", None).code, "bad_request");
    }
}
