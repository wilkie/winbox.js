//! The standard controls -- the classes USER registers itself -- as
//! winbox.js's `controls.ts`, `control-classes.ts` and `ctlcolor.ts` keep
//! them: what a control keeps, and what its window procedure does with the
//! messages a program sends it. What each paints is `control_paint.rs`'s. The
//! edit control, the list box, the combo box and the scroll bar control,
//! each with a state and messages of its own, are in `edit.rs`,
//! `mledit.rs`, `listbox.rs`, `combobox.rs` and `scroll_bars.rs`; their
//! window procedure, here, hands each its messages in the order
//! `control-classes.ts`'s `controlProc` does.

use winbox_raster::IconData;

use crate::call::Stop;
use crate::edit::{EM_GETMODIFY, EM_SETMODIFY, ES_MULTILINE, WM_CLEAR, WM_CUT};
use crate::engine::Engine;
use crate::gdi::GdiObject;
use crate::messages::{
    Param, WM_CTLCOLOR, WM_GETTEXT, WM_GETTEXTLENGTH, WM_NCCREATE, WM_NCDESTROY, WM_SETTEXT,
};
use crate::system::System;

const WM_CREATE: u16 = 0x0001;
const WM_SIZE: u16 = 0x0005;
const WM_SETFOCUS: u16 = 0x0007;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_ENABLE: u16 = 0x000a;
const WM_PAINT: u16 = 0x000f;
const WM_ERASEBKGND: u16 = 0x0014;
const WM_SETFONT: u16 = 0x0030;
const WM_GETFONT: u16 = 0x0031;
const WM_GETDLGCODE: u16 = 0x0087;
pub const WM_COMMAND: u16 = 0x0111;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const STM_SETICON: u16 = 0x0400;
const STM_GETICON: u16 = 0x0401;
pub const BM_GETCHECK: u16 = 0x0400;
pub const BM_SETCHECK: u16 = 0x0401;
pub const BM_SETSTYLE: u16 = 0x0404;

const BS_OWNERDRAW: u32 = 0x0b;
const TRANSPARENT: u16 = 1;
const WS_BORDER: u32 = 0x0080_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const ODA_DRAWENTIRE: u16 = 1;
const ODA_FOCUS: u16 = 4;

pub const CTLCOLOR_EDIT: u16 = 1;
pub const CTLCOLOR_LISTBOX: u16 = 2;
pub const CTLCOLOR_BTN: u16 = 3;
pub const CTLCOLOR_DLG: u16 = 4;
pub const CTLCOLOR_SCROLLBAR: u16 = 5;
pub const CTLCOLOR_STATIC: u16 = 6;

const COLOR_SCROLLBAR: usize = 0;
const COLOR_WINDOW: usize = 5;
const COLOR_WINDOWTEXT: usize = 8;

/// What a control paints with, from its parent's answer to `WM_CTLCOLOR`,
/// as `COLORREF`s.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControlColours {
    pub brush: u32,
    pub text: u32,
    pub ground: u32,
    /// A hollow brush answered: nothing filled, the parent showing
    /// (`ctltrans`).
    pub hollow: bool,
    /// The background mode made transparent: no cell behind the text
    /// (`ctltrans`).
    pub transparent: bool,
    /// Where the brush's pattern starts, in the control (`brushrlz`).
    pub brush_origin: (i32, i32),
}

/// What a control keeps: its class and style, its text, and what it holds.
#[derive(Debug, Clone, Default)]
// Each is a yes or no of the control's, as USER keeps it.
#[allow(clippy::struct_excessive_bools)]
pub struct ControlState {
    pub class_name: String,
    pub style: u32,
    pub text: String,
    pub checked: u16,
    /// A button's state beside its check and its focus: pushed, the mouse
    /// captured, a press followed (`button.rs`).
    pub state: u8,
    pub items: Vec<String>,
    /// The font `WM_SETFONT` gave it; the System font without one.
    pub font: Option<u16>,
    /// An edit control's border, which it draws inside its client area
    /// rather than as a frame.
    pub border: bool,
    /// A static control's icon, with `SS_ICON`, and its handle.
    pub icon: Option<IconData>,
    pub icon_handle: u16,
    /// What its parent answered as it was last painted.
    pub colours: Option<ControlColours>,
    /// Made at its first message, for a window of a class of a program's
    /// that hands its messages on to this procedure, until it is made.
    pub adopted: bool,
    /// An edit control's selection, scroll and limit (`edit.rs`).
    pub edit: Option<crate::edit::EditState>,
    /// A multi-line edit control's lines (`mledit.rs`).
    pub lines: Option<crate::mledit::LinesState>,
    /// An edit control's memory in its instance's heap (`edit_buffer.rs`).
    pub buffer: Option<crate::edit_buffer::EditBuffer>,
    /// A list box's selection, scroll and data (`listbox.rs`).
    pub list: Option<crate::listbox::ListState>,
    /// A list box made, and so made whole rows high when it is sized.
    pub list_ready: bool,
    /// A list box changed by a message, to be painted again after it.
    pub invalid: bool,
    /// The combo box a list box or an edit control is part of: nought for
    /// none.
    pub combo_hwnd: u16,
    /// A combo box's parts (`combobox.rs`).
    pub combo: Option<crate::combobox::ComboState>,
    /// A scroll bar control's range and position (`scroll_bars.rs`).
    pub scroll: Option<crate::scroll_bars::ScrollState>,
    /// The device context an owner draws the control's items in, once it
    /// is made.
    pub item_dc: u16,
}

impl ControlState {
    /// A control's state when it is made: its text, nothing checked, no
    /// items.
    pub fn new(class_name: &str, style: u32, text: &str) -> Self {
        Self {
            class_name: class_name.to_ascii_uppercase(),
            style,
            text: text.to_string(),
            ..Self::default()
        }
    }

    /// What the control tells the dialog manager it wants (`WM_GETDLGCODE`).
    fn dialog_code(&self) -> u32 {
        let kind = self.style & 0x0f;

        match self.class_name.as_str() {
            "EDIT" => {
                0x0080
                    | 0x0008
                    | 0x0001
                    | if self.style & ES_MULTILINE != 0 {
                        0x0004
                    } else {
                        0
                    }
            }
            "LISTBOX" | "COMBOLBOX" | "COMBOBOX" => 0x0080 | 0x0001,
            "STATIC" => 0x0100,
            "BUTTON" => match kind {
                // A group box is static to the dialog manager (`USER.EXE`
                // seg25 `1cab`).
                7 => 0x0100,
                1 => 0x2000 | 0x0010,
                0 => 0x2000 | 0x0020,
                4 | 9 => 0x2000 | 0x0040,
                _ => 0x2000,
            },
            _ => 0,
        }
    }

    /// The type a control asks its parent's colours as, and how many times
    /// it asks as it paints, by its class; none for one not recorded.
    fn asking(&self) -> Option<(u16, u32)> {
        match self.class_name.as_str() {
            "EDIT" => Some((
                CTLCOLOR_EDIT,
                if self.style & ES_MULTILINE != 0 { 2 } else { 3 },
            )),
            "LISTBOX" => Some((CTLCOLOR_LISTBOX, 3)),
            "STATIC" => Some((CTLCOLOR_STATIC, 1)),
            "SCROLLBAR" => Some((CTLCOLOR_SCROLLBAR, 1)),
            // An owner-drawn button's owner paints it.
            "BUTTON" if self.style & 0x0f == BS_OWNERDRAW => None,
            "BUTTON" => Some((CTLCOLOR_BTN, 1)),
            _ => None,
        }
    }
}

/// Where a control's window goes for the rectangle it was asked for: there,
/// but a list box, which moves itself out by a border each way as it is
/// made, border or not (`USER.EXE` seg38 `02d5`).
pub fn control_rect(
    class_name: &str,
    x: i16,
    y: i16,
    width: i16,
    height: i16,
) -> (i16, i16, i16, i16) {
    if class_name == "LISTBOX" || class_name == "COMBOLBOX" {
        return (
            x.wrapping_sub(1),
            y.wrapping_sub(1),
            width.wrapping_add(2),
            height.wrapping_add(2),
        );
    }

    (x, y, width, height)
}

/// A colour as a `COLORREF`, from a brush's red, green and blue.
fn colorref_of(color: [u8; 4]) -> u32 {
    u32::from(color[0]) | u32::from(color[1]) << 8 | u32::from(color[2]) << 16
}

impl System {
    fn control_mut(&mut self, index: usize) -> &mut ControlState {
        self.control_at(index)
    }

    fn brush_mut(&mut self, handle: u16) -> Option<&mut crate::gdi::objects::Brush> {
        let (object, _) = self.gdi_object_of(handle)?;

        match &mut self.gdi.objects[object] {
            GdiObject::Brush(brush) => Some(brush),
            _ => None,
        }
    }

    /// USER's brush of a system colour, kept as USER keeps its own, and made
    /// again when the colour changes.
    fn sys_color_brush(&mut self, index: usize) -> u16 {
        let colour = self.sys_color(index);

        if let Some(&(kept, handle)) = self.sys_color_brushes.get(&index)
            && kept == colour
        {
            return handle;
        }

        let handle = crate::gdi::objects::create_solid_brush(self, colour);

        self.sys_color_brushes.insert(index, (colour, handle));
        handle
    }

    /// `DefWindowProc`'s answer to `WM_CTLCOLOR` (seg1 `5f9c`): the
    /// background `COLOR_WINDOW`, the text `COLOR_WINDOWTEXT`, and
    /// `COLOR_WINDOW`'s brush; or for a scroll bar white and black, and
    /// `COLOR_SCROLLBAR`'s brush, unrealized.
    pub fn default_control_colour(&mut self, hdc: u16, kind: u16) -> u16 {
        if kind == CTLCOLOR_SCROLLBAR {
            let brush = self.sys_color_brush(COLOR_SCROLLBAR);

            crate::gdi::dc::set_bk_color(self, hdc, 0x00ff_ffff);
            crate::gdi::dc::set_text_color(self, hdc, 0);

            if let Some(brush) = self.brush_mut(brush) {
                brush.realised = None;
            }

            return brush;
        }

        let window = self.sys_color(COLOR_WINDOW);
        let text = self.sys_color(COLOR_WINDOWTEXT);

        crate::gdi::dc::set_bk_color(self, hdc, window);
        crate::gdi::dc::set_text_color(self, hdc, text);
        self.sys_color_brush(COLOR_WINDOW)
    }
}

impl Engine {
    /// A control asks its parent what it is to paint with, as it is about
    /// to be painted, and keeps the answer for its painting (`ctlcolor`):
    /// `WM_CTLCOLOR` with its device context, and itself and its type in
    /// `lParam` (seg6 `028c`), as many times as its kind asks; an answer
    /// that is no brush is asked of `DefWindowProc` instead.
    pub(crate) async fn ask_control_colours(&self, hwnd: u16, index: usize) -> Result<(), Stop> {
        let (how, parent) = {
            let system = self.system();
            let window = system.windows[index].as_ref().expect("a window");
            let how = window.control.as_ref().and_then(ControlState::asking);
            let parent = window
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map_or(0, |parent| parent.hwnd);

            (how, parent)
        };
        let Some((kind, times)) = how else {
            return Ok(());
        };
        let hdc = self.system().get_dc(hwnd);
        let lparam = u32::from(hwnd) | u32::from(kind) << 16;
        let mut answer = 0;

        for _ in 0..times {
            answer = if parent == 0 {
                0
            } else {
                self.send_message(parent, WM_CTLCOLOR, hdc, &mut Param::Value(lparam))
                    .await? as u16
            };

            let mut system = self.system();

            if system.brush_mut(answer).is_none() {
                answer = system.default_control_colour(hdc, kind);
            }
        }

        let mut system = self.system();
        let dc = crate::gdi::dc::dc_of(&system, hdc);

        // The brush realised in the control, unless it was already
        // somewhere: Chess answers the brush its window was erased with, and
        // its labels' pattern stays in step with the window's (`brushrlz`).
        if let Some(dc) = dc {
            let origin = crate::gdi::dc::brush_org_of(&system, dc);

            if let Some(brush) = system.brush_mut(answer)
                && brush.realised.is_none()
            {
                brush.realised = Some(origin);
            }
        }

        let corner = dc.map_or((0, 0), |dc| crate::gdi::dc::screen_origin(&system, dc));
        let (brush, hollow, brush_origin) = match system.brush_mut(answer) {
            Some(brush) => (
                colorref_of(brush.color),
                brush.color[3] == 0,
                brush
                    .realised
                    .map_or((0, 0), |(x, y)| (x - corner.0, y - corner.1)),
            ),
            None => (0, false, (0, 0)),
        };
        // The text colour the answer set, or a new device context's black:
        // not the pen's colour, which is another thing. Chess sets no text
        // colour for its labels, and they were white.
        let state = dc.map(|dc| &system.gdi.dcs[dc].state);
        let colours = ControlColours {
            brush,
            text: state.and_then(|state| state.text_color).unwrap_or(0) & 0x00ff_ffff,
            ground: state
                .and_then(|state| state.back_color)
                .unwrap_or(0x00ff_ffff)
                & 0x00ff_ffff,
            hollow,
            transparent: state.is_some_and(|state| state.back_mode == TRANSPARENT),
            brush_origin,
        };

        system.control_mut(index).colours = Some(colours);
        system.release_dc(hwnd, hdc)?;
        Ok(())
    }

    /// A button pressed, as a click or its mnemonic presses it: an automatic
    /// check box toggles, an automatic three-state one steps, an automatic
    /// radio button is checked and the others in its group cleared, and the
    /// parent is told with `BN_CLICKED`.
    pub async fn click_control(&self, hwnd: u16) -> Result<(), Stop> {
        let notify = {
            let mut guard = self.system();
            let system = &mut *guard;
            let Some(index) = system.window_named(hwnd) else {
                return Ok(());
            };
            let window = system.windows[index].as_ref().expect("a window");
            let Some(control) = window
                .control
                .as_ref()
                .filter(|control| control.class_name == "BUTTON")
            else {
                return Ok(());
            };
            let kind = control.style & 0x0f;
            let parent = window.parent;
            let control_id = window.control_id;

            if kind == 3 {
                let control = system.control_mut(index);

                control.checked = u16::from(control.checked == 0);
            } else if kind == 6 {
                let control = system.control_mut(index);

                control.checked = (control.checked + 1) % 3;
            } else if kind == 9 {
                system.control_mut(index).checked = 1;

                // The rest of its group: the radio buttons around it back to
                // one with `WS_GROUP`, and up to the next.
                let siblings: Vec<usize> = system
                    .z_order
                    .iter()
                    .copied()
                    .filter(|&other| {
                        system.windows[other]
                            .as_ref()
                            .is_some_and(|other| other.parent == parent && other.hwnd != 0)
                    })
                    .collect();
                let style = |at: usize| {
                    system.windows[siblings[at]]
                        .as_ref()
                        .expect("a window")
                        .style
                };

                if let Some(at) = siblings.iter().position(|&other| other == index) {
                    let mut start = at;

                    while start > 0 && style(start) & 0x0002_0000 == 0 {
                        start -= 1;
                    }

                    let mut cleared = Vec::new();

                    for (at, &other) in siblings.iter().enumerate().skip(start) {
                        if at > start && style(at) & 0x0002_0000 != 0 {
                            break;
                        }

                        let window = system.windows[other].as_ref().expect("a window");

                        if other != index
                            && window
                                .control
                                .as_ref()
                                .is_some_and(|control| control.class_name == "BUTTON")
                            && window.style & 0x0f == 9
                        {
                            cleared.push(other);
                        }
                    }

                    for other in cleared {
                        system.control_mut(other).checked = 0;
                        system.windows[other]
                            .as_mut()
                            .expect("a window")
                            .needs_paint = true;
                    }
                }
            }

            system.windows[index]
                .as_mut()
                .expect("a window")
                .needs_paint = true;
            parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map(|parent| (parent.hwnd, control_id))
                .filter(|(parent, _)| *parent != 0)
        };

        if let Some((parent, control_id)) = notify {
            self.send_message(
                parent,
                WM_COMMAND,
                control_id,
                &mut Param::Value(u32::from(hwnd)),
            )
            .await?;
        }

        Ok(())
    }
}

impl System {
    /// A window of another class this procedure is made for: a superclass,
    /// as Delphi's `TBitBtn` and `TMemo` are of `BUTTON` and `EDIT`, which
    /// hands its messages on to USER's procedure with `CallWindowProc`.
    /// Windows keeps a control's state in the window's own bytes, so the
    /// procedure makes it whatever the class is called; here it is made at
    /// the window's first message, `WM_NCCREATE`, as `CreateWindow` makes it
    /// for USER's own classes. An edit control draws its own border, inside
    /// its client area (`USER.EXE` seg27 `013e`), and takes its memory in
    /// the heap of the instance its `CREATESTRUCT` names.
    fn adopt(&mut self, kind: &str, index: usize, lparam: &Param) {
        let window = self.windows[index].as_mut().expect("a window");
        let mut control = ControlState::new(kind, window.style, &window.title);

        if kind == "EDIT" {
            control.border = window.style & WS_BORDER != 0;
            window.style &= !WS_BORDER;
        }

        control.adopted = true;
        window.control = Some(control);

        if kind == "EDIT" {
            let instance = match lparam {
                Param::Value(0) => 0,
                Param::Value(far) => {
                    let at = (far & 0xffff_0000) | (far.wrapping_add(4) & 0xffff);

                    self.read_word(at)
                }
                Param::Struct(bytes) => bytes
                    .get(4..6)
                    .map_or(0, |word| u16::from_le_bytes([word[0], word[1]])),
            };
            let multiline = self.control_at(index).style & ES_MULTILINE != 0;

            self.create_edit_buffer(index, instance, multiline);
        }
    }
}

impl Engine {
    /// The window procedure of USER's control classes, `kind` the class, as
    /// `control-classes.ts`'s `controlProc` takes a message: an adopted
    /// control made; an adopted list or combo box's parts made once it is
    /// made; a combo box's own messages; an edit control's memory freed,
    /// its modified flag, its clipboard and its own messages; a list box
    /// sized; then what every control answers, a button's, a scroll bar's
    /// and a list box's messages; and the rest to `DefWindowProc`.
    ///
    /// The caret, which `BeginPaint` and `EndPaint` take away and put back
    /// around a control's painting, is USER's drawing, not ported yet.
    #[allow(clippy::too_many_lines)]
    pub async fn control_proc(
        &self,
        kind: &str,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let index = self.system().window_named(hwnd);

        if message == WM_NCCREATE
            && let Some(index) = index
        {
            let mut system = self.system();

            if system.windows[index]
                .as_ref()
                .is_some_and(|window| window.control.is_none())
            {
                system.adopt(kind, index, lparam);
            }
        }

        let Some(index) = index.filter(|&index| {
            self.system().windows[index]
                .as_ref()
                .is_some_and(|window| window.control.is_some())
        }) else {
            return Box::pin(self.def_window_proc(hwnd, message, wparam, lparam)).await;
        };

        // An adopted list or combo box makes its parts once it is made.
        if message == WM_CREATE && self.system().control_mut(index).adopted {
            self.system().control_mut(index).adopted = false;

            let answer = Box::pin(self.def_window_proc(hwnd, message, wparam, lparam)).await?;

            if kind == "LISTBOX" || kind == "COMBOLBOX" {
                self.init_list(hwnd).await?;
            } else if kind == "COMBOBOX" {
                Box::pin(self.init_combo(hwnd)).await?;
            }

            return Ok(answer);
        }

        let value = match lparam {
            Param::Value(value) => *value,
            Param::Struct(_) => 0,
        };
        let invalidate = |engine: &Self| {
            if let Some(window) = engine.system().windows[index].as_mut() {
                window.needs_paint = true;
            }
        };

        if kind == "COMBOBOX"
            && message != WM_PAINT
            && message != WM_ERASEBKGND
            && let Some(answer) =
                Box::pin(self.combo_message(hwnd, index, message, wparam, lparam)).await?
        {
            return Ok(answer);
        }

        let multiline =
            kind == "EDIT" && self.system().control_mut(index).style & ES_MULTILINE != 0;

        // An edit control's memory, freed as it goes (`edit_buffer.rs`).
        if kind == "EDIT" && message == WM_NCDESTROY {
            self.system().free_edit_buffer(index);
        }

        // Whether the text was changed since it was last set, for either
        // kind of edit control: 0 or 1, and set by any nonzero `wParam`
        // (seg26 `0e32`, `0e3e`).
        if kind == "EDIT" && (message == EM_GETMODIFY || message == EM_SETMODIFY) {
            let mut system = self.system();
            let edit = system.edit_state(index);

            if message == EM_GETMODIFY {
                return Ok(u32::from(edit.modified));
            }

            edit.modified = wparam != 0;
            return Ok(0);
        }

        // Cut, copy, paste and clear, through the clipboard.
        if kind == "EDIT" && (WM_CUT..=WM_CLEAR).contains(&message) {
            Box::pin(self.edit_clipboard(hwnd, index, message)).await?;
            return Ok(0);
        }

        if kind == "EDIT" && message != WM_SETTEXT {
            let answer = if multiline {
                Box::pin(self.ml_edit_message(hwnd, index, message, wparam, lparam)).await?
            } else {
                Box::pin(self.edit_message(hwnd, index, message, wparam, value)).await?
            };

            if let Some(answer) = answer {
                return Ok(answer);
            }
        }

        // Resized, a list box is made a whole number of rows high again, as
        // it was made: Cribbage moves its list to 46 pixels, and Windows
        // shows it 34.
        if message == WM_SIZE && kind == "LISTBOX" && self.system().control_mut(index).list_ready {
            self.system().integral_height(index)?;
        }

        match message {
            // Painted between `BeginPaint` and `EndPaint`, which take the
            // caret away and put it back, in its parent's colours, as its
            // kind paints (`control_paint`). An owner-drawn button's owner
            // paints it.
            WM_PAINT => {
                let hidden = self.system().hide_caret_for(hwnd);

                self.ask_control_colours(hwnd, index).await?;

                let owner_drawn = kind == "BUTTON"
                    && self.system().control_mut(index).style & 0x0f == BS_OWNERDRAW;

                if matches!(kind, "LISTBOX" | "COMBOLBOX" | "COMBOBOX") || owner_drawn {
                    {
                        let mut system = self.system();
                        let window = system.control_window_mut(index);

                        window.needs_erase = false;
                        window.needs_paint = false;
                    }

                    if kind == "COMBOBOX" {
                        Box::pin(self.paint_combo_box(index)).await?;
                    } else if owner_drawn {
                        self.draw_button_item(index, ODA_DRAWENTIRE, None).await?;
                    } else {
                        Box::pin(self.paint_list(index)).await?;
                    }
                } else {
                    self.system().paint_control(index)?;
                }

                let mut system = self.system();

                if hidden {
                    system.show_caret_of(hwnd);
                }

                let window = system.windows[index].as_mut().expect("a window");

                window.paint_clip = None;
                window.paint_shape = None;
                return Ok(0);
            }
            // A control paints all of itself.
            WM_ERASEBKGND => return Ok(1),
            WM_SETFONT => {
                self.system().control_mut(index).font = (wparam != 0).then_some(wparam);

                if value != 0 {
                    invalidate(self);
                }

                return Ok(0);
            }
            WM_GETFONT => {
                return Ok(u32::from(
                    self.system().control_mut(index).font.unwrap_or(0),
                ));
            }
            WM_GETDLGCODE => return Ok(self.system().control_mut(index).dialog_code()),
            // A static's icon given and asked for: the icon before answered,
            // and the control painted again. As documented; USER's own is
            // not read out.
            STM_SETICON | STM_GETICON if kind == "STATIC" => {
                let mut system = self.system();
                let before = system.control_mut(index).icon_handle;

                if message == STM_SETICON {
                    let icon = if wparam == 0 {
                        None
                    } else {
                        system.icon_of(wparam)
                    };
                    let control = system.control_mut(index);

                    control.icon_handle = wparam;
                    control.icon = icon;
                    drop(system);
                    invalidate(self);
                }

                return Ok(u32::from(before));
            }
            WM_SETTEXT => {
                {
                    let mut system = self.system();
                    let text: String = system
                        .message_string(lparam)
                        .into_iter()
                        .map(char::from)
                        .collect();
                    let window = system.control_window_mut(index);

                    window.title.clone_from(&text);
                    window.needs_paint = true;
                    system.control_mut(index).text = text;
                }

                if kind == "EDIT" {
                    // New text is not a change (seg29 `00c0`, seg31 `00b6`).
                    self.system().edit_state(index).modified = false;

                    if multiline {
                        Box::pin(self.ml_edit_message(hwnd, index, message, wparam, lparam))
                            .await?;
                    } else {
                        Box::pin(self.edit_message(hwnd, index, message, wparam, value)).await?;
                    }
                }

                return Ok(1);
            }
            WM_GETTEXT => {
                let mut system = self.system();
                let text: Vec<u8> = system
                    .control_mut(index)
                    .text
                    .chars()
                    .map(|character| character as u8)
                    .collect();

                return Ok(match lparam {
                    Param::Value(far) => {
                        if wparam == 0 {
                            0
                        } else {
                            system.copy_text(&text, *far, usize::from(wparam)) as u32
                        }
                    }
                    // A buffer laid out here, to a procedure of USER's own.
                    Param::Struct(bytes) => {
                        let count = text
                            .len()
                            .min(usize::from(wparam).saturating_sub(1))
                            .min(bytes.len().saturating_sub(1));

                        bytes[..count].copy_from_slice(&text[..count]);

                        if count < bytes.len() {
                            bytes[count] = 0;
                        }

                        count as u32
                    }
                });
            }
            WM_GETTEXTLENGTH => {
                return Ok(self.system().control_mut(index).text.chars().count() as u32);
            }
            _ => {}
        }

        // The mouse, the pushed state, and the focus lost (`button.rs`).
        if kind == "BUTTON"
            && let Some(answer) =
                Box::pin(self.button_message(hwnd, index, message, wparam, value)).await?
        {
            return Ok(answer);
        }

        if kind == "BUTTON" {
            match message {
                BM_GETCHECK => return Ok(u32::from(self.system().control_mut(index).checked)),
                BM_SETCHECK => {
                    self.system().control_mut(index).checked = wparam;
                    invalidate(self);
                    return Ok(0);
                }
                // The button's own style, its low byte; drawn again if
                // `lParam` says so. The dialog manager moves the default push
                // button so (`defpush`).
                BM_SETSTYLE => {
                    let mut system = self.system();
                    let window = system.control_window_mut(index);

                    window.style = (window.style & !0xff) | u32::from(wparam & 0xff);

                    let control = system.control_mut(index);

                    control.style = (control.style & !0xff) | u32::from(wparam & 0xff);
                    drop(system);

                    if value != 0 {
                        invalidate(self);
                    }

                    return Ok(0);
                }
                // An owner-drawn button is drawn again for its focus alone,
                // as it gains or loses it (`ODA_FOCUS`): Delphi's buttons
                // take their focus rectangle away so.
                WM_SETFOCUS | WM_KILLFOCUS
                    if self.system().control_mut(index).style & 0x0f == BS_OWNERDRAW =>
                {
                    self.draw_button_item(index, ODA_FOCUS, Some(message == WM_SETFOCUS))
                        .await?;
                    return Ok(0);
                }
                _ => {}
            }
        }

        // A press on a scroll bar control, once or twice alike: the focus,
        // if it takes it, then the press followed (`USER.EXE` seg18 `0b63`).
        if kind == "SCROLLBAR" && (message == WM_LBUTTONDOWN || message == WM_LBUTTONDBLCLK) {
            Box::pin(self.scroll_control_press(hwnd, index, value)).await?;
            return Ok(0);
        }

        // A button is drawn again as it gains or loses the focus
        // (`btnfocus`).
        if kind == "BUTTON" && (message == WM_SETFOCUS || message == WM_KILLFOCUS) {
            invalidate(self);
        }

        // A button or static text is drawn again, enabled or not (`btndis`).
        if (kind == "BUTTON" || kind == "STATIC") && message == WM_ENABLE {
            invalidate(self);
            return Ok(0);
        }

        // A scroll bar control's arrows go with its being enabled
        // (`USER.EXE` seg18 `0a67`).
        if kind == "SCROLLBAR" && message == WM_ENABLE {
            self.system().enable_scroll_control(hwnd, wparam != 0);
            return Ok(0);
        }

        if (kind == "LISTBOX" || kind == "COMBOLBOX")
            && let Some(answer) =
                Box::pin(self.listbox_message(hwnd, index, message, wparam, lparam)).await?
        {
            return Ok(answer);
        }

        Box::pin(self.def_window_proc(hwnd, message, wparam, lparam)).await
    }

    /// An owner-drawn button drawn by its parent, with `WM_DRAWITEM`
    /// (documented): `ODT_BUTTON`, item 0, the action, its state --
    /// `ODS_FOCUS` with the focus, `ODS_DISABLED` disabled, `ODS_SELECTED`
    /// pushed (`USER.EXE` seg25 `11d9`, `19d7`, `1ef8`) -- a device context
    /// for it and its client area. Sound Recorder's buttons are drawn this
    /// way. `focused` is the focus it is drawn with, or none for whether it
    /// has it.
    pub(crate) async fn draw_button_item(
        &self,
        index: usize,
        action: u16,
        focused: Option<bool>,
    ) -> Result<(), Stop> {
        let (far, id) = {
            let mut system = self.system();
            let window = system.control_window(index);

            if !window.visible {
                return Ok(());
            }

            let state = if focused.unwrap_or(system.focus == Some(index)) {
                0x10
            } else {
                0
            } | if window.style & WS_DISABLED != 0 {
                0x04
            } else {
                0
            } | window.control.as_ref().map_or(0, |control| {
                u16::from(control.state & crate::button::PUSHED != 0)
            });
            let (id, hwnd, width, height) = (
                window.control_id,
                window.hwnd,
                window.client_width(),
                window.client_height(),
            );
            let far = system.owner_block() + 32;
            let hdc = system.item_dc(index);

            system.write_words(
                far,
                &[
                    4,
                    id,
                    0,
                    action,
                    state,
                    hwnd,
                    hdc,
                    0,
                    0,
                    width as u16,
                    height as u16,
                    0,
                    0,
                ],
            );
            (far, id)
        };

        self.send_parent(index, crate::control_host::WM_DRAWITEM, id, far)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_list_box_moves_out_by_a_border() {
        assert_eq!(control_rect("LISTBOX", 10, 20, 30, 40), (9, 19, 32, 42));
        assert_eq!(control_rect("BUTTON", 10, 20, 30, 40), (10, 20, 30, 40));
    }

    #[test]
    fn dialog_codes_by_kind() {
        let code = |class, style| ControlState::new(class, style, "").dialog_code();

        assert_eq!(code("button", 0x07), 0x0100);
        assert_eq!(code("button", 0x01), 0x2010);
        assert_eq!(code("button", 0x00), 0x2020);
        assert_eq!(code("button", 0x09), 0x2040);
        assert_eq!(code("button", 0x03), 0x2000);
        assert_eq!(code("edit", 0x04), 0x008d);
        assert_eq!(code("static", 0), 0x0100);
    }
}
