//! The combo box: a field -- an edit control, or for a drop-down list its
//! own selection field -- a button, and a list box of the class
//! `ComboLBox`, always showing under a simple one's field and dropped down
//! from the others'. winbox.js's `combobox.ts`, with what
//! `control-classes.ts` does with it: its making (`initCombo`), its list
//! dropped down and put away, its focus, and its answer to the messages it
//! is sent (`comboMessage`).
//!
//! **Read out of `USER.EXE`** -- the window procedure is seg33 `0000`, with
//! seg34 for its layout -- and **recorded** by `combobox` on four displays:
//! a drop-down list, a drop-down, a simple one and an owner-drawn drop-down
//! list, filled, selected, keyed, dropped down and put away.
//!
//! Its field, its button and its focus rectangle are the desktop's drawing,
//! not ported yet; where the TypeScript engine paints the combo box, the
//! field's rectangle is worked out and an owner-drawn one's `WM_DRAWITEM`
//! sent as it sends it.

use crate::call::Stop;
use crate::control_host::{
    WM_COMPAREITEM, WM_DELETEITEM, WM_DRAWITEM, WM_MEASUREITEM, bytes_of, widened,
};
use crate::create::{Creation, WindowName};
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;

pub const CBS_SIMPLE: u32 = 1;
pub const CBS_DROPDOWN: u32 = 2;
pub const CBS_DROPDOWNLIST: u32 = 3;
pub const CBS_OWNERDRAWFIXED: u32 = 0x10;
pub const CBS_OWNERDRAWVARIABLE: u32 = 0x20;
pub const CBS_AUTOHSCROLL: u32 = 0x40;
pub const CBS_SORT: u32 = 0x100;
pub const CBS_HASSTRINGS: u32 = 0x200;
pub const CBS_NOINTEGRALHEIGHT: u32 = 0x400;
pub const CBS_DISABLENOSCROLL: u32 = 0x800;

pub const CB_GETEDITSEL: u16 = 0x400;
pub const CB_LIMITTEXT: u16 = 0x401;
pub const CB_SETEDITSEL: u16 = 0x402;
pub const CB_ADDSTRING: u16 = 0x403;
pub const CB_DELETESTRING: u16 = 0x404;
pub const CB_DIR: u16 = 0x405;
pub const CB_GETCOUNT: u16 = 0x406;
pub const CB_GETCURSEL: u16 = 0x407;
pub const CB_GETLBTEXT: u16 = 0x408;
pub const CB_GETLBTEXTLEN: u16 = 0x409;
pub const CB_INSERTSTRING: u16 = 0x40a;
pub const CB_RESETCONTENT: u16 = 0x40b;
pub const CB_FINDSTRING: u16 = 0x40c;
pub const CB_SELECTSTRING: u16 = 0x40d;
pub const CB_SETCURSEL: u16 = 0x40e;
pub const CB_SHOWDROPDOWN: u16 = 0x40f;
pub const CB_GETITEMDATA: u16 = 0x410;
pub const CB_SETITEMDATA: u16 = 0x411;
pub const CB_GETDROPPEDCONTROLRECT: u16 = 0x412;
pub const CB_SETITEMHEIGHT: u16 = 0x413;
pub const CB_GETITEMHEIGHT: u16 = 0x414;
pub const CB_SETEXTENDEDUI: u16 = 0x415;
pub const CB_GETEXTENDEDUI: u16 = 0x416;
pub const CB_GETDROPPEDSTATE: u16 = 0x417;
pub const CB_FINDSTRINGEXACT: u16 = 0x418;

pub const CBN_SELCHANGE: u16 = 1;
pub const CBN_DBLCLK: u16 = 2;
pub const CBN_SETFOCUS: u16 = 3;
pub const CBN_KILLFOCUS: u16 = 4;
pub const CBN_EDITCHANGE: u16 = 5;
pub const CBN_EDITUPDATE: u16 = 6;
pub const CBN_DROPDOWN: u16 = 7;
pub const CBN_CLOSEUP: u16 = 8;

pub const LIST_ID: u16 = 1000;
pub const EDIT_ID: u16 = 1001;

const WM_SETTEXT: u16 = 0x000c;
const WM_GETTEXT: u16 = 0x000d;
const WM_GETTEXTLENGTH: u16 = 0x000e;
const WM_SETFOCUS: u16 = 0x0007;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_KEYDOWN: u16 = 0x0100;
const WM_CHAR: u16 = 0x0102;
const WM_SYSKEYDOWN: u16 = 0x0104;
const WM_COMMAND: u16 = 0x0111;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;

const EM_GETSEL: u16 = 0x0400;
const EM_SETSEL: u16 = 0x0401;
const EM_LIMITTEXT: u16 = 0x0415;
const LB_SETCURSEL: u16 = 0x407;
const LB_RESETCONTENT: u16 = 0x405;
const LB_SELECTSTRING: u16 = 0x40d;
const LB_SETTOPINDEX: u16 = 0x418;
const LB_GETITEMHEIGHT: u16 = 0x422;
const LB_COMBO_FOCUS: u16 = 0x424;
const LB_COMBO_UNFOCUS: u16 = 0x425;

const VK_F4: u16 = 0x73;
const VK_UP: u16 = 0x26;
const VK_DOWN: u16 = 0x28;

const WS_BORDER: u32 = 0x0080_0000;
const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;

const SM_CXVSCROLL: i16 = 2;

/// The list box messages the combo box passes on as they are (seg33
/// `0029`).
fn passed_to_list(message: u16) -> Option<u16> {
    Some(match message {
        CB_ADDSTRING => 0x401,
        CB_DIR => 0x40e,
        CB_DELETESTRING => 0x403,
        CB_GETCOUNT => 0x40c,
        CB_GETCURSEL => 0x409,
        CB_GETLBTEXT => 0x40a,
        CB_GETLBTEXTLEN => 0x40b,
        CB_INSERTSTRING => 0x402,
        CB_FINDSTRING => 0x410,
        CB_FINDSTRINGEXACT => 0x423,
        CB_GETITEMDATA => 0x41a,
        CB_SETITEMDATA => 0x41b,
        _ => return None,
    })
}

/// What a combo box keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// Each is a yes or no of the combo box's, as USER keeps it.
#[allow(clippy::struct_excessive_bools)]
pub struct ComboState {
    pub kind: u32,
    pub owner_draw: bool,
    pub field_height: i32,
    pub field: [i32; 4],
    pub button: Option<[i32; 4]>,
    pub list: [i32; 4],
    pub edit: u16,
    pub list_box: u16,
    pub focused: bool,
    pub dropped: bool,
    pub tracking: bool,
    pub pressed: bool,
    /// A selection changed with the keys while dropped, which does not put
    /// the list away.
    pub keyboard: bool,
    /// The size it was made at, to which a dropped list's height belongs.
    pub height: i32,
    /// The System font's average width, by which a drop-down's list is in.
    pub cx_sys_char: i32,
    /// Its edit control's text being set by the combo box itself, which
    /// the parent is not told of.
    pub setting: bool,
}

/// Where a combo box's parts go (seg34 `02ac`): the field one font height
/// high, plus a quarter of the smaller of it and the System font's height,
/// plus four borders -- 24 on the VGA, 19 on the EGA -- or for an
/// owner-drawn one what the parent answers plus six; the button at the
/// right, a scroll bar's width; the field short of the button by a border
/// less, and a drop-down's by the System font's average width more; the
/// list from a border above the field's bottom to a border above the combo
/// box's, a drop-down list's under all of it, the others' that average
/// width in.
pub fn layout(
    kind: u32,
    width: i32,
    height: i32,
    field_height: i32,
    cx_vscroll: i32,
    cx_sys_char: i32,
) -> ([i32; 4], Option<[i32; 4]>, [i32; 4]) {
    let border = 1;
    let button = (kind != CBS_SIMPLE).then_some([width - cx_vscroll, 0, width, field_height]);
    let field_width = match kind {
        CBS_DROPDOWNLIST => width - cx_vscroll + border,
        CBS_DROPDOWN => width - cx_vscroll + border - cx_sys_char,
        _ => width,
    };
    let left = if kind == CBS_DROPDOWNLIST {
        0
    } else {
        cx_sys_char
    };

    (
        [0, 0, field_width, field_height],
        button,
        [left, field_height - border, width, height - border],
    )
}

/// The list box style a combo box makes its list with (seg34 `005b`).
pub fn list_style(style: u32) -> u32 {
    let mut list = 0x4000_0000 | 0x1000_0000 | 0x0400_0000 | 0x0080_0000 | 0x8000 | 0x0001;

    for (from, to) in [
        (CBS_SORT, 0x0002),
        (CBS_HASSTRINGS, 0x0040),
        (CBS_OWNERDRAWFIXED, 0x0010),
        (CBS_OWNERDRAWVARIABLE, 0x0020),
        (CBS_NOINTEGRALHEIGHT, 0x0100),
        (CBS_DISABLENOSCROLL, 0x1000),
        (WS_VSCROLL, WS_VSCROLL),
    ] {
        if style & from != 0 {
            list |= to;
        }
    }

    list
}

/// The edit control's style (seg34 `005b`).
pub fn edit_style(style: u32) -> u32 {
    let mut edit = 0x4000_0000 | 0x1000_0000 | 0x0080_0000 | 0x0300;

    if style & CBS_AUTOHSCROLL != 0 {
        edit |= 0x0080;
    }

    if style & 0x0080 != 0 {
        edit |= 0x0400;
    }

    edit
}

/// The field as the combo box paints it, for a drop-down list
/// (`desktop.ts`'s `paintCombo`): the rectangle inside its border and a
/// border more, which is highlighted while the combo box has the focus
/// and its list is put away, and an owner's item's rectangle, three
/// borders in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaintedField {
    pub rc: [i32; 4],
    pub highlighted: bool,
    pub item: [i32; 4],
}

pub fn painted_field(combo: &ComboState) -> Option<PaintedField> {
    if combo.kind != CBS_DROPDOWNLIST {
        return None;
    }

    let [left, top, right, bottom] = combo.field;

    Some(PaintedField {
        rc: [left + 2, top + 2, right - 2, bottom - 2],
        highlighted: combo.focused && !combo.dropped,
        item: [left + 3, top + 3, right - 3, bottom - 3],
    })
}

fn signed(value: u32) -> i32 {
    i32::from(value as u16 as i16)
}

impl System {
    fn combo_of(&mut self, index: usize) -> Option<ComboState> {
        self.control_at(index).combo
    }

    fn combo_mut(&mut self, index: usize) -> &mut ComboState {
        self.control_at(index).combo.get_or_insert(ComboState {
            kind: CBS_SIMPLE,
            owner_draw: false,
            field_height: 0,
            field: [0; 4],
            button: None,
            list: [0; 4],
            edit: 0,
            list_box: 0,
            focused: false,
            dropped: false,
            tracking: false,
            pressed: false,
            keyboard: false,
            height: 0,
            cx_sys_char: 0,
            setting: false,
        })
    }

    /// The selection's text, or none.
    fn selected_text(&mut self, index: usize) -> Option<Vec<u8>> {
        let list = self.combo_of(index)?.list_box;
        let list = self.window_named(list)?;
        let sel = self.list_state(list).sel;
        let items = &self.control_at(list).items;

        usize::try_from(sel)
            .ok()
            .and_then(|sel| items.get(sel))
            .map(|item| bytes_of(item))
    }

    /// The combo box's field, button and focus drawn -- the desktop's
    /// drawing, passed over.
    pub fn paint_combo(&mut self, _index: usize, _combo: &ComboState, _text: Option<&[u8]>) {}
}

impl Engine {
    /// A combo box's parent told, with `WM_COMMAND`, as its list and edit
    /// tell it.
    async fn combo_notify(&self, index: usize, code: u16) -> Result<(), Stop> {
        self.notify_parent(index, code).await
    }

    /// A combo box made (`USER.EXE` seg34 `0000`, `005b`, `02ac`): its style
    /// with `CBS_HASSTRINGS` unless owner-drawn and without a border or
    /// scroll bars of its own; the field's height, asked of an owner-drawn
    /// one's parent; its list, and an edit control but for a drop-down
    /// list; and a list that drops down taken from it to lie on the
    /// desktop, put away, and the combo box made as high as its field.
    #[allow(clippy::too_many_lines)]
    pub(crate) async fn init_combo(&self, hwnd: u16) -> Result<(), Stop> {
        let (index, original, owner_draw, mut field_height) = {
            let mut system = self.system();
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };

            if system
                .control_window(index)
                .control
                .as_ref()
                .is_none_or(|control| control.class_name != "COMBOBOX")
            {
                return Ok(());
            }

            let original = system.control_at(index).style;
            let owner_draw = original & (CBS_OWNERDRAWFIXED | CBS_OWNERDRAWVARIABLE) != 0;

            if !owner_draw {
                system.control_at(index).style |= CBS_HASSTRINGS;
            }

            let window = system.control_window_mut(index);

            window.style &= !(WS_BORDER | WS_VSCROLL | WS_HSCROLL);

            let (left, top, width, height) = (window.left, window.top, window.width, window.height);

            system.place_window(index, left, top, width, height)?;

            let height = system.control_font_height(index)?;
            let system_height = system.system_control_font()?.height;

            (
                index,
                original,
                owner_draw,
                height + height.min(system_height) / 4 + 4,
            )
        };
        let kind = match original & 3 {
            0 => CBS_SIMPLE,
            kind => kind,
        };

        // An owner-drawn field's height is its parent's to say, six pixels
        // less; the item number is left as it is found, and the width.
        if owner_draw {
            let (far, id) = {
                let mut system = self.system();
                let far = system.owner_block();
                let id = system.control_window(index).control_id;

                system.write_words(far, &[3, id, 0xffff, 0, (field_height - 6) as u16, 0, 0]);
                (far, id)
            };

            self.send_parent(index, WM_MEASUREITEM, id, far).await?;
            field_height = i32::from(self.system().read_word(far + 8)) + 6;
        }

        let (parts, cx_sys_char, place) = {
            let mut system = self.system();
            let cx_vscroll = system.metric(SM_CXVSCROLL);
            let cx_sys_char =
                (crate::gdi::text::get_dialog_base_units(&mut system)? & 0xffff) as i32;
            let window = system.control_window(index);
            let parts = layout(
                kind,
                window.width,
                window.height,
                field_height,
                cx_vscroll,
                cx_sys_char,
            );

            (parts, cx_sys_char, (window.left, window.top, window.height))
        };
        let (field, button, list) = parts;

        *self.system().combo_mut(index) = ComboState {
            kind,
            owner_draw,
            field_height,
            field,
            button,
            list,
            edit: 0,
            list_box: 0,
            focused: false,
            dropped: false,
            tracking: false,
            pressed: false,
            keyboard: false,
            height: place.2,
            cx_sys_char,
            setting: false,
        };

        let [ll, lt, lr, lb] = list;
        let list_box = Box::pin(self.create_window(Creation {
            ex_style: 0,
            class: "ComboLBox".to_string(),
            class_far: 0,
            name: WindowName::Own(String::new()),
            style: list_style(original),
            x: (ll + 1) as i16,
            y: (lt + 1) as i16,
            width: (lr - ll - 2) as i16,
            height: (lb - lt - 2) as i16,
            parent: hwnd,
            menu: LIST_ID,
            instance: 0,
            param: 0,
        }))
        .await?;
        let list_index = {
            let mut system = self.system();

            system.combo_mut(index).list_box = list_box;

            let list_index = system.window_named(list_box);

            if let Some(list_index) = list_index {
                system.control_at(list_index).combo_hwnd = hwnd;
            }

            list_index
        };

        if kind != CBS_DROPDOWNLIST {
            let [fl, ft, fr, fb] = field;
            let edit = Box::pin(self.create_window(Creation {
                ex_style: 0,
                class: "Edit".to_string(),
                class_far: 0,
                name: WindowName::Own(String::new()),
                style: edit_style(original),
                x: fl as i16,
                y: ft as i16,
                width: (fr - fl) as i16,
                height: (fb - ft) as i16,
                parent: hwnd,
                menu: EDIT_ID,
                instance: 0,
                param: 0,
            }))
            .await?;
            let mut system = self.system();

            system.combo_mut(index).edit = edit;

            if let Some(edit) = system.window_named(edit) {
                system.control_at(edit).combo_hwnd = hwnd;
            }
        }

        let Some(list_index) = list_index else {
            return Ok(());
        };
        let mut system = self.system();

        if kind == CBS_SIMPLE {
            // Always shown: moved to its place, a pixel short, and made
            // whole rows.
            system.combo_mut(index).dropped = true;

            let (left, top) = (place.0, place.1);

            system.place_window(list_index, left + ll, top + lt, lr - ll, lb - lt - 1)?;
            system.integral_height(list_index)?;
            return Ok(());
        }

        system.hide(list_index);
        system.control_window_mut(list_index).parent = None;
        system.own();

        let window = system.control_window(index);
        let (left, top, width) = (window.left, window.top, window.width);

        system.place_window(index, left, top, width, field_height)
    }

    /// The field brought up to the selection: its text into the edit
    /// control, or the field painted.
    async fn refresh_field(&self, index: usize) -> Result<(), Stop> {
        let (combo, text) = {
            let mut system = self.system();
            let Some(combo) = system.combo_of(index) else {
                return Ok(());
            };

            if combo.kind == CBS_DROPDOWNLIST {
                system.control_window_mut(index).needs_paint = true;
                return Ok(());
            }

            (combo, system.selected_text(index).unwrap_or_default())
        };
        let mut text = text;

        text.push(0);
        self.system().combo_mut(index).setting = true;
        self.send_message(combo.edit, WM_SETTEXT, 0, &mut Param::Struct(text))
            .await?;
        self.system().combo_mut(index).setting = false;
        Ok(())
    }

    /// The list dropped down (seg33 `0c36`): the parent told
    /// `CBN_DROPDOWN`; a drop-down list's list scrolled to its selection;
    /// the list put a border above the field's bottom, under the field -- a
    /// drop-down's the System font's average width in -- or above it where
    /// there is no room below, and shown on top without taking the focus.
    async fn drop_down(&self, index: usize) -> Result<(), Stop> {
        let (combo, list) = {
            let mut system = self.system();
            let Some(combo) = system.combo_of(index) else {
                return Ok(());
            };
            let list = system.window_named(combo.list_box);

            (combo, list)
        };
        let Some(list) = list else {
            return Ok(());
        };

        if combo.dropped {
            return Ok(());
        }

        self.combo_notify(index, CBN_DROPDOWN).await?;
        self.system().combo_mut(index).dropped = true;

        if combo.kind == CBS_DROPDOWNLIST {
            let sel = self.system().list_state(list).sel.max(0);

            self.send_message(
                combo.list_box,
                LB_SETTOPINDEX,
                sel as u16,
                &mut Param::Value(0),
            )
            .await?;
            self.send_message(combo.list_box, LB_COMBO_FOCUS, 0, &mut Param::Value(0))
                .await?;
        }

        {
            let mut system = self.system();
            let field = if combo.edit == 0 {
                index
            } else {
                system.window_named(combo.edit).unwrap_or(index)
            };
            let field = system.control_window(field);
            let (field_left, field_top, field_height) = (field.left, field.top, field.height);
            let bottom = field_top + field_height;
            let list_window = system.control_window(list);
            let (height, width) = (list_window.height, list_window.width);
            let x = field_left
                + if combo.kind == CBS_DROPDOWNLIST {
                    0
                } else {
                    combo.cx_sys_char
                };
            let screen = i32::from(system.display.height);
            let y = if bottom - 1 + height <= screen {
                bottom - 1
            } else {
                (field_top + 1 - height).max(0)
            };

            system.place_window(list, x, y, width, height)?;
            system.control_window_mut(index).needs_paint = true;
        }

        self.paint_combo_box(index).await?;
        self.system().show_on_top(list);
        Ok(())
    }

    /// The list put away (seg33 `0b3c`): hidden, the combo box painted
    /// again, and the parent told `CBN_CLOSEUP` when it was dropped and
    /// told is asked for. A simple combo box's list stays.
    async fn close_up(&self, index: usize, notify: bool) -> Result<(), Stop> {
        let was = {
            let mut system = self.system();
            let Some(combo) = system.combo_of(index) else {
                return Ok(());
            };
            let Some(list) = system.window_named(combo.list_box) else {
                return Ok(());
            };

            if combo.kind == CBS_SIMPLE {
                return Ok(());
            }

            if combo.dropped {
                system.combo_mut(index).dropped = false;
                system.hide(list);
            }

            system.control_window_mut(index).needs_paint = true;
            combo.dropped
        };

        self.paint_combo_box(index).await?;

        if notify && was {
            self.combo_notify(index, CBN_CLOSEUP).await?;
        }

        Ok(())
    }

    /// The focus arriving (seg33 `115d`).
    async fn combo_gain_focus(&self, index: usize) -> Result<(), Stop> {
        let Some(combo) = self.system().combo_of(index) else {
            return Ok(());
        };

        if combo.focused {
            return Ok(());
        }

        if combo.edit == 0 {
            self.send_message(combo.list_box, LB_COMBO_FOCUS, 0, &mut Param::Value(0))
                .await?;
        } else {
            self.send_message(combo.edit, EM_SETSEL, 0, &mut Param::Value(0xffff_0000))
                .await?;
        }

        {
            let mut system = self.system();

            system.combo_mut(index).focused = true;
            system.control_window_mut(index).needs_paint = true;
        }

        self.paint_combo_box(index).await?;
        self.combo_notify(index, CBN_SETFOCUS).await
    }

    /// The focus leaving for a window not its own (seg33 `11b2`).
    async fn combo_lose_focus(&self, index: usize, to: u16) -> Result<(), Stop> {
        let Some(combo) = self.system().combo_of(index) else {
            return Ok(());
        };

        if !combo.focused {
            return Ok(());
        }

        {
            let system = self.system();
            let mut other = system.window_named(to);

            while let Some(at) = other {
                if at == index {
                    return Ok(());
                }

                other = system.windows[at].as_ref().and_then(|window| window.parent);
            }
        }

        self.close_up(index, true).await?;

        if combo.edit == 0 {
            self.send_message(combo.list_box, LB_COMBO_UNFOCUS, 0, &mut Param::Value(0))
                .await?;
        } else {
            self.send_message(combo.edit, EM_SETSEL, 0, &mut Param::Value(0))
                .await?;
        }

        {
            let mut system = self.system();

            system.combo_mut(index).focused = false;
            system.control_window_mut(index).needs_paint = true;
        }

        self.paint_combo_box(index).await?;
        self.combo_notify(index, CBN_KILLFOCUS).await
    }

    /// Paints a combo box (seg33 `0875`), asking an owner to draw its
    /// field's item.
    pub(crate) async fn paint_combo_box(&self, index: usize) -> Result<(), Stop> {
        let (far, id) = {
            let mut system = self.system();
            let Some(combo) = system.combo_of(index) else {
                return Ok(());
            };

            if !system.control_window(index).visible {
                return Ok(());
            }

            system.control_window_mut(index).needs_paint = false;

            let text = if combo.owner_draw {
                None
            } else {
                system.selected_text(index)
            };
            let shown = if combo.kind == CBS_DROPDOWNLIST {
                Some(text.unwrap_or_default())
            } else {
                None
            };

            system.paint_combo(index, &combo, shown.as_deref());

            let Some(field) = painted_field(&combo) else {
                return Ok(());
            };

            if !combo.owner_draw {
                return Ok(());
            }

            let Some(list) = system.window_named(combo.list_box) else {
                return Ok(());
            };
            let (sel, data) = {
                let state = system.list_state(list);
                let data = usize::try_from(state.sel)
                    .ok()
                    .map_or(0xffff_ffff, |sel| state.data.get(sel).copied().unwrap_or(0));

                (state.sel, data)
            };
            let far = system.owner_block() + 32;
            let hdc = system.item_dc(index);
            let (id, hwnd) = {
                let window = system.control_window(index);

                (window.control_id, window.hwnd)
            };
            let [l, t, r, b] = field.item;

            system.write_words(
                far,
                &[
                    3,
                    id,
                    sel as u16,
                    1,
                    if field.highlighted { 0x11 } else { 0 },
                    hwnd,
                    hdc,
                    l as u16,
                    t as u16,
                    r as u16,
                    b as u16,
                    data as u16,
                    (data >> 16) as u16,
                ],
            );
            (far, id)
        };

        self.send_parent(index, WM_DRAWITEM, id, far).await?;
        Ok(())
    }

    /// A combo box's answer to a message, or `None` for one it leaves to
    /// the rest of its window procedure (seg33 `0029`), widened as a list
    /// box's are; `CB_GETEDITSEL`, item data and the dropped rectangle are
    /// longs.
    pub(crate) async fn combo_message(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<Option<u32>, Stop> {
        let answer = self
            .combo_answer(hwnd, index, message, wparam, lparam)
            .await?;

        Ok(answer.map(|answer| {
            widened(
                message,
                answer,
                &[CB_GETEDITSEL, CB_GETITEMDATA, CB_GETDROPPEDCONTROLRECT],
            )
        }))
    }

    #[allow(clippy::too_many_lines)]
    async fn combo_answer(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<Option<u32>, Stop> {
        let Some(combo) = self.system().combo_of(index) else {
            return Ok(None);
        };
        let list = combo.list_box;
        let value = match lparam {
            Param::Value(value) => *value,
            Param::Struct(_) => 0,
        };

        if let Some(passed) = passed_to_list(message) {
            return Ok(Some(self.send_message(list, passed, wparam, lparam).await?));
        }

        Ok(Some(match message {
            CB_SETCURSEL => {
                let answer = self
                    .send_message(list, LB_SETCURSEL, wparam, &mut Param::Value(0))
                    .await?;

                if signed(u32::from(wparam)) != -1 {
                    self.send_message(list, LB_SETTOPINDEX, wparam, &mut Param::Value(0))
                        .await?;
                }

                self.refresh_field(index).await?;
                answer
            }
            CB_SELECTSTRING => {
                let answer = self
                    .send_message(list, LB_SELECTSTRING, wparam, lparam)
                    .await?;

                self.refresh_field(index).await?;
                answer
            }
            CB_RESETCONTENT => {
                self.send_message(list, LB_RESETCONTENT, 0, &mut Param::Value(0))
                    .await?;
                self.refresh_field(index).await?;
                1
            }
            CB_SHOWDROPDOWN => {
                if wparam != 0 {
                    self.drop_down(index).await?;
                } else if combo.dropped {
                    self.close_up(index, true).await?;
                }

                1
            }
            CB_GETDROPPEDSTATE => u32::from(combo.dropped),
            CB_GETEDITSEL => {
                if combo.edit == 0 {
                    0xffff_ffff
                } else {
                    self.send_message(combo.edit, EM_GETSEL, wparam, lparam)
                        .await?
                }
            }
            CB_SETEDITSEL => {
                if combo.edit == 0 {
                    0xffff
                } else {
                    self.send_message(combo.edit, EM_SETSEL, wparam, lparam)
                        .await?;
                    1
                }
            }
            CB_LIMITTEXT => {
                if combo.edit == 0 {
                    0xffff
                } else {
                    self.send_message(combo.edit, EM_LIMITTEXT, wparam, lparam)
                        .await?
                }
            }
            CB_GETITEMHEIGHT => {
                if signed(u32::from(wparam)) == -1 {
                    combo.field_height as u32
                } else {
                    self.send_message(list, LB_GETITEMHEIGHT, wparam, &mut Param::Value(0))
                        .await?
                }
            }
            // A drop-down list's text is its selection's, and cannot be
            // set.
            WM_SETTEXT => {
                if combo.edit == 0 {
                    return Ok(Some(0xffff));
                }

                self.system().combo_mut(index).setting = true;
                self.send_message(combo.edit, WM_SETTEXT, wparam, lparam)
                    .await?;
                self.system().combo_mut(index).setting = false;
                1
            }
            WM_GETTEXT => {
                if combo.edit != 0 {
                    return Ok(Some(
                        self.send_message(combo.edit, WM_GETTEXT, wparam, lparam)
                            .await?,
                    ));
                }

                let mut system = self.system();
                let text = system.selected_text(index).unwrap_or_default();

                if value == 0 || wparam == 0 {
                    0
                } else {
                    system.copy_text(&text, value, usize::from(wparam)) as u32
                }
            }
            WM_GETTEXTLENGTH => {
                if combo.edit == 0 {
                    0xffff
                } else {
                    self.send_message(combo.edit, WM_GETTEXTLENGTH, 0, &mut Param::Value(0))
                        .await?
                }
            }
            WM_SETFOCUS => {
                if combo.edit == 0 {
                    self.combo_gain_focus(index).await?;
                } else {
                    self.set_focus(combo.edit).await?;
                }

                0
            }
            WM_KILLFOCUS => {
                self.combo_lose_focus(index, wparam).await?;
                0
            }
            // The keys go to the list of a drop-down list and to the edit
            // control of the others; F4 drops the list down or puts it
            // away.
            WM_KEYDOWN | WM_CHAR => {
                if message == WM_KEYDOWN && wparam == VK_F4 && combo.kind != CBS_SIMPLE {
                    if combo.dropped {
                        self.close_up(index, true).await?;
                    } else {
                        self.drop_down(index).await?;
                    }

                    return Ok(Some(0));
                }

                let target = if combo.edit == 0 { list } else { combo.edit };

                self.send_message(target, message, wparam, lparam).await?
            }
            // Alt and an arrow do the same.
            WM_SYSKEYDOWN => {
                if matches!(wparam, VK_UP | VK_DOWN) && combo.kind != CBS_SIMPLE {
                    if combo.dropped {
                        self.close_up(index, true).await?;
                    } else {
                        self.drop_down(index).await?;
                    }

                    return Ok(Some(0));
                }

                return Ok(None);
            }
            WM_COMMAND => {
                let code = (value >> 16) as u16;

                if wparam == LIST_ID {
                    if code == 1 || code == 3 {
                        if self
                            .system()
                            .combo_of(index)
                            .is_some_and(|combo| combo.keyboard)
                        {
                            self.system().combo_mut(index).keyboard = false;
                        } else {
                            self.close_up(index, true).await?;
                        }

                        self.combo_notify(index, CBN_SELCHANGE).await?;
                        self.refresh_field(index).await?;
                    } else if code == 2 {
                        self.combo_notify(index, CBN_DBLCLK).await?;
                    }

                    return Ok(Some(0));
                }

                if wparam == EDIT_ID {
                    let setting = self
                        .system()
                        .combo_of(index)
                        .is_some_and(|combo| combo.setting);

                    if code == 0x100 {
                        self.combo_gain_focus(index).await?;
                    } else if code == 0x200 {
                        let going = {
                            let system = self.system();

                            system.controls.focus_going.unwrap_or_else(|| {
                                system
                                    .focus
                                    .and_then(|focus| system.windows[focus].as_ref())
                                    .map_or(0, |window| window.hwnd)
                            })
                        };

                        self.combo_lose_focus(index, going).await?;
                    } else if !setting && code == 0x300 {
                        self.combo_notify(index, CBN_EDITCHANGE).await?;
                    } else if !setting && code == 0x400 {
                        self.combo_notify(index, CBN_EDITUPDATE).await?;
                    }
                }

                0
            }
            // The list's owner-draw messages, passed to the parent as the
            // combo box's.
            WM_MEASUREITEM | WM_DRAWITEM | WM_DELETEITEM | WM_COMPAREITEM => {
                let id = {
                    let mut system = self.system();
                    let id = system.control_window(index).control_id;

                    system.write_words(value, &[3, id]);

                    if message == WM_DRAWITEM {
                        let at = (value & 0xffff_0000) | (value.wrapping_add(10) & 0xffff);

                        system.write_words(at, &[hwnd]);
                    }

                    id
                };

                self.send_parent(index, message, id, value).await?
            }
            WM_LBUTTONDOWN | WM_LBUTTONDBLCLK => {
                if !combo.focused {
                    self.set_focus(hwnd).await?;
                }

                let x = signed(value);
                let combo = self.system().combo_of(index).unwrap_or(combo);
                let in_button = combo.button.is_some_and(|button| x >= button[0]);

                if combo.kind == CBS_DROPDOWNLIST || in_button {
                    self.system().combo_mut(index).pressed = true;

                    if combo.dropped {
                        self.close_up(index, true).await?;
                        self.system().combo_mut(index).pressed = false;
                    } else {
                        self.system().combo_mut(index).tracking = true;
                        self.drop_down(index).await?;
                    }
                }

                0
            }
            WM_LBUTTONUP => {
                let mut system = self.system();
                let state = system.combo_mut(index);

                state.tracking = false;
                state.pressed = false;
                system.control_window_mut(index).needs_paint = true;
                0
            }
            _ => return Ok(None),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lays_out_a_drop_down_list() {
        let (field, button, list) = layout(CBS_DROPDOWNLIST, 100, 120, 24, 17, 8);

        assert_eq!(field, [0, 0, 84, 24]);
        assert_eq!(button, Some([83, 0, 100, 24]));
        assert_eq!(list, [0, 23, 100, 119]);
    }

    #[test]
    fn a_simple_one_has_no_button() {
        let (field, button, list) = layout(CBS_SIMPLE, 100, 120, 24, 17, 8);

        assert_eq!(field, [0, 0, 100, 24]);
        assert_eq!(button, None);
        assert_eq!(list, [8, 23, 100, 119]);
    }

    #[test]
    fn styles_its_parts() {
        assert_eq!(list_style(CBS_SORT | CBS_HASSTRINGS), 0x5480_8043);
        assert_eq!(edit_style(CBS_AUTOHSCROLL), 0x5080_0380);
    }
}
