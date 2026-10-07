//! The single-line edit control: what it does with the characters, keys and
//! messages it is sent -- winbox.js's `edit.ts` -- with what both kinds of
//! edit control share: their state, the layout of their text for their
//! font (`desktop.ts`'s `editLayout`), and the clipboard's cut, copy, paste
//! and clear (`edit-clipboard.ts`).
//!
//! **Recorded** by `editctl`, on four displays, everything sent with
//! `SendMessage` to two edit controls:
//!
//! * a character is typed where the caret is, over the selection if there
//!   is one; backspace takes the selection or the character before, Delete
//!   the selection or the one after;
//! * Home, End and the arrows move the caret and take the selection away;
//! * the caret stands at the selection's end;
//! * every change tells the parent `EN_UPDATE`, then `EN_CHANGE`, with
//!   `WM_COMMAND`; a character that would pass the limit changes nothing
//!   and tells it `EN_MAXTEXT`; setting the text is a change too, and
//!   selecting is not;
//! * the focus arriving tells the parent `EN_SETFOCUS`, and leaving
//!   `EN_KILLFOCUS`; the selection stays as it was.
//!
//! The caret is USER's own drawing, not ported yet: where the control makes,
//! places, shows, hides and destroys it, the place is worked out -- which
//! scrolls the text -- and the caret itself passed over.

use crate::call::Stop;
use crate::control_host::{ControlFont, bytes_of, text_of};
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;

pub const EM_GETSEL: u16 = 0x0400;
pub const EM_SETSEL: u16 = 0x0401;
pub const EM_GETMODIFY: u16 = 0x0408;
pub const EM_SETMODIFY: u16 = 0x0409;
pub const EM_LIMITTEXT: u16 = 0x0415;
const EM_LINELENGTH: u16 = 0x0411;

pub const EN_SETFOCUS: u16 = 0x0100;
pub const EN_KILLFOCUS: u16 = 0x0200;
pub const EN_CHANGE: u16 = 0x0300;
pub const EN_UPDATE: u16 = 0x0400;
pub const EN_MAXTEXT: u16 = 0x0501;

pub const WM_CUT: u16 = 0x0300;
pub const WM_COPY: u16 = 0x0301;
pub const WM_PASTE: u16 = 0x0302;
pub const WM_CLEAR: u16 = 0x0303;

pub const ES_MULTILINE: u32 = 0x0004;
const ES_AUTOHSCROLL: u32 = 0x0080;
const ES_NOHIDESEL: u32 = 0x0100;

const WM_SETTEXT: u16 = 0x000c;
const WM_SETFOCUS: u16 = 0x0007;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_KEYDOWN: u16 = 0x0100;
const WM_CHAR: u16 = 0x0102;
const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const MK_SHIFT: u16 = 0x0004;

const VK_BACK: u8 = 0x08;
const VK_SHIFT: u16 = 0x10;
const VK_END: u16 = 0x23;
const VK_HOME: u16 = 0x24;
const VK_LEFT: u16 = 0x25;
const VK_RIGHT: u16 = 0x27;
const VK_DELETE: u16 = 0x2e;
const VK_INSERT: u16 = 0x2d;
const VK_CONTROL: u16 = 0x11;

const CF_TEXT: u16 = 1;

/// What an edit control keeps beyond its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditState {
    /// Where the selection starts, where it ends and the caret stands.
    pub anchor: i32,
    pub caret: i32,
    /// The first character that shows.
    pub scroll: i32,
    pub limit: i32,
    pub focused: bool,
    /// Whether a press is being followed with the mouse captured.
    pub tracking: bool,
    /// Whether the text was changed since it was last set (`EM_GETMODIFY`).
    pub modified: bool,
}

impl Default for EditState {
    fn default() -> Self {
        Self {
            anchor: 0,
            caret: 0,
            scroll: 0,
            limit: 30000,
            focused: false,
            tracking: false,
            modified: false,
        }
    }
}

impl EditState {
    /// The selection, its lower end first.
    pub fn selection(&self) -> (i32, i32) {
        (self.anchor.min(self.caret), self.anchor.max(self.caret))
    }
}

/// Part of a text, as a JavaScript string's `slice` takes it: from `from`
/// up to `to`, a place before the start counted back from the end, each
/// held to the text, nothing where `to` is before `from`.
pub(crate) fn slice(text: &[u8], from: i32, to: i32) -> &[u8] {
    let length = text.len() as i32;
    let held = |place: i32| {
        if place < 0 {
            (length + place).max(0) as usize
        } else {
            place.min(length) as usize
        }
    };
    let (from, to) = (held(from), held(to));

    if to <= from { &[] } else { &text[from..to] }
}

/// Where an edit control's text and caret go, for its font: **read out of
/// `USER.EXE`**, and recorded by `editctl` on four displays.
///
/// * The font's average width is its letters' width, `a` to `z` and `A` to
///   `Z`, over 26, plus one, halved -- the dialog's rule -- or for a fixed
///   pitch its `tmAveCharWidth` (seg2 `03a4`). The System font's is kept
///   beside it.
/// * The text's rectangle is the client area; with a border, less half the
///   smaller of the two average widths across and a quarter of the smaller
///   of the two heights down, and never taller than a line (seg29 `0000`).
/// * The caret is a pixel wide for a font narrower than the System font and
///   two otherwise, and a pixel taller than the font (seg28 `1224`).
#[derive(Debug, Clone)]
pub struct EditLayout {
    pub caret_width: i32,
    pub caret_height: i32,
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub width: i32,
    pub average: i32,
    pub fixed: bool,
    pub overhang: i32,
    /// The control's font, or the System font, to measure with.
    pub font: ControlFont,
    /// The font's height, and the System font's.
    pub height: i32,
    pub system_average: i32,
    pub system_height: i32,
    pub client_width: i32,
    pub client_height: i32,
    pub border: bool,
}

impl EditLayout {
    /// How wide a run of the text is, as `GetTextExtent` says: nothing for
    /// no characters, where an emboldened font's extra pixel would
    /// otherwise stand. `editctl` records it -- the caret in an empty
    /// control in bold MS Sans Serif is a pixel left of the text's
    /// rectangle, its overhang taken away and nothing added back.
    pub fn measure(&self, text: &[u8]) -> i32 {
        self.font.measure(text)
    }
}

impl System {
    /// An edit control's state, made the first time.
    pub(crate) fn edit_state(&mut self, index: usize) -> &mut EditState {
        self.control_at(index)
            .edit
            .get_or_insert_with(EditState::default)
    }

    /// An edit control's text, a character to a byte.
    pub(crate) fn edit_text(&mut self, index: usize) -> Vec<u8> {
        bytes_of(&self.control_at(index).text)
    }

    pub(crate) fn set_edit_text(&mut self, index: usize, text: &[u8]) {
        self.control_at(index).text = text_of(text);
    }

    pub fn edit_layout(&mut self, index: usize) -> Result<EditLayout, Stop> {
        let own = self.control_font(index)?;
        let system = self.system_control_font()?;
        let system_average = system.dialog_average();
        let fixed = own.as_ref().is_some_and(|own| own.fixed_pitch);
        let average = match &own {
            Some(own) if fixed => own.average,
            Some(own) => own.dialog_average(),
            None => system_average,
        };
        let height = own.as_ref().map_or(system.height, |own| own.height);
        let overhang = own.as_ref().map_or(0, |own| own.overhang);
        let window = self.control_window(index);
        let (client_width, client_height) = (window.client_width(), window.client_height());
        let border = self.control_at(index).border;
        let across = if border {
            average.min(system_average) / 2
        } else {
            0
        };
        let down = if border {
            height.min(system.height) / 4
        } else {
            0
        };
        let right = client_width - across;

        Ok(EditLayout {
            caret_width: if average < system_average { 1 } else { 2 },
            caret_height: height + 1,
            left: across,
            top: down,
            right,
            bottom: (down + height).min(client_height - down),
            width: right - across,
            average,
            fixed,
            overhang,
            system_average,
            system_height: system.height,
            height,
            font: own.unwrap_or(system),
            client_width,
            client_height,
            border,
        })
    }
}

// An edit control's calls on the caret: `CreateCaret`, `SetCaretPos`,
// `ShowCaret`, `HideCaret` and `DestroyCaret` (`caret.rs`).
impl System {
    pub fn edit_create_caret(&mut self, hwnd: u16, width: i32, height: i32) {
        self.create_caret_for(hwnd, width, height);
    }

    pub fn edit_set_caret_pos(&mut self, x: i32, y: i32) {
        self.set_caret_pos_to(x, y);
    }

    pub fn edit_show_caret(&mut self, hwnd: u16) {
        self.show_caret_of(hwnd);
    }

    pub fn edit_hide_caret(&mut self, hwnd: u16) {
        self.hide_caret_of(hwnd);
    }

    pub fn edit_destroy_caret(&mut self) {
        self.destroy_caret_now();
    }

    /// An edit control painted again at once, the caret kept out of the
    /// way.
    pub(crate) fn edit_repaint(&mut self, hwnd: u16, index: usize) {
        self.edit_hide_caret(hwnd);
        self.repaint_control(index);
        self.edit_show_caret(hwnd);
    }
}

/// How many characters of `text`, counted back from its end, fit in
/// `width` (seg26 `025c`).
fn fit_back(text: &[u8], width: i32, layout: &EditLayout) -> i32 {
    let mut count = 0;

    while (count as usize) < text.len()
        && layout.measure(&text[text.len() - count as usize - 1..]) <= width
    {
        count += 1;
    }

    count
}

/// Where a character boundary is across the client area (seg28 `0047`):
/// the text's left less the font's overhang, and the width of what shows
/// before it; for a fixed pitch, the average width a character.
fn boundary_x(text: &[u8], edit: &EditState, layout: &EditLayout, at: i32) -> i32 {
    if layout.fixed {
        return layout.left + (at - edit.scroll) * layout.average;
    }

    layout.left - layout.overhang + layout.measure(slice(text, edit.scroll, at))
}

/// Brings the caret into view, for `ES_AUTOHSCROLL` (seg28 `061d`): at or
/// before the first character that shows, back by as many characters as
/// fit in a quarter of the width; past the last that fits, on so the caret
/// is three quarters of the way along what fits -- but never so far that
/// the end of the text leaves room at the right.
fn scroll_to(style: u32, text: &[u8], edit: &mut EditState, layout: &EditLayout) {
    if style & ES_AUTOHSCROLL == 0 {
        return;
    }

    if edit.caret <= edit.scroll {
        edit.scroll =
            (edit.caret - fit_back(slice(text, 0, edit.caret), layout.width / 4, layout)).max(0);
        return;
    }

    let fits = fit_back(slice(text, edit.scroll, edit.caret), layout.width, layout);

    if edit.caret - edit.scroll > fits {
        let at_end = fit_back(text, layout.width, layout);

        edit.scroll = (edit.caret - 3 * fits / 4).min(text.len() as i32 - at_end);
    }
}

/// The character a place across the client area falls before (seg28
/// `0eee`). Left of the text's rectangle, the one before the first that
/// shows; right of it, one past the first that does not fit. Otherwise the
/// most characters from the first that shows whose width, less half the
/// font's average width, reaches no further than the place: the dividing
/// point before a character is half an average width back from its left
/// edge, whatever its own width. **Recorded** by `editctl`: "abc" in the
/// System font, each letter eight pixels wide from 4, average 8 -- presses
/// from 6 to 20 give 0, then 1 from 8, then 2 from 16.
fn index_at(text: &[u8], edit: &EditState, layout: &EditLayout, x: i32) -> i32 {
    let length = text.len() as i32;

    if x <= layout.left {
        return if edit.scroll > 0 { edit.scroll - 1 } else { 0 };
    }

    if x > layout.right {
        let mut fits = 0;

        while edit.scroll + fits < length
            && layout.measure(slice(text, edit.scroll, edit.scroll + fits + 1)) <= layout.width
        {
            fits += 1;
        }

        return if edit.scroll + fits >= length {
            length
        } else {
            edit.scroll + fits + 1
        };
    }

    let half = layout.average / 2;
    let mut count = 0;

    while edit.scroll + count < length
        && layout.measure(slice(text, edit.scroll, edit.scroll + count + 1)) - half
            <= x - layout.left
    {
        count += 1;
    }

    edit.scroll + count
}

/// The word around a place, for a double click (seg26 `0426`): back to just
/// after the blank before it, and on over the word and the blanks after it.
/// Spaces and tabs are the blanks.
fn word_at(text: &[u8], at: i32) -> (i32, i32) {
    let blank = |at: i32| matches!(text.get(at as usize), Some(b' ' | b'\t'));
    let length = text.len() as i32;
    let mut start = at;
    let mut end = at;

    while start > 0 && !blank(start - 1) {
        start -= 1;
    }

    while end < length && !blank(end) {
        end += 1;
    }

    while end < length && blank(end) {
        end += 1;
    }

    (start, end)
}

/// Text put in place of `start` to `end`.
fn spliced(text: &[u8], start: i32, end: i32, put: &[u8]) -> Vec<u8> {
    let mut made = slice(text, 0, start).to_vec();

    made.extend_from_slice(put);
    made.extend_from_slice(slice(text, end, text.len() as i32));
    made
}

impl Engine {
    /// The caret at its boundary, and at the text's top; never so far
    /// right that it leaves the text's rectangle (seg28 `0000`).
    fn place_caret(&self, index: usize) -> Result<(), Stop> {
        let mut system = self.system();
        let layout = system.edit_layout(index)?;
        let text = system.edit_text(index);
        let style = system.control_at(index).style;
        let mut edit = *system.edit_state(index);

        scroll_to(style, &text, &mut edit, &layout);
        *system.edit_state(index) = edit;

        if edit.focused {
            let x = boundary_x(&text, &edit, &layout, edit.caret)
                .min(layout.right - layout.caret_width);

            system.edit_set_caret_pos(x, layout.top);
        }

        Ok(())
    }

    fn edit_repaint(&self, hwnd: u16, index: usize) {
        self.system().edit_repaint(hwnd, index);
    }

    /// Replaces the selection with `text`, as typing does; whether anything
    /// changed.
    async fn replace(&self, index: usize, put: &[u8]) -> Result<bool, Stop> {
        let over = {
            let mut system = self.system();
            let text = system.edit_text(index);
            let edit = *system.edit_state(index);
            let (start, end) = edit.selection();

            if text.len() as i32 - (end - start) + put.len() as i32 > edit.limit {
                true
            } else {
                system.set_edit_text(index, &spliced(&text, start, end, put));

                let edit = system.edit_state(index);

                edit.anchor = start + put.len() as i32;
                edit.caret = edit.anchor;

                // Changed by anything put in or taken out (seg26 `05c4`,
                // `0841`).
                if !put.is_empty() || end > start {
                    edit.modified = true;
                }

                false
            }
        };

        if over {
            self.notify_parent(index, EN_MAXTEXT).await?;
            return Ok(false);
        }

        Ok(true)
    }

    async fn changed(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        self.place_caret(index)?;
        self.edit_repaint(hwnd, index);
        self.notify_parent(index, EN_UPDATE).await?;
        self.notify_parent(index, EN_CHANGE).await
    }

    /// The selection replaced with pasted text, or with nothing for
    /// `WM_CLEAR`: as much of it as the limit leaves room for, `EN_MAXTEXT`
    /// first if not all, and then `EN_UPDATE` and `EN_CHANGE` whatever
    /// changed. **Recorded** by `editclip`: ten characters pasted into three
    /// with a limit of six put in three; an empty clipboard pasted still
    /// tells the parent.
    pub(crate) async fn paste_text(&self, hwnd: u16, index: usize, put: &[u8]) -> Result<(), Stop> {
        // The selection as it was asked for: a parent that moves it when it
        // is told `EN_MAXTEXT` does not move where the text goes.
        let (room, length, (start, end)) = {
            let mut system = self.system();
            let text = system.edit_text(index);
            let edit = *system.edit_state(index);
            let (start, end) = edit.selection();

            (
                (edit.limit - (text.len() as i32 - (end - start))).max(0),
                put.len() as i32,
                (start, end),
            )
        };
        let mut put = put;

        if length > room {
            self.notify_parent(index, EN_MAXTEXT).await?;
            put = &put[..room as usize];
        }

        {
            let mut system = self.system();
            let text = system.edit_text(index);

            system.set_edit_text(index, &spliced(&text, start, end, put));

            let edit = system.edit_state(index);

            edit.anchor = start + put.len() as i32;
            edit.caret = edit.anchor;

            if !put.is_empty() || end > start {
                edit.modified = true;
            }
        }

        self.changed(hwnd, index).await
    }

    /// A single-line edit control's answer to a message, or `None` for one
    /// it leaves to the rest of its window procedure.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn edit_message(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: u32,
    ) -> Result<Option<u32>, Stop> {
        self.system().edit_state(index);

        match message {
            WM_SETFOCUS => {
                {
                    let mut system = self.system();
                    let layout = system.edit_layout(index)?;

                    system.edit_state(index).focused = true;
                    system.edit_create_caret(hwnd, layout.caret_width, layout.caret_height);
                }

                self.place_caret(index)?;
                self.system().edit_show_caret(hwnd);
                self.edit_repaint(hwnd, index);
                self.notify_parent(index, EN_SETFOCUS).await?;
                Ok(Some(0))
            }
            WM_KILLFOCUS => {
                {
                    let mut system = self.system();

                    system.edit_state(index).focused = false;
                    system.edit_hide_caret(hwnd);
                    system.edit_destroy_caret();
                }

                self.edit_repaint(hwnd, index);
                self.notify_parent(index, EN_KILLFOCUS).await?;
                Ok(Some(0))
            }
            WM_CHAR => {
                let code = wparam as u8;

                if self.clipboard_character(hwnd, index, code).await? {
                    return Ok(Some(0));
                }

                if code == VK_BACK {
                    {
                        let mut system = self.system();
                        let edit = system.edit_state(index);
                        let (start, end) = edit.selection();

                        if start == end && start == 0 {
                            return Ok(Some(0));
                        }

                        if start == end {
                            edit.anchor = start - 1;
                        }
                    }

                    self.replace(index, &[]).await?;
                    self.changed(hwnd, index).await?;
                    return Ok(Some(0));
                }

                if code < 0x20 {
                    return Ok(Some(0));
                }

                if self.replace(index, &[code]).await? {
                    self.changed(hwnd, index).await?;
                }

                Ok(Some(0))
            }
            WM_KEYDOWN => {
                let shift = crate::user_misc::key_state(&self.system(), VK_SHIFT) & 0x80 != 0;
                let control = crate::user_misc::key_state(&self.system(), VK_CONTROL) & 0x80 != 0;

                if self
                    .clipboard_key(hwnd, index, wparam, shift, control)
                    .await?
                {
                    return Ok(Some(0));
                }
                let (length, edit) = {
                    let mut system = self.system();

                    (
                        system.edit_text(index).len() as i32,
                        *system.edit_state(index),
                    )
                };
                let move_to = |to: i32| -> Result<(), Stop> {
                    {
                        let mut system = self.system();
                        let edit = system.edit_state(index);

                        edit.caret = to.min(length).max(0);

                        if !shift {
                            edit.anchor = edit.caret;
                        }
                    }

                    self.place_caret(index)?;
                    self.edit_repaint(hwnd, index);
                    Ok(())
                };

                match wparam {
                    VK_HOME => move_to(0)?,
                    VK_END => move_to(length)?,
                    VK_LEFT => move_to(if shift || edit.anchor == edit.caret {
                        edit.caret - 1
                    } else {
                        edit.selection().0
                    })?,
                    VK_RIGHT => move_to(if shift || edit.anchor == edit.caret {
                        edit.caret + 1
                    } else {
                        edit.selection().1
                    })?,
                    VK_DELETE => {
                        let (start, end) = edit.selection();

                        if start == end && end == length {
                            return Ok(Some(0));
                        }

                        if start == end {
                            self.system().edit_state(index).anchor = start + 1;
                        }

                        self.replace(index, &[]).await?;
                        self.changed(hwnd, index).await?;
                    }
                    _ => {}
                }

                Ok(Some(0))
            }
            // The mouse (seg28 `1009`). A press on a control without the
            // focus first takes the selection away, unless `ES_NOHIDESEL`,
            // and takes the focus; then the mouse is captured, and the caret
            // goes where it was pressed -- the selection with it, or with
            // Shift stretched from its other end. While captured, a move
            // stretches it.
            WM_LBUTTONDOWN => {
                let focused = {
                    let mut system = self.system();
                    let style = system.control_at(index).style;
                    let edit = system.edit_state(index);

                    if !edit.focused && style & ES_NOHIDESEL == 0 {
                        edit.anchor = edit.caret;
                    }

                    edit.focused
                };

                if !focused {
                    self.set_focus(hwnd).await?;
                }

                {
                    let mut system = self.system();
                    let layout = system.edit_layout(index)?;
                    let text = system.edit_text(index);

                    system.edit_state(index).tracking = true;
                    system.capture = Some(index);

                    let edit = *system.edit_state(index);
                    let at = index_at(&text, &edit, &layout, i32::from(lparam as u16 as i16))
                        .min(text.len() as i32);
                    let edit = system.edit_state(index);

                    edit.caret = at;

                    if wparam & MK_SHIFT == 0 {
                        edit.anchor = at;
                    }
                }

                self.place_caret(index)?;
                self.edit_repaint(hwnd, index);
                Ok(Some(0))
            }
            WM_MOUSEMOVE => {
                if self.system().edit_state(index).tracking {
                    {
                        let mut system = self.system();
                        let layout = system.edit_layout(index)?;
                        let text = system.edit_text(index);
                        let edit = *system.edit_state(index);

                        system.edit_state(index).caret =
                            index_at(&text, &edit, &layout, i32::from(lparam as u16 as i16));
                    }

                    self.place_caret(index)?;
                    self.edit_repaint(hwnd, index);
                }

                Ok(Some(0))
            }
            WM_LBUTTONUP => {
                let mut system = self.system();
                let edit = system.edit_state(index);

                if edit.tracking {
                    edit.tracking = false;
                    system.capture = None;
                }

                Ok(Some(0))
            }
            // The word the caret is in, and the blanks after it, selected.
            WM_LBUTTONDBLCLK => {
                {
                    let mut system = self.system();
                    let text = system.edit_text(index);
                    let edit = system.edit_state(index);
                    let (start, end) = word_at(&text, edit.caret);

                    edit.anchor = start;
                    edit.caret = end;
                    edit.tracking = false;
                }

                self.place_caret(index)?;
                self.edit_repaint(hwnd, index);
                Ok(Some(0))
            }
            EM_GETSEL => {
                let (start, end) = self.system().edit_state(index).selection();

                Ok(Some((end as u32) << 16 | start as u32 & 0xffff))
            }
            EM_SETSEL => {
                {
                    let mut system = self.system();
                    let length = system.edit_text(index).len() as i32;
                    let edit = system.edit_state(index);

                    edit.anchor = i32::from(lparam as u16).min(length);
                    edit.caret = i32::from((lparam >> 16) as u16).min(length);
                }

                self.place_caret(index)?;
                self.edit_repaint(hwnd, index);
                Ok(Some(1))
            }
            // The text's length, whatever line is asked for and whatever
            // is selected (`sllen`): File Manager sizes what it reads its
            // Copy box's From field into by it.
            EM_LINELENGTH => Ok(Some(self.system().edit_text(index).len() as u32)),
            EM_LIMITTEXT => {
                self.system().edit_state(index).limit = if wparam == 0 {
                    30000
                } else {
                    i32::from(wparam)
                };
                Ok(Some(0))
            }
            // After the text is set: the caret back to the start.
            WM_SETTEXT => {
                {
                    let mut system = self.system();
                    let edit = system.edit_state(index);

                    edit.anchor = 0;
                    edit.caret = 0;
                    edit.scroll = 0;
                }

                self.place_caret(index)?;
                self.edit_repaint(hwnd, index);
                self.notify_parent(index, EN_UPDATE).await?;
                self.notify_parent(index, EN_CHANGE).await?;
                Ok(Some(1))
            }
            _ => Ok(None),
        }
    }

    /// An edit control's `WM_CUT`, `WM_COPY`, `WM_PASTE` and `WM_CLEAR`
    /// (`edit-clipboard.ts`).
    ///
    /// **Recorded** by `editclip`, a single-line and a multi-line control:
    ///
    /// * `WM_COPY` puts the selection on the clipboard as `CF_TEXT`, the
    ///   control opening and emptying it, and so its owner. Nothing
    ///   selected, the clipboard is left as it was. The parent is told
    ///   nothing.
    /// * `WM_CLEAR` takes the selection out; `WM_CUT` copies it and takes it
    ///   out.
    /// * `WM_PASTE` puts `CF_TEXT` in place of the selection, the caret
    ///   after it. A single-line control takes the text only to its first
    ///   line break; a multi-line one takes it all.
    ///
    /// What the text does, and what the parent is told, is each control's:
    /// see `paste_text` and `ml_paste_text`.
    pub(crate) async fn edit_clipboard(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
    ) -> Result<(), Stop> {
        let (text, (start, end), multiline) = {
            let mut system = self.system();
            let text = system.edit_text(index);
            let selection = system.edit_state(index).selection();
            let multiline = system.control_at(index).style & ES_MULTILINE != 0;

            (text, selection, multiline)
        };

        if (message == WM_COPY || message == WM_CUT) && end > start {
            self.copy_to_clipboard(hwnd, slice(&text, start, end))
                .await?;
        }

        let put = if message == WM_CUT || message == WM_CLEAR {
            None
        } else if message == WM_PASTE {
            let mut text = self.paste_from_clipboard(hwnd).await?;

            if !multiline
                && let Some(stop) = text.iter().position(|&byte| byte == b'\r' || byte == b'\n')
            {
                text.truncate(stop);
            }

            Some(text)
        } else {
            return Ok(());
        };

        if multiline {
            self.ml_paste_text(hwnd, index, put.as_deref()).await
        } else {
            self.paste_text(hwnd, index, put.as_deref().unwrap_or_default())
                .await
        }
    }

    /// The clipboard's keys, as USER's edit controls take them (`USER.EXE`
    /// seg28 `0a93`, `0c88`-`0d54`; the multi-line control's alike, seg30):
    /// Control and Insert copy, by `WM_COPY` sent to the control; Shift and
    /// Insert paste; Shift and Delete copy as Control and Insert does and
    /// take the selection out -- with nothing selected, a backspace. The
    /// characters Control and C, V and X make are these three (seg28
    /// `0959`-`0a1f`, seg30 `1796`-`17ce`). Whether the key was one of them.
    ///
    /// Not modelled: `ES_READONLY`, which these controls do not keep, and
    /// which takes only the copy.
    pub(crate) async fn clipboard_key(
        &self,
        hwnd: u16,
        index: usize,
        key: u16,
        shift: bool,
        control: bool,
    ) -> Result<bool, Stop> {
        match (key, control, shift) {
            (VK_INSERT, true, false) => {
                self.send_message(hwnd, WM_COPY, 0, &mut Param::Value(0))
                    .await?;
            }
            (VK_INSERT, false, true) => {
                Box::pin(self.edit_clipboard(hwnd, index, WM_PASTE)).await?;
            }
            (VK_DELETE, false, true) => {
                let (start, end) = self.system().edit_state(index).selection();

                if start == end {
                    return Box::pin(self.backspace(hwnd, index)).await.map(|()| true);
                }

                self.send_message(hwnd, WM_COPY, 0, &mut Param::Value(0))
                    .await?;
                Box::pin(self.edit_clipboard(hwnd, index, WM_CLEAR)).await?;
            }
            _ => return Ok(false),
        }

        Ok(true)
    }

    /// A control character typed: Control and C, V or X, as the clipboard's
    /// keys (`clipboard_key`). Whether it was one of them.
    pub(crate) async fn clipboard_character(
        &self,
        hwnd: u16,
        index: usize,
        code: u8,
    ) -> Result<bool, Stop> {
        let (start, end) = self.system().edit_state(index).selection();

        match code {
            0x03 => {
                self.clipboard_key(hwnd, index, VK_INSERT, false, true)
                    .await
            }
            0x16 => {
                self.clipboard_key(hwnd, index, VK_INSERT, true, false)
                    .await
            }
            // Nothing selected: only a beep (`0a2c`).
            0x18 if start == end => Ok(true),
            0x18 => {
                self.clipboard_key(hwnd, index, VK_DELETE, true, false)
                    .await
            }
            _ => Ok(false),
        }
    }

    /// A backspace, as the control's own `WM_CHAR` takes it.
    async fn backspace(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let multiline = self.system().control_at(index).style & ES_MULTILINE != 0;

        if multiline {
            self.ml_edit_message(hwnd, index, WM_CHAR, u16::from(VK_BACK), &Param::Value(0))
                .await?;
        } else {
            self.edit_message(hwnd, index, WM_CHAR, u16::from(VK_BACK), 0)
                .await?;
        }

        Ok(())
    }

    /// Text put on the clipboard as `CF_TEXT`, by the control.
    async fn copy_to_clipboard(&self, hwnd: u16, text: &[u8]) -> Result<(), Stop> {
        let handle = {
            let mut system = self.system();
            let (handle, _) = system.text_block(text);

            if !system.open_clipboard(hwnd) {
                return Ok(());
            }

            handle
        };

        self.empty_clipboard().await?;
        self.system().set_clipboard_data(CF_TEXT, handle);
        self.close_clipboard().await?;
        Ok(())
    }

    /// The clipboard's `CF_TEXT`, or nothing.
    async fn paste_from_clipboard(&self, hwnd: u16) -> Result<Vec<u8>, Stop> {
        if !self.system().open_clipboard(hwnd) {
            return Ok(Vec::new());
        }

        let handle = self.get_clipboard_data(CF_TEXT).await?;
        let text = {
            let mut system = self.system();
            let far = if handle == 0 {
                0
            } else {
                system.lock_block(handle)
            };

            if far == 0 {
                Vec::new()
            } else {
                let mut text = system.read_string(far);

                text.truncate(0xffff);
                text
            }
        };

        self.close_clipboard().await?;
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slices_as_a_string_does() {
        assert_eq!(slice(b"abc", 1, 2), b"b");
        assert_eq!(slice(b"abc", 2, 1), b"");
        assert_eq!(slice(b"abc", -1, 9), b"c");
        assert_eq!(slice(b"abc", -9, 2), b"ab");
        // A line break looked for two before the second character: not
        // there, as `"a\r\n".slice(-1, 1)` is empty.
        assert_eq!(slice(b"a\r\n", -1, 1), b"");
    }

    #[test]
    fn a_word_and_the_blanks_after_it() {
        assert_eq!(word_at(b"one two  three", 5), (4, 9));
        assert_eq!(word_at(b"one", 0), (0, 3));
    }

    #[test]
    fn the_selection_lower_end_first() {
        let edit = EditState {
            anchor: 5,
            caret: 2,
            ..EditState::default()
        };

        assert_eq!(edit.selection(), (2, 5));
    }
}
