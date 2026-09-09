//! Google connector OAuth credentials live on **nela-backend** only.
//!
//! Desktop apps must not ship `GOOGLE_CONNECTOR_CLIENT_ID` / `_SECRET`.
//! Connect flows use `connectors::oauth_client` (start → browser → poll →
//! local token store). Token refresh also goes through the API broker.

/// User-facing message when something still expects a local connector client.
pub const CREDENTIALS_ON_BACKEND: &str = "Google connector sign-in is handled by NELA Cloud. \
Connect from Settings or the Connectors panel — no Google client secrets are stored in the desktop app.";

/// Removed: desktop must not resolve a Google connector client ID.
pub fn connector_client_id() -> Result<String, String> {
    Err(CREDENTIALS_ON_BACKEND.to_string())
}

/// Removed: desktop must not ship a Google connector client secret.
pub fn connector_client_secret() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::CREDENTIALS_ON_BACKEND;

    #[test]
    fn user_error_does_not_mention_env_or_gcp() {
        let lower = CREDENTIALS_ON_BACKEND.to_lowercase();
        assert!(!lower.contains(".env"));
        assert!(!lower.contains("client_id"));
        assert!(!lower.contains("google cloud"));
    }
}
