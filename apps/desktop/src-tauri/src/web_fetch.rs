//! A general HTTP fetch for the webview's source extractors (YouTube, web pages, Reddit, PDFs,
//! Hacker News, Bluesky). It exists because the extractors in `@sourcefold/core` never call
//! `fetch` themselves: the desktop app hands them this command through `SourceFetch`.
//!
//! It is deliberately narrow. Only `http` and `https`. Redirects are followed by hand so every hop
//! is checked again. On every hop the host is resolved and refused when it points at this computer
//! or the local network (loopback, private, link-local, unique-local, CGNAT, unspecified,
//! multicast, `localhost` names), so the local server on `127.0.0.1:23456` can never be reached
//! through it. The resolved address is pinned with `Client::resolve`, so the connection goes to the
//! address that was checked rather than a second lookup (DNS rebinding).
//!
//! Caller headers are filtered through an allowlist, and `Cookie` is only forwarded to YouTube for
//! its consent cookies.

use std::collections::{BTreeMap, HashMap};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT_LANGUAGE, LOCATION, USER_AGENT};
use serde::{Deserialize, Serialize};

const MAX_REDIRECTS: usize = 10;
const MAX_BODY_BYTES: usize = 50 * 1024 * 1024;
const MAX_POST_BODY_BYTES: usize = 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_ACCEPT_LANGUAGE: &str = "en-US,en;q=0.9";
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/// Error codes the TypeScript side maps to `SourceError`s (see `apps/desktop/src/lib/web-fetch.ts`).
pub const ERROR_INVALID_URL: &str = "invalid_url";
pub const ERROR_BLOCKED_ADDRESS: &str = "blocked_address";
pub const ERROR_TOO_LARGE: &str = "too_large";

const COOKIE_HOSTS: [&str; 3] = ["youtube.com", "www.youtube.com", "m.youtube.com"];
const COOKIE_NAMES: [&str; 2] = ["consent", "socs"];

#[derive(Debug, Clone)]
pub struct WebFetchOptions {
    pub url: String,
    pub method: Option<String>,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub response_type: Option<String>,
}

/// What the webview sees. `bytes` is base64 and only set when `response_type` asked for bytes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebFetchResponse {
    pub status: u16,
    /// Final address after redirects.
    pub url: String,
    /// Response headers with lowercase names.
    pub headers: BTreeMap<String, String>,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<String>,
}

/// A URL that passed the address checks, with the address to connect to for names.
#[derive(Debug)]
struct ValidatedTarget {
    url: reqwest::Url,
    /// `(host, address)` to pin, so the name is resolved once and not again by the connector.
    pin: Option<(String, SocketAddr)>,
}

pub async fn fetch(options: WebFetchOptions) -> Result<WebFetchResponse, String> {
    let method = match options.method.as_deref() {
        Some(value) if value.eq_ignore_ascii_case("POST") => reqwest::Method::POST,
        _ => reqwest::Method::GET,
    };
    if let Some(body) = &options.body {
        if body.len() > MAX_POST_BODY_BYTES {
            return Err(ERROR_TOO_LARGE.to_string());
        }
    }
    let want_bytes = options.response_type.as_deref() == Some("bytes");

    let mut url = parse_url(&options.url)?;
    let mut redirects = 0usize;

    loop {
        let target = validate_target(&url)?;
        let client = build_client(&target)?;
        let host = target.url.host_str().unwrap_or_default().to_string();
        let outgoing = allowed_headers(&host, &options.headers);
        let has_user_agent = outgoing.iter().any(|(name, _)| name == "user-agent");
        let has_accept_language = outgoing.iter().any(|(name, _)| name == "accept-language");

        let mut request = client.request(method.clone(), target.url.clone());
        for (name, value) in &outgoing {
            if let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(name.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                request = request.header(name, value);
            }
        }
        if !has_user_agent {
            request = request.header(USER_AGENT, DEFAULT_USER_AGENT);
        }
        if !has_accept_language {
            request = request.header(ACCEPT_LANGUAGE, DEFAULT_ACCEPT_LANGUAGE);
        }
        if method == reqwest::Method::POST {
            if let Some(body) = &options.body {
                request = request.body(body.clone());
            }
        }

        let mut response = request.send().await.map_err(|error| fetch_failed(&error))?;
        let status = response.status();

        if status.is_redirection() {
            if redirects >= MAX_REDIRECTS {
                return Err(fetch_failed_msg("too many redirects"));
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| fetch_failed_msg("redirect without a location"))?;
            url = url
                .join(location)
                .map_err(|_| fetch_failed_msg("bad redirect"))?;
            if url.scheme() != "http" && url.scheme() != "https" {
                return Err(fetch_failed_msg("bad redirect"));
            }
            redirects += 1;
            continue;
        }

        let headers = collect_headers(response.headers());
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| fetch_failed(&error))?
        {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(ERROR_TOO_LARGE.to_string());
            }
            body.extend_from_slice(&chunk);
        }

        let (text, bytes) = if want_bytes {
            (String::new(), Some(base64_encode(&body)))
        } else {
            (String::from_utf8_lossy(&body).into_owned(), None)
        };

        return Ok(WebFetchResponse {
            status: status.as_u16(),
            url: url.to_string(),
            headers,
            text,
            bytes,
        });
    }
}

fn parse_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| ERROR_INVALID_URL.to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err(ERROR_INVALID_URL.to_string()),
    }
}

/// Refuses an address that is not on the public internet.
pub fn is_blocked_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_blocked_v4(ip),
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            let link_local = (segments[0] & 0xffc0) == 0xfe80; // fe80::/10
            let unique_local = (segments[0] & 0xfe00) == 0xfc00; // fc00::/7
                                                                 // Native IPv6 ranges first: `to_ipv4` also maps the deprecated IPv4-compatible form,
                                                                 // where `::1` would otherwise look like the harmless `0.0.0.1`.
            if ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || link_local
                || unique_local
            {
                return true;
            }
            // IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible (`::a.b.c.d`) carry a v4 address.
            if let Some(v4) = ip.to_ipv4() {
                return is_blocked_v4(v4);
            }
            false
        }
    }
}

fn is_blocked_v4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_broadcast()
        || (octets[0] == 100 && (64..=127).contains(&octets[1])) // 100.64.0.0/10 CGNAT
}

/// RFC 6761 reserves `localhost` and anything under `.localhost`.
pub fn is_localhost_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost")
}

fn validate_target(url: &reqwest::Url) -> Result<ValidatedTarget, String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(ERROR_INVALID_URL.to_string());
    }
    let raw_host = url
        .host_str()
        .ok_or_else(|| ERROR_INVALID_URL.to_string())?;
    // `Url::host_str` wraps IPv6 addresses in brackets.
    let host = raw_host.trim_start_matches('[').trim_end_matches(']');

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_address(ip) {
            return Err(ERROR_BLOCKED_ADDRESS.to_string());
        }
        return Ok(ValidatedTarget {
            url: url.clone(),
            pin: None,
        });
    }

    if is_localhost_name(host) {
        return Err(ERROR_BLOCKED_ADDRESS.to_string());
    }

    let port = url
        .port_or_known_default()
        .ok_or_else(|| ERROR_INVALID_URL.to_string())?;
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|error| fetch_failed_msg(&error.to_string()))?
        .collect();
    if addresses.is_empty() {
        return Err(fetch_failed_msg("could not resolve host"));
    }
    // Refuse when any address for the name is blocked, not just the one we would pick.
    if addresses
        .iter()
        .any(|address| is_blocked_address(address.ip()))
    {
        return Err(ERROR_BLOCKED_ADDRESS.to_string());
    }

    Ok(ValidatedTarget {
        url: url.clone(),
        pin: Some((host.to_string(), addresses[0])),
    })
}

fn build_client(target: &ValidatedTarget) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT);
    if let Some((host, address)) = &target.pin {
        builder = builder.resolve(host, *address);
    }
    builder
        .build()
        .map_err(|error| fetch_failed_msg(&error.to_string()))
}

/// The caller's headers, filtered to the allowlist. Unknown names are dropped silently. The
/// `Cookie` header is forwarded only to YouTube and only its consent cookies.
pub fn allowed_headers(host: &str, raw: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut pairs: Vec<(&String, &String)> = raw.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(b.0));

    let mut out = Vec::new();
    for (name, value) in pairs {
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let value = match name.as_str() {
            "cookie" => match youtube_consent_cookie(host, value) {
                Some(cookie) => cookie,
                None => continue,
            },
            "accept"
            | "accept-language"
            | "content-type"
            | "user-agent"
            | "x-youtube-client-name"
            | "x-youtube-client-version"
            | "origin"
            | "referer" => value.to_string(),
            _ => continue,
        };
        if HeaderValue::from_str(&value).is_ok() {
            out.push((name, value));
        }
    }
    out
}

/// Keeps only `CONSENT=` / `SOCS=` pairs, and only for YouTube's own hosts.
pub fn youtube_consent_cookie(host: &str, cookie: &str) -> Option<String> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if !COOKIE_HOSTS.contains(&host.as_str()) {
        return None;
    }
    let kept: Vec<&str> = cookie
        .split(';')
        .map(str::trim)
        .filter(|pair| {
            let name = pair
                .split('=')
                .next()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase();
            COOKIE_NAMES.contains(&name.as_str())
        })
        .collect();
    if kept.is_empty() {
        None
    } else {
        Some(kept.join("; "))
    }
}

fn collect_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (name, value) in headers.iter() {
        let key = name.as_str().to_ascii_lowercase();
        let text = value.to_str().unwrap_or_default().to_string();
        out.entry(key)
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&text);
            })
            .or_insert(text);
    }
    out
}

fn fetch_failed(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        fetch_failed_msg("timed out")
    } else if error.is_connect() {
        fetch_failed_msg("could not connect")
    } else {
        fetch_failed_msg(&error.to_string())
    }
}

fn fetch_failed_msg(detail: &str) -> String {
    format!("fetch_failed: {}", detail)
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 (RFC 4648). Written by hand because the crate this project already uses
/// (`reqwest`) does not re-export an encoder and no base64 crate is a direct dependency.
pub fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_ALPHABET[((triple >> 18) & 63) as usize] as char);
        out.push(BASE64_ALPHABET[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(BASE64_ALPHABET[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(BASE64_ALPHABET[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_non_public_addresses() {
        let blocked = [
            "127.0.0.1",
            "127.1.2.3",
            "10.0.0.1",
            "172.16.5.4",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "100.127.255.254",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fe80::1",
            "fc00::1",
            "fd12:3456:789a::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.1.1",
        ];
        for raw in blocked {
            let ip: IpAddr = raw.parse().unwrap();
            assert!(is_blocked_address(ip), "{} should be blocked", raw);
        }
    }

    #[test]
    fn allows_public_addresses() {
        let allowed = [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",
            "100.63.255.255",
            "100.128.0.1",
            "172.15.255.255",
            "172.32.0.1",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
            "::ffff:8.8.8.8",
        ];
        for raw in allowed {
            let ip: IpAddr = raw.parse().unwrap();
            assert!(!is_blocked_address(ip), "{} should be allowed", raw);
        }
    }

    #[test]
    fn blocks_localhost_names() {
        assert!(is_localhost_name("localhost"));
        assert!(is_localhost_name("LOCALHOST."));
        assert!(is_localhost_name("app.localhost"));
        assert!(!is_localhost_name("localhost.example.com"));
        assert!(!is_localhost_name("notlocalhost"));
    }

    #[test]
    fn refuses_loopback_private_and_localhost_targets() {
        for raw in [
            "http://127.0.0.1:23456/api/items",
            "http://localhost/",
            "https://10.0.0.5/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://app.localhost/",
        ] {
            let url = reqwest::Url::parse(raw).unwrap();
            assert_eq!(
                validate_target(&url).unwrap_err(),
                ERROR_BLOCKED_ADDRESS,
                "{} should be blocked",
                raw
            );
        }
    }

    #[test]
    fn accepts_a_public_ip_literal_without_resolving() {
        let url = reqwest::Url::parse("https://93.184.216.34/").unwrap();
        let target = validate_target(&url).unwrap();
        assert!(target.pin.is_none());
    }

    #[test]
    fn keeps_only_allowlisted_headers() {
        let mut raw = HashMap::new();
        raw.insert("Accept".to_string(), "text/html".to_string());
        raw.insert("User-Agent".to_string(), "custom".to_string());
        raw.insert("X-Forwarded-For".to_string(), "1.2.3.4".to_string());
        raw.insert("Authorization".to_string(), "secret".to_string());
        raw.insert("Referer".to_string(), "https://example.com/".to_string());
        raw.insert("Cookie".to_string(), "session=secret".to_string());

        assert_eq!(
            allowed_headers("example.com", &raw),
            vec![
                ("accept".to_string(), "text/html".to_string()),
                ("referer".to_string(), "https://example.com/".to_string()),
                ("user-agent".to_string(), "custom".to_string()),
            ]
        );
    }

    #[test]
    fn cookie_only_for_youtube_consent() {
        assert_eq!(
            youtube_consent_cookie("www.youtube.com", "CONSENT=YES+cb"),
            Some("CONSENT=YES+cb".to_string())
        );
        assert_eq!(
            youtube_consent_cookie(
                "m.youtube.com",
                "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZGRlYWQ"
            ),
            Some("SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZGRlYWQ".to_string())
        );
        assert_eq!(
            youtube_consent_cookie(
                "youtube.com",
                "VISITOR_INFO1_LIVE=abc; CONSENT=YES+cb; PREF=f1"
            ),
            Some("CONSENT=YES+cb".to_string())
        );
        assert_eq!(
            youtube_consent_cookie("www.youtube.com", "SID=secret; HSID=secret"),
            None
        );
        assert_eq!(youtube_consent_cookie("evil.com", "CONSENT=YES+cb"), None);
        assert_eq!(
            youtube_consent_cookie("youtube.com.evil.com", "CONSENT=YES+cb"),
            None
        );
    }

    #[test]
    fn drops_cookie_for_non_youtube_hosts() {
        let mut raw = HashMap::new();
        raw.insert("Cookie".to_string(), "CONSENT=YES+cb".to_string());
        assert!(allowed_headers("example.com", &raw).is_empty());
        assert_eq!(
            allowed_headers("youtube.com", &raw),
            vec![("cookie".to_string(), "CONSENT=YES+cb".to_string())]
        );
    }

    #[test]
    fn refuses_unsupported_schemes() {
        assert_eq!(
            parse_url("ftp://example.com/").unwrap_err(),
            ERROR_INVALID_URL
        );
        assert_eq!(parse_url("not a url").unwrap_err(), ERROR_INVALID_URL);
        assert!(parse_url("https://example.com/").is_ok());
    }

    #[test]
    fn encodes_base64() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(&[0, 1, 2, 253, 254, 255]), "AAEC/f7/");
    }
}
