//! The host's mouse and keyboard as Windows' input, as the page turns its
//! canvas's events: the same for the one window of desktop mode and for the
//! windows of seamless mode, which only say where on the screen the pointer
//! is.

use std::time::{Duration, Instant};

use winbox_win16::key_input::Key;
use winbox_win16::raster_input::{Pointer, PointerKind};
use winit::event::{ElementState, KeyEvent, MouseButton};
use winit::keyboard::{Key as LogicalKey, KeyCode, ModifiersState, NamedKey, PhysicalKey};

/// How close in time and place a second press must be to make a double
/// click, as a page's `detail` of 2 says one is: Windows' own 500
/// milliseconds and four pixels.
const DOUBLE_CLICK: Duration = Duration::from_millis(500);
const DOUBLE_CLICK_DISTANCE: i32 = 4;

/// One thing the host's mouse or keyboard did.
#[derive(Debug)]
pub enum Input {
    Pointer(Pointer),
    Key(bool, Key),
}

/// The last press, for the next to be a double click of.
#[derive(Debug, Clone, Copy)]
struct Press {
    button: u8,
    x: i32,
    y: i32,
    at: Instant,
}

/// The mouse and keyboard as the host left them, and what they did since
/// the machine was last given it.
#[derive(Debug, Default)]
pub struct Inputs {
    /// Where the pointer is on the screen, and the buttons down: left 1,
    /// right 2, middle 4.
    pub pointer: (i16, i16),
    pub buttons: u8,
    pub modifiers: ModifiersState,
    last_press: Option<Press>,
    pub input: Vec<Input>,
    /// F12 pressed as Ctrl+Shift+F12, the drives' (`key`): its release is
    /// theirs too.
    chord: bool,
}

impl Inputs {
    fn pointer(&mut self, kind: PointerKind, button: u8, double: bool) {
        self.input.push(Input::Pointer(Pointer {
            kind,
            x: self.pointer.0,
            y: self.pointer.1,
            button,
            buttons: self.buttons,
            double,
        }));
    }

    /// The pointer moved to a point of the screen.
    pub fn moved(&mut self, at: (i16, i16)) {
        self.pointer = at;
        self.pointer(PointerKind::Move, 0, false);
    }

    pub fn button(&mut self, state: ElementState, button: MouseButton) {
        // The button changed as a page numbers it -- 0 left, 1 middle, 2
        // right -- and as a bit of those down.
        let (number, bit) = match button {
            MouseButton::Left => (0, 1),
            MouseButton::Right => (2, 2),
            MouseButton::Middle => (1, 4),
            _ => return,
        };

        if state == ElementState::Pressed {
            let (x, y) = (i32::from(self.pointer.0), i32::from(self.pointer.1));
            let double = self.last_press.is_some_and(|press| {
                press.button == number
                    && press.at.elapsed() < DOUBLE_CLICK
                    && (press.x - x).abs() <= DOUBLE_CLICK_DISTANCE
                    && (press.y - y).abs() <= DOUBLE_CLICK_DISTANCE
            });

            // A third press starts again, as a page's `detail` counts on.
            self.last_press = (!double).then_some(Press {
                button: number,
                x,
                y,
                at: Instant::now(),
            });
            self.buttons |= bit;
            self.pointer(PointerKind::Down, number, double);
        } else {
            self.buttons &= !bit;
            self.pointer(PointerKind::Up, number, false);
        }
    }

    pub fn key(&mut self, event: &KeyEvent) {
        // winit names a key as a page does: `KeyA`, `Enter`, `ShiftLeft`.
        let PhysicalKey::Code(code) = event.physical_key else {
            return;
        };

        // Ctrl+Shift+F12, with images mounted, is the drives': the next disk
        // in each drive with a set (`mounts.rs`). Neither press nor release
        // of F12 reaches Windows; Ctrl and Shift did, and are let go of as
        // ever.
        if code == KeyCode::F12 && crate::mounts::chord_taken() {
            let chord = self.modifiers.control_key()
                && self.modifiers.shift_key()
                && !self.modifiers.alt_key();

            if event.state == ElementState::Pressed && chord {
                if !event.repeat {
                    crate::mounts::ask_next();
                }

                self.chord = true;
                return;
            }

            if event.state == ElementState::Released && std::mem::take(&mut self.chord) {
                return;
            }
        }

        // What it types, as a page's `key` gives it: the space bar is a
        // character there, where winit names it.
        let text = match &event.logical_key {
            LogicalKey::Character(text) => text.to_string(),
            LogicalKey::Named(NamedKey::Space) => " ".to_string(),
            _ => String::new(),
        };

        self.input.push(Input::Key(
            event.state == ElementState::Pressed,
            Key {
                code: format!("{code:?}"),
                key: text,
                repeat: event.repeat,
                alt: self.modifiers.alt_key(),
            },
        ));
    }

    /// A key named as a page names it pressed or let go, as a script of
    /// `--script` types it: what it types, a letter's or a digit's own.
    pub fn named_key(&mut self, down: bool, code: &str) {
        let letter = code
            .strip_prefix("Key")
            .or_else(|| code.strip_prefix("Digit"))
            .filter(|rest| rest.len() == 1);
        let text = match letter {
            Some(letter) => letter.to_ascii_lowercase(),
            None if code == "Space" => " ".to_string(),
            None => String::new(),
        };

        // Alt held from its press, as the host's modifiers have it.
        if code.starts_with("Alt") {
            self.modifiers.set(ModifiersState::ALT, down);
        }

        self.input.push(Input::Key(
            down,
            Key {
                code: code.to_string(),
                key: text,
                repeat: false,
                alt: self.modifiers.alt_key(),
            },
        ));
    }
}
