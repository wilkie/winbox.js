//! The multi-line edit control, Notepad's: its lines, how it breaks them,
//! the keys between them, its scrolling and what it answers about its
//! lines -- winbox.js's `mledit.ts`.
//!
//! **Read out of `USER.EXE`**, segment 30 and what it calls, and
//! **recorded** by `mledit` on four displays: a borderless control with
//! both scroll bars, Notepad's kind, and a bordered one that wraps its
//! words, typed at, keyed, scrolled, selected and clicked.
//!
//! As for the single-line control (`edit.rs`), the caret's place is worked
//! out and the caret itself, USER's drawing, passed over.

use crate::call::Stop;
use crate::edit::{EM_GETRECT, EN_CHANGE, EN_KILLFOCUS, EN_SETFOCUS, EN_UPDATE, EditState, slice};
use crate::engine::Engine;
use crate::messages::Param;
use crate::scroll_bars::{SB_HORZ, SB_VERT};
use crate::system::System;

pub const EN_HSCROLL: u16 = 0x0601;
pub const EN_VSCROLL: u16 = 0x0602;

pub const EM_GETSEL: u16 = 0x0400;
pub const EM_SETSEL: u16 = 0x0401;
pub const EM_SCROLL: u16 = 0x0405;
pub const EM_LINESCROLL: u16 = 0x0406;
pub const EM_GETLINECOUNT: u16 = 0x040a;
pub const EM_LINEINDEX: u16 = 0x040b;
pub const EM_SETHANDLE: u16 = 0x040c;
pub const EM_GETHANDLE: u16 = 0x040d;
pub const EM_LINELENGTH: u16 = 0x0411;
pub const EM_REPLACESEL: u16 = 0x0412;
pub const EM_GETLINE: u16 = 0x0414;
pub const EM_LIMITTEXT: u16 = 0x0415;
pub const EM_LINEFROMCHAR: u16 = 0x0419;
pub const EM_GETFIRSTVISIBLELINE: u16 = 0x041e;

const WM_SETFOCUS: u16 = 0x0007;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_SIZE: u16 = 0x0005;
const WM_SETTEXT: u16 = 0x000c;
const WM_KEYDOWN: u16 = 0x0100;
const WM_CHAR: u16 = 0x0102;
const WM_HSCROLL: u16 = 0x0114;
const WM_VSCROLL: u16 = 0x0115;
const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;

const ES_AUTOVSCROLL: u32 = 0x0040;
const ES_AUTOHSCROLL: u32 = 0x0080;
const ES_NOHIDESEL: u32 = 0x0100;
const WS_HSCROLL: u32 = 0x0010_0000;
const WS_VSCROLL: u32 = 0x0020_0000;

const VK_BACK: u8 = 0x08;
const VK_SHIFT: u16 = 0x10;
const VK_CONTROL: u16 = 0x11;
const VK_PRIOR: u16 = 0x21;
const VK_NEXT: u16 = 0x22;
const VK_END: u16 = 0x23;
const VK_HOME: u16 = 0x24;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;
const VK_DELETE: u16 = 0x2e;

const MK_SHIFT: u16 = 0x0004;

/// Where the caret is parked while it cannot be seen.
const HIDDEN: i32 = -20000;

/// What the multi-line control keeps beyond the single-line one's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinesState {
    /// Where each line starts.
    pub starts: Vec<i32>,
    pub first: i32,
    pub caret_line: i32,
    /// How far the text is scrolled across, in pixels.
    pub offset: i32,
    /// The widest line built since the last full build.
    pub widest: i32,
    /// The scroll bars' positions, as last set.
    pub v: i32,
    pub h: i32,
}

impl Default for LinesState {
    fn default() -> Self {
        Self {
            starts: vec![0],
            first: 0,
            caret_line: 0,
            offset: 0,
            widest: 0,
            v: 0,
            h: 0,
        }
    }
}

/// What the multi-line control needs of its window and font: its client
/// area, its border, and its font's and the System font's average widths
/// and heights, and each character's width (`USER.EXE` seg27 `00df`, a
/// table filled from `GetCharWidth`).
#[derive(Debug, Clone)]
pub struct LinesLayout {
    pub width: i32,
    pub height: i32,
    pub border: bool,
    pub average: i32,
    pub height1: i32,
    pub system_average: i32,
    pub system_height: i32,
    /// Each character's width: its run's, less the font's overhang.
    pub widths: Vec<i32>,
}

impl LinesLayout {
    pub fn char_width(&self, code: u8) -> i32 {
        self.widths[usize::from(code)]
    }
}

/// The text's rectangle, and the clip the control paints within.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FormatRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub visible: i32,
    pub valid: bool,
    /// The clip: the client area less the margins the single-line control
    /// keeps, the smaller average and height of the two fonts.
    pub clip_left: i32,
    pub clip_top: i32,
}

/// The text's rectangle (seg30 `1ff9`): the client area, less half the
/// System font's average width across and a quarter of its height down
/// with a border, cut to a whole number of lines. It is unusable narrower
/// than an average character or shorter than a line.
pub fn format_rect(layout: &LinesLayout) -> FormatRect {
    let across = if layout.border {
        layout.system_average / 2
    } else {
        0
    };
    let down = if layout.border {
        layout.system_height / 4
    } else {
        0
    };
    let (left, top) = (across, down);
    let right = layout.width - across;
    let bottom = layout.height - down;
    // A font is never 0 high, nor 0 wide on average; the divisions here and
    // below are held to 1 where the TypeScript engine would divide by
    // nought.
    let visible = ((bottom - top) / layout.height1.max(1)).max(0);

    FormatRect {
        left,
        top,
        right,
        bottom: top + visible * layout.height1,
        visible,
        valid: right - left >= layout.average && visible > 0,
        clip_left: if layout.border {
            layout.average.min(layout.system_average) / 2
        } else {
            0
        },
        clip_top: if layout.border {
            layout.height1.min(layout.system_height) / 4
        } else {
            0
        },
    }
}

/// A byte of the text by a place that may be outside it.
fn at(text: &[u8], place: i32) -> Option<u8> {
    usize::try_from(place)
        .ok()
        .and_then(|place| text.get(place).copied())
}

fn blank(character: Option<u8>) -> bool {
    matches!(character, Some(b' ' | b'\t'))
}

/// Whether the control wraps its words: when it scrolls neither way
/// across.
fn wraps(style: u32) -> bool {
    style & (ES_AUTOHSCROLL | WS_HSCROLL) == 0
}

fn auto_v(style: u32) -> bool {
    style & (ES_AUTOVSCROLL | WS_VSCROLL) != 0
}

fn auto_h(style: u32) -> bool {
    style & (ES_AUTOHSCROLL | WS_HSCROLL) != 0
}

fn width_of(layout: &LinesLayout, text: &[u8]) -> i32 {
    text.iter().map(|&code| layout.char_width(code)).sum()
}

/// How many of `text`'s first characters fit in `limit` (seg26 `025c`).
fn fit_in(layout: &LinesLayout, text: &[u8], limit: i32) -> i32 {
    let mut width = 0;
    let mut count = 0;

    for &code in text {
        width += layout.char_width(code);

        if width > limit {
            break;
        }

        count += 1;
    }

    count
}

/// Where a line's own characters end: before its CR LF, or CR CR LF.
fn hard_end(text: &[u8], from: i32) -> i32 {
    let length = text.len() as i32;

    for place in from.max(0)..length {
        if at(text, place) == Some(b'\r')
            && (at(text, place + 1) == Some(b'\n')
                || (at(text, place + 1) == Some(b'\r') && at(text, place + 2) == Some(b'\n')))
        {
            return place;
        }
    }

    length
}

/// The text and the state of a multi-line control, taken out of it to be
/// worked on and put back.
#[derive(Debug, Clone)]
struct Lines {
    text: Vec<u8>,
    style: u32,
    state: LinesState,
    edit: EditState,
}

impl Lines {
    /// A line's length, less the break that ends it (seg30 `01d8`).
    fn line_length(&self, line: i32) -> i32 {
        let text = &self.text;
        let starts = &self.state.starts;
        let length = text.len() as i32;
        let start = usize::try_from(line)
            .ok()
            .and_then(|line| starts.get(line))
            .copied()
            .unwrap_or(length);
        let next = if (line + 1) < starts.len() as i32 {
            starts[(line + 1) as usize]
        } else {
            length
        };
        let mut end = next;

        if end - start >= 2 && at(text, end - 2) == Some(b'\r') && at(text, end - 1) == Some(b'\n')
        {
            end -= 2;

            if end > start && at(text, end - 1) == Some(b'\r') {
                end -= 1;
            }
        }

        end - start
    }

    fn start_of(&self, line: i32) -> i32 {
        usize::try_from(line)
            .ok()
            .and_then(|line| self.state.starts.get(line))
            .copied()
            .unwrap_or(0)
    }

    /// Builds the lines again from `from` on (seg30 `0b63`). Each line runs
    /// to its break -- CR LF, or CR CR LF -- or, wrapping, to as many
    /// characters as fit, taken back to the start of the word that would
    /// not fit unless that word is the whole line, and on over one space
    /// after it. Typing stops as soon as a line starts where one did
    /// before, less what was typed.
    fn build(&mut self, layout: &LinesLayout, from: i32, delta: i32, typing: bool) {
        let text = &self.text;
        let length = text.len() as i32;
        let rect = format_rect(layout);
        let width = rect.right - rect.left;
        let full = from == 0 && delta == 0 && !typing;
        let from = from.max(0) as usize;
        let later: Vec<i32> = self
            .state
            .starts
            .iter()
            .skip(from + 1)
            .map(|start| start + delta)
            .collect();
        let mut starts: Vec<i32> = self.state.starts.iter().take(from + 1).copied().collect();

        if full {
            self.state.widest = 0;
        }

        let mut start = starts.get(from).copied().unwrap_or(0);

        loop {
            let end = hard_end(text, start);
            let mut place;

            if wraps(self.style) {
                let fits = fit_in(layout, slice(text, start, end), width).max(1);

                place = (start + fits).min(end);

                if place != end && !blank(at(text, place)) && !blank(at(text, place - 1)) {
                    let mut word = place;

                    while word > start && !blank(at(text, word - 1)) {
                        word -= 1;
                    }

                    if word > start {
                        place = word;
                    }
                }
            } else {
                place = start + (end - start).min(0x400);
            }

            self.state.widest = self
                .state
                .widest
                .max(width_of(layout, slice(text, start, place.min(end))));

            if !blank(at(text, place - 1)) && blank(at(text, place)) {
                place += 1;
            }

            if at(text, place) == Some(b'\r') {
                place += 2;

                if at(text, place) == Some(b'\n') {
                    place += 1;
                }
            }

            if place >= length {
                if length > 0 && at(text, length - 1) == Some(b'\n') && place == length {
                    starts.push(place);
                }

                break;
            }

            if typing && let Some(found) = later.iter().position(|&start| start == place) {
                starts.extend_from_slice(&later[found..]);
                break;
            }

            starts.push(place);
            start = place;
        }

        self.state.starts = if starts.is_empty() { vec![0] } else { starts };
        self.state.caret_line = self
            .state
            .caret_line
            .min(self.state.starts.len() as i32 - 1);
    }

    /// The line a character is on: the last to start at or before it
    /// (seg30 `0243`).
    fn line_of(&self, index: i32) -> i32 {
        let starts = &self.state.starts;
        let mut line = 0;

        while ((line + 1) as usize) < starts.len() && starts[(line + 1) as usize] <= index {
            line += 1;
        }

        line
    }

    /// The caret's line after an insert or a delete (seg30 `0604`): its
    /// line, except at a line start not just after a CR LF, where the caret
    /// stays at the end of the line before. **Read out**, and
    /// **recorded**: without it, typing a long word in the wrapping control
    /// scrolls a keystroke early.
    fn caret_line_of(&self, index: i32) -> i32 {
        let line = self.line_of(index);

        if line != 0
            && self.start_of(line) == index
            && slice(&self.text, index - 2, index) != b"\r\n"
        {
            return line - 1;
        }

        line
    }

    /// Where the caret shows, or nowhere (seg30 `0134`).
    fn caret_place(&self, layout: &LinesLayout) -> Option<(i32, i32)> {
        let rect = format_rect(layout);
        let line = self.state.caret_line;

        if !rect.valid || line < self.state.first || line >= self.state.first + rect.visible {
            return None;
        }

        let start = self.start_of(line);
        let x = rect.left + width_of(layout, slice(&self.text, start, self.edit.caret))
            - self.state.offset;
        let y = (line - self.state.first) * layout.height1 + rect.top;
        let outside = if wraps(self.style) {
            y > rect.bottom - layout.height1
        } else {
            x > rect.right || y > rect.bottom
        };

        if outside {
            return None;
        }

        Some((x.min(rect.right - 2), y))
    }

    /// The scroll bars' positions (seg30 `1bbd`), rounded as `MulDiv` does.
    fn positions(&self, layout: &LinesLayout) -> (i32, i32) {
        let count = self.state.starts.len() as i32;
        // Never over nought -- at least two lines, or a widest line of at
        // least two average widths -- but 0 if it were, which is what
        // `SetScrollPos` makes of the TypeScript engine's `NaN`.
        let mul_div = |a: i32, b: i32, c: i32| {
            if c == 0 {
                0
            } else {
                (a * b + (c >> 1)).div_euclid(c)
            }
        };

        (
            if count < 2 {
                0
            } else {
                mul_div(self.state.first, 100, count - 1)
            },
            if 2 * layout.average > self.state.widest {
                0
            } else {
                mul_div(self.state.offset, 100, self.state.widest)
            },
        )
    }

    /// The character a place in the client area falls at (seg30 `0366`):
    /// the line from the height, then across it.
    fn index_at(&self, layout: &LinesLayout, x: i32, y: i32) -> (i32, i32) {
        let state = &self.state;
        let rect = format_rect(layout);
        let mut line = if y <= rect.top {
            (state.first - 1).max(0)
        } else if y >= rect.bottom {
            state.first + rect.visible
        } else {
            state.first + (y - rect.top) / layout.height1.max(1)
        };

        line = line.min(state.starts.len() as i32 - 1);

        let start = self.start_of(line);
        let length = self.line_length(line);
        let text = slice(&self.text, start, start + length);
        let half = layout.average / 2;
        let within = if x >= rect.right {
            (fit_in(layout, text, state.offset - rect.left + rect.right) + 1).min(length)
        } else if x <= rect.left + half {
            (fit_in(layout, text, state.offset) - 1).max(0)
        } else {
            // A binary search, as the code runs it (seg30 `0467`-`04e4`):
            // the result is the last character count it tried, one more if
            // that count's width fell short of the place.
            let target = x + state.offset;
            let mut lo = 0;
            let mut hi = length + 1;
            let mut mid = 0;
            let mut width = 0;

            while hi - 1 > lo {
                mid = lo + ((hi - lo) >> 1).max(1);
                width = width_of(layout, slice(text, 0, mid)) + half + rect.left;

                if width > target {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }

            if width - target < target - width {
                mid += 1;
            }

            mid.min(length)
        };

        (line, start + within)
    }

    /// The caret's place for the keys that move a line: where it stands,
    /// drawn or not -- not kept within the rectangle, which only placing
    /// the caret does (seg30 `0277`).
    fn caret_pixel(&self, layout: &LinesLayout) -> (i32, i32) {
        let rect = format_rect(layout);
        let start = self.start_of(self.state.caret_line);

        (
            rect.left + width_of(layout, slice(&self.text, start, self.edit.caret))
                - self.state.offset,
            (self.state.caret_line - self.state.first) * layout.height1 + rect.top,
        )
    }
}

/// A step left or right, over a line break whole (seg30 `00be`).
fn step(text: &[u8], place: i32, forward: bool) -> i32 {
    let length = text.len() as i32;

    if forward {
        if slice(text, place, place + 3) == b"\r\r\n" {
            return place + 3;
        }

        if slice(text, place, place + 2) == b"\r\n" {
            return place + 2;
        }

        return length.min(place + 1);
    }

    if place >= 3 && slice(text, place - 3, place) == b"\r\r\n" {
        return place - 3;
    }

    if place >= 2 && slice(text, place - 2, place) == b"\r\n" {
        return place - 2;
    }

    (place - 1).max(0)
}

/// A row of a multi-line control to draw: where it is down the client
/// area, and its runs, each where it starts across, its text and whether
/// it is selected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaintRow {
    pub y: i32,
    pub runs: Vec<(i32, Vec<u8>, bool)>,
}

impl System {
    /// What the multi-line control lays its lines out by
    /// (`desktop.ts`'s `linesLayout`).
    pub(crate) fn lines_layout(&mut self, index: usize) -> Result<LinesLayout, Stop> {
        let single = self.edit_layout(index)?;
        let widths = (0..=255u8)
            .map(|code| single.measure(&[code]) - single.overhang)
            .collect();

        Ok(LinesLayout {
            width: single.client_width,
            height: single.client_height,
            border: single.border,
            average: single.average,
            height1: single.height,
            system_average: single.system_average,
            system_height: single.system_height,
            widths,
        })
    }

    fn lines_load(&mut self, index: usize) -> Lines {
        let text = self.edit_text(index);
        let edit = *self.edit_state(index);
        let control = self.control_at(index);

        Lines {
            text,
            style: control.style,
            state: control.lines.clone().unwrap_or_default(),
            edit,
        }
    }

    fn lines_store(&mut self, index: usize, lines: Lines) {
        self.set_edit_text(index, &lines.text);

        let control = self.control_at(index);

        control.lines = Some(lines.state);
        control.edit = Some(lines.edit);
    }

    /// The lines built the first time the control is worked on, as its
    /// host is made (`linesHost`).
    fn ensure_lines(&mut self, index: usize) -> Result<(), Stop> {
        if self.control_at(index).lines.is_some() {
            return Ok(());
        }

        let layout = self.lines_layout(index)?;
        let mut lines = self.lines_load(index);

        lines.build(&layout, 0, 0, false);
        self.lines_store(index, lines);
        Ok(())
    }

    fn place_lines_caret(&mut self, index: usize, layout: &LinesLayout) {
        let lines = self.lines_load(index);

        if !lines.edit.focused {
            return;
        }

        let (x, y) = lines.caret_place(layout).unwrap_or((HIDDEN, HIDDEN));

        self.edit_set_caret_pos(x, y);
    }

    /// The scroll bars' thumbs placed where they have moved to.
    fn set_positions(&mut self, hwnd: u16, index: usize, layout: &LinesLayout) {
        let mut lines = self.lines_load(index);
        let (v, h) = lines.positions(layout);
        let (set_v, set_h) = (v != lines.state.v, h != lines.state.h);

        lines.state.v = v;
        lines.state.h = h;
        self.lines_store(index, lines);

        if set_v {
            self.set_scroll_pos(hwnd, SB_VERT, v as u16, true);
        }

        if set_h {
            self.set_scroll_pos(hwnd, SB_HORZ, h as u16, true);
        }
    }

    /// The rows of a multi-line control to draw: each line, and its
    /// selected part.
    pub fn paint_lines(&mut self, index: usize) -> Result<(FormatRect, Vec<PaintRow>), Stop> {
        let layout = self.lines_layout(index)?;
        let lines = self.lines_load(index);
        let rect = format_rect(&layout);
        let (start, end) = lines.edit.selection();
        let shows = start != end && (lines.edit.focused || lines.style & ES_NOHIDESEL != 0);
        let mut rows = Vec::new();

        if !rect.valid {
            return Ok((rect, rows));
        }

        let last = (lines.state.first + rect.visible).min(lines.state.starts.len() as i32 - 1);

        for line in lines.state.first..=last {
            let from = lines.start_of(line);
            let to = from + lines.line_length(line);
            let y = (line - lines.state.first) * layout.height1 + rect.top;
            let cuts = if shows {
                vec![from, from.max(start.min(to)), from.max(end.min(to)), to]
            } else {
                vec![from, to]
            };
            let mut runs = Vec::new();

            for (at, pair) in cuts.windows(2).enumerate() {
                let (a, b) = (pair[0], pair[1]);

                if b > a {
                    runs.push((
                        rect.left - lines.state.offset
                            + width_of(&layout, slice(&lines.text, from, a)),
                        slice(&lines.text, a, b).to_vec(),
                        shows && at == 1,
                    ));
                }
            }

            rows.push(PaintRow { y, runs });
        }

        Ok((rect, rows))
    }
}

fn signed(value: u32) -> i32 {
    i32::from(value as u16 as i16)
}

impl Engine {
    fn ml_repaint(&self, hwnd: u16, index: usize) {
        self.system().edit_repaint(hwnd, index);
    }

    /// Scrolls by `amount` lines down or characters across (seg30 `1bfe`),
    /// telling the parent whether or not anything moved, and the scroll
    /// bars.
    async fn ml_scroll(
        &self,
        hwnd: u16,
        index: usize,
        vertical: bool,
        amount: i32,
        notify: bool,
    ) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let layout = system.lines_layout(index)?;
            let mut lines = system.lines_load(index);
            let state = &mut lines.state;

            if vertical {
                state.first = (state.first + amount)
                    .min(state.starts.len() as i32 - 1)
                    .max(0);
            } else {
                state.offset = (state.offset + amount * layout.average)
                    .min(state.widest)
                    .max(0);
            }

            system.lines_store(index, lines);
            system.set_positions(hwnd, index, &layout);
        }

        if notify {
            self.notify_parent(index, if vertical { EN_VSCROLL } else { EN_HSCROLL })
                .await?;
        }

        self.ml_repaint(hwnd, index);
        Ok(())
    }

    /// Brings the caret into view (seg30 `1e9b`): down or up so its line is
    /// the last or the first that shows; across, when the text is wider
    /// than its rectangle, by whole average characters to a third of the
    /// width in.
    async fn scroll_to_caret(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let (style, vertical) = {
            let mut system = self.system();
            let layout = system.lines_layout(index)?;
            let lines = system.lines_load(index);
            let rect = format_rect(&layout);
            let state = &lines.state;
            let amount = if state.caret_line > state.first + rect.visible - 1 {
                state.caret_line - (state.first + rect.visible - 1)
            } else if state.caret_line < state.first {
                state.caret_line - state.first
            } else {
                0
            };

            (lines.style, amount)
        };

        if auto_v(style) && vertical != 0 {
            self.ml_scroll(hwnd, index, true, vertical, true).await?;
        }

        let across = {
            let mut system = self.system();
            let layout = system.lines_layout(index)?;
            let lines = system.lines_load(index);
            let rect = format_rect(&layout);
            let mut characters = 0;

            if auto_h(style) && rect.right - rect.left < lines.state.widest {
                let start = lines.start_of(lines.state.caret_line);
                let x = rect.left + width_of(&layout, slice(&lines.text, start, lines.edit.caret))
                    - lines.state.offset;
                let average = layout.average.max(1);

                if x > rect.right {
                    characters = ((rect.right - rect.left) / 3 - rect.right + x) / average;
                } else if x < 0 {
                    characters = ((rect.left - rect.right) / 3 + x) / average;
                }
            }

            characters
        };

        if across != 0 {
            self.ml_scroll(hwnd, index, false, across, true).await?;
        }

        let mut system = self.system();
        let layout = system.lines_layout(index)?;

        system.set_positions(hwnd, index, &layout);
        system.place_lines_caret(index, &layout);
        Ok(())
    }

    /// Takes out what `from` to `to` is (seg30 `0943`).
    async fn ml_remove(&self, hwnd: u16, index: usize, from: i32, to: i32) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let layout = system.lines_layout(index)?;
            let mut lines = system.lines_load(index);
            let start_line = lines.line_of(from);
            let mut text = slice(&lines.text, 0, from).to_vec();

            text.extend_from_slice(slice(&lines.text, to, lines.text.len() as i32));
            lines.text = text;
            lines.edit.anchor = from;
            lines.edit.caret = from;

            if to > from {
                lines.edit.modified = true;
            }

            lines.build(&layout, (start_line - 1).max(0), from - to, false);
            lines.state.caret_line = lines.caret_line_of(from);
            system.lines_store(index, lines);
        }

        self.notify_parent(index, EN_UPDATE).await?;
        self.ml_repaint(hwnd, index);
        self.scroll_to_caret(hwnd, index).await?;
        self.notify_parent(index, EN_CHANGE).await
    }

    /// Puts `text` at the caret (seg30 `0641`); whether it fitted the
    /// limit.
    async fn ml_insert(
        &self,
        hwnd: u16,
        index: usize,
        put: &[u8],
        typing: bool,
    ) -> Result<bool, Stop> {
        {
            let mut system = self.system();
            let layout = system.lines_layout(index)?;
            let mut lines = system.lines_load(index);
            let place = lines.edit.caret;

            if lines.text.len() as i32 + put.len() as i32 > lines.edit.limit {
                return Ok(false);
            }

            let mut text = slice(&lines.text, 0, place).to_vec();

            text.extend_from_slice(put);
            text.extend_from_slice(slice(&lines.text, place, lines.text.len() as i32));
            lines.text = text;
            lines.edit.anchor = place + put.len() as i32;
            lines.edit.caret = lines.edit.anchor;

            if !put.is_empty() {
                lines.edit.modified = true;
            }

            let line = lines.state.caret_line;

            lines.build(&layout, line, put.len() as i32, typing);
            lines.state.caret_line = lines.caret_line_of(lines.edit.caret);
            system.lines_store(index, lines);
        }

        self.notify_parent(index, EN_UPDATE).await?;
        self.ml_repaint(hwnd, index);
        self.scroll_to_caret(hwnd, index).await?;
        self.notify_parent(index, EN_CHANGE).await?;
        Ok(true)
    }

    async fn delete_selection(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let (start, end) = self.system().edit_state(index).selection();

        if start != end {
            self.ml_remove(hwnd, index, start, end).await?;
        }

        Ok(())
    }

    /// The selection taken out, and pasted text put in its place, for
    /// `WM_CUT`, `WM_CLEAR` and `WM_PASTE`: none puts nothing in.
    /// **Recorded** by `editclip`: `EN_UPDATE` and `EN_CHANGE` once for
    /// each of the two that changes the text.
    pub(crate) async fn ml_paste_text(
        &self,
        hwnd: u16,
        index: usize,
        put: Option<&[u8]>,
    ) -> Result<(), Stop> {
        self.system().ensure_lines(index)?;
        self.delete_selection(hwnd, index).await?;

        if let Some(put) = put {
            self.ml_insert(hwnd, index, put, false).await?;
        }

        Ok(())
    }

    /// A press, as the mouse makes one and the keys that move between lines
    /// do (seg30 `18a9`).
    async fn press(
        &self,
        hwnd: u16,
        index: usize,
        x: i32,
        y: i32,
        shift: bool,
    ) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let layout = system.lines_layout(index)?;
            let mut lines = system.lines_load(index);
            let (line, place) = lines.index_at(&layout, x, y);

            lines.state.caret_line = line;
            lines.edit.caret = place;

            if !shift {
                lines.edit.anchor = place;
            }

            system.lines_store(index, lines);
        }

        self.scroll_to_caret(hwnd, index).await?;
        self.ml_repaint(hwnd, index);
        Ok(())
    }

    /// New text: the lines built again, the caret and the view at the
    /// start.
    fn restart(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let mut system = self.system();
        let layout = system.lines_layout(index)?;
        let mut lines = system.lines_load(index);

        lines.edit.anchor = 0;
        lines.edit.caret = 0;
        lines.state.first = 0;
        lines.state.offset = 0;
        lines.state.caret_line = 0;
        lines.build(&layout, 0, 0, false);
        system.lines_store(index, lines);
        system.set_positions(hwnd, index, &layout);
        system.place_lines_caret(index, &layout);
        system.edit_repaint(hwnd, index);
        Ok(())
    }

    /// The caret moved to `to` on `line` by the keys, the selection with it
    /// unless Shift is down.
    async fn ml_move(
        &self,
        hwnd: u16,
        index: usize,
        to: i32,
        line: Option<i32>,
        shift: bool,
    ) -> Result<(), Stop> {
        {
            let mut system = self.system();
            let mut lines = system.lines_load(index);

            lines.edit.caret = to;
            lines.state.caret_line = line.unwrap_or_else(|| lines.line_of(to));

            if !shift {
                lines.edit.anchor = to;
            }

            system.lines_store(index, lines);
        }

        self.scroll_to_caret(hwnd, index).await?;
        self.ml_repaint(hwnd, index);
        Ok(())
    }

    /// A multi-line edit control's answer to a message, or `None`.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn ml_edit_message(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: &Param,
    ) -> Result<Option<u32>, Stop> {
        {
            let mut system = self.system();

            system.edit_state(index);
            system.ensure_lines(index)?;
        }

        let value = match lparam {
            Param::Value(value) => *value,
            Param::Struct(_) => 0,
        };

        match message {
            WM_SETFOCUS => {
                {
                    let mut system = self.system();
                    let layout = system.lines_layout(index)?;

                    system.edit_state(index).focused = true;
                    system.edit_create_caret(hwnd, 2, layout.height1);
                    system.place_lines_caret(index, &layout);
                    system.edit_show_caret(hwnd);
                }

                self.ml_repaint(hwnd, index);
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

                self.ml_repaint(hwnd, index);
                self.notify_parent(index, EN_KILLFOCUS).await?;
                Ok(Some(0))
            }
            WM_SIZE => {
                let mut system = self.system();
                let layout = system.lines_layout(index)?;
                let mut lines = system.lines_load(index);

                lines.build(&layout, 0, 0, false);
                system.lines_store(index, lines);
                Ok(Some(0))
            }
            WM_CHAR => {
                let mut code = wparam as u8;

                if code == 0x0a {
                    code = 0x0d;
                }

                if code == VK_BACK {
                    let (lines, (start, end)) = {
                        let mut system = self.system();
                        let lines = system.lines_load(index);
                        let selection = lines.edit.selection();

                        (lines, selection)
                    };

                    if start != end {
                        self.delete_selection(hwnd, index).await?;
                    } else if start > 0 {
                        self.ml_remove(hwnd, index, step(&lines.text, start, false), start)
                            .await?;
                    }

                    return Ok(Some(0));
                }

                if code == 0x0d || code == 0x09 || code >= 0x20 {
                    self.delete_selection(hwnd, index).await?;

                    let put: &[u8] = if code == 0x0d { b"\r\n" } else { &[code] };

                    self.ml_insert(hwnd, index, put, code != 0x0d).await?;
                }

                Ok(Some(0))
            }
            WM_KEYDOWN => {
                let (shift, ctrl) = {
                    let system = self.system();

                    (
                        crate::user_misc::key_state(&system, VK_SHIFT) & 0x80 != 0,
                        crate::user_misc::key_state(&system, VK_CONTROL) & 0x80 != 0,
                    )
                };
                let (layout, lines) = {
                    let mut system = self.system();

                    (system.lines_layout(index)?, system.lines_load(index))
                };
                let rect = format_rect(&layout);

                match wparam {
                    VK_UP | VK_DOWN => {
                        if ctrl {
                            return Ok(Some(0));
                        }

                        let (x, y) = lines.caret_pixel(&layout);
                        let dy = if wparam == VK_UP {
                            -layout.height1
                        } else {
                            layout.height1
                        };

                        self.press(hwnd, index, x, y + dy + 1, shift).await?;
                    }
                    VK_PRIOR | VK_NEXT => {
                        let (x, y) = lines.caret_pixel(&layout);
                        let page = (rect.visible - 1).max(1);

                        self.ml_scroll(
                            hwnd,
                            index,
                            true,
                            if wparam == VK_PRIOR { -page } else { page },
                            true,
                        )
                        .await?;
                        self.press(hwnd, index, x, y + 1, shift).await?;
                    }
                    VK_HOME => {
                        let to = if ctrl {
                            0
                        } else {
                            lines.start_of(lines.state.caret_line)
                        };

                        self.ml_move(hwnd, index, to, None, shift).await?;
                    }
                    // End keeps the caret on a wrapped line: before the end
                    // of the text, on a line after the first that starts
                    // without a CR LF before it, its line is the one before
                    // -- whether or not the caret is at that line's start
                    // (seg30 `1630`).
                    VK_END => {
                        let length = lines.text.len() as i32;
                        let to = if ctrl {
                            length
                        } else {
                            lines.start_of(lines.state.caret_line)
                                + lines.line_length(lines.state.caret_line)
                        };
                        let mut line = lines.line_of(to);
                        let start = lines.start_of(line);

                        if to < length
                            && wraps(lines.style)
                            && line != 0
                            && slice(&lines.text, start - 2, start) != b"\r\n"
                        {
                            line -= 1;
                        }

                        self.ml_move(hwnd, index, to, Some(line), shift).await?;
                    }
                    VK_LEFT => {
                        let to = if shift || lines.edit.anchor == lines.edit.caret {
                            step(&lines.text, lines.edit.caret, false)
                        } else {
                            lines.edit.selection().0
                        };

                        self.ml_move(hwnd, index, to, None, shift).await?;
                    }
                    VK_RIGHT => {
                        let to = if shift || lines.edit.anchor == lines.edit.caret {
                            step(&lines.text, lines.edit.caret, true)
                        } else {
                            lines.edit.selection().1
                        };

                        self.ml_move(hwnd, index, to, None, shift).await?;
                    }
                    VK_DELETE => {
                        let (start, end) = lines.edit.selection();

                        if start != end {
                            self.delete_selection(hwnd, index).await?;
                        } else if start < lines.text.len() as i32 {
                            self.ml_remove(hwnd, index, start, step(&lines.text, start, true))
                                .await?;
                        }
                    }
                    _ => {}
                }

                Ok(Some(0))
            }
            WM_LBUTTONDOWN => {
                {
                    let mut system = self.system();
                    let style = system.control_at(index).style;

                    system.capture = Some(index);

                    let edit = system.edit_state(index);

                    edit.tracking = true;

                    if !edit.focused && style & ES_NOHIDESEL == 0 {
                        edit.anchor = edit.caret;
                    }
                }

                self.press(
                    hwnd,
                    index,
                    signed(value),
                    signed(value >> 16),
                    wparam & MK_SHIFT != 0,
                )
                .await?;

                if !self.system().edit_state(index).focused {
                    self.set_focus(hwnd).await?;
                }

                Ok(Some(0))
            }
            WM_MOUSEMOVE => {
                if self.system().edit_state(index).tracking {
                    self.press(hwnd, index, signed(value), signed(value >> 16), true)
                        .await?;
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
            // A double click (seg30 `1a08`): the word from where the first
            // press put the caret, looking back unless it is at the start of
            // the caret's line, selected; the caret at its end, on the line
            // that end is on -- the next one, for a word that ends where a
            // line wraps. A press is no longer followed, so moving the mouse
            // with the button held stretches nothing. **Recorded** by
            // `editdbl`, in a control that wraps: past the end of a wrapped
            // line, the word before the wrap; at the start of the next, the
            // word there.
            WM_LBUTTONDBLCLK => {
                let (caret, left) = {
                    let mut system = self.system();
                    let lines = system.lines_load(index);

                    (
                        lines.edit.caret,
                        lines.edit.caret != lines.start_of(lines.state.caret_line),
                    )
                };
                let (start, end) = self.word_around(index, caret, left).await?;

                {
                    let mut system = self.system();
                    let mut lines = system.lines_load(index);

                    lines.edit.anchor = start;
                    lines.edit.caret = end;
                    lines.state.caret_line = lines.line_of(end);
                    lines.edit.tracking = false;
                    system.lines_store(index, lines);
                }

                self.scroll_to_caret(hwnd, index).await?;
                self.ml_repaint(hwnd, index);
                Ok(Some(0))
            }
            // The text's rectangle, copied out; answers 1 (seg26 `0e1c`).
            EM_GETRECT => {
                let mut system = self.system();
                let rect = format_rect(&system.lines_layout(index)?);

                system.write_words(
                    value,
                    &[
                        rect.left as u16,
                        rect.top as u16,
                        rect.right as u16,
                        rect.bottom as u16,
                    ],
                );
                Ok(Some(1))
            }
            // Scrolling (seg30 `1bfe`): a line or character, a page -- a
            // line less than shows, counted in characters too across -- the
            // thumb, `n` for `EM_LINESCROLL`, or 40Eh, which answers the
            // position without moving and is how Notepad, whose frame has
            // the scroll bars, reads it.
            WM_VSCROLL | WM_HSCROLL => {
                let vertical = message == WM_VSCROLL;
                let (layout, lines) = {
                    let mut system = self.system();

                    (system.lines_layout(index)?, system.lines_load(index))
                };
                let rect = format_rect(&layout);
                let page = (rect.visible - 1).max(1);
                let n = signed(value);
                let mul_div = |a: i32, b: i32, c: i32| {
                    if c == 0 {
                        0
                    } else {
                        (a * b + (c >> 1)).div_euclid(c)
                    }
                };

                if wparam == 0x040e {
                    let (v, h) = lines.positions(&layout);

                    return Ok(Some(if vertical { v } else { h } as u32));
                }

                if wparam == 4 || wparam == 5 {
                    {
                        let mut system = self.system();
                        let mut lines = system.lines_load(index);
                        let count = lines.state.starts.len() as i32;

                        if vertical {
                            lines.state.first = mul_div(count - 1, n, 100).min(count - 1);
                        } else {
                            lines.state.offset =
                                mul_div(lines.state.widest - layout.average, n, 100);
                        }

                        system.lines_store(index, lines);
                    }

                    self.ml_scroll(hwnd, index, vertical, 0, wparam == 4)
                        .await?;
                    return Ok(Some(0x10000));
                }

                let amount = match wparam {
                    0 => -1,
                    1 => 1,
                    2 => -page,
                    3 => page,
                    0x406 => n,
                    _ => return Ok(Some(0)),
                };

                self.ml_scroll(hwnd, index, vertical, amount, true).await?;
                Ok(Some(1 << 16 | (amount as u32 & 0xffff)))
            }
            EM_SCROLL => {
                Box::pin(self.ml_edit_message(hwnd, index, WM_VSCROLL, wparam, &Param::Value(0)))
                    .await
            }
            EM_LINESCROLL => {
                Box::pin(self.ml_edit_message(
                    hwnd,
                    index,
                    WM_VSCROLL,
                    0x406,
                    &Param::Value(signed(value) as u32 & 0xffff),
                ))
                .await?;
                Box::pin(self.ml_edit_message(
                    hwnd,
                    index,
                    WM_HSCROLL,
                    0x406,
                    &Param::Value((value >> 16) & 0xffff),
                ))
                .await?;
                Ok(Some(1))
            }
            EM_GETSEL => {
                let (start, end) = self.system().edit_state(index).selection();

                Ok(Some((end as u32) << 16 | start as u32 & 0xffff))
            }
            // The caret goes to the second end, and is brought into view
            // (32:0340).
            EM_SETSEL => {
                {
                    let mut system = self.system();
                    let mut lines = system.lines_load(index);
                    let length = lines.text.len() as i32;
                    let mut from = signed(value);
                    let to = i32::from((value >> 16) as u16).min(length);

                    if from == -1 {
                        from = lines.edit.caret;
                    }

                    lines.edit.anchor = from.max(0).min(length);
                    lines.edit.caret = to;
                    lines.state.caret_line = lines.line_of(to);
                    system.lines_store(index, lines);
                }

                self.ml_repaint(hwnd, index);
                self.scroll_to_caret(hwnd, index).await?;
                Ok(Some(1))
            }
            EM_LIMITTEXT => {
                self.system().edit_state(index).limit = if wparam == 0 {
                    30000
                } else {
                    i32::from(wparam)
                };
                Ok(Some(0))
            }
            EM_GETLINECOUNT => Ok(Some(
                self.system().lines_load(index).state.starts.len() as u32
            )),
            EM_GETFIRSTVISIBLELINE => Ok(Some(self.system().lines_load(index).state.first as u32)),
            EM_LINEFROMCHAR => {
                let lines = self.system().lines_load(index);
                let at = signed(u32::from(wparam));

                Ok(Some(lines.line_of(if at == -1 {
                    lines.edit.selection().0
                } else {
                    at
                }) as u32))
            }
            EM_LINEINDEX => {
                let lines = self.system().lines_load(index);
                let line = if signed(u32::from(wparam)) == -1 {
                    lines.state.caret_line
                } else {
                    signed(u32::from(wparam))
                };

                Ok(Some(if line >= lines.state.starts.len() as i32 {
                    0xffff
                } else {
                    lines.start_of(line) as u32
                }))
            }
            EM_LINELENGTH => {
                let lines = self.system().lines_load(index);
                let at = signed(u32::from(wparam));

                if at != -1 {
                    return Ok(Some(lines.line_length(lines.line_of(at)) as u32));
                }

                let (start, end) = lines.edit.selection();
                let first = lines.line_of(start);
                let last = lines.line_of(end);

                Ok(Some(
                    (start - lines.start_of(first)
                        + (lines.start_of(last) + lines.line_length(last) - end))
                        as u32,
                ))
            }
            EM_GETLINE => {
                let lines = self.system().lines_load(index);
                let line = signed(u32::from(wparam));

                if line < 0 || line >= lines.state.starts.len() as i32 {
                    return Ok(Some(0));
                }

                let mut system = self.system();
                let room = i32::from(system.read_word(value));
                let start = lines.start_of(line);
                let count = lines.line_length(line).min(room);
                let bytes = slice(&lines.text, start, start + count).to_vec();

                for (step, byte) in bytes.iter().enumerate() {
                    let far = (value & 0xffff_0000) | (value.wrapping_add(step as u32) & 0xffff);

                    system.write_far(far, &[*byte]);
                }

                Ok(Some(count as u32))
            }
            // The string is read once the selection is out: the parent, told
            // of that change, may have written where `lParam` points.
            EM_REPLACESEL => {
                self.delete_selection(hwnd, index).await?;

                let put = self.system().message_string(lparam);

                self.ml_insert(hwnd, index, &put, false).await?;
                Ok(Some(0))
            }
            // After the text is set: the lines built again, everything at
            // the start, and no notification (seg31 `0067`).
            WM_SETTEXT => {
                self.restart(hwnd, index)?;
                Ok(Some(1))
            }
            // The text's block in the program's heap (`edit_buffer.rs`).
            EM_GETHANDLE => Ok(Some(u32::from(self.system().text_handle(index)))),
            // Another block taken as the text: everything at the start, as
            // for `WM_SETTEXT`, no notification, and not modified (seg32
            // `018f`).
            EM_SETHANDLE => {
                let text = self.system().adopt_handle(index, wparam);

                if let Some(text) = text {
                    {
                        let mut system = self.system();

                        system.set_edit_text(index, &text);
                        system.edit_state(index).modified = false;
                    }

                    self.restart(hwnd, index)?;
                }

                Ok(Some(1))
            }
            _ => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_host::bytes_of;

    fn layout() -> LinesLayout {
        LinesLayout {
            width: 80,
            height: 64,
            border: false,
            average: 8,
            height1: 16,
            system_average: 8,
            system_height: 16,
            widths: vec![8; 256],
        }
    }

    fn lines(text: &[u8], style: u32) -> Lines {
        Lines {
            text: text.to_vec(),
            style,
            state: LinesState::default(),
            edit: EditState::default(),
        }
    }

    #[test]
    fn lines_break_at_cr_lf() {
        let mut built = lines(b"ab\r\ncd\r\n", ES_AUTOHSCROLL);

        built.build(&layout(), 0, 0, false);
        assert_eq!(built.state.starts, vec![0, 4, 8]);
        assert_eq!(built.line_length(0), 2);
    }

    #[test]
    fn words_wrap_to_the_width() {
        // Ten characters fit in 80 pixels, and a word that would not is
        // taken to the next line.
        let mut built = lines(b"hello there world", 0);

        built.build(&layout(), 0, 0, false);
        assert_eq!(built.state.starts, vec![0, 6, 12]);
    }

    #[test]
    fn steps_over_a_break_whole() {
        assert_eq!(step(b"a\r\nb", 1, true), 3);
        assert_eq!(step(b"a\r\nb", 3, false), 1);
        assert_eq!(step(b"a\r\r\nb", 4, false), 1);
    }

    #[test]
    fn bytes_as_a_control_keeps_them() {
        assert_eq!(bytes_of("a\u{e9}"), vec![b'a', 0xe9]);
    }
}
