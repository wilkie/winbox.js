//! The keyboard on the raster desktop, as winbox.js's `raster-input.ts`
//! gives it to the windows: a key the host names turned into the virtual
//! key Windows' keyboard driver would give, posted to the queue of the
//! program whose window has the focus -- or, with none, is active -- and
//! what it typed kept for `TranslateMessage`.
//!
//! Nothing here calls into a program: each message is posted, as the input
//! queue posts it. Which keys are system keys is measured by `altchild`,
//! which puts its keys in through `KEYBD_EVENT` (`keybd_event`); the rest of
//! the input queue is not.

use crate::queue::{Message, WM_KEYDOWN};
use crate::system::System;

const WM_KEYUP: u16 = 0x0101;
const WM_CHAR: u16 = 0x0102;
const WM_SYSKEYDOWN: u16 = 0x0104;
const WM_SYSKEYUP: u16 = 0x0105;
const WM_SYSCHAR: u16 = 0x0106;

const VK_SHIFT: u16 = 0x10;
const VK_CONTROL: u16 = 0x11;
const VK_MENU: u16 = 0x12;
const VK_F10: u16 = 0x79;

/// A key the host hands in.
#[derive(Debug, Clone)]
pub struct Key {
    /// The host's name for the key, as a web page names it: `KeyA`,
    /// `Digit1`, `Enter`, `ShiftLeft`.
    pub code: String,
    /// What it types, if it types one character.
    pub key: String,
    /// Whether it is held down and repeating.
    pub repeat: bool,
    /// Whether Alt is held: the key is then a system key.
    pub alt: bool,
}

/// The virtual key of a key the host names, as `User.VIRTUAL_KEY_TRANSLATE`
/// has them: the named keys, and the keys that are not letters, digits or
/// named as the US keyboard driver gives them -- `KEYBOARD.DRV`'s table of
/// a virtual key for each scan code, at file offset `12ee`, read at the scan
/// code each of these keys sends. `ContextMenu` is `VK_MENU`, as the
/// TypeScript engine's table has it.
const VIRTUAL_KEYS: &[(&str, u16)] = &[
    ("Enter", 0x0d),
    ("NumpadEnter", 0x0d),
    ("Space", 0x20),
    ("Escape", 0x1b),
    ("F1", 0x70),
    ("F2", 0x71),
    ("F3", 0x72),
    ("F4", 0x73),
    ("F5", 0x74),
    ("F6", 0x75),
    ("F7", 0x76),
    ("F8", 0x77),
    ("F9", 0x78),
    ("F10", 0x79),
    ("F11", 0x7a),
    ("F12", 0x7b),
    ("F13", 0x7c),
    ("F14", 0x7d),
    ("F15", 0x7e),
    ("F16", 0x7f),
    ("F17", 0x80),
    ("F18", 0x81),
    ("F19", 0x82),
    ("F20", 0x83),
    ("F21", 0x84),
    ("F22", 0x85),
    ("F23", 0x86),
    ("F24", 0x87),
    ("NumLock", 0x90),
    ("ScrollLock", 0x91),
    ("Backspace", 0x08),
    ("Tab", 0x09),
    ("Clear", 0x0c),
    ("ShiftLeft", 0x10),
    ("ControlLeft", 0x11),
    ("ContextMenu", 0x12),
    ("Pause", 0x13),
    ("CapsLock", 0x14),
    ("PageUp", 0x21),
    ("PageDown", 0x22),
    ("End", 0x23),
    ("Home", 0x24),
    ("ArrowLeft", 0x25),
    ("ArrowUp", 0x26),
    ("ArrowRight", 0x27),
    ("ArrowDown", 0x28),
    ("PrintScreen", 0x2a),
    ("Insert", 0x2d),
    ("Delete", 0x2e),
    ("Numpad0", 0x60),
    ("Numpad1", 0x61),
    ("Numpad2", 0x62),
    ("Numpad3", 0x63),
    ("Numpad4", 0x64),
    ("Numpad5", 0x65),
    ("Numpad6", 0x66),
    ("Numpad7", 0x67),
    ("Numpad8", 0x68),
    ("Numpad9", 0x69),
    ("NumpadMultiply", 0x6a),
    ("NumpadAdd", 0x6b),
    ("NumpadSubtract", 0x6d),
    ("NumpadDecimal", 0x6e),
    ("NumpadDivide", 0x6f),
    ("ShiftRight", 0x10),
    ("ControlRight", 0x11),
    // The scan codes `-` 0Ch, `=` 0Dh, `[` 1Ah, `]` 1Bh, `;` 27h, `'` 28h,
    // `` ` `` 29h, `\` 2Bh, `,` 33h, `.` 34h, `/` 35h, and the 102nd key
    // 56h.
    ("Minus", 0xbd),
    ("Equal", 0xbb),
    ("BracketLeft", 0xdb),
    ("BracketRight", 0xdd),
    ("Semicolon", 0xba),
    ("Quote", 0xde),
    ("Backquote", 0xc0),
    ("Backslash", 0xdc),
    ("Comma", 0xbc),
    ("Period", 0xbe),
    ("Slash", 0xbf),
    ("IntlBackslash", 0xe2),
];

/// The virtual key of a key the host names: a letter's and a digit's are
/// their own character, Alt is `VK_MENU`, the rest from the table; nought
/// for one Windows has no key for.
pub fn virtual_key(code: &str) -> u16 {
    if code == "AltLeft" || code == "AltRight" {
        return VK_MENU;
    }

    let single = |prefix: &str, range: std::ops::RangeInclusive<u8>| {
        code.strip_prefix(prefix)
            .filter(|rest| rest.len() == 1 && range.contains(&rest.as_bytes()[0]))
            .map(|rest| u16::from(rest.as_bytes()[0]))
    };

    single("Key", b'A'..=b'Z')
        .or_else(|| single("Digit", b'0'..=b'9'))
        .or_else(|| {
            VIRTUAL_KEYS
                .iter()
                .find(|&&(name, _)| name == code)
                .map(|&(_, key)| key)
        })
        .unwrap_or(0)
}

/// The control character a key types that the host names rather than
/// gives: the keyboard driver's `ToAscii` makes them 8, 9, 13 and 27.
fn control_character(code: &str) -> Option<u8> {
    match code {
        "Backspace" => Some(0x08),
        "Tab" => Some(0x09),
        "Enter" | "NumpadEnter" => Some(0x0d),
        "Escape" => Some(0x1b),
        _ => None,
    }
}

/// Whether a key pressed or released is a system key, `WM_SYSKEYDOWN` or
/// `WM_SYSKEYUP`, with Alt down or not and Control down or not; the count
/// of keys pressed while Alt has been down kept up (`virtual_key_event`).
fn is_system_key(
    virtual_key: u16,
    down: bool,
    alt: bool,
    control: bool,
    keys_with_alt: &mut u32,
) -> bool {
    let made = if virtual_key == VK_MENU {
        if down {
            *keys_with_alt = 0;
        }

        !control && (down || *keys_with_alt == 0)
    } else if virtual_key != VK_CONTROL && alt {
        if down {
            *keys_with_alt = keys_with_alt.wrapping_add(1);
        }

        !control
    } else {
        false
    };

    // The system queue makes F10 a system key as it is taken, whatever
    // `KEYBD_EVENT` made it (seg1 `3188`).
    made || virtual_key == VK_F10
}

impl System {
    /// A key the host names pressed or released: its virtual key, and what
    /// it types, to `virtual_key_event`.
    pub fn key_event(&mut self, down: bool, key: &Key) {
        let virtual_key = virtual_key(&key.code);

        if virtual_key == 0 {
            return;
        }

        // One character, as a page's string counts them: one UTF-16 unit;
        // or the control character a key the host names types.
        let mut characters = key.key.chars();
        let typed =
            control_character(&key.code).or_else(|| match (characters.next(), characters.next()) {
                (Some(character), None) if u32::from(character) < 0x1_0000 => {
                    Some((u32::from(character) & 0xff) as u8)
                }
                _ => None,
            });

        self.virtual_key_event(down, virtual_key, key.alt, key.repeat, typed);
    }

    /// A virtual key pressed or released, as the keyboard driver hands it to
    /// USER's `KEYBD_EVENT`: the host's keys, and a program's own through
    /// that entry (`keybd_event`). `WM_KEYDOWN` or `WM_KEYUP` to the window
    /// with the focus, else the active one, and nothing where that window,
    /// or one it is inside, is disabled. `lParam` is a repeat count of one,
    /// bit 30 for a key already down, bits 30 and 31 for a release, and bit
    /// 29 while Alt is down. While USER's system error box is up, the key is
    /// the box's instead.
    ///
    /// **Read out** of `USER.EXE`: `KEYBD_EVENT` (seg1 `4b59`, then
    /// `4c1d`-`4c4e`) makes a key a system key, `WM_SYSKEYDOWN` or
    /// `WM_SYSKEYUP`, when Alt is down and Control is not. Alt's own press
    /// is one; its release is one only if no other key was pressed while it
    /// was down (the count at `32d`), else a plain `WM_KEYUP`; Control is
    /// never one. The system queue makes F10 one as the key is taken from
    /// it, Alt or not (seg1 `3188`). **Recorded** by `altchild`, whose keys
    /// go in through `KEYBD_EVENT`: Alt's press with bit 29, its release
    /// alone as `WM_SYSKEYUP` without it, and F10 alone as `WM_SYSKEYDOWN`
    /// and `WM_SYSKEYUP`.
    pub fn virtual_key_event(
        &mut self,
        down: bool,
        virtual_key: u16,
        alt: bool,
        repeat: bool,
        typed: Option<u8>,
    ) {
        let target = self
            .focus
            .filter(|&index| self.windows[index].is_some())
            .or_else(|| self.active_window());
        let modal = self.modal_input.is_some();

        if !modal && target.is_none_or(|target| self.disabled(target)) {
            return;
        }

        let table = &mut self.user_state.async_keys;

        if down {
            table[usize::from(virtual_key as u8)] |= 0x81;
        } else {
            table[usize::from(virtual_key as u8)] &= !0x80;
        }

        // Alt's own press has Alt down, and its release has it up, whatever
        // the host says of it (`altchild`).
        let alt = if virtual_key == VK_MENU { down } else { alt };
        let control = table[usize::from(VK_CONTROL)] & 0x80 != 0;
        let system_key = is_system_key(
            virtual_key,
            down,
            alt,
            control,
            &mut self.user_state.keys_with_alt,
        );
        let message = match (system_key, down) {
            (true, true) => WM_SYSKEYDOWN,
            (true, false) => WM_SYSKEYUP,
            (false, true) => WM_KEYDOWN,
            (false, false) => WM_KEYUP,
        };

        // USER's system error box up: the key is its, at the cursor.
        if modal {
            let (x, y) = self.cursor_of();

            if let Some(queue) = self.modal_input.as_mut() {
                queue.push_back((message, virtual_key, x, y));
            }

            return;
        }

        let Some(target) = target else {
            return;
        };

        // A letter typed with Control down is a control character: the
        // keyboard driver's `ToAscii` gives the letter's code with only its
        // low five bits, Shift down or not (`KEYBOARD.DRV` seg10
        // `05a0`-`05b4`). As a page names it, the key types the letter.
        let typed = if control && (0x41..=0x5a).contains(&virtual_key) {
            Some(virtual_key as u8 & 0x1f)
        } else {
            typed
        };

        if down && let Some(typed) = typed {
            self.user_state.typed.insert(virtual_key, typed);
        }

        let mut lparam = 1 | if repeat { 1 << 30 } else { 0 };

        if !down {
            lparam |= 3 << 30;
        }

        if alt {
            lparam |= 1 << 29;
        }

        let hwnd = self.windows[target]
            .as_ref()
            .map_or(0, |window| window.hwnd);

        self.post_input(hwnd, message, virtual_key, lparam);
    }

    /// The keyboard driver's way into USER: a key pressed or released, put
    /// in as the keyboard made it, called with registers, not a stack.
    /// **Read out** of `USER.EXE` (seg1 `4b59`): AL the virtual key, AH 80h
    /// for a release and nought for a press (`4b6c`-`4b8b`), BL the scan
    /// code. What makes it a system key is `virtual_key_event`'s.
    /// **Recorded** by `altchild`, which puts all its keys in through this
    /// entry. Not modelled: the scan code, which goes into bits 16 to 23 of
    /// `lParam` on Windows and is nought here, as it is for the host's keys;
    /// and the character a key types is the US keyboard's, unshifted unless
    /// Shift is down, for the letters, the digits, Space and the keys that
    /// type a control character.
    pub fn keybd_event(&mut self) {
        let ax = self.cpu.regs[winbox_cpu::AX];

        if !self.raster() {
            return;
        }

        let virtual_key = ax & 0xff;
        let down = ax & 0xff00 == 0;
        let held =
            |system: &Self, key: u16| system.user_state.async_keys[usize::from(key)] & 0x80 != 0;
        let shift = held(self, VK_SHIFT);
        let typed = match virtual_key {
            0x41..=0x5a if shift => Some(virtual_key as u8),
            0x41..=0x5a => Some(virtual_key as u8 + 0x20),
            0x30..=0x39 | 0x20 | 0x08 | 0x09 | 0x0d | 0x1b => Some(virtual_key as u8),
            _ => None,
        };
        // Alt down with it, as the key leaves it: Alt's own release is
        // without.
        let alt = if virtual_key == VK_MENU {
            down
        } else {
            held(self, VK_MENU)
        };
        // A press of a key already down is a repeat, bit 30.
        let repeat = down && held(self, virtual_key);

        self.virtual_key_event(down, virtual_key, alt, repeat, typed);
    }

    /// What a key typed, posted after it as `WM_CHAR` -- `WM_SYSCHAR` for a
    /// system key -- to the running task's queue, with the key's own
    /// `lParam`, time and point, as `TranslateMessage` posts it on the
    /// raster desktop. Only a press types.
    pub(crate) fn post_typed(&mut self, message: &Message) {
        if message.message != WM_KEYDOWN && message.message != WM_SYSKEYDOWN {
            return;
        }

        let Some(&typed) = self.user_state.typed.get(&message.wparam) else {
            return;
        };
        let character = Message {
            message: if message.message == WM_KEYDOWN {
                WM_CHAR
            } else {
                WM_SYSCHAR
            },
            wparam: u16::from(typed),
            serial: 0,
            ..*message
        };

        if let Some(task) = self.task.as_mut() {
            task.queue.push(character, false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The system keys as `KEYBD_EVENT` makes them (`altchild`; `USER.EXE`
    /// seg1 `4c1d`-`4c4e`, `3188`).
    #[test]
    fn system_keys_as_keybd_event_makes_them() {
        let mut count = 0;

        // Alt pressed and released alone: both system keys.
        assert!(is_system_key(VK_MENU, true, true, false, &mut count));
        assert!(is_system_key(VK_MENU, false, false, false, &mut count));

        // Released after another key: a plain release.
        assert!(is_system_key(VK_MENU, true, true, false, &mut count));
        assert!(is_system_key(0x73, true, true, false, &mut count));
        assert!(!is_system_key(VK_MENU, false, false, false, &mut count));

        // F10, Alt or not; Control down, none.
        assert!(is_system_key(VK_F10, true, false, false, &mut count));
        assert!(!is_system_key(0x58, true, true, true, &mut count));
        assert!(!is_system_key(VK_CONTROL, true, true, false, &mut count));
        assert!(!is_system_key(0x41, true, false, false, &mut count));
    }

    #[test]
    fn keys_named_as_a_page_names_them() {
        assert_eq!(virtual_key("KeyA"), 0x41);
        assert_eq!(virtual_key("Digit7"), 0x37);
        assert_eq!(virtual_key("AltRight"), VK_MENU);
        assert_eq!(virtual_key("Enter"), 0x0d);
        assert_eq!(virtual_key("Slash"), 0xbf);
        assert_eq!(virtual_key("Keya"), 0);
        assert_eq!(virtual_key("KeyAB"), 0);
        assert_eq!(virtual_key("MetaLeft"), 0);
    }
}
