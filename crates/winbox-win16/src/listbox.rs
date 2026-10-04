//! The list box: its items and their order, its selection, the keys and
//! the mouse, its scrolling, what it tells its parent, and an owner-drawn
//! one -- winbox.js's `listbox.ts`, with what `control-classes.ts` does
//! around it: the strings its messages carry, its making (`initList`), its
//! whole rows (`integralHeight`) and what it asks of the desktop and its
//! parent (`listHost`).
//!
//! **Read out of `USER.EXE`** -- the window procedure is seg35 `0100`, with
//! seg38 for making one, seg43 for its items and scroll bar -- and
//! **recorded** by `listbox` on four displays: a sorted list box with a
//! scroll bar, one with many selected, and an owner-drawn one as
//! `COMMDLG.DLL`'s file lists are, driven with messages, keys and clicks.
//!
//! Its rows, its highlight and its focus rectangle are the desktop's
//! drawing (`control_pixels.rs`); an owner's `WM_DRAWITEM` is sent as the
//! TypeScript engine sends it.
//! `LB_DIR` and `LB_ADDFILE`, which fill a list from the disk
//! (`dlgdir.ts`), are not here yet and stop.

use crate::call::Stop;
use crate::control_host::{WM_DRAWITEM, WM_MEASUREITEM, bytes_of, text_of, widened};
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;

pub const LBS_NOTIFY: u32 = 0x0001;
pub const LBS_SORT: u32 = 0x0002;
pub const LBS_MULTIPLESEL: u32 = 0x0008;
pub const LBS_OWNERDRAWFIXED: u32 = 0x0010;
pub const LBS_OWNERDRAWVARIABLE: u32 = 0x0020;
pub const LBS_HASSTRINGS: u32 = 0x0040;
pub const LBS_NOINTEGRALHEIGHT: u32 = 0x0100;
pub const LBS_EXTENDEDSEL: u32 = 0x0800;
pub const LBS_DISABLENOSCROLL: u32 = 0x1000;

pub const LB_ADDSTRING: u16 = 0x401;
pub const LB_INSERTSTRING: u16 = 0x402;
pub const LB_DELETESTRING: u16 = 0x403;
pub const LB_RESETCONTENT: u16 = 0x405;
pub const LB_SETSEL: u16 = 0x406;
pub const LB_SETCURSEL: u16 = 0x407;
pub const LB_GETSEL: u16 = 0x408;
pub const LB_GETCURSEL: u16 = 0x409;
pub const LB_GETTEXT: u16 = 0x40a;
pub const LB_GETTEXTLEN: u16 = 0x40b;
pub const LB_GETCOUNT: u16 = 0x40c;
pub const LB_SELECTSTRING: u16 = 0x40d;
pub const LB_DIR: u16 = 0x40e;
pub const LB_GETTOPINDEX: u16 = 0x40f;
pub const LB_FINDSTRING: u16 = 0x410;
pub const LB_GETSELCOUNT: u16 = 0x411;
pub const LB_GETSELITEMS: u16 = 0x412;
pub const LB_ADDFILE: u16 = 0x417;
pub const LB_SETTOPINDEX: u16 = 0x418;
pub const LB_GETITEMRECT: u16 = 0x419;
pub const LB_GETITEMDATA: u16 = 0x41a;
pub const LB_SETITEMDATA: u16 = 0x41b;
pub const LB_SETCARETINDEX: u16 = 0x41f;
pub const LB_GETCARETINDEX: u16 = 0x420;
pub const LB_SETITEMHEIGHT: u16 = 0x421;
pub const LB_GETITEMHEIGHT: u16 = 0x422;
pub const LB_FINDSTRINGEXACT: u16 = 0x423;
/// A combo box's list shown as having the focus while its combo box has
/// it, and no longer.
pub const LB_COMBO_FOCUS: u16 = 0x0424;
pub const LB_COMBO_UNFOCUS: u16 = 0x0425;

pub const LBN_SELCHANGE: u16 = 1;
pub const LBN_DBLCLK: u16 = 2;
pub const LBN_SETFOCUS: u16 = 4;
pub const LBN_KILLFOCUS: u16 = 5;

const ODA_DRAWENTIRE: u16 = 1;
const ODA_SELECT: u16 = 2;
const ODA_FOCUS: u16 = 4;
const ODS_SELECTED: u16 = 1;
const ODS_FOCUS: u16 = 0x10;

const WM_SETFOCUS: u16 = 0x0007;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_KEYDOWN: u16 = 0x0100;
const WM_CHAR: u16 = 0x0102;
const WM_VSCROLL: u16 = 0x0115;
const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const WM_GETDLGCODE: u16 = 0x0087;

const VK_SPACE: u16 = 0x20;
const VK_PRIOR: u16 = 0x21;
const VK_NEXT: u16 = 0x22;
const VK_END: u16 = 0x23;
const VK_HOME: u16 = 0x24;
const VK_LEFT: u16 = 0x25;
const VK_UP: u16 = 0x26;
const VK_RIGHT: u16 = 0x27;
const VK_DOWN: u16 = 0x28;

const WS_VSCROLL: u32 = 0x0020_0000;
const WS_DISABLED: u32 = 0x0800_0000;

/// What a list box keeps beyond its strings, which are the control's
/// `items`.
#[derive(Debug, Clone, Default)]
// Each is a yes or no of the list's, as USER keeps it.
#[allow(clippy::struct_excessive_bools)]
pub struct ListState {
    pub data: Vec<u32>,
    pub selected: Vec<bool>,
    pub sel: i32,
    pub caret: i32,
    pub top: i32,
    pub anchor: i32,
    /// The height of a row, set at making or by `LB_SETITEMHEIGHT`.
    pub height: i32,
    pub focused: bool,
    /// Whether the focus rectangle is drawn now.
    pub focus_shown: bool,
    pub mouse_down: bool,
    pub double: bool,
}

impl ListState {
    fn new(height: i32) -> Self {
        Self {
            sel: -1,
            height,
            ..Self::default()
        }
    }
}

/// What a list box's message carries in `lParam`: a string, for a list that
/// keeps strings, or a value.
#[derive(Debug, Clone)]
pub enum ListArg {
    Text(Vec<u8>),
    Value(u32),
}

impl ListArg {
    fn text(&self) -> &[u8] {
        match self {
            Self::Text(text) => text,
            Self::Value(_) => &[],
        }
    }

    fn value(&self) -> u32 {
        match self {
            Self::Text(_) => 0,
            Self::Value(value) => *value,
        }
    }
}

/// A list box's answer: a number, a string to copy with its nought, or an
/// owner-drawn item's data to copy, all four bytes.
#[derive(Debug, Clone)]
pub enum ListAnswer {
    Number(u32),
    Copy(Vec<u8>),
    Data(u32),
}

/// A byte in lower case, as `lstrcmpi` lowers a string's characters: A to
/// Z, and Latin-1's capitals.
fn lower(byte: u8) -> u8 {
    match byte {
        b'A'..=b'Z' | 0xc0..=0xd6 | 0xd8..=0xde => byte + 0x20,
        _ => byte,
    }
}

/// Two strings compared without regard to case, as `lstrcmpi` compares
/// them: the first difference of their lowered characters.
fn lstrcmpi(left: &[u8], right: &[u8]) -> i32 {
    (0..left.len().max(right.len()))
        .map(|at| {
            i32::from(left.get(at).copied().map_or(0, lower))
                - i32::from(right.get(at).copied().map_or(0, lower))
        })
        .find(|&difference| difference != 0)
        .unwrap_or(0)
}

fn signed(value: u32) -> i32 {
    i32::from(value as u16 as i16)
}

/// Finds an item from after `start`, wrapping (seg35 `1dce`): as a prefix,
/// or the whole string exactly, without regard to case. A prefix search
/// that does not itself start with `[` passes over an item's leading `[` or
/// `[-`.
///
/// Both are put in capitals as the TypeScript engine's strings are, a
/// character to a byte read as Latin-1 and capitalised as Unicode has it:
/// `ß` becomes `SS`, and `ÿ` and `µ` capitals outside Latin-1 -- so `ß`
/// finds an item that starts `ss`.
fn find_in(items: &[String], start: i32, text: &[u8], exact: bool) -> i32 {
    let count = items.len() as i32;
    let wanted = text_of(text).to_uppercase();

    if wanted.is_empty() || count == 0 {
        return -1;
    }

    for step in 1..=count {
        let at = ((start + step) % count + count) % count;
        let upper = items[at as usize].to_uppercase();
        let mut item = upper.as_str();

        if !exact && !wanted.starts_with('[') {
            item = item
                .strip_prefix("[-")
                .or_else(|| item.strip_prefix('['))
                .unwrap_or(item);
        }

        if if exact {
            item == wanted
        } else {
            item.starts_with(&wanted)
        } {
            return at;
        }
    }

    -1
}

/// What a list box is made of, read out of its window for a message.
#[derive(Debug, Clone, Copy)]
struct Shape {
    style: u32,
    count: i32,
    client_width: i32,
    client_height: i32,
    visible: bool,
}

impl Shape {
    fn owner_draw(self) -> bool {
        self.style & (LBS_OWNERDRAWFIXED | LBS_OWNERDRAWVARIABLE) != 0
    }

    fn multiple(self) -> bool {
        self.style & (LBS_MULTIPLESEL | LBS_EXTENDEDSEL) != 0
    }

    fn has_strings(self) -> bool {
        !self.owner_draw() || self.style & LBS_HASSTRINGS != 0
    }
}

impl System {
    /// A list box's state, made the first time with rows `height` high.
    pub(crate) fn list_state(&mut self, index: usize) -> &mut ListState {
        self.control_at(index)
            .list
            .get_or_insert_with(|| ListState::new(16))
    }

    fn list_shape(&mut self, index: usize) -> Shape {
        let window = self.control_window(index);
        let control = window.control.as_ref().expect("a control");

        Shape {
            style: control.style,
            count: control.items.len() as i32,
            client_width: window.client_width(),
            client_height: window.client_height(),
            visible: window.visible,
        }
    }

    /// How many whole rows show, and with a partly shown one counted
    /// (seg35 `09d2`).
    fn list_rows(&mut self, index: usize, partial: bool) -> i32 {
        let height = self.list_shape(index).client_height;
        // A row is never 0 high -- made from a font's height, or 1 to 255 by
        // `LB_SETITEMHEIGHT` -- but held to 1 here and in the divisions
        // below, where the TypeScript engine would divide by nought.
        let row = self.list_state(index).height.max(1);
        let whole = height / row;

        if partial && height % row != 0 {
            whole + 1
        } else {
            whole
        }
    }

    /// The furthest the top can go: the count less the rows that show.
    fn max_top(&mut self, index: usize) -> i32 {
        let count = self.list_shape(index).count;

        (count - self.list_rows(index, false)).max(0)
    }

    pub(crate) fn is_selected(&mut self, index: usize, item: i32) -> bool {
        let multiple = self.list_shape(index).multiple();
        let list = self.list_state(index);

        if multiple {
            usize::try_from(item)
                .ok()
                .and_then(|item| list.selected.get(item))
                .copied()
                .unwrap_or(false)
        } else {
            list.sel == item && item >= 0
        }
    }

    /// The scroll bar (seg43 `0000`): shown while the list is scrolled or
    /// does not fit, and placed at the top over the furthest top, as a
    /// percentage rounded as `MulDiv` rounds. The range is never set, so it
    /// is the window's 0 to 100.
    pub(crate) fn update_list_scroll(&mut self, index: usize) -> Result<(), Stop> {
        let most = self.max_top(index);
        let top = self.list_state(index).top;
        let shown = top != 0 || most != 0;
        // Scrolled with nothing to scroll -- items taken away under it -- the
        // TypeScript engine's percentage is infinite, which `SetScrollPos`
        // takes as 0.
        let position = if !shown {
            None
        } else if top == 0 || most == 0 {
            Some(0)
        } else {
            Some((top * 100 + (most >> 1)) / most)
        };

        self.list_scroll_bar(index, shown, position)
    }

    /// The vertical scroll bar shown or hidden, and its position set
    /// (`listHost.scrollBar`). With `LBS_DISABLENOSCROLL` it is kept, its
    /// arrows turned off when there is nothing to scroll (`USER.EXE` seg43
    /// `0088`).
    fn list_scroll_bar(
        &mut self,
        index: usize,
        mut visible: bool,
        position: Option<i32>,
    ) -> Result<(), Stop> {
        let (style, own, hwnd) = {
            let window = self.control_window(index);

            (
                window.style,
                window.control.as_ref().map_or(0, |control| control.style),
                window.hwnd,
            )
        };
        let has = style & WS_VSCROLL != 0;

        if own & LBS_DISABLENOSCROLL != 0 {
            let flags = if visible { 0 } else { 3 };
            let state = self.control_window_mut(index).scroll_bars.vertical();

            if state.flags != flags {
                state.flags = flags;
                self.paint_frame(index);
            }

            visible = true;
        }

        if visible != has {
            let window = self.control_window_mut(index);

            if visible {
                window.style |= WS_VSCROLL;
            } else {
                window.style &= !WS_VSCROLL;
            }

            let (left, top, width, height) = (window.left, window.top, window.width, window.height);

            self.place_window(index, left, top, width, height)?;
        }

        if let Some(position) = position {
            self.set_scroll_pos(hwnd, crate::scroll_bars::SB_VERT, position as u16, true);
        }

        Ok(())
    }

    /// Where a string goes in a sorted list (seg43 `0658`): bracketed names
    /// after all others, the rest by `lstrcmpi`.
    fn sorted_place(&mut self, index: usize, text: &[u8]) -> i32 {
        let items: Vec<Vec<u8>> = self
            .control_at(index)
            .items
            .iter()
            .map(|item| bytes_of(item))
            .collect();
        let compare = |one: &[u8], other: &[u8]| {
            let a = one.first() == Some(&b'[');
            let b = other.first() == Some(&b'[');

            if a == b {
                lstrcmpi(one, other)
            } else if a {
                1
            } else {
                -1
            }
        };
        let mut lo = 0i32;
        let mut hi = items.len() as i32 - 1;

        while lo <= hi {
            let mid = (lo + hi) >> 1;
            let c = compare(&items[mid as usize], text);

            match c.cmp(&0) {
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid - 1,
                std::cmp::Ordering::Equal => return mid,
            }
        }

        lo
    }

    /// Finds an item from after `start`, wrapping (seg35 `1dce`).
    fn find_item(&mut self, index: usize, start: i32, text: &[u8], exact: bool) -> i32 {
        find_in(&self.control_at(index).items, start, text, exact)
    }

    /// The item under a place, or -1 outside the items (seg35 `0e27`).
    fn item_at(&mut self, index: usize, x: i32, y: i32) -> i32 {
        let shape = self.list_shape(index);
        let list = self.list_state(index);

        if x < 0 || x >= shape.client_width || y < 0 {
            return -1;
        }

        let item = list.top + y / list.height.max(1);

        if item < shape.count { item } else { -1 }
    }

    /// A list box made a whole number of rows high (`USER.EXE` seg38
    /// `0457`), unless `LBS_NOINTEGRALHEIGHT`: when its inside, less a
    /// border each way, is not a whole number of rows, it is made as many
    /// rows as its whole height holds, and the borders -- which is a row
    /// more than its inside held when the remainder is more than two
    /// borders' worth. A combo box's simple list shows it: 65 pixels become
    /// 66.
    pub(crate) fn integral_height(&mut self, index: usize) -> Result<(), Stop> {
        const BORDER: i32 = 1;

        let style = self.control_at(index).style;
        let row = self.list_state(index).height.max(1);

        if style & (LBS_NOINTEGRALHEIGHT | LBS_OWNERDRAWVARIABLE) != 0 {
            return Ok(());
        }

        let window = self.control_window(index);
        let (left, top, width, height) = (window.left, window.top, window.width, window.height);

        if (height - 2 * BORDER) % row != 0 {
            self.place_window(index, left, top, width, height / row * row + 2 * BORDER)?;
        }

        Ok(())
    }
}

impl Engine {
    /// `WM_DRAWITEM` to the parent, for an owner-drawn list's item: the
    /// structure 32 bytes into the owner block, `ODT_LISTBOX`, the item --
    /// 0xFFFF past the last -- the action, the state with `ODS_DISABLED`
    /// for a disabled list, the list and a device context on it, the row's
    /// rectangle across the client area, and the item's data.
    async fn list_draw_item(
        &self,
        index: usize,
        item: i32,
        action: u16,
        state: u16,
        row: i32,
    ) -> Result<(), Stop> {
        let (far, id) = {
            let mut system = self.system();
            let far = system.owner_block() + 32;
            let hdc = system.item_dc(index);
            let shape = system.list_shape(index);
            let (id, hwnd, style) = {
                let window = system.control_window(index);

                (window.control_id, window.hwnd, window.style)
            };
            let list = system.list_state(index);
            let data = usize::try_from(item)
                .ok()
                .and_then(|item| list.data.get(item))
                .copied()
                .unwrap_or(0);
            let words = [
                2,
                id,
                if item < shape.count {
                    item as u16
                } else {
                    0xffff
                },
                action,
                state | if style & WS_DISABLED != 0 { 4 } else { 0 },
                hwnd,
                hdc,
                0,
                (row * list.height) as u16,
                shape.client_width as u16,
                ((row + 1) * list.height) as u16,
                data as u16,
                (data >> 16) as u16,
            ];

            system.write_words(far, &words);
            (far, id)
        };

        self.send_parent(index, WM_DRAWITEM, id, far).await?;
        Ok(())
    }

    /// The focus rectangle on the caret's row: inverted over a string list,
    /// and asked of the parent for an owner-drawn one (`ODA_FOCUS`).
    async fn draw_list_focus(&self, index: usize, on: bool) -> Result<(), Stop> {
        let (owner, caret, row, selected) = {
            let mut system = self.system();
            let shape = system.list_shape(index);

            if !shape.visible {
                return Ok(());
            }

            let rows = system.list_rows(index, true);
            let list = system.list_state(index);
            let (caret, row) = (list.caret, list.caret - list.top);

            if row < 0 || row >= rows {
                return Ok(());
            }

            let selected = system.is_selected(index, caret);

            (shape.owner_draw(), caret, row, selected)
        };

        if owner {
            let state = if on { ODS_FOCUS } else { 0 } | if selected { ODS_SELECTED } else { 0 };

            self.list_draw_item(index, caret, ODA_FOCUS, state, row)
                .await?;
        } else {
            self.system().list_focus_rect(index, row);
        }

        Ok(())
    }

    async fn list_focus_off(&self, index: usize) -> Result<(), Stop> {
        let shown = {
            let mut system = self.system();
            let list = system.list_state(index);

            std::mem::replace(&mut list.focus_shown, false)
        };

        if shown {
            self.draw_list_focus(index, false).await?;
        }

        Ok(())
    }

    /// Drawn only where it can be: a hidden list has none showing.
    async fn list_focus_on(&self, index: usize) -> Result<(), Stop> {
        let draw = {
            let mut system = self.system();
            let visible = system.list_shape(index).visible;
            let list = system.list_state(index);

            if list.focused && !list.focus_shown && visible {
                list.focus_shown = true;
                true
            } else {
                false
            }
        };

        if draw {
            self.draw_list_focus(index, true).await?;
        }

        Ok(())
    }

    /// One item drawn as its selection is now: `ODA_SELECT` to an owner,
    /// or its text, its whole row filled first (`USER.EXE` seg35 `1096`).
    async fn draw_one(&self, index: usize, item: i32) -> Result<(), Stop> {
        let (owner, row, selected) = {
            let mut system = self.system();
            let shape = system.list_shape(index);

            if !shape.visible {
                return Ok(());
            }

            let rows = system.list_rows(index, true);
            let row = item - system.list_state(index).top;

            if item < 0 || item >= shape.count || row < 0 || row >= rows {
                return Ok(());
            }

            (shape.owner_draw(), row, system.is_selected(index, item))
        };

        if owner {
            let state = if selected { ODS_SELECTED } else { 0 };

            self.list_draw_item(index, item, ODA_SELECT, state, row)
                .await?;
        } else {
            self.system().list_text(index, item, true, None)?;
        }

        Ok(())
    }

    /// The whole list box painted (seg35 `0c4e`): cleared in its colour,
    /// each row from the top that shows, and the focus rectangle -- which
    /// comes back only if it was showing before.
    pub(crate) async fn paint_list(&self, index: usize) -> Result<(), Stop> {
        let (top, last, owner, shown) = {
            let mut system = self.system();
            let shape = system.list_shape(index);

            if !shape.visible {
                return Ok(());
            }

            let rows = system.list_rows(index, true);
            let state = system.list_state(index);
            let last = (state.top + rows - 1).min(shape.count - 1);
            let shown = std::mem::replace(&mut state.focus_shown, false);
            let top = state.top;

            system.list_erase(index);
            (top, last, shape.owner_draw(), shown)
        };

        for item in top..=last {
            if owner {
                // Its row from the top as it is now: an owner may scroll the
                // list as it draws an item.
                let (selected, top) = {
                    let mut system = self.system();

                    (
                        system.is_selected(index, item),
                        system.list_state(index).top,
                    )
                };
                let state = if selected { ODS_SELECTED } else { 0 };

                self.list_draw_item(index, item, ODA_DRAWENTIRE, state, item - top)
                    .await?;
            } else {
                self.system().list_text(index, item, false, None)?;
            }
        }

        if shown {
            self.list_focus_on(index).await?;
        }

        Ok(())
    }

    /// Scrolls so an item shows: to the top if above, to the last row if
    /// below (seg35 `0fb4`).
    async fn ensure_visible(&self, index: usize, item: i32) -> Result<(), Stop> {
        let (top, old) = {
            let mut system = self.system();
            let showing = system.list_rows(index, false);
            let old = system.list_state(index).top;
            let mut top = old;

            if item < top {
                top = item;
            } else if item > top + showing - 1 {
                top = top - (top + showing - 1) + item;
            }

            (top, old)
        };

        if top != old {
            self.set_top(index, top).await?;
        }

        Ok(())
    }

    /// Scrolls to a new top (seg35 `16f9`), as `ScrollWindow` and
    /// `UpdateWindow` do it: what shows is moved by whole rows, and only the
    /// rows the move uncovers are drawn -- so what was on the rows that
    /// stay, a deselected item's highlight left beside its text among it,
    /// goes with them. **Recorded** by `combobox`: a list dropped down and
    /// moved a row by the keys keeps that highlight.
    async fn set_top(&self, index: usize, top: i32) -> Result<(), Stop> {
        let uncovered = {
            let mut system = self.system();
            let most = system.max_top(index);
            let shape = system.list_shape(index);
            let list = system.list_state(index);
            let old = list.top;

            list.top = top.min(most).max(0);

            if list.top != old && shape.visible {
                let shift = (old - list.top) * list.height;
                let height = shape.client_height;
                let (from, to) = if shift < 0 {
                    ((height + shift).max(0), height)
                } else {
                    (0, height.min(shift))
                };
                let row = list.height.max(1);
                let first = list.top + from / row;
                let final_item = (list.top + (to - 1) / row).min(shape.count - 1);

                system.list_scroll_client(index, shift, from, to);
                Some((first, final_item, from, to, shape.owner_draw()))
            } else {
                None
            }
        };

        if let Some((first, last, from, to, owner)) = uncovered {
            for item in first..=last {
                if owner {
                    let (selected, top) = {
                        let mut system = self.system();

                        (
                            system.is_selected(index, item),
                            system.list_state(index).top,
                        )
                    };
                    let state = if selected { ODS_SELECTED } else { 0 };

                    self.list_draw_item(index, item, ODA_DRAWENTIRE, state, item - top)
                        .await?;
                } else {
                    self.system()
                        .list_text(index, item, false, Some((from, to)))?;
                }
            }
        }

        self.system().update_list_scroll(index)
    }

    /// The caret moved, its focus rectangle with it.
    async fn set_list_caret(&self, index: usize, item: i32) -> Result<(), Stop> {
        let shown = self.system().list_state(index).focus_shown;

        if shown {
            self.draw_list_focus(index, false).await?;
            self.system().list_state(index).caret = item;
            self.draw_list_focus(index, true).await?;
        } else {
            self.system().list_state(index).caret = item;
        }

        Ok(())
    }

    /// The selection moved to an item as the keys move it (seg35 `18a8`),
    /// the parent told.
    async fn move_to(&self, index: usize, item: i32, space: bool) -> Result<(), Stop> {
        self.set_list_caret(index, item).await?;
        self.list_focus_off(index).await?;

        let multiple = self.system().list_shape(index).multiple();

        if !multiple {
            let old = std::mem::replace(&mut self.system().list_state(index).sel, item);

            self.draw_one(index, old).await?;
            self.draw_one(index, item).await?;
        } else if space {
            {
                let mut system = self.system();
                let list = system.list_state(index);

                if let Some(selected) = usize::try_from(item)
                    .ok()
                    .and_then(|item| list.selected.get_mut(item))
                {
                    *selected = !*selected;
                }
            }

            self.draw_one(index, item).await?;
        }

        self.ensure_visible(index, item).await?;
        self.system().update_list_scroll(index)?;
        self.list_focus_on(index).await?;
        self.list_keyboard_change(index);

        if self.system().list_shape(index).style & LBS_NOTIFY != 0 {
            self.notify_parent(index, LBN_SELCHANGE).await?;
        }

        Ok(())
    }

    /// A combo box's list: the selection changed with the keys while
    /// dropped, which does not put the list away (seg35 `1d27`).
    fn list_keyboard_change(&self, index: usize) {
        let mut system = self.system();
        let combo = system.control_at(index).combo_hwnd;

        if let Some(combo) = system.window_named(combo)
            && let Some(state) = system.windows[combo]
                .as_mut()
                .and_then(|window| window.control.as_mut())
                .and_then(|control| control.combo.as_mut())
            && state.dropped
        {
            state.keyboard = true;
        }
    }

    /// A list box's answer to a message, or `None` for one it leaves
    /// alone.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn list_message(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: ListArg,
    ) -> Result<Option<ListAnswer>, Stop> {
        let shape = {
            let mut system = self.system();

            system.list_state(index);
            system.list_shape(index)
        };
        let count = shape.count;
        let number = |value: i32| Ok(Some(ListAnswer::Number(value as u32)));

        match message {
            LB_ADDSTRING | LB_INSERTSTRING => {
                let mut system = self.system();
                let item = if shape.has_strings() {
                    lparam.text().to_vec()
                } else {
                    Vec::new()
                };
                let mut at = if message == LB_INSERTSTRING {
                    signed(u32::from(wparam))
                } else {
                    -1
                };

                if message == LB_ADDSTRING {
                    at = if shape.style & LBS_SORT != 0 && shape.has_strings() {
                        system.sorted_place(index, &item)
                    } else {
                        count
                    };
                } else if at == -1 {
                    at = count;
                } else if at > count {
                    return number(0xffff);
                }

                // Where `splice` puts it: a place before the start counted
                // back from the end.
                let place = |length: usize| {
                    if at < 0 {
                        (length as i32 + at).max(0) as usize
                    } else {
                        (at as usize).min(length)
                    }
                };
                let items = &mut system.control_at(index).items;

                items.insert(place(items.len()), text_of(&item));

                let list = system.list_state(index);

                list.data.insert(
                    place(list.data.len()),
                    if shape.has_strings() {
                        0
                    } else {
                        lparam.value()
                    },
                );
                list.selected.insert(place(list.selected.len()), false);
                system.update_list_scroll(index)?;

                let top = system.list_state(index).top;

                if at <= top + system.list_rows(index, true) {
                    system.control_at(index).invalid = true;
                }

                number(at)
            }
            LB_DELETESTRING => {
                let at = signed(u32::from(wparam));

                if at < 0 || at >= count {
                    return number(0xffff);
                }

                if count == 1 {
                    Box::pin(self.list_message(hwnd, index, LB_RESETCONTENT, 0, ListArg::Value(0)))
                        .await?;
                    return number(0);
                }

                let mut system = self.system();

                system.control_at(index).items.remove(at as usize);

                let left = count - 1;
                let list = system.list_state(index);

                if (at as usize) < list.data.len() {
                    list.data.remove(at as usize);
                }

                if (at as usize) < list.selected.len() {
                    list.selected.remove(at as usize);
                }

                if list.sel == at || list.sel >= left {
                    list.sel = -1;
                }

                if list.caret == at {
                    list.caret -= 1;
                }

                list.caret = list.caret.min(left - 1).max(0);
                system.control_at(index).invalid = true;
                system.update_list_scroll(index)?;
                number(left)
            }
            LB_RESETCONTENT => {
                let mut system = self.system();

                system.control_at(index).items.clear();

                let list = system.list_state(index);

                list.data.clear();
                list.selected.clear();
                list.top = 0;
                list.caret = 0;
                list.sel = -1;
                system.control_at(index).invalid = true;
                system.list_scroll_bar(index, false, None)?;
                number(1)
            }
            LB_GETCOUNT => number(count),
            // An owner-drawn list without strings has only each item's
            // data, which `LB_GETTEXT` copies, all four bytes, and both
            // answer 4 (seg43 `0234`).
            LB_GETTEXT => {
                let at = signed(u32::from(wparam));

                if at < 0 || at >= count {
                    return number(0xffff);
                }

                let mut system = self.system();

                Ok(Some(if shape.has_strings() {
                    ListAnswer::Copy(bytes_of(&system.control_at(index).items[at as usize]))
                } else {
                    ListAnswer::Data(
                        system
                            .list_state(index)
                            .data
                            .get(at as usize)
                            .copied()
                            .unwrap_or(0),
                    )
                }))
            }
            LB_GETTEXTLEN => {
                let at = signed(u32::from(wparam));

                if at < 0 || at >= count {
                    return number(0xffff);
                }

                if shape.has_strings() {
                    number(
                        self.system().control_at(index).items[at as usize]
                            .chars()
                            .count() as i32,
                    )
                } else {
                    number(4)
                }
            }
            LB_GETITEMDATA => {
                let at = signed(u32::from(wparam));

                if at < 0 || at >= count {
                    return Ok(Some(ListAnswer::Number(0xffff_ffff)));
                }

                let data = self
                    .system()
                    .list_state(index)
                    .data
                    .get(at as usize)
                    .copied()
                    .unwrap_or(0);

                Ok(Some(ListAnswer::Number(data)))
            }
            LB_SETITEMDATA => {
                let at = signed(u32::from(wparam));

                if at < 0 || at >= count {
                    return number(0xffff);
                }

                let mut system = self.system();
                let list = system.list_state(index);

                if let Some(data) = list.data.get_mut(at as usize) {
                    *data = lparam.value();
                }

                number(1)
            }
            LB_SETCURSEL => {
                if shape.multiple() {
                    return number(0xffff);
                }

                let at = signed(u32::from(wparam));
                let old = self.system().list_state(index).sel;

                self.list_focus_off(index).await?;

                if old >= 0 {
                    self.ensure_visible(index, at).await?;
                    self.system().list_state(index).sel = -1;
                    self.draw_one(index, old).await?;
                }

                if at >= 0 && at < count {
                    self.ensure_visible(index, at).await?;
                    {
                        let mut system = self.system();
                        let list = system.list_state(index);

                        list.sel = at;
                        list.caret = at;
                    }
                    self.draw_one(index, at).await?;
                } else {
                    self.system().list_state(index).sel = -1;
                }

                self.list_focus_on(index).await?;

                let sel = self.system().list_state(index).sel;

                number(sel & 0xffff)
            }
            LB_GETCURSEL => {
                let mut system = self.system();
                let list = system.list_state(index);

                number(
                    if shape.multiple() {
                        list.caret
                    } else {
                        list.sel
                    } & 0xffff,
                )
            }
            LB_GETTOPINDEX => number(self.system().list_state(index).top),
            LB_GETCARETINDEX => number(self.system().list_state(index).caret),
            LB_SETTOPINDEX => {
                self.set_top(index, signed(u32::from(wparam))).await?;
                number(1)
            }
            LB_FINDSTRING | LB_FINDSTRINGEXACT => {
                let found = self.system().find_item(
                    index,
                    signed(u32::from(wparam)),
                    lparam.text(),
                    message == LB_FINDSTRINGEXACT,
                );

                number(found & 0xffff)
            }
            LB_SELECTSTRING => {
                let found =
                    self.system()
                        .find_item(index, signed(u32::from(wparam)), lparam.text(), false);

                if found < 0 {
                    return number(0xffff);
                }

                Box::pin(self.list_message(
                    hwnd,
                    index,
                    LB_SETCURSEL,
                    found as u16,
                    ListArg::Value(0),
                ))
                .await
            }
            LB_GETITEMHEIGHT => number(self.system().list_state(index).height),
            LB_SETITEMHEIGHT => {
                let value = lparam.value() as i32;

                if !(1..=255).contains(&value) {
                    return number(0xffff);
                }

                self.system().list_state(index).height = value & 0xff;
                number(0)
            }
            // Many selected: invalidated, drawn when it is next painted
            // (seg35 `22c8`).
            LB_SETSEL => {
                if !shape.multiple() {
                    return number(0xffff);
                }

                let at = signed(lparam.value());
                let on = wparam != 0;
                let mut system = self.system();
                let list = system.list_state(index);

                if at == -1 {
                    list.selected = vec![on; count as usize];
                } else if at >= 0 && at < count {
                    if list.selected.len() < count as usize {
                        list.selected.resize(count as usize, false);
                    }

                    list.selected[at as usize] = on;

                    if on {
                        list.sel = at;
                        list.caret = at;
                        list.anchor = at;
                    }
                }

                system.control_at(index).invalid = true;
                number(0)
            }
            LB_GETSEL => {
                let at = signed(u32::from(wparam));

                if at < 0 || at >= count {
                    return number(0xffff);
                }

                let selected = self.system().is_selected(index, at);

                number(i32::from(selected))
            }
            LB_GETSELCOUNT => {
                if !shape.multiple() {
                    return number(0xffff);
                }

                let mut system = self.system();
                let selected = system
                    .list_state(index)
                    .selected
                    .iter()
                    .filter(|&&on| on)
                    .count();

                number(selected as i32)
            }
            // A combo box's list shown as having the focus while its combo
            // box has it, and no longer (`USER.EXE` seg33 `115d`, `11b2`,
            // `0c36`): inferred from where the combo box sends them, and
            // **recorded** by `combobox` -- a dropped list shows no focus
            // rectangle until the keys move its selection, and then shows it
            // on the new one.
            LB_COMBO_FOCUS => {
                self.system().list_state(index).focused = true;
                number(0)
            }
            LB_COMBO_UNFOCUS => {
                self.list_focus_off(index).await?;
                self.system().list_state(index).focused = false;
                number(0)
            }
            WM_SETFOCUS => {
                self.system().list_state(index).focused = true;
                self.list_focus_on(index).await?;
                self.notify_parent(index, LBN_SETFOCUS).await?;
                number(0)
            }
            WM_KILLFOCUS => {
                self.list_focus_off(index).await?;
                self.system().list_state(index).focused = false;
                self.notify_parent(index, LBN_KILLFOCUS).await?;
                number(0)
            }
            WM_KEYDOWN => {
                if count == 0 {
                    return number(0);
                }

                let (caret, sel, page) = {
                    let mut system = self.system();
                    let showing = system.list_rows(index, false);
                    let list = system.list_state(index);

                    (
                        list.caret,
                        list.sel,
                        if showing > 1 { showing - 1 } else { showing },
                    )
                };
                let delta = match wparam {
                    VK_UP | VK_LEFT => -1,
                    VK_DOWN | VK_RIGHT => 1,
                    VK_PRIOR => -page,
                    VK_NEXT => page,
                    VK_HOME => -30000,
                    VK_END => 30000,
                    VK_SPACE => 0,
                    _ => return number(0),
                };
                let mut at = (caret + delta).min(count - 1).max(0);

                if !shape.multiple() {
                    // The first arrow selects the caret's item.
                    if matches!(wparam, VK_UP | VK_DOWN) && !self.system().is_selected(index, caret)
                    {
                        at = caret;
                    }

                    if at == sel {
                        return number(0);
                    }
                }

                self.move_to(index, at, wparam == VK_SPACE).await?;
                number(0)
            }
            // A typed character: the next item it begins, after the caret
            // (seg35 `1f6a`).
            WM_CHAR => {
                let character = wparam as u8;

                if character == b' ' || count == 0 || !shape.has_strings() {
                    return number(0);
                }

                let found = {
                    let mut system = self.system();
                    let caret = system.list_state(index).caret;

                    system.find_item(index, caret, &[character], false)
                };

                if found >= 0 {
                    self.move_to(index, found, false).await?;
                }

                number(0)
            }
            WM_LBUTTONDOWN | WM_LBUTTONDBLCLK => {
                self.set_focus(hwnd).await?;

                let value = lparam.value();
                let at = self
                    .system()
                    .item_at(index, signed(value), signed(value >> 16));

                if at < 0 {
                    return number(0);
                }

                let double = {
                    let mut system = self.system();
                    let list = system.list_state(index);

                    list.mouse_down = true;
                    list.double = message == WM_LBUTTONDBLCLK;
                    system.capture = Some(index);
                    system.list_state(index).double
                };

                self.list_focus_off(index).await?;

                if !shape.multiple() {
                    let old = std::mem::replace(&mut self.system().list_state(index).sel, at);

                    self.draw_one(index, old).await?;
                    self.draw_one(index, at).await?;
                } else if !double {
                    {
                        let mut system = self.system();
                        let list = system.list_state(index);

                        if let Some(selected) = list.selected.get_mut(at as usize) {
                            *selected = !*selected;
                        }
                    }

                    self.draw_one(index, at).await?;
                }

                self.system().list_state(index).caret = at;
                self.list_focus_on(index).await?;

                if double {
                    return Box::pin(self.list_message(hwnd, index, WM_LBUTTONUP, 0, lparam)).await;
                }

                number(0)
            }
            WM_MOUSEMOVE => {
                let (down, caret) = {
                    let mut system = self.system();
                    let list = system.list_state(index);

                    (list.mouse_down, list.caret)
                };

                if !down {
                    return number(0);
                }

                let value = lparam.value();
                let at = self
                    .system()
                    .item_at(index, signed(value), signed(value >> 16));

                if at >= 0 && at != caret {
                    self.list_focus_off(index).await?;

                    if !shape.multiple() {
                        let old = std::mem::replace(&mut self.system().list_state(index).sel, at);

                        self.draw_one(index, old).await?;
                        self.draw_one(index, at).await?;
                    }

                    self.system().list_state(index).caret = at;
                    self.list_focus_on(index).await?;
                }

                number(0)
            }
            WM_LBUTTONUP => {
                let caret = {
                    let mut system = self.system();
                    let list = system.list_state(index);

                    if !list.mouse_down {
                        return number(0);
                    }

                    list.mouse_down = false;

                    let caret = list.caret;

                    system.capture = None;
                    caret
                };

                self.ensure_visible(index, caret).await?;

                if shape.style & LBS_NOTIFY != 0 {
                    let double = self.system().list_state(index).double;

                    self.notify_parent(index, if double { LBN_DBLCLK } else { LBN_SELCHANGE })
                        .await?;
                }

                self.system().list_state(index).double = false;
                number(0)
            }
            // Scrolling (seg35 `0a33`): a line, a page, the thumb, the ends.
            WM_VSCROLL => {
                let (top, page) = {
                    let mut system = self.system();
                    let showing = system.list_rows(index, false);

                    (
                        system.list_state(index).top,
                        if showing > 1 { showing - 1 } else { showing },
                    )
                };
                let position = signed(lparam.value());

                self.list_focus_off(index).await?;

                match wparam {
                    0 => self.set_top(index, top - 1).await?,
                    1 => self.set_top(index, top + 1).await?,
                    2 => self.set_top(index, top - page).await?,
                    3 => self.set_top(index, top + page).await?,
                    4 | 5 => {
                        self.set_top(index, ((count - page) * position + 50).div_euclid(100))
                            .await?;
                    }
                    6 => self.set_top(index, 0).await?,
                    7 => self.set_top(index, count - 1).await?,
                    8 => self.system().update_list_scroll(index)?,
                    _ => {}
                }

                self.list_focus_on(index).await?;
                number(0)
            }
            WM_GETDLGCODE => number(0x0081),
            _ => Ok(None),
        }
    }

    /// A list box's message as its window procedure takes it
    /// (`listboxMessage`): the string `lParam` points to, for the messages
    /// that carry one to a list that keeps strings; the list painted again
    /// when it changed; `LB_GETTEXT`'s string or data copied out; and the
    /// answer widened as `SendMessage` answers.
    pub(crate) async fn listbox_message(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<Option<u32>, Stop> {
        // A directory's entries, or one file's (`dlgdir.ts`).
        if message == LB_DIR || message == LB_ADDFILE {
            return Err(Stop::Unsupported("a list box filled from the disk"));
        }

        let (strings, value) = {
            let mut system = self.system();
            let shape = system.list_shape(index);
            let value = match lparam {
                Param::Value(value) => *value,
                Param::Struct(_) => 0,
            };

            (shape.has_strings(), value)
        };
        let argument = if strings
            && matches!(
                message,
                LB_ADDSTRING
                    | LB_INSERTSTRING
                    | LB_FINDSTRING
                    | LB_FINDSTRINGEXACT
                    | LB_SELECTSTRING
            ) {
            ListArg::Text(self.system().message_string(lparam))
        } else {
            ListArg::Value(value)
        };
        let answer = self
            .list_message(hwnd, index, message, wparam, argument)
            .await?;

        {
            let mut system = self.system();

            if std::mem::replace(&mut system.control_at(index).invalid, false) {
                let window = system.control_window_mut(index);

                window.needs_erase = true;
                window.needs_paint = true;
            }
        }

        Ok(match answer {
            None => None,
            // `LB_GETTEXT` copies the string and its nought, answering its
            // length -- or, from a list without strings, the item's data.
            Some(ListAnswer::Copy(text)) => {
                let mut system = self.system();

                Some(match lparam {
                    Param::Value(far) => system.copy_text(&text, *far, text.len() + 1) as u32,
                    Param::Struct(bytes) => {
                        let count = text.len().min(bytes.len().saturating_sub(1));

                        bytes[..count].copy_from_slice(&text[..count]);

                        if count < bytes.len() {
                            bytes[count] = 0;
                        }

                        count as u32
                    }
                })
            }
            Some(ListAnswer::Data(data)) => {
                self.system().write_far(value, &data.to_le_bytes());
                Some(4)
            }
            Some(ListAnswer::Number(number)) => Some(widened(message, number, &[LB_GETITEMDATA])),
        })
    }

    /// A list box made (`USER.EXE` seg38 `0085`): an owner-drawn one of
    /// fixed heights asks its parent its row height with `WM_MEASUREITEM`
    /// -- offering the font's height, and an item number never set -- and
    /// then the list box is made a whole number of rows high unless
    /// `LBS_NOINTEGRALHEIGHT`, and its scroll bar hidden while nothing
    /// needs it.
    pub(crate) async fn init_list(&self, hwnd: u16) -> Result<(), Stop> {
        let (index, height, owner) = {
            let mut system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let made = system
                .control_window(index)
                .control
                .as_ref()
                .map(|control| control.class_name.clone());

            if !matches!(made.as_deref(), Some("LISTBOX" | "COMBOLBOX")) {
                return Ok(());
            }

            let height = system.control_font_height(index)?;
            let owner = system.control_at(index).style & LBS_OWNERDRAWFIXED != 0;

            // Its font's height: the state may already have been made, by
            // the messages `CreateWindow` sends before this.
            system
                .control_at(index)
                .list
                .get_or_insert_with(|| ListState::new(height))
                .height = height;
            (index, height, owner)
        };

        if owner {
            let (far, id) = {
                let mut system = self.system();
                let far = system.owner_block();
                let id = system.control_window(index).control_id;

                system.write_words(far, &[2, id, 0, 0, height as u16, 0, 0]);
                (far, id)
            };

            self.send_parent(index, WM_MEASUREITEM, id, far).await?;

            let mut system = self.system();
            let answered = i32::from(system.read_word(far + 8));

            system.list_state(index).height = if answered == 0 { height } else { answered };
        }

        let mut system = self.system();

        system.integral_height(index)?;
        system.control_at(index).list_ready = true;
        system.update_list_scroll(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collates_without_regard_to_case() {
        assert_eq!(lstrcmpi(b"apple", b"APPLE"), 0);
        assert!(lstrcmpi(b"Zebra", b"apple") > 0);
        assert!(lstrcmpi(b"a", b"ab") < 0);
    }

    #[test]
    fn finds_in_capitals_as_a_javascript_string_has_them() {
        let items: Vec<String> = ["[-a-]", "Straße", "ss", "\u{ff}x", "[dir]"]
            .iter()
            .map(|item| (*item).to_string())
            .collect();

        // `ß` in capitals is `SS`: it finds "ss", and "Straße" whole.
        assert_eq!(find_in(&items, -1, &[0xdf], false), 2);
        assert_eq!(find_in(&items, -1, b"STRASSE", true), 1);
        // `ÿ` has its capital outside Latin-1, the same either way.
        assert_eq!(find_in(&items, -1, &[0xff], false), 3);
        // A prefix passes over `[-` and `[`, unless it starts with `[`.
        assert_eq!(find_in(&items, 0, b"a", false), 0);
        assert_eq!(find_in(&items, 0, b"d", false), 4);
        assert_eq!(find_in(&items, -1, b"[d", false), 4);
        // From after the start, wrapping; nothing for nothing.
        assert_eq!(find_in(&items, 2, b"s", false), 1);
        assert_eq!(find_in(&items, 0, b"", false), -1);
    }

    #[test]
    fn widens_with_the_sign() {
        assert_eq!(
            widened(LB_GETCURSEL, 0xffff, &[LB_GETITEMDATA]),
            0xffff_ffff
        );
        assert_eq!(widened(LB_GETITEMDATA, 0xffff, &[LB_GETITEMDATA]), 0xffff);
        assert_eq!(widened(0x0087, 0xffff, &[]), 0xffff);
    }
}
