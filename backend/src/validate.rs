use std::collections::BTreeMap;

use crate::error::AppError;

/// Collects field errors so a request reports every problem at once.
#[derive(Default)]
pub struct Validator {
    errors: BTreeMap<String, String>,
}

impl Validator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn fail(&mut self, field: &str, message: impl Into<String>) {
        self.errors.entry(field.to_owned()).or_insert_with(|| message.into());
    }

    /// Non-blank text no longer than `max` characters.
    pub fn text(&mut self, field: &str, value: &str, max: usize) {
        let len = value.trim().chars().count();
        if len == 0 {
            self.fail(field, "This field is required.");
        } else if len > max {
            self.fail(field, format!("Must be at most {max} characters."));
        }
    }

    /// Optional text: only the length is checked.
    pub fn optional_text(&mut self, field: &str, value: Option<&str>, max: usize) {
        if let Some(v) = value {
            if v.trim().chars().count() > max {
                self.fail(field, format!("Must be at most {max} characters."));
            }
        }
    }

    pub fn email(&mut self, field: &str, value: &str) {
        let v = value.trim();
        let valid = v.len() <= 254
            && v.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
            })
            && !v.chars().any(char::is_whitespace);
        if !valid {
            self.fail(field, "Enter a valid email address.");
        }
    }

    pub fn password(&mut self, field: &str, value: &str) {
        let len = value.chars().count();
        if len < 10 {
            self.fail(field, "Use at least 10 characters.");
        } else if len > 128 {
            self.fail(field, "Use at most 128 characters.");
        } else if !(value.chars().any(|c| c.is_alphabetic()) && value.chars().any(|c| c.is_ascii_digit())) {
            self.fail(field, "Use a mix of letters and numbers.");
        }
    }

    pub fn one_of(&mut self, field: &str, value: &str, allowed: &[&str]) {
        if !allowed.contains(&value) {
            self.fail(field, format!("Must be one of: {}.", allowed.join(", ")));
        }
    }

    pub fn finish(self) -> Result<(), AppError> {
        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(AppError::Validation(self.errors))
        }
    }
}

/// Trims and turns blank strings into `None`.
pub fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}
