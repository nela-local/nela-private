//! Presentation artifact rendering (HTML slide decks).

mod enrich;
mod parse;
mod write;

use std::path::Path;

pub use parse::{is_nela_presentation_html, parse_presentation_html};
pub use write::write_presentation_plan;

/// Derive a filesystem-safe output stem for an edited deck copy.
pub fn edited_output_name(source_path: &str) -> String {
    let base = Path::new(source_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("nela_presentation");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let stem = trimmed.chars().take(72).collect::<String>();
    if stem.is_empty() {
        "nela_presentation_edited".to_string()
    } else if stem.ends_with("_edited") {
        stem
    } else {
        format!("{stem}_edited")
    }
}
