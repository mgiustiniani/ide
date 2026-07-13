const MAX_CLIPBOARD_TEXT_BYTES: usize = 2 * 1024 * 1024;

const CLIPBOARD_UNAVAILABLE: &str = "Clipboard is unavailable.";
const CLIPBOARD_NON_TEXT: &str = "Clipboard does not contain text.";
const CLIPBOARD_OVERSIZED: &str = "Clipboard text exceeds the 2 MiB limit.";
const CLIPBOARD_PERMISSION_DENIED: &str = "Clipboard permission was denied.";
const CLIPBOARD_PLATFORM_ERROR: &str = "Clipboard is not supported on this platform.";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClipboardErrorKind {
    Unavailable,
    NonText,
    Oversized,
    PermissionDenied,
    Platform,
}

impl ClipboardErrorKind {
    const fn message(self) -> &'static str {
        match self {
            Self::Unavailable => CLIPBOARD_UNAVAILABLE,
            Self::NonText => CLIPBOARD_NON_TEXT,
            Self::Oversized => CLIPBOARD_OVERSIZED,
            Self::PermissionDenied => CLIPBOARD_PERMISSION_DENIED,
            Self::Platform => CLIPBOARD_PLATFORM_ERROR,
        }
    }
}

fn unknown_error_kind(description: &str) -> ClipboardErrorKind {
    let description = description.to_ascii_lowercase();
    if description.contains("permission")
        || description.contains("denied")
        || description.contains("forbidden")
        || description.contains("not authorized")
    {
        ClipboardErrorKind::PermissionDenied
    } else {
        ClipboardErrorKind::Platform
    }
}

fn initialization_error_kind(error: &arboard::Error) -> ClipboardErrorKind {
    match error {
        arboard::Error::ClipboardNotSupported => ClipboardErrorKind::Platform,
        arboard::Error::Unknown { description } => unknown_error_kind(description),
        _ => ClipboardErrorKind::Unavailable,
    }
}

fn read_error_kind(error: &arboard::Error) -> ClipboardErrorKind {
    match error {
        arboard::Error::ContentNotAvailable => ClipboardErrorKind::NonText,
        arboard::Error::ClipboardNotSupported => ClipboardErrorKind::Platform,
        arboard::Error::ClipboardOccupied => ClipboardErrorKind::Unavailable,
        arboard::Error::ConversionFailure => ClipboardErrorKind::Platform,
        arboard::Error::Unknown { description } => unknown_error_kind(description),
        _ => ClipboardErrorKind::Platform,
    }
}

fn enforce_text_cap(text: String) -> Result<String, ClipboardErrorKind> {
    if text.len() > MAX_CLIPBOARD_TEXT_BYTES {
        Err(ClipboardErrorKind::Oversized)
    } else {
        Ok(text)
    }
}

/// Reads the current clipboard's plain-text representation on explicit invocation only.
///
/// The clipboard is not watched or retained. Empty text is returned unchanged so callers can
/// apply use-case-specific validation.
#[tauri::command]
pub fn read_clipboard_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| initialization_error_kind(&error).message().to_owned())?;
    let text = clipboard
        .get_text()
        .map_err(|error| read_error_kind(&error).message().to_owned())?;

    enforce_text_cap(text).map_err(|error| error.message().to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_accepts_empty_and_does_not_alter_text() {
        assert_eq!(enforce_text_cap(String::new()), Ok(String::new()));

        let source = "  class Example {\n}\n".to_owned();
        assert_eq!(enforce_text_cap(source.clone()), Ok(source));
    }

    #[test]
    fn cap_accepts_exact_utf8_byte_limit() {
        let source = "é".repeat(MAX_CLIPBOARD_TEXT_BYTES / 2);
        assert_eq!(source.len(), MAX_CLIPBOARD_TEXT_BYTES);
        assert_eq!(enforce_text_cap(source.clone()), Ok(source));
    }

    #[test]
    fn cap_rejects_text_over_utf8_byte_limit() {
        let source = format!("{}é", "a".repeat(MAX_CLIPBOARD_TEXT_BYTES - 1));
        assert_eq!(source.len(), MAX_CLIPBOARD_TEXT_BYTES + 1);
        assert_eq!(enforce_text_cap(source), Err(ClipboardErrorKind::Oversized));
    }

    #[test]
    fn read_errors_map_to_distinct_static_messages() {
        assert_eq!(
            read_error_kind(&arboard::Error::ContentNotAvailable).message(),
            CLIPBOARD_NON_TEXT
        );
        assert_eq!(
            read_error_kind(&arboard::Error::ClipboardOccupied).message(),
            CLIPBOARD_UNAVAILABLE
        );
        assert_eq!(
            read_error_kind(&arboard::Error::ClipboardNotSupported).message(),
            CLIPBOARD_PLATFORM_ERROR
        );
        assert_eq!(
            unknown_error_kind("portal permission denied").message(),
            CLIPBOARD_PERMISSION_DENIED
        );
        assert_eq!(
            unknown_error_kind("backend initialization failed").message(),
            CLIPBOARD_PLATFORM_ERROR
        );
    }

    #[test]
    fn backend_details_are_never_exposed_in_messages() {
        let sensitive_detail = "permission denied while handling SECRET_CLIPBOARD_TEXT";
        let kind = unknown_error_kind(sensitive_detail);

        assert_eq!(kind.message(), CLIPBOARD_PERMISSION_DENIED);
        assert!(!kind.message().contains("SECRET_CLIPBOARD_TEXT"));
    }

    #[test]
    fn initialization_errors_distinguish_unavailable_platform_and_permission() {
        assert_eq!(
            initialization_error_kind(&arboard::Error::ClipboardOccupied),
            ClipboardErrorKind::Unavailable
        );
        assert_eq!(
            initialization_error_kind(&arboard::Error::ClipboardNotSupported),
            ClipboardErrorKind::Platform
        );
        assert_eq!(
            initialization_error_kind(&arboard::Error::Unknown {
                description: "access forbidden".to_owned(),
            }),
            ClipboardErrorKind::PermissionDenied
        );
    }

    #[test]
    #[ignore = "manual native clipboard smoke test; requires an interactive display"]
    fn manual_read_never_logs_clipboard_content() {
        match read_clipboard_text() {
            Ok(text) => assert!(text.len() <= MAX_CLIPBOARD_TEXT_BYTES),
            Err(message) => assert!(matches!(
                message.as_str(),
                CLIPBOARD_UNAVAILABLE
                    | CLIPBOARD_NON_TEXT
                    | CLIPBOARD_OVERSIZED
                    | CLIPBOARD_PERMISSION_DENIED
                    | CLIPBOARD_PLATFORM_ERROR
            )),
        }
    }
}
