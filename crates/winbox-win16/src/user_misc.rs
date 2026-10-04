//! USER's functions that need no window: its rectangle arithmetic, its
//! ANSI character set, `wvsprintf`, the global atoms, the keys' states, and
//! the small calls a program makes on its way up.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::atoms;
use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;
use crate::user::format_values;

/// What USER keeps of these calls: the double-click time once asked for or
/// set, and the keys' two tables.
#[derive(Debug, Clone)]
pub struct UserState {
    /// The double-click time, in milliseconds, once read or set.
    pub double_click_time: Option<u16>,
    /// The key-state table `GetKeyState` reads: 80h while a key is down as
    /// the messages taken have it, 1 while it is toggled on.
    pub key_states: [u8; 256],
    /// `GetAsyncKeyState`'s: 80h while a key is down now, 1 if it has gone
    /// down since last asked.
    pub async_keys: [u8; 256],
    /// The character each virtual key typed last, for `TranslateMessage`
    /// (`key_input.rs`).
    pub typed: std::collections::HashMap<u16, u8>,
}

impl Default for UserState {
    fn default() -> Self {
        Self {
            double_click_time: None,
            key_states: [0; 256],
            async_keys: [0; 256],
            typed: std::collections::HashMap::new(),
        }
    }
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "SetRect" => set_rect,
        "SetRectEmpty" => set_rect_empty,
        "CopyRect" => copy_rect,
        "IsRectEmpty" => is_rect_empty,
        "PtInRect" => pt_in_rect,
        "OffsetRect" => offset_rect,
        "InflateRect" => inflate_rect,
        "IntersectRect" => intersect_rect,
        "UnionRect" => union_rect,
        "EqualRect" => equal_rect,
        "SubtractRect" => subtract_rect,
        "AnsiUpper" => ansi_upper,
        "AnsiLower" => ansi_lower,
        "AnsiUpperBuff" => ansi_upper_buff,
        "AnsiLowerBuff" => ansi_lower_buff,
        "AnsiNext" => ansi_next,
        "AnsiPrev" => ansi_prev,
        "IsCharAlpha" => is_char_alpha,
        "IsCharAlphanumeric" => is_char_alphanumeric,
        "IsCharUpper" => is_char_upper,
        "IsCharLower" => is_char_lower,
        "WVSPRINTF" => wvsprintf,
        "GlobalAddAtom" => atoms::global_add_atom,
        "GlobalFindAtom" => atoms::global_find_atom,
        "GlobalDeleteAtom" => atoms::global_delete_atom,
        "GlobalGetAtomName" => atoms::global_get_atom_name,
        "MessageBeep" => message_beep,
        "GetFreeSystemResources" => get_free_system_resources,
        "SystemParametersInfo" => system_parameters_info,
        "SwapMouseButton" => swap_mouse_button,
        "GetDoubleClickTime" => get_double_click_time,
        "SetDoubleClickTime" => set_double_click_time,
        "GetKeyState" => get_key_state,
        "GetAsyncKeyState" => get_async_key_state,
        "GetKeyboardState" => get_keyboard_state,
        "SetKeyboardState" => set_keyboard_state,
        "GetTimerResolution" => get_timer_resolution,
        "InSendMessage" => in_send_message,
        "GetInputState" => get_input_state,
        "WNetGetConnection" => wnet_get_connection,
        "WNetGetCaps" => wnet_get_caps,
        _ => return None,
    }))
}

// Rectangles.
//
// USER's rectangle arithmetic, on `RECT`s as `left`, `top`, `right` and
// `bottom`, right and bottom exclusive. Measured at its edges by the
// `rectops` probe:
//
// * A rectangle is empty when its right is not past its left or its bottom
//   not past its top: a flat one, or an inverted one.
// * Two rectangles that only touch do not intersect; `IntersectRect` then
//   answers 0 and leaves all zeros.
// * `UnionRect` takes the other rectangle when one is empty -- the second
//   when the first is, even if the second is empty too -- and answers
//   whether what it left is not empty.
// * `SubtractRect` cuts only a rectangle the other spans the whole width or
//   height of; one with a hole in its middle is left as it was, and one
//   wholly covered becomes zeros.
// * `InflateRect` does not stop at nothing: shrunk past it, a rectangle
//   turns inside out.
// * `EqualRect` compares all four sides, so two empty rectangles that
//   differ are not equal.
//
// Every rectangle given is read before any is written, so a rectangle given
// as both a source and the destination is read as it was. A side is kept to
// sixteen bits as it is written.

/// A `RECT`, its sides widened so that arithmetic on them does not wrap
/// until they are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    const ZERO: Self = Self::new(0, 0, 0, 0);

    pub const fn new(left: i32, top: i32, right: i32, bottom: i32) -> Self {
        Self {
            left,
            top,
            right,
            bottom,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.right <= self.left || self.bottom <= self.top
    }

    /// Two rectangles' common part, or zeros where they do not overlap;
    /// whether they do.
    pub fn intersect(a: &Self, b: &Self) -> (Self, bool) {
        let cut = Self::new(
            a.left.max(b.left),
            a.top.max(b.top),
            a.right.min(b.right),
            a.bottom.min(b.bottom),
        );

        if cut.is_empty() {
            (Self::ZERO, false)
        } else {
            (cut, true)
        }
    }

    /// The rectangle about both, or the other where one is empty; whether
    /// it is not empty.
    pub fn union(a: &Self, b: &Self) -> (Self, bool) {
        let union = if a.is_empty() {
            *b
        } else if b.is_empty() {
            *a
        } else {
            Self::new(
                a.left.min(b.left),
                a.top.min(b.top),
                a.right.max(b.right),
                a.bottom.max(b.bottom),
            )
        };

        (union, !union.is_empty())
    }

    /// `a` less what of it `b` covers, where that leaves a rectangle; whether
    /// it is not empty.
    pub fn subtract(a: &Self, b: &Self) -> (Self, bool) {
        let mut result = *a;
        let (cut, overlaps) = Self::intersect(a, b);

        if overlaps {
            if cut == *a {
                return (Self::ZERO, false);
            }

            if cut.left == a.left && cut.right == a.right {
                if cut.top == a.top {
                    result.top = cut.bottom;
                } else if cut.bottom == a.bottom {
                    result.bottom = cut.top;
                }
            } else if cut.top == a.top && cut.bottom == a.bottom {
                if cut.left == a.left {
                    result.left = cut.right;
                } else if cut.right == a.right {
                    result.right = cut.left;
                }
            }
        }

        (result, !result.is_empty())
    }
}

/// A `RECT` a far pointer points at; `None` for a null pointer.
fn read_rect(system: &System, far: u32) -> Option<Rect> {
    if far == 0 {
        return None;
    }

    let bytes = system.read_far(far, 8);
    let side = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

    Some(Rect::new(side(0), side(2), side(4), side(6)))
}

/// A `RECT` the function reads or writes: where the TypeScript engine
/// reads a null pointer's sides, it throws and the program stops, as it
/// does here.
fn rect(system: &System, far: u32) -> Result<Rect, Stop> {
    read_rect(system, far).ok_or(Stop::Unsupported("a null RECT"))
}

fn write_rect(system: &mut System, far: u32, rect: &Rect) {
    let mut bytes = Vec::with_capacity(8);

    for side in [rect.left, rect.top, rect.right, rect.bottom] {
        bytes.extend_from_slice(&(side as u16).to_le_bytes());
    }

    system.write_far(far, &bytes);
}

fn boolean(value: bool) -> Result<Answer, Stop> {
    Ok(Answer::Word(u16::from(value)))
}

fn set_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let left = i32::from(args.signed(system));
    let top = i32::from(args.signed(system));
    let right = i32::from(args.signed(system));
    let bottom = i32::from(args.signed(system));

    rect(system, far)?;
    write_rect(system, far, &Rect::new(left, top, right, bottom));
    Ok(Answer::Nothing)
}

fn set_rect_empty(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    rect(system, far)?;
    write_rect(system, far, &Rect::ZERO);
    Ok(Answer::Nothing)
}

fn copy_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let destination = args.dword(system);
    let source = args.dword(system);

    rect(system, destination)?;

    let source = rect(system, source)?;

    write_rect(system, destination, &source);
    Ok(Answer::Nothing)
}

fn is_rect_empty(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    boolean(rect(system, far)?.is_empty())
}

/// The point comes by value, x in its low word and y in its high, signed:
/// **recorded** by `minis2`, the left and top edges inside, the right and
/// bottom out. A null rectangle holds no point.
fn pt_in_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let point = args.dword(system);
    let x = i32::from(point as u16 as i16);
    let y = i32::from((point >> 16) as u16 as i16);

    boolean(
        read_rect(system, far).is_some_and(|rect| {
            x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
        }),
    )
}

fn moved(system: &mut System, args: &mut Args, grow: bool) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let dx = i32::from(args.signed(system));
    let dy = i32::from(args.signed(system));
    let r = rect(system, far)?;
    let moved = if grow {
        Rect::new(r.left - dx, r.top - dy, r.right + dx, r.bottom + dy)
    } else {
        Rect::new(r.left + dx, r.top + dy, r.right + dx, r.bottom + dy)
    };

    write_rect(system, far, &moved);
    Ok(Answer::Nothing)
}

fn offset_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    moved(system, args, false)
}

fn inflate_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    moved(system, args, true)
}

fn equal_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let a = args.dword(system);
    let b = args.dword(system);

    boolean(rect(system, a)? == rect(system, b)?)
}

/// A destination and two rectangles, made into one by `combine`.
fn combined(
    system: &mut System,
    args: &mut Args,
    combine: fn(&Rect, &Rect) -> (Rect, bool),
) -> Result<Answer, Stop> {
    let destination = args.dword(system);
    let a = args.dword(system);
    let b = args.dword(system);

    rect(system, destination)?;

    let (result, answer) = combine(&rect(system, a)?, &rect(system, b)?);

    write_rect(system, destination, &result);
    boolean(answer)
}

fn intersect_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    combined(system, args, Rect::intersect)
}

fn union_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    combined(system, args, Rect::union)
}

fn subtract_rect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    combined(system, args, Rect::subtract)
}

// The ANSI character set.
//
// Not `to_ascii_uppercase`: these work on single bytes in the Windows
// codepage, and the accented range has traps in it that a plain "add or
// subtract 20h" walks straight into. What is here matches what real
// Windows 3.1 returned, recorded in `oracle/fixtures/strings.json`:
//
//   à é ü  (E0h E9h FCh)  uppercase to  À É Ü  (C0h C9h DCh)
//   ß      (DFh)          unchanged, having no single uppercase form
//   ÷ ×    (F7h D7h)      unchanged, being arithmetic rather than letters
//
// The two symbols are the reason the ranges below have holes in them: they
// sit in the middle of the accented letters, so a range check without them
// converts a division sign into a multiplication sign.
//
// FFh (ÿ) is left alone. Its uppercase in this codepage is 9Fh, which is not
// a simple offset, and nothing has measured what Windows does with it.

/// One ANSI byte uppercased.
pub fn ansi_upper_byte(byte: u8) -> u8 {
    match byte {
        b'a'..=b'z' => byte - 0x20,
        0xe0..=0xfe if byte != 0xf7 => byte - 0x20,
        _ => byte,
    }
}

/// One ANSI byte lowercased.
pub fn ansi_lower_byte(byte: u8) -> u8 {
    match byte {
        b'A'..=b'Z' => byte + 0x20,
        0xc0..=0xde if byte != 0xd7 => byte + 0x20,
        _ => byte,
    }
}

/// A string in memory converted in place, or a single character.
///
/// These functions take a far pointer, except when they do not: a high
/// word of nought means the low byte is a character to convert on its own,
/// and the result comes back in the low byte rather than being written
/// anywhere. Software used that to avoid needing a buffer for one letter.
/// Answers the pointer it was given, or the converted character.
///
/// A string runs to its nought; the offset wraps within its segment, and a
/// segment with no nought in it is converted once through. The TypeScript
/// engine's offset does not wrap and has no end: past the segment's last
/// byte it reads on into whatever follows, and with no nought anywhere it
/// does not return. Both are the same for a string inside its segment.
pub fn ansi_convert(system: &mut System, pointer: u32, convert: fn(u8) -> u8) -> u32 {
    if pointer >> 16 == 0 {
        return u32::from(convert(pointer as u8));
    }

    for step in 0..0x10000u32 {
        let at = (pointer & 0xffff_0000) | (pointer.wrapping_add(step) & 0xffff);
        let byte = system.read_far(at, 1)[0];

        if byte == 0 {
            break;
        }

        system.write_far(at, &[convert(byte)]);
    }

    pointer
}

/// `count` bytes of a buffer converted in place, a nought among them or
/// not; answers the count. **Recorded** by `minis`: `AnsiUpperBuff` over
/// eight bytes with a nought at the fifth converts the three after it too,
/// and over five stops at five. A count of nought is 64 KB, as documented,
/// and not recorded.
pub fn ansi_convert_buffer(
    system: &mut System,
    pointer: u32,
    count: u16,
    convert: fn(u8) -> u8,
) -> u16 {
    let length = if count == 0 {
        0x10000
    } else {
        u32::from(count)
    };
    let mut bytes = system.read_far(pointer, length as usize);

    for byte in &mut bytes {
        *byte = convert(*byte);
    }

    system.write_far(pointer, &bytes);
    count
}

fn ansi_upper(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);

    Ok(Answer::Dword(ansi_convert(
        system,
        pointer,
        ansi_upper_byte,
    )))
}

fn ansi_lower(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);

    Ok(Answer::Dword(ansi_convert(
        system,
        pointer,
        ansi_lower_byte,
    )))
}

fn ansi_upper_buff(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let count = args.word(system);

    Ok(Answer::Word(ansi_convert_buffer(
        system,
        pointer,
        count,
        ansi_upper_byte,
    )))
}

fn ansi_lower_buff(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let count = args.word(system);

    Ok(Answer::Word(ansi_convert_buffer(
        system,
        pointer,
        count,
        ansi_lower_byte,
    )))
}

/// The next character of a string: a byte on, the character set being of
/// single bytes. At the string's end it stays put, as recorded: on a
/// pointer to the nought it answers that same pointer, so walking a string
/// with it stops rather than running past the end. A double-byte character
/// set would advance by two; there is none here.
pub fn next_character(system: &System, pointer: u32) -> u32 {
    if system.read_far(pointer, 1)[0] == 0 {
        return pointer;
    }

    (pointer & 0xffff_0000) | (pointer.wrapping_add(1) & 0xffff)
}

fn ansi_next(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);

    Ok(Answer::Dword(next_character(system, pointer)))
}

/// The character before: a byte back, in the start's segment, or the start
/// itself where there is none before. A double-byte character set would
/// walk forward from the start; there is none here.
pub fn previous_character(start: u32, current: u32) -> u32 {
    if current & 0xffff <= start & 0xffff {
        return start;
    }

    (start & 0xffff_0000) | (current.wrapping_sub(1) & 0xffff)
}

fn ansi_prev(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let start = args.dword(system);
    let current = args.dword(system);

    Ok(Answer::Dword(previous_character(start, current)))
}

/// Which of the 256 characters each `IsChar...` answers yes for, as
/// `queries` recorded them: 64 hexadecimal digits, character 0 in the top
/// bit of the first. The ANSI letters with accents count, and the
/// multiplication and division signs, D7h and F7h, do not.
const ALPHA: &[u8; 64] = b"00000000000000007fffffe07fffffe00028002900000000fffffefffffffeff";
const ALPHANUMERIC: &[u8; 64] = b"000000000000ffc07fffffe07fffffe00028002900000000fffffefffffffeff";
const UPPER: &[u8; 64] = b"00000000000000007fffffe0000000000028000100000000fffffefe00000000";
const LOWER: &[u8; 64] = b"0000000000000000000000007fffffe0000000280000000000000001fffffeff";

fn is_character(table: &[u8; 64], character: u16) -> bool {
    let code = usize::from(character as u8);
    let digit = char::from(table[code >> 2]).to_digit(16).unwrap_or(0);

    (digit >> (3 - (code & 3))) & 1 != 0
}

fn character_in(system: &mut System, args: &mut Args, table: &[u8; 64]) -> Result<Answer, Stop> {
    let character = args.word(system);

    boolean(is_character(table, character))
}

fn is_char_alpha(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    character_in(system, args, ALPHA)
}

fn is_char_alphanumeric(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    character_in(system, args, ALPHANUMERIC)
}

fn is_char_upper(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    character_in(system, args, UPPER)
}

fn is_char_lower(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    character_in(system, args, LOWER)
}

/// `wsprintf` with its values at a far pointer rather than on the stack, a
/// Pascal function: the output, the format and the values. Its count of
/// characters written, its nought not counted. A format whose segment is
/// nought is a number, not a string, and spells out nothing. A null format
/// stops the program: the TypeScript engine takes the length of nothing
/// there and throws.
///
/// Not done here: a format that cannot be read is turned away by the
/// TypeScript engine before the call, answering nought and writing nothing
/// (**recorded** by `badarg`). That check is the engine's, made of every
/// `LPCSTR` argument, and the Rust engine does not make it yet for any
/// function; here such a format is read as memory has it.
fn wvsprintf(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let output = args.dword(system);
    let format = args.dword(system);
    let values = args.dword(system);

    if format == 0 {
        return Err(Stop::Unsupported("wvsprintf with a null format"));
    }

    let format = if format >> 16 == 0 {
        Vec::new()
    } else {
        system.read_string(format)
    };
    let text = format_values(system, &format, values);
    let mut bytes = text.clone();

    bytes.push(0);
    system.write_far(output, &bytes);
    Ok(Answer::Word(text.len() as u16))
}

/// A beep of a kind. The sound driver plays it; winbox.js has none to play
/// it with, and nothing is answered.
fn message_beep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Nothing)
}

/// How much of USER's and GDI's heaps is free, as a percentage. **Read out
/// of `USER.EXE`** (seg41 `1740`): for each of USER's three local heaps and
/// GDI's, `GetHeapSpaces` gives its size and what is free, and the
/// percentage is the free kilobytes a hundred times over the size's,
/// truncated. 0 answers the least of all four, 1 GDI's, and 2 the least of
/// USER's.
///
/// winbox.js keeps no such heaps, so it answers what Windows 3.1 answers
/// freshly started with one program running, **recorded** by `about`: 88
/// for 0 and 1, and 96 for 2. They do not fall as windows and objects are
/// made.
pub(crate) fn get_free_system_resources(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let resource = args.word(system);

    Ok(Answer::Word(if resource == 2 { 96 } else { 88 }))
}

const SPI_ICONHORIZONTALSPACING: u16 = 13;
const SPI_ICONVERTICALSPACING: u16 = 24;
const SPI_GETICONTITLEWRAP: u16 = 25;
const SPI_GETICONTITLELOGFONT: u16 = 31;

const SM_CXICONSPACING: &str = "38";
const SM_CYICONSPACING: &str = "39";

/// The display's vertical resolution in dots to the inch, as the display
/// table has it, the mode found by its name: 96, or 72 for the EGA. Read
/// here, where it is wanted, rather than kept with the display.
fn logical_pixels_y(system: &System) -> i32 {
    let modes: serde_json::Value =
        serde_json::from_str(include_str!("../data/displays.json")).unwrap_or_default();

    modes
        .as_object()
        .and_then(|modes| {
            modes
                .values()
                .find(|mode| mode["name"].as_str() == Some(system.display.name.as_str()))
        })
        .and_then(|mode| mode["logicalPixelsY"].as_i64())
        .map_or(96, |dots| dots as i32)
}

/// The icon title's `LOGFONT`: MS Sans Serif, eight points on a display of
/// so many dots to the inch, normal weight.
///
/// The height is `-Math.round(8 * dots / 72)`. `round` here rounds a half
/// away from nought where `Math.round` rounds it up, the same for the
/// positive quotient; and a whole number of dots over nine is never a half.
fn icon_title_font(dots: i32) -> [u8; 50] {
    let mut font = [0u8; 50];
    let height = -(f64::from(8 * dots) / 72.0).round() as i16;

    font[0..2].copy_from_slice(&height.to_le_bytes());
    font[8..10].copy_from_slice(&400u16.to_le_bytes());
    font[18..18 + 13].copy_from_slice(b"MS Sans Serif");
    font
}

/// A system-wide setting read or set.
///
/// What an icon is placed and labelled by is answered, as the `sizing`
/// probe recorded it on four displays: the icon spacing, whether titles
/// wrap, and the title's font -- MS Sans Serif, eight points on the
/// display's vertical resolution, normal weight. Nothing is set yet, and
/// the other settings are not answered.
fn system_parameters_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let action = args.word(system);
    args.word(system);
    let far = args.dword(system);
    args.word(system);

    if far == 0 {
        return boolean(false);
    }

    let metric = |system: &System, index: &str, otherwise: i16| {
        system
            .display
            .metrics_by_index
            .get(index)
            .copied()
            .unwrap_or(otherwise)
    };
    let word = match action {
        SPI_ICONHORIZONTALSPACING => metric(system, SM_CXICONSPACING, 75),
        SPI_ICONVERTICALSPACING => metric(system, SM_CYICONSPACING, 72),
        SPI_GETICONTITLEWRAP => 1,
        SPI_GETICONTITLELOGFONT => {
            let font = icon_title_font(logical_pixels_y(system));

            system.write_far(far, &font);
            return boolean(true);
        }
        _ => return boolean(false),
    };

    system.write_far(far, &word.to_le_bytes());
    boolean(true)
}

/// Swaps the mouse's buttons, or puts them back. **Read out** (and
/// **recorded**): the value given is kept as it is, answered by
/// `GetSystemMetrics(SM_SWAPBUTTON)`, and the one before is answered.
fn swap_mouse_button(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let swap = args.word(system);
    let before = system.swap_buttons.unwrap_or(0);

    system.swap_buttons = Some(swap);
    Ok(Answer::Word(before))
}

/// The time within which a second press makes a double click, in
/// milliseconds: `DoubleClickSpeed` in `WIN.INI`'s `[windows]`, 452 on the
/// installation the probes run on, until it is set (`misc`).
pub(crate) fn get_double_click_time(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let time = if let Some(time) = system.user_state.double_click_time {
        time
    } else {
        let time =
            crate::profiles_kernel::profile_int(system, b"windows", b"DoubleClickSpeed", 500);

        system.user_state.double_click_time = Some(time);
        time
    };

    Ok(Answer::Word(time))
}

/// Sets the double-click time; nought is 500.
fn set_double_click_time(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let time = args.word(system);

    system.user_state.double_click_time = Some(if time == 0 { 500 } else { time });
    Ok(Answer::Nothing)
}

/// **Read out of `USER.EXE`**: the key's byte from the state table,
/// sign-extended -- `FF80h` for a key down, `1` for one toggled on, `FF81h`
/// for both.
pub fn key_state(system: &System, key: u16) -> u16 {
    let byte = system.user_state.key_states[usize::from(key as u8)];

    if byte & 0x80 != 0 {
        0xff00 | u16::from(byte)
    } else {
        u16::from(byte)
    }
}

fn get_key_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let key = args.word(system);

    Ok(Answer::Word(key_state(system, key)))
}

/// A key as it is now: 8000h while it is down, and 1 if it has gone down
/// since last asked, which asking clears. **Read out**; only the low byte
/// of the key is looked at. **Recorded**: no key answers anything with none
/// pressed.
fn get_async_key_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let key = usize::from(args.word(system) as u8);
    let byte = system.user_state.async_keys[key];
    let state = (if byte & 0x80 != 0 { 0x8000 } else { 0 }) | u16::from(byte & 0x01);

    system.user_state.async_keys[key] &= !0x01;
    Ok(Answer::Word(state))
}

/// The key-state table's 256 bytes, copied out: what `GetKeyState` reads.
fn get_keyboard_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let table = system.user_state.key_states;

    system.write_far(far, &table);
    Ok(Answer::Nothing)
}

/// The key-state table set from 256 bytes, as `GetKeyState` then answers.
fn set_keyboard_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let bytes = system.read_far(far, 256);

    system.user_state.key_states.copy_from_slice(&bytes);
    Ok(Answer::Nothing)
}

/// A thousand, the timer's resolution as USER answers it (`userwin`).
fn get_timer_resolution(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(1000))
}

/// Whether the message being handled was sent by another task. Nought for
/// one the program sent itself, one posted, and outside any message
/// (`queries`); one from another task is not recorded, and winbox.js
/// answers nought for it too.
fn in_send_message(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// Whether input waits in the system's queue: nought where there is none,
/// as `unregcls` records it, a posted `WM_KEYDOWN` being a posted message
/// and not input. winbox.js takes input to its program straight away, so
/// none waits.
fn get_input_state(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// `WN_NOT_SUPPORTED`.
///
/// `WNetGetConnection`'s local name is an `LPCSTR`, which the TypeScript
/// engine turns away, answering nought, where it cannot be read; the Rust
/// engine does not check it yet (see `wvsprintf`), and answers this.
const WN_NOT_SUPPORTED: u16 = 1;

/// The network, of which there is none: USER hands these calls to a
/// network driver, and with none installed they answer that the network
/// does not do it. **Recorded** by `netcaps`: `WNetGetConnection` answers
/// `WN_NOT_SUPPORTED` for every drive and writes nothing, and `WNetGetCaps`
/// answers nought for every index. File Manager took a stub's success for a
/// network drive at every letter.
fn wnet_get_connection(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.dword(system);
    args.dword(system);
    args.dword(system);
    Ok(Answer::Word(WN_NOT_SUPPORTED))
}

fn wnet_get_caps(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(0))
}

/// USER's strings, by their resource numbers: the names it reads its
/// settings by, its classes', the system colours', and the words of its
/// message boxes and errors. winbox.js keeps them itself, as it keeps USER:
/// no Windows file is shipped. Made to match the Windows 3.1 the recordings
/// are made on by `scripts/oracle/strings-table.mjs`.
pub const USER_STRINGS: &[(u16, &str)] = &[
    (0x000, "Windows"),
    (0x001, "Colors"),
    (0x002, "Pattern"),
    (0x003, "Fonts"),
    (0x004, "CursorBlinkRate"),
    (0x005, "SwapMouseButtons"),
    (0x006, "DoubleClickSpeed"),
    (0x007, "TypeAhead"),
    (0x008, "GridGranularity"),
    (0x009, "Beep"),
    (0x00a, "MouseThreshold1"),
    (0x00b, "MouseThreshold2"),
    (0x00c, "MouseSpeed"),
    (0x00d, "KeyboardSpeed"),
    (0x00e, "BorderWidth"),
    (0x00f, "DefaultQueueSize"),
    (0x010, "Button"),
    (0x011, "Edit"),
    (0x012, "Static"),
    (0x013, "ListBox"),
    (0x014, "ScrollBar"),
    (0x015, "ComboBox"),
    (0x016, "MDIClient"),
    (0x017, "ComboLBox"),
    (0x020, "Scrollbar"),
    (0x021, "Background"),
    (0x022, "ActiveTitle"),
    (0x023, "InactiveTitle"),
    (0x024, "Menu"),
    (0x025, "Window"),
    (0x026, "WindowFrame"),
    (0x027, "MenuText"),
    (0x028, "WindowText"),
    (0x029, "TitleText"),
    (0x02a, "ActiveBorder"),
    (0x02b, "InactiveBorder"),
    (0x02c, "AppWorkspace"),
    (0x02d, "Hilight"),
    (0x02e, "HilightText"),
    (0x02f, "ButtonFace"),
    (0x030, "ButtonShadow"),
    (0x031, "GrayText"),
    (0x032, "ButtonText"),
    (0x033, "InactiveTitleText"),
    (0x034, "ButtonHilight"),
    (0x03c, "FILE:"),
    (
        0x03d,
        "Cannot open output file for writing.  Check to ensure path and filename are correct.",
    ),
    (0x03e, "Overwrite existing output file?"),
    (0x03f, "&More Windows..."),
    (0x040, "IconSpacing"),
    (0x041, "IconVerticalSpacing"),
    (0x042, "IconTitleWrap"),
    (0x043, "Wallpaper"),
    (0x044, "WallpaperStyle"),
    (0x045, "WallpaperOriginX"),
    (0x046, "WallpaperOriginY"),
    (0x047, "NETWORK.DRV"),
    (0x048, "boot"),
    (0x049, "LANGUAGE.DLL"),
    (0x04a, "SYSTEM.INI"),
    (0x04b, "System Error"),
    (0x04c, "Divide By Zero or Overflow Error"),
    (0x04d, "Untitled"),
    (0x04e, "Error"),
    (0x04f, "TASKMAN.EXE"),
    (0x050, "Desktop"),
    (0x051, "Patterns"),
    (0x052, "(None)"),
    (0x053, "TileWallpaper"),
    (0x054, "OK"),
    (0x055, "Cancel"),
    (0x056, "&Abort"),
    (0x057, "&Retry"),
    (0x058, "&Ignore"),
    (0x059, "&Yes"),
    (0x05a, "&No"),
    (0x05b, "ynraic"),
    (0x05c, "am"),
    (0x05d, "pm"),
    (0x05e, "MenuShowDelay"),
    (0x05f, "MenuHideDelay"),
    (0x060, "MenuDropAlignment"),
    (0x061, "DoubleClickWidth"),
    (0x062, "DoubleClickHeight"),
    (0x063, "ScreenSaveTimeOut"),
    (0x064, "ScreenSaveActive"),
    (0x065, "SCRNSAVE.EXE"),
    (0x066, "DRIVERS"),
    (
        0x067,
        "Insufficient memory to create the bitmap.  Quit one or more applications to increase available memory.",
    ),
    (0x068, "Yes"),
    (0x069, "No"),
    (0x06a, "KeyboardDelay"),
    (0x06b, "DragFullWindows"),
    (0x06c, "IconTitleFaceName"),
    (0x06d, "IconTitleSize"),
    (0x06e, "IconTitleStyle"),
    (0x06f, "CoolSwitch"),
    (0x072, "&Close"),
    (0x0c8, "COMM"),
    (0x0c9, "COMMWRITESTRING"),
    (0x0ca, "READCOMMSTRING"),
    (0x0cb, "ENABLENOTIFICATION"),
    (0x0cc, "MOUSE"),
    (0x0cd, "TSR Support"),
    (0x0ce, "Cannot run the application specified by "),
    (0x0cf, "Cannot load the library specified by "),
    (0x0d0, "Cannot open the driver specified by "),
    (0x100, "Cannot connect to %s: %s"),
    (0x101, "Error Restoring Network Connections"),
    (0x102, "Error Restoring Network Connections"),
    (
        0x103,
        "Windows was restarted while restoring network connections. Retry establishing connections or cancel network connections for this session?",
    ),
    (0x113, "Unexpected network error: 0x%4.4X"),
    (0x114, "Network function not supported."),
    (0x115, "Network error."),
    (0x119, "Incorrect password."),
    (0x11a, "Access denied."),
    (0x11e, "Out of memory."),
    (0x143, "Device not connected."),
    (0x144, "Device has open files."),
    (0x145, "Invalid network name."),
    (0x146, "Invalid local device."),
    (0x147, "Device already connected."),
    (0x148, "Connection has gone down."),
    (0x149, "Permanent connection not available."),
    (0x201, "BOULAMITE"),
    (0x202, "WinBox.js oracle              "),
    (0x203, "winbox.js                     "),
    (0x204, "3.1"),
    (
        0x205,
        "Your serial number label is on the inside back cover of Getting Started with Microsoft Windows.   ",
    ),
];

/// One of USER's strings by its resource number.
pub fn user_string(id: u16) -> Option<&'static str> {
    USER_STRINGS
        .iter()
        .find(|&&(number, _)| number == id)
        .map(|&(_, text)| text)
}

#[cfg(test)]
mod tests {
    use super::*;

    use winbox_machine::segment_selector;

    type Combine = fn(&Rect, &Rect) -> (Rect, bool);
    type Convert = fn(u8) -> u8;

    /// A block of memory to work in, and its far pointer.
    fn block(system: &mut System) -> u32 {
        let index = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 0x1000, 0)
            .unwrap();

        u32::from(segment_selector(index)) << 16
    }

    fn answered((rect, answer): (Rect, bool)) -> String {
        format!(
            "{},{}:{}:{}:{}",
            u8::from(answer),
            rect.left,
            rect.top,
            rect.right,
            rect.bottom
        )
    }

    /// The rectangles as the `rectops` probe recorded them.
    #[test]
    fn rectangles_as_recorded() {
        let ten = Rect::new(0, 0, 10, 10);
        let cases: [(Combine, Rect, Rect, &str); 11] = [
            (Rect::intersect, ten, Rect::new(5, 5, 20, 20), "1,5:5:10:10"),
            (Rect::intersect, ten, Rect::new(10, 0, 20, 10), "0,0:0:0:0"),
            (Rect::intersect, ten, Rect::new(20, 20, 30, 30), "0,0:0:0:0"),
            (Rect::intersect, ten, Rect::new(5, 5, 5, 5), "0,0:0:0:0"),
            (Rect::union, ten, Rect::new(20, 20, 30, 30), "1,0:0:30:30"),
            (Rect::union, Rect::new(5, 5, 5, 5), ten, "1,0:0:10:10"),
            (
                Rect::union,
                Rect::new(1, 1, 1, 1),
                Rect::new(40, 40, 30, 50),
                "0,40:40:30:50",
            ),
            (Rect::subtract, ten, Rect::new(-5, 4, 15, 20), "1,0:0:10:4"),
            (Rect::subtract, ten, Rect::new(4, -5, 20, 15), "1,0:0:4:10"),
            (Rect::subtract, ten, Rect::new(3, 3, 6, 6), "1,0:0:10:10"),
            (Rect::subtract, ten, Rect::new(-1, -1, 11, 11), "0,0:0:0:0"),
        ];

        for (combine, a, b, recorded) in cases {
            assert_eq!(answered(combine(&a, &b)), recorded);
        }

        assert!(!ten.is_empty());
        assert!(Rect::new(5, 5, 5, 9).is_empty());
        assert!(Rect::new(9, 9, 5, 5).is_empty());
        assert_ne!(Rect::new(0, 0, 0, 0), Rect::new(1, 1, 1, 1));
    }

    /// Rectangles in memory: a side kept to sixteen bits as it is written,
    /// and read back signed.
    #[test]
    fn rectangles_in_memory() {
        let mut system = System::new();
        let at = block(&mut system);

        write_rect(&mut system, at, &Rect::new(-3, 2, 32_768, 8));
        assert_eq!(read_rect(&system, at), Some(Rect::new(-3, 2, -32_768, 8)));
        assert_eq!(read_rect(&system, 0), None);
        assert_eq!(rect(&system, 0), Err(Stop::Unsupported("a null RECT")));
    }

    /// `AnsiUpper` and `AnsiLower` as the `strings` probe recorded them,
    /// and a character given in place of a pointer.
    #[test]
    fn ansi_case_as_recorded() {
        let mut system = System::new();
        let at = block(&mut system);
        let cases: [(&[u8], &[u8], &[u8]); 7] = [
            (b"hello", b"HELLO", b"hello"),
            (b"HELLO", b"HELLO", b"hello"),
            (b"MiXeD 123", b"MIXED 123", b"mixed 123"),
            (
                b"with-punctuation!",
                b"WITH-PUNCTUATION!",
                b"with-punctuation!",
            ),
            (
                &[0xe0, 0xe9, 0xfc],
                &[0xc0, 0xc9, 0xdc],
                &[0xe0, 0xe9, 0xfc],
            ),
            (&[0xdf], &[0xdf], &[0xdf]),
            (&[0xf7, 0xd7], &[0xf7, 0xd7], &[0xf7, 0xd7]),
        ];

        for (given, upper, lower) in cases {
            let mut bytes = given.to_vec();

            bytes.push(0);
            system.write_far(at, &bytes);
            assert_eq!(ansi_convert(&mut system, at, ansi_upper_byte), at);
            assert_eq!(system.read_string(at), upper);
            system.write_far(at, &bytes);
            ansi_convert(&mut system, at, ansi_lower_byte);
            assert_eq!(system.read_string(at), lower);
        }

        assert_eq!(
            ansi_convert(&mut system, u32::from(b'q'), ansi_upper_byte),
            u32::from(b'Q')
        );
        assert_eq!(ansi_convert(&mut system, 0xc9, ansi_lower_byte), 0xe9);
    }

    /// `AnsiUpperBuff` and `AnsiLowerBuff` go past a nought, as `minis`
    /// recorded.
    #[test]
    fn ansi_buffers_as_recorded() {
        let mut system = System::new();
        let at = block(&mut system);
        let given = [0x61, 0x42, 0xe0, 0xf7, 0x00, 0x7a, 0xc0, 0x71, 0x71, 0x71];
        let cases: [(u16, Convert, [u8; 10]); 4] = [
            (
                5,
                ansi_upper_byte,
                [0x41, 0x42, 0xc0, 0xf7, 0x00, 0x7a, 0xc0, 0x71, 0x71, 0x71],
            ),
            (
                8,
                ansi_upper_byte,
                [0x41, 0x42, 0xc0, 0xf7, 0x00, 0x5a, 0xc0, 0x51, 0x71, 0x71],
            ),
            (
                8,
                ansi_lower_byte,
                [0x61, 0x62, 0xe0, 0xf7, 0x00, 0x7a, 0xe0, 0x71, 0x71, 0x71],
            ),
            (
                1,
                ansi_upper_byte,
                [0x41, 0x42, 0xe0, 0xf7, 0x00, 0x7a, 0xc0, 0x71, 0x71, 0x71],
            ),
        ];

        for (count, convert, expected) in cases {
            system.write_far(at, &given);
            assert_eq!(ansi_convert_buffer(&mut system, at, count, convert), count);
            assert_eq!(system.read_far(at, 10), expected);
        }
    }

    /// `AnsiNext` and `AnsiPrev` as the `strings` probe recorded them.
    #[test]
    fn ansi_next_and_prev_as_recorded() {
        let mut system = System::new();
        let at = block(&mut system);

        system.write_far(at, b"\0");
        assert_eq!(next_character(&system, at), at);
        assert_eq!(previous_character(at, at), at);
        system.write_far(at, b"hello\0");
        assert_eq!(next_character(&system, at), at + 1);
        assert_eq!(previous_character(at, at + 1), at);
        assert_eq!(previous_character(at, at + 5), at + 4);
    }

    /// The characters each `IsChar...` answers yes for, as `queries`
    /// recorded them.
    #[test]
    fn characters_as_recorded() {
        for (table, recorded) in [
            (
                ALPHA,
                "00000000000000007fffffe07fffffe00028002900000000fffffefffffffeff",
            ),
            (
                ALPHANUMERIC,
                "000000000000ffc07fffffe07fffffe00028002900000000fffffefffffffeff",
            ),
            (
                UPPER,
                "00000000000000007fffffe0000000000028000100000000fffffefe00000000",
            ),
            (
                LOWER,
                "0000000000000000000000007fffffe0000000280000000000000001fffffeff",
            ),
        ] {
            let digits: String = (0..64u16)
                .map(|digit| {
                    let value = (0..4u16).fold(0, |value, bit| {
                        value << 1 | u32::from(is_character(table, digit * 4 + bit))
                    });

                    char::from_digit(value, 16).unwrap()
                })
                .collect();

            assert_eq!(digits, recorded);
        }

        // Only the low byte is looked at.
        assert!(is_character(ALPHA, 0x141));
        assert!(!is_character(ALPHA, 0xd7));
    }

    /// The key-state table as `queries` set and read it.
    #[test]
    fn key_states_as_recorded() {
        let mut system = System::new();

        for (key, state) in system.user_state.key_states.iter_mut().enumerate() {
            *state = key as u8 ^ 0x5a;
        }

        assert_eq!(key_state(&system, 0x41), 0x1b);
        assert_eq!(key_state(&system, 0xda), 0xff80);
        assert_eq!(key_state(&system, 0x1da), 0xff80);
    }

    /// The icon title's font on the VGA and on the EGA, as `sizing`
    /// recorded it on the VGA.
    #[test]
    fn icon_title_font_as_recorded() {
        let mut system = System::new();
        let vga = icon_title_font(logical_pixels_y(&system));

        assert_eq!(i16::from_le_bytes([vga[0], vga[1]]), -11);
        assert_eq!(u16::from_le_bytes([vga[8], vga[9]]), 400);
        assert_eq!(&vga[18..32], b"MS Sans Serif\0");

        system.display = crate::display::mode("ega").unwrap();

        let ega = icon_title_font(logical_pixels_y(&system));

        assert_eq!(i16::from_le_bytes([ega[0], ega[1]]), -8);
    }

    /// `AnsiUpperBuff` with a count of nought converts the whole segment,
    /// wrapping within it, and answers nought, as the TypeScript engine's
    /// `length & 0xffff` does.
    #[test]
    fn ansi_buffer_of_nought_is_the_segment() {
        let mut system = System::new();
        let at = block(&mut system);

        system.write_far(at | 0x0fff, b"a");
        system.write_far(at, b"b");
        assert_eq!(
            ansi_convert_buffer(&mut system, at | 0x0fff, 0, ansi_upper_byte),
            0
        );
        assert_eq!(system.read_far(at | 0x0fff, 1), b"A");
        assert_eq!(system.read_far(at, 1), b"B");
    }

    /// The calls of one word, given it as `Args::repeat` gives it.
    fn called(
        system: &mut System,
        function: fn(&mut System, &mut Args) -> Result<Answer, Stop>,
        word: u16,
    ) -> Answer {
        function(system, &mut Args::repeat(word)).unwrap()
    }

    /// `GetKeyState` and `GetAsyncKeyState` look at the key's low byte
    /// only; asking the second clears its "gone down" bit and not its
    /// "down" one.
    #[test]
    fn key_calls_as_read_out() {
        let mut system = System::new();

        system.user_state.key_states[0x41] = 0x81;
        system.user_state.async_keys[0x41] = 0x81;
        assert_eq!(
            called(&mut system, get_key_state, 0xff41),
            Answer::Word(0xff81)
        );
        assert_eq!(
            called(&mut system, get_async_key_state, 0x0141),
            Answer::Word(0x8001)
        );
        assert_eq!(
            called(&mut system, get_async_key_state, 0x41),
            Answer::Word(0x8000)
        );
        assert_eq!(
            called(&mut system, get_async_key_state, 0x42),
            Answer::Word(0)
        );
    }

    /// The double-click time: `WIN.INI`'s, 500 where it has none, and
    /// nought set is 500.
    #[test]
    fn double_click_time() {
        let mut system = System::new();

        assert_eq!(
            called(&mut system, get_double_click_time, 0),
            Answer::Word(500)
        );
        assert_eq!(
            called(&mut system, set_double_click_time, 300),
            Answer::Nothing
        );
        assert_eq!(
            called(&mut system, get_double_click_time, 0),
            Answer::Word(300)
        );
        called(&mut system, set_double_click_time, 0);
        assert_eq!(
            called(&mut system, get_double_click_time, 0),
            Answer::Word(500)
        );
    }

    /// `SwapMouseButton` answers what was set before, nought at first, and
    /// keeps the value given as it is.
    #[test]
    fn swap_mouse_button_answers_the_one_before() {
        let mut system = System::new();

        assert_eq!(called(&mut system, swap_mouse_button, 7), Answer::Word(0));
        assert_eq!(called(&mut system, swap_mouse_button, 0), Answer::Word(7));
        assert_eq!(system.swap_buttons, Some(0));
    }

    /// The resources free, as `about` recorded them.
    #[test]
    fn free_system_resources_as_recorded() {
        let mut system = System::new();

        assert_eq!(
            called(&mut system, get_free_system_resources, 0),
            Answer::Word(88)
        );
        assert_eq!(
            called(&mut system, get_free_system_resources, 1),
            Answer::Word(88)
        );
        assert_eq!(
            called(&mut system, get_free_system_resources, 2),
            Answer::Word(96)
        );
    }

    #[test]
    fn user_strings_by_number() {
        assert_eq!(user_string(0x54), Some("OK"));
        assert_eq!(user_string(0x204), Some("3.1"));
        assert_eq!(user_string(0x18), None);
    }
}
