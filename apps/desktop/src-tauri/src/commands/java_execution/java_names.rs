//! JLS 3.8 lexical admission at command boundaries; the selected compiler/JVM owns semantics.
//! Do not normalize names or reinterpret them as paths, shell text or display labels.
use regex::Regex;
use std::sync::OnceLock;

fn identifier_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(
            r"\A[\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}]*\z",
        )
        .unwrap()
    })
}
pub(super) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && !value.chars().any(char::is_control)
        && identifier_regex().is_match(value)
}
pub(super) fn binary_name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && value.split('.').all(identifier)
}
pub(super) fn pattern_segment(value: &str) -> bool {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    !value.is_empty()
        && !value.chars().any(char::is_control)
        && VALUE
            .get_or_init(|| {
                Regex::new(r"\A[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}*]+\z").unwrap()
            })
            .is_match(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_names_preserve_unicode_and_reject_protocol_and_command_syntax() {
        for name in [
            "café.Avvío𐐀",
            "测试.类",
            "cafe\u{301}.Œuvre$Étage",
            "€Compte._x",
            "pkg.ⅠClasse",
        ] {
            assert!(binary_name(name), "{name}");
        }
        for name in [
            "",
            "-jar",
            "a..B",
            "a/B",
            "a\\B",
            "1Classe",
            "a.B#test",
            "a.B;exit",
            "a.\u{301}Nom",
            "a.😀",
            "a.B\n",
            "a.B\u{85}",
        ] {
            assert!(!binary_name(name), "{name:?}");
        }
        assert!(!binary_name(&"é".repeat(257)));
        assert!(pattern_segment("*Vérif*"));
        assert!(!pattern_segment("Vérif?"));
    }
}
