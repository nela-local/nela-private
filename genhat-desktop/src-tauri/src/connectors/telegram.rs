//! Telegram user-account connector (MTProto).
//!
//! Session stays on-device. nela-backend is not in this path.

use grammers_client::session::Session;
use grammers_client::types::{Chat, LoginToken, PasswordToken, User};
use grammers_client::{Client, Config, InitParams, SignInError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::sync::Mutex as AsyncMutex;

const SESSION_FILE: &str = "nela.session";
const PROFILE_FILE: &str = "profile.json";
const MAX_BODY_CHARS: usize = 4096;
const MAX_DIALOG_LIST: usize = 10;
const DEFAULT_DIALOG_LIST: usize = 5;
const MAX_HISTORY: usize = 20;
const DEFAULT_HISTORY: usize = 10;
const DIALOG_SCAN: usize = 200;
const PREVIEW_CHARS: usize = 280;

static APP_DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

const USER_UNAVAILABLE: &str =
    "Telegram isn't available in this copy of NELA. Update the app and try Connect again.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramStatus {
    pub connected: bool,
    pub username: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConnectNext {
    pub next: String,
    pub username: Option<String>,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramSendResult {
    pub sent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramMessageSummary {
    pub chat: String,
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramReadResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messages: Option<Vec<TelegramMessageSummary>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredProfile {
    username: Option<String>,
    phone: Option<String>,
}

enum PendingLogin {
    AwaitingCode {
        client: Client,
        token: LoginToken,
        session_path: PathBuf,
    },
    AwaitingPassword {
        client: Client,
        token: PasswordToken,
        session_path: PathBuf,
    },
}

static PENDING: AsyncMutex<Option<PendingLogin>> = AsyncMutex::const_new(None);

pub fn set_app_data_dir(path: PathBuf) {
    if let Ok(mut guard) = APP_DATA_DIR.lock() {
        *guard = Some(path);
    }
}

fn app_data_dir() -> Result<PathBuf, String> {
    APP_DATA_DIR
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| "Could not open app data on this device.".to_string())
}

fn telegram_dir(app_data: &Path) -> PathBuf {
    app_data.join("connectors").join("telegram")
}

fn session_path(app_data: &Path) -> PathBuf {
    telegram_dir(app_data).join(SESSION_FILE)
}

fn profile_path(app_data: &Path) -> PathBuf {
    telegram_dir(app_data).join(PROFILE_FILE)
}

fn api_id() -> Result<i32, String> {
    crate::cloud::load_dotenv_files();
    let raw = std::env::var("NELA_TELEGRAM_API_ID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            option_env!("NELA_TELEGRAM_API_ID")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
        .ok_or_else(|| USER_UNAVAILABLE.to_string())?;
    raw.parse::<i32>()
        .map_err(|_| USER_UNAVAILABLE.to_string())
}

fn api_hash() -> Result<String, String> {
    crate::cloud::load_dotenv_files();
    if let Ok(h) = std::env::var("NELA_TELEGRAM_API_HASH") {
        let h = h.trim().to_string();
        if !h.is_empty() {
            return Ok(h);
        }
    }
    option_env!("NELA_TELEGRAM_API_HASH")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| USER_UNAVAILABLE.to_string())
}

fn map_err(err: impl std::fmt::Display) -> String {
    let s = err.to_string();
    let lower = s.to_lowercase();
    if lower.contains("flood") {
        let secs = lower
            .split(|c: char| !c.is_ascii_digit())
            .filter(|p| !p.is_empty())
            .find_map(|p| p.parse::<u32>().ok().filter(|n| *n > 0 && *n < 3600));
        return match secs {
            Some(n) => format!("Telegram asked us to wait {n} seconds. Try again after that."),
            None => "Telegram asked us to wait. Try again in a moment.".to_string(),
        };
    }
    if lower.contains("phone") && (lower.contains("invalid") || lower.contains("occupied")) {
        return "That phone number could not be used. Check the country code and try again."
            .to_string();
    }
    if s.trim().is_empty() {
        return "Telegram could not complete that request. Please try again.".to_string();
    }
    s
}

fn normalize_phone(raw: &str) -> Result<String, String> {
    let digits: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();
    let mut phone = if digits.starts_with('+') {
        digits
    } else {
        format!("+{digits}")
    };
    phone.retain(|c| c == '+' || c.is_ascii_digit());
    if phone.len() < 8 || !phone.starts_with('+') || phone.chars().filter(|c| c.is_ascii_digit()).count() < 7
    {
        return Err("Enter a phone number with country code, like +14155552671.".to_string());
    }
    Ok(phone)
}

fn read_profile(app_data: &Path) -> Option<StoredProfile> {
    let raw = std::fs::read_to_string(profile_path(app_data)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_profile(app_data: &Path, profile: &StoredProfile) -> Result<(), String> {
    let dir = telegram_dir(app_data);
    std::fs::create_dir_all(&dir).map_err(|_| "Could not save Telegram on this device.".to_string())?;
    let raw = serde_json::to_string(profile)
        .map_err(|_| "Could not save Telegram on this device.".to_string())?;
    std::fs::write(profile_path(app_data), raw)
        .map_err(|_| "Could not save Telegram on this device.".to_string())?;
    Ok(())
}

fn session_looks_signed_in(app_data: &Path) -> bool {
    let path = session_path(app_data);
    if !path.exists() {
        return false;
    }
    Session::load_file(&path)
        .ok()
        .map(|s| s.signed_in())
        .unwrap_or(false)
}

fn display_name(profile: &StoredProfile) -> Option<String> {
    profile
        .username
        .as_ref()
        .filter(|s| !s.is_empty())
        .cloned()
        .or_else(|| profile.phone.clone())
}

fn handle_from_user(user: &User) -> (Option<String>, Option<String>) {
    let username = user.username().map(|u| format!("@{u}"));
    let phone = user.phone().map(|p| {
        if p.starts_with('+') {
            p.to_string()
        } else {
            format!("+{p}")
        }
    });
    (username, phone)
}

async fn connect_client(app_data: &Path) -> Result<Client, String> {
    let dir = telegram_dir(app_data);
    std::fs::create_dir_all(&dir).map_err(|_| "Could not save Telegram on this device.".to_string())?;
    let path = session_path(app_data);
    let session = Session::load_file_or_create(&path).map_err(map_err)?;
    let mut params = InitParams::default();
    params.flood_sleep_threshold = 0;
    Client::connect(Config {
        session,
        api_id: api_id()?,
        api_hash: api_hash()?,
        params,
    })
    .await
    .map_err(map_err)
}

fn save_session(client: &Client, path: &Path) -> Result<(), String> {
    client
        .session()
        .save_to_file(path)
        .map_err(|_| "Could not save Telegram on this device.".to_string())
}

async fn finish_login(client: Client, session_path: PathBuf, user: User) -> Result<TelegramConnectNext, String> {
    save_session(&client, &session_path)?;
    let app_data = app_data_dir()?;
    let (username, phone) = handle_from_user(&user);
    write_profile(
        &app_data,
        &StoredProfile {
            username: username.clone(),
            phone,
        },
    )?;
    drop(client);
    Ok(TelegramConnectNext {
        next: "connected".into(),
        username,
        hint: None,
    })
}

pub fn status() -> Result<TelegramStatus, String> {
    let app_data = app_data_dir()?;
    if !session_looks_signed_in(&app_data) {
        return Ok(TelegramStatus {
            connected: false,
            username: None,
            phone: None,
        });
    }
    let profile = read_profile(&app_data).unwrap_or_default();
    Ok(TelegramStatus {
        connected: true,
        username: display_name(&profile),
        phone: profile.phone,
    })
}

pub async fn connect_start(phone: &str) -> Result<TelegramConnectNext, String> {
    let _ = api_id()?;
    let _ = api_hash()?;
    let phone = normalize_phone(phone)?;
    let app_data = app_data_dir()?;
    if session_looks_signed_in(&app_data) {
        let profile = read_profile(&app_data).unwrap_or_default();
        return Ok(TelegramConnectNext {
            next: "connected".into(),
            username: display_name(&profile),
            hint: None,
        });
    }

    let client = connect_client(&app_data).await?;
    if client.is_authorized().await.map_err(map_err)? {
        let user = client.get_me().await.map_err(map_err)?;
        let path = session_path(&app_data);
        return finish_login(client, path, user).await;
    }

    *PENDING.lock().await = None;
    let token = client.request_login_code(&phone).await.map_err(map_err)?;
    let path = session_path(&app_data);
    save_session(&client, &path)?;
    *PENDING.lock().await = Some(PendingLogin::AwaitingCode {
        client,
        token,
        session_path: path,
    });
    Ok(TelegramConnectNext {
        next: "code".into(),
        username: None,
        hint: None,
    })
}

pub async fn connect_code(code: &str) -> Result<TelegramConnectNext, String> {
    let code = code.trim();
    if code.is_empty() {
        return Err("Enter the login code from Telegram.".to_string());
    }
    let mut guard = PENDING.lock().await;
    let pending = guard.take().ok_or_else(|| {
        "Telegram sign-in expired. Enter your phone number again.".to_string()
    })?;
    let PendingLogin::AwaitingCode {
        client,
        token,
        session_path,
    } = pending
    else {
        *guard = Some(pending);
        return Err("Enter your Telegram cloud password to finish sign-in.".to_string());
    };

    match client.sign_in(&token, code).await {
        Ok(user) => {
            drop(guard);
            finish_login(client, session_path, user).await
        }
        Err(SignInError::PasswordRequired(password_token)) => {
            let hint = password_token.hint().map(|s| s.to_string());
            *guard = Some(PendingLogin::AwaitingPassword {
                client,
                token: password_token,
                session_path,
            });
            Ok(TelegramConnectNext {
                next: "password".into(),
                username: None,
                hint,
            })
        }
        Err(SignInError::InvalidCode) => {
            *guard = Some(PendingLogin::AwaitingCode {
                client,
                token,
                session_path,
            });
            Err("That login code is not valid. Check Telegram and try again.".to_string())
        }
        Err(err) => Err(map_err(err)),
    }
}

pub async fn connect_password(password: &str) -> Result<TelegramConnectNext, String> {
    let password = password.trim();
    if password.is_empty() {
        return Err("Enter your Telegram two-step password.".to_string());
    }
    let mut guard = PENDING.lock().await;
    let pending = guard.take().ok_or_else(|| {
        "Telegram sign-in expired. Enter your phone number again.".to_string()
    })?;
    let PendingLogin::AwaitingPassword {
        client,
        token,
        session_path,
    } = pending
    else {
        *guard = Some(pending);
        return Err("Enter the login code from Telegram first.".to_string());
    };

    match client.check_password(token.clone(), password).await {
        Ok(user) => {
            drop(guard);
            finish_login(client, session_path, user).await
        }
        Err(SignInError::InvalidPassword) => {
            *guard = Some(PendingLogin::AwaitingPassword {
                client,
                token,
                session_path,
            });
            Err("That password is not correct.".to_string())
        }
        Err(err) => Err(map_err(err)),
    }
}

pub async fn disconnect() -> Result<TelegramStatus, String> {
    *PENDING.lock().await = None;
    let app_data = app_data_dir()?;
    if session_looks_signed_in(&app_data) {
        if let Ok(client) = connect_client(&app_data).await {
            let _ = client.sign_out().await;
        }
    }
    let dir = telegram_dir(&app_data);
    let _ = std::fs::remove_file(session_path(&app_data));
    let _ = std::fs::remove_file(profile_path(&app_data));
    let _ = std::fs::remove_dir(&dir);
    Ok(TelegramStatus {
        connected: false,
        username: None,
        phone: None,
    })
}

fn chat_username(chat: &Chat) -> Option<String> {
    chat.username().map(|u| format!("@{u}"))
}

fn chat_label(chat: &Chat) -> String {
    match chat {
        Chat::User(user) => {
            let full = user.full_name();
            if !full.trim().is_empty() {
                return full;
            }
        }
        _ => {}
    }
    let title = chat.name();
    if !title.is_empty() {
        return title.to_string();
    }
    chat_username(chat).unwrap_or_else(|| "Telegram chat".to_string())
}

fn normalize_label(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Rank 0 = exact name/@username, 1 = contains. None = no match.
fn match_chat_name(needle: &str, candidates: &[&str]) -> Option<u8> {
    let want = normalize_label(needle);
    if want.is_empty() {
        return None;
    }
    let want_user = want.trim_start_matches('@');
    let mut contains = None;
    for cand in candidates {
        let c = normalize_label(cand);
        if c.is_empty() {
            continue;
        }
        if c == want || c == want_user || format!("@{c}") == want {
            return Some(0);
        }
        if want_user.len() >= 2 && c.contains(want_user) {
            contains = Some(1);
        }
    }
    contains
}

fn chat_match_candidates(chat: &Chat) -> Vec<String> {
    let mut out = Vec::new();
    match chat {
        Chat::User(user) => {
            let full = user.full_name();
            if !full.trim().is_empty() {
                out.push(full);
            }
            let first = user.first_name();
            if !first.is_empty() {
                out.push(first.to_string());
            }
            if let Some(last) = user.last_name() {
                out.push(last.to_string());
            }
        }
        _ => {
            let title = chat.name();
            if !title.is_empty() {
                out.push(title.to_string());
            }
        }
    }
    if let Some(u) = chat.username() {
        out.push(u.to_string());
        out.push(format!("@{u}"));
    }
    out
}

fn trim_preview(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    Some(t.chars().take(PREVIEW_CHARS).collect())
}

async fn resolve_chat(client: &Client, raw: &str) -> Result<Chat, String> {
    let needle = raw.trim();
    if needle.is_empty() {
        return Err("Choose a chat to message.".to_string());
    }
    let mut dialogs = client.iter_dialogs();
    let mut scanned = 0usize;
    let mut contains_hit: Option<Chat> = None;
    while let Some(dialog) = dialogs.next().await.map_err(map_err)? {
        scanned += 1;
        if scanned > DIALOG_SCAN {
            break;
        }
        let chat = dialog.chat().clone();
        let cands = chat_match_candidates(&chat);
        let refs: Vec<&str> = cands.iter().map(String::as_str).collect();
        match match_chat_name(needle, &refs) {
            Some(0) => return Ok(chat),
            Some(_) if contains_hit.is_none() => contains_hit = Some(chat),
            _ => {}
        }
    }
    if let Some(chat) = contains_hit {
        return Ok(chat);
    }

    let uname = needle.trim_start_matches('@').trim();
    let try_username = needle.starts_with('@') || !needle.contains(char::is_whitespace);
    if try_username && !uname.is_empty() {
        if let Some(chat) = client.resolve_username(uname).await.map_err(map_err)? {
            return Ok(chat);
        }
    }
    Err(format!(
        "Could not find a Telegram chat named “{needle}”. Use the name shown in your chat list or @username."
    ))
}

pub async fn send_message(to: &str, body: &str) -> Result<TelegramSendResult, String> {
    let body = body.trim();
    if body.is_empty() {
        return Err("Message cannot be empty.".to_string());
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err("The message is too long.".to_string());
    }
    let app_data = app_data_dir()?;
    if !session_looks_signed_in(&app_data) {
        return Err("Telegram is not connected.".to_string());
    }
    let client = connect_client(&app_data).await?;
    if !client.is_authorized().await.map_err(map_err)? {
        return Err("Telegram is not connected. Connect again.".to_string());
    }
    let chat = resolve_chat(&client, to).await?;
    let sent = client.send_message(chat, body).await.map_err(map_err)?;
    save_session(&client, &session_path(&app_data))?;
    Ok(TelegramSendResult {
        sent: true,
        id: Some(sent.id()),
        reason: None,
    })
}

pub async fn read_messages(
    chat: Option<String>,
    max_results: Option<u32>,
) -> Result<TelegramReadResult, String> {
    let app_data = app_data_dir()?;
    if !session_looks_signed_in(&app_data) {
        return Ok(TelegramReadResult {
            ok: false,
            messages: None,
            reason: Some("Telegram is not connected.".into()),
        });
    }
    let client = connect_client(&app_data).await?;
    if !client.is_authorized().await.map_err(map_err)? {
        return Ok(TelegramReadResult {
            ok: false,
            messages: None,
            reason: Some("Telegram is not connected. Connect again.".into()),
        });
    }

    let named = chat.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let messages = if let Some(name) = named {
        let max = max_results
            .unwrap_or(DEFAULT_HISTORY as u32)
            .clamp(1, MAX_HISTORY as u32) as usize;
        let peer = resolve_chat(&client, name).await?;
        let label = chat_label(&peer);
        let username = chat_username(&peer);
        let mut iter = client.iter_messages(peer.clone()).limit(max);
        let mut newest_first = Vec::new();
        while let Some(msg) = iter.next().await.map_err(map_err)? {
            let from = if msg.outgoing() {
                "You".to_string()
            } else {
                msg.sender()
                    .map(|s| chat_label(&s))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| label.clone())
            };
            newest_first.push(TelegramMessageSummary {
                chat: label.clone(),
                username: username.clone(),
                from: Some(from),
                preview: trim_preview(msg.text()),
            });
        }
        newest_first.reverse();
        newest_first
    } else {
        let max = max_results
            .unwrap_or(DEFAULT_DIALOG_LIST as u32)
            .clamp(1, MAX_DIALOG_LIST as u32) as usize;
        let mut dialogs = client.iter_dialogs();
        let mut out = Vec::new();
        while let Some(dialog) = dialogs.next().await.map_err(map_err)? {
            if out.len() >= max {
                break;
            }
            let chat = dialog.chat();
            out.push(TelegramMessageSummary {
                chat: chat_label(chat),
                username: chat_username(chat),
                from: None,
                preview: dialog.last_message.as_ref().and_then(|m| trim_preview(m.text())),
            });
        }
        out
    };

    save_session(&client, &session_path(&app_data))?;
    Ok(TelegramReadResult {
        ok: true,
        messages: Some(messages),
        reason: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_phone() {
        assert_eq!(normalize_phone("+1 415 555 2671").unwrap(), "+14155552671");
        assert!(normalize_phone("123").is_err());
    }

    #[test]
    fn user_error_hides_env() {
        let lower = USER_UNAVAILABLE.to_lowercase();
        assert!(!lower.contains(".env"));
        assert!(!lower.contains("api_id"));
        assert!(!lower.contains("my.telegram"));
    }

    #[test]
    fn matches_saved_name_before_username() {
        let cands = ["Priya Sharma", "Priya", "Sharma", "priya_s", "@priya_s"];
        assert_eq!(match_chat_name("Priya Sharma", &cands), Some(0));
        assert_eq!(match_chat_name("priya", &cands), Some(0));
        assert_eq!(match_chat_name("@priya_s", &cands), Some(0));
        assert_eq!(match_chat_name("Sharma", &cands), Some(0));
        assert_eq!(match_chat_name("priya sha", &cands), Some(1));
        assert_eq!(match_chat_name("nobody-here", &cands), None);
    }
}
