//! The compatibility catalog's hand at a setup (`scripts/catalog/pass.mjs`,
//! `kb/guides/compatibility.md`, "Installs"): a look every few seconds, and
//! Enter pressed where the windows are as they were at the last look (a
//! setup copying its files changes its dialog's text as it goes, and Enter
//! there would press its Cancel); where Enter has done nothing for two
//! presses, what a person would do instead.
//!
//! * **The click rule.** The left button pressed and let go at the centre of
//!   the first push button shown whose caption is, in this order of
//!   preference, "Continue", "Install", "Next", "OK", "Yes" or "Complete"
//!   (its first word, `&` and what is not a letter left out).
//! * **The Alt rule.** Where the click too did nothing for two presses, or
//!   no such button takes a click, Alt with the letter its caption
//!   underlines (the letter after `&`).
//!
//! "Did nothing" is the windows as they were: the same windows, captions,
//! places, showing and disabling, and the same focus, before a press and
//! before the next. Each thing done is kept as a survey report's mark
//! (`stepMarks`), so `trace --marks` does the run again as it was.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::call_marks::{CallMark, MarkAction};
use crate::key_input::Key;
use crate::raster_input::{Pointer, PointerKind};
use crate::system::System;

/// The captions the click rule looks for, the first preferred.
pub const CAPTIONS: [&str; 6] = ["continue", "install", "next", "ok", "yes", "complete"];

/// A window disabled (`WS_DISABLED`).
const WS_DISABLED: u32 = 0x0800_0000;

/// The hand's state through a run.
#[derive(Debug, Clone, Default)]
pub struct PassRules {
    /// The windows as they were at each look since the last rule's step.
    seen: Vec<u64>,
    /// The windows as they were when a button was last clicked.
    clicked_at: Option<u64>,
    /// What was done, as a report's `stepMarks`.
    pub steps: Vec<serde_json::Value>,
    /// The rules' own steps alone: when, which rule, which button.
    pub rules: Vec<serde_json::Value>,
}

/// A push button as the rules see it: its slot, its caption and where its
/// centre is on the screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Button {
    pub slot: usize,
    pub id: u16,
    pub class: String,
    pub caption: String,
    pub x: i32,
    pub y: i32,
}

/// The looks of a run, one each `every` milliseconds from `every` until
/// `seconds`.
#[must_use]
pub fn looks(every: f64, seconds: f64) -> Vec<CallMark> {
    let mut marks = Vec::new();
    let mut time = every;

    while time < seconds * 1000.0 {
        marks.push(CallMark {
            instructions: 0,
            calls: 0,
            time,
            action: MarkAction::Look,
        });
        time += every;
    }

    marks
}

/// A caption's words as the rules compare them: `&` left out, each word its
/// letters and digits alone, in lower case.
fn words_of(caption: &str) -> Vec<String> {
    caption
        .replace('&', "")
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_lowercase)
        .collect()
}

/// The letter a caption underlines: the one after a single `&`.
fn accelerator(caption: &str) -> Option<char> {
    let bytes = caption.as_bytes();
    let mut at = 0;

    while at + 1 < bytes.len() {
        if bytes[at] == b'&' {
            if bytes[at + 1] == b'&' {
                at += 2;
                continue;
            }

            let letter = char::from(bytes[at + 1]);

            return letter.is_ascii_alphanumeric().then_some(letter);
        }

        at += 1;
    }

    None
}

/// Which of the rules' captions a caption begins with: its place in
/// `CAPTIONS`.
#[must_use]
pub fn preference(caption: &str) -> Option<usize> {
    let words = words_of(caption);
    let first = words.first()?;

    CAPTIONS.iter().position(|wanted| first == wanted)
}

impl System {
    /// Whether a window and every window it is a child of are shown and
    /// not disabled.
    fn shown_and_enabled(&self, mut slot: usize) -> bool {
        loop {
            let Some(window) = self.windows.get(slot).and_then(Option::as_ref) else {
                return false;
            };

            if !window.visible || window.style & WS_DISABLED != 0 {
                return false;
            }

            match window.parent {
                Some(parent) => slot = parent,
                None => return true,
            }
        }
    }

    /// The push buttons of the windows, in the order of their slots: a
    /// `Button` of style `BS_PUSHBUTTON` or `BS_DEFPUSHBUTTON`, or a
    /// window of a class of its own named as a button (Visual Basic's
    /// `ThunderCommandButton`, Borland's `BorBtn`, Sheridan's 3-D
    /// `ThunderSSCommand`, whose caption is its control's and not its
    /// window's text); with `shown`, only those shown and enabled with
    /// their parents.
    #[must_use]
    pub fn push_buttons(&self, shown: bool) -> Vec<Button> {
        self.windows
            .iter()
            .enumerate()
            .filter_map(|(slot, window)| {
                let window = window.as_ref()?;
                let class = window.class.to_ascii_lowercase();
                let push = if class == "button" {
                    window.style & 0xf <= 1
                } else {
                    class.contains("button") || class.contains("btn") || class.contains("command")
                };

                (window.parent.is_some() && push && (!shown || self.shown_and_enabled(slot))).then(
                    || Button {
                        slot,
                        id: window.control_id,
                        class: window.class.clone(),
                        caption: window.title.clone(),
                        x: window.left + window.width / 2,
                        y: window.top + window.height / 2,
                    },
                )
            })
            .collect()
    }

    /// The windows as they are, as one number: each window's slot, handle,
    /// class, caption, place, size, showing and disabling, and the focus.
    fn windows_seen(&self) -> u64 {
        let mut hasher = DefaultHasher::new();

        for (slot, window) in self.windows.iter().enumerate() {
            let Some(window) = window else { continue };

            (
                slot,
                window.hwnd,
                &window.class,
                &window.title,
                window.visible,
                window.style & WS_DISABLED,
                (window.left, window.top, window.width, window.height),
            )
                .hash(&mut hasher);
        }

        self.focus.hash(&mut hasher);
        hasher.finish()
    }

    /// The button the rules would press: the first shown, enabled and
    /// found by a point at its centre, of the most preferred caption.
    fn rules_button(&self) -> Option<(usize, Button)> {
        let mut found: Option<(usize, Button)> = None;

        for button in self.push_buttons(true) {
            let Some(rank) = preference(&button.caption) else {
                continue;
            };

            if self.window_at(button.x, button.y) != Some(button.slot) {
                continue;
            }

            if found.as_ref().is_none_or(|(best, _)| rank < *best) {
                found = Some((rank, button));
            }
        }

        found
    }

    /// A look of the pass's hand (`MarkAction::Look`): Enter, or where Enter
    /// has done nothing twice, a rule's step; done now, as marks put first.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn pass_look(&mut self, time: f64) {
        let Some(mut rules) = self.call_marks.rules.take() else {
            return;
        };
        let seen = self.windows_seen();

        if rules.seen.last() != Some(&seen) {
            rules.seen.clear();
        }

        rules.seen.push(seen);

        let instructions = self.instructions;
        let calls = self.log.as_ref().map_or(0, |log| self.log_from + log.len());
        let mut done: Vec<(f64, MarkAction, serde_json::Value)> = Vec::new();
        let key = |code: &str, text: &str, alt: bool| Key {
            code: code.to_string(),
            key: text.to_string(),
            repeat: false,
            alt,
        };
        let pressed = |at: f64, key: &Key| -> Vec<(f64, MarkAction, serde_json::Value)> {
            [(at, true), (at + 50.0, false)]
                .into_iter()
                .map(|(at, down)| {
                    (
                        at,
                        MarkAction::Key {
                            down,
                            key: key.clone(),
                            time: at as u32,
                        },
                        serde_json::json!({
                            "kind": if down { "down" } else { "up" },
                            "key": key.key,
                            "code": key.code,
                            "alt": key.alt,
                        }),
                    )
                })
                .collect()
        };
        // Changed since the last look: the program is at work (a copy's
        // dialog names each file), and nothing is pressed. Quiet since: Enter;
        // quiet through two Enters: a rule.
        let quiet = rules.seen.len() >= 2;
        let stuck = rules.seen.len() >= 4;
        let button = if stuck { self.rules_button() } else { None };

        match button {
            // Clicked here before, to no end: Alt and its letter, where it
            // underlines one.
            Some((_, button))
                if rules.clicked_at == Some(seen) && accelerator(&button.caption).is_some() =>
            {
                let letter = accelerator(&button.caption).unwrap_or('a');
                let lower = letter.to_ascii_lowercase();
                let code = if lower.is_ascii_digit() {
                    format!("Digit{lower}")
                } else {
                    format!("Key{}", lower.to_ascii_uppercase())
                };

                done.extend(pressed(time, &key(&code, &lower.to_string(), true)));
                rules.rules.push(serde_json::json!({
                    "time": time, "rule": "alt", "key": lower.to_string(),
                    "id": button.id, "caption": button.caption,
                }));
                rules.clicked_at = None;
                rules.seen.clear();
            }
            Some((_, button)) if rules.clicked_at != Some(seen) => {
                let (x, y) = (button.x as i16, button.y as i16);

                for (at, kind, buttons) in [
                    (time, PointerKind::Move, 0),
                    (time + 50.0, PointerKind::Down, 1),
                    (time + 150.0, PointerKind::Up, 0),
                ] {
                    let name = match kind {
                        PointerKind::Move => "move",
                        PointerKind::Down => "down",
                        PointerKind::Up => "up",
                    };

                    done.push((
                        at,
                        MarkAction::Pointer(Pointer {
                            kind,
                            x,
                            y,
                            button: 0,
                            buttons,
                            double: false,
                        }),
                        serde_json::json!({
                            "pointer": {"kind": name, "x": x, "y": y, "button": 0, "buttons": buttons},
                        }),
                    ));
                }

                rules.rules.push(serde_json::json!({
                    "time": time, "rule": "click", "x": x, "y": y,
                    "id": button.id, "caption": button.caption,
                }));
                rules.clicked_at = Some(seen);
                rules.seen.clear();
            }
            _ if quiet => done.extend(pressed(time, &key("Enter", "\r", false))),
            _ => {}
        }

        // Kept in the order done, each at the place the look was.
        for (at, _, json) in &mut done {
            json["time"] = serde_json::json!(*at);
            json["instructions"] = serde_json::json!(instructions);
            json["calls"] = serde_json::json!(calls);
            rules.steps.push(json.clone());
        }

        // Put first, in order: the first comes now.
        for (at, action, _) in done.into_iter().rev() {
            self.call_marks.marks.push_front(CallMark {
                instructions,
                calls,
                time: at,
                action,
            });
        }

        self.call_marks.rules = Some(rules);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captions_are_compared_by_their_first_word() {
        assert_eq!(preference("&Continue"), Some(0));
        assert_eq!(preference("Install Hunting Season"), Some(1));
        assert_eq!(preference("&Next >"), Some(2));
        assert_eq!(preference("OK"), Some(3));
        assert_eq!(preference("Cancel"), None);
        assert_eq!(preference("Exit Install"), None);
        assert_eq!(preference(""), None);
    }

    #[test]
    fn the_underlined_letter_is_the_one_after_an_ampersand() {
        assert_eq!(accelerator("&Install Hunting Season"), Some('I'));
        assert_eq!(accelerator("Con&tinue"), Some('t'));
        assert_eq!(accelerator("Fish && Chips"), None);
        assert_eq!(accelerator("OK"), None);
    }

    #[test]
    fn looks_come_every_so_often() {
        let marks = looks(4000.0, 12.0);

        assert_eq!(
            marks.iter().map(|mark| mark.time).collect::<Vec<_>>(),
            [4000.0, 8000.0]
        );
    }
}
