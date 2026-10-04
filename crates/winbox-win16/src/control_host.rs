//! What USER's controls with a state of their own -- the edit control, the
//! list box, the combo box and the scroll bar control -- ask of the desktop
//! and of their parents, as winbox.js's `control-classes.ts` gives it them:
//! their fonts' measures, a device context for an owner to draw an item in,
//! guest memory for the owner-draw structures, and their messages to their
//! parents.
//!
//! What a control paints is the desktop's drawing: [`System::paint_control`]
//! for the edit control and the scroll bar control, and `control_pixels.rs`
//! for the list box's rows, its focus rectangle and the combo box's field.

use winbox_machine::segment_selector;
use winbox_raster::{LogicalFont, Measure};

use crate::call::Stop;
use crate::controls::ControlState;
use crate::engine::Engine;
use crate::fonts::text_metrics;
use crate::gdi::GdiObject;
use crate::handles::{Kind, Object};
use crate::messages::Param;
use crate::system::System;

pub(crate) const WM_DRAWITEM: u16 = 0x002b;
pub(crate) const WM_MEASUREITEM: u16 = 0x002c;
pub(crate) const WM_DELETEITEM: u16 = 0x002d;
pub(crate) const WM_COMPAREITEM: u16 = 0x0039;

/// The letters a font's average width is measured over, as the dialog's
/// rule measures it.
pub(crate) const LETTERS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/// What a control's font is to it: the font, realised, and its metrics, as
/// `raster-desktop.ts`'s `fontOf` reads them back from `GetTextMetrics`.
#[derive(Debug, Clone)]
pub struct ControlFont {
    pub font: LogicalFont,
    pub height: i32,
    pub overhang: i32,
    /// Whether every character is as wide as every other: bit 0 of
    /// `tmPitchAndFamily` clear.
    pub fixed_pitch: bool,
    pub average: i32,
}

impl ControlFont {
    fn of(font: LogicalFont) -> Self {
        let metrics = text_metrics(&font);

        Self {
            height: metrics.height,
            overhang: metrics.overhang,
            fixed_pitch: metrics.pitch_and_family & 1 == 0,
            average: metrics.ave_char_width,
            font,
        }
    }

    /// The font's average width by the dialog's rule: its letters' width
    /// over 26, plus one, halved.
    pub fn dialog_average(&self) -> i32 {
        ((self.measure(LETTERS) / 26) + 1) / 2
    }

    /// How wide a run of text is in the font, as `GetTextExtent` says:
    /// nothing for no characters.
    pub fn measure(&self, text: &[u8]) -> i32 {
        if text.is_empty() {
            return 0;
        }

        self.font.measure(text, Measure::default()).0 as i32
    }
}

/// Text as a control keeps it, a character to a byte, as bytes.
pub(crate) fn bytes_of(text: &str) -> Vec<u8> {
    text.chars().map(|character| character as u8).collect()
}

/// Bytes as a control keeps its text, a character to a byte.
pub(crate) fn text_of(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

/// A list box's or a combo box's answer as the long `SendMessage` answers:
/// the word it works in, widened with its sign, so that `LB_ERR` is -1 in
/// all 32 bits -- but for the messages named, whose answers are 32 bits of
/// their own. **Recorded** by `lberr`: every failure answers `FFFFFFFFh`. File
/// Manager walks a list with `LB_GETTEXT` until it does.
pub(crate) fn widened(message: u16, answer: u32, whole: &[u16]) -> u32 {
    if whole.contains(&message) || !(0x400..=0x42f).contains(&message) {
        return answer;
    }

    i32::from(answer as u16 as i16) as u32
}

/// What USER keeps for its controls that is not any one window's.
#[derive(Debug, Clone, Default)]
pub struct Controls {
    /// The clipboard (`clipboard.rs`).
    pub clipboard: crate::clipboard::Clipboard,
    /// The owner-draw structures' block, as `GlobalLock` gives it; nought
    /// until it is made.
    pub owner_block: u32,
    /// Where the focus is going while the window losing it is told, for a
    /// control that learns of its leaving only from its own child: a combo
    /// box's edit control.
    pub focus_going: Option<u16>,
    /// What a control's procedure works on once its window is destroyed
    /// under it -- by its parent, told of a change -- as the TypeScript
    /// engine works on the window it holds, which no longer shows.
    pub detached: crate::windows::Window,
}

impl System {
    /// The state of a window that is a control; once it is destroyed, a
    /// state of no window's.
    pub(crate) fn control_at(&mut self, index: usize) -> &mut ControlState {
        let live = self.windows[index]
            .as_ref()
            .is_some_and(|window| window.control.is_some());

        if live {
            return self.windows[index]
                .as_mut()
                .and_then(|window| window.control.as_mut())
                .expect("a control");
        }

        self.controls
            .detached
            .control
            .get_or_insert_with(ControlState::default)
    }

    /// The window an index names; once it is destroyed, a window of no
    /// one's.
    pub(crate) fn control_window(&self, index: usize) -> &crate::windows::Window {
        self.windows[index]
            .as_ref()
            .unwrap_or(&self.controls.detached)
    }

    pub(crate) fn control_window_mut(&mut self, index: usize) -> &mut crate::windows::Window {
        if self.windows[index].is_some() {
            return self.windows[index].as_mut().expect("a window");
        }

        &mut self.controls.detached
    }

    /// A string a message carries: as a far pointer to one in the
    /// program's memory, or laid out here; nothing for nought.
    pub(crate) fn message_string(&self, lparam: &Param) -> Vec<u8> {
        match lparam {
            Param::Value(0) => Vec::new(),
            Param::Value(far) => self.read_string(*far),
            Param::Struct(bytes) => bytes
                .iter()
                .copied()
                .take_while(|&byte| byte != 0)
                .collect(),
        }
    }

    /// Words written at a far pointer, a word apart.
    pub(crate) fn write_words(&mut self, far: u32, words: &[u16]) {
        let bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();

        self.write_far(far, &bytes);
    }

    /// The word at a far pointer.
    pub(crate) fn read_word(&self, far: u32) -> u16 {
        let bytes = self.read_far(far, 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    }

    /// Guest memory for the owner-draw structures, one of each: a block of
    /// 64 bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT`, made the first time and
    /// kept; the measuring structure at its start and the drawing one 32
    /// bytes in.
    pub(crate) fn owner_block(&mut self) -> u32 {
        if self.controls.owner_block == 0
            && let Some(index) =
                self.global
                    .allocate(&mut self.cpu.bus, &mut self.descriptors, 64, 0x42)
        {
            // As `GlobalLock` gives it, through its handle's selector.
            self.controls.owner_block = u32::from(segment_selector(index)) << 16;
        }

        self.controls.owner_block
    }

    /// A device context on a control, for its owner to draw an item with:
    /// with the control's font in it, or the System font, as `GetDC` gives
    /// it. Made the first time, a handle of its own, and kept.
    pub(crate) fn item_dc(&mut self, index: usize) -> u16 {
        let dc = self.window_dc(index);
        let own = self
            .control_at(index)
            .font
            .and_then(|handle| self.gdi_object_of(handle))
            .filter(|(_, object)| matches!(object, GdiObject::Font(_)))
            .map(|(object, _)| object);

        if let Some(object) = own {
            self.gdi.dcs[dc].state.font = Some(object);
        } else if self.gdi.dcs[dc].state.font.is_none() {
            let font = self.system_font();

            self.gdi.dcs[dc].state.font = font;
        }

        let kept = self.control_at(index).item_dc;

        if kept != 0 {
            return kept;
        }

        let handle = self.handles.allocate(Kind::Dc, Object::Dc(dc)).unwrap_or(0);

        self.control_at(index).item_dc = handle;
        handle
    }

    /// The System font the desktop hands out, as a control measures with
    /// it.
    pub(crate) fn system_control_font(&self) -> Result<ControlFont, Stop> {
        self.desktop_font
            .clone()
            .map(ControlFont::of)
            .ok_or(Stop::Unsupported("a control before the raster desktop"))
    }

    /// The font `WM_SETFONT` gave a control, realised, or none for the
    /// System font.
    pub(crate) fn control_font(&mut self, index: usize) -> Result<Option<ControlFont>, Stop> {
        let Some(handle) = self.control_at(index).font else {
            return Ok(None);
        };
        let Some((object, GdiObject::Font(_))) = self.gdi_object_of(handle) else {
            return Ok(None);
        };

        Ok(crate::gdi::text::realised(self, object)?.map(ControlFont::of))
    }

    /// A control's font's height: its own, or the System font's.
    pub(crate) fn control_font_height(&mut self, index: usize) -> Result<i32, Stop> {
        Ok(match self.control_font(index)? {
            Some(font) => font.height,
            None => self.system_control_font()?.height,
        })
    }
}

impl Engine {
    /// A message to a control's parent, answered as its procedure answers;
    /// a combo box's list or edit control tells its combo box instead,
    /// wherever the list lies. Nought for no parent.
    pub(crate) async fn send_parent(
        &self,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        let target = {
            let system = self.system();
            let window = system.control_window(index);
            let combo = window
                .control
                .as_ref()
                .map_or(0, |control| control.combo_hwnd);

            if combo == 0 {
                window
                    .parent
                    .and_then(|parent| system.windows[parent].as_ref())
                    .map_or(0, |parent| parent.hwnd)
            } else {
                combo
            }
        };

        if target == 0 {
            return Ok(0);
        }

        self.send_message(target, message, wparam, &mut Param::Value(lparam))
            .await
    }

    /// A control's parent told, with `WM_COMMAND`: the control's
    /// identifier, and its window and the code in `lParam`.
    pub(crate) async fn notify_parent(&self, index: usize, code: u16) -> Result<(), Stop> {
        let (hwnd, id) = {
            let system = self.system();
            let window = system.control_window(index);

            (window.hwnd, window.control_id)
        };

        self.send_parent(
            index,
            crate::controls::WM_COMMAND,
            id,
            u32::from(hwnd) | u32::from(code) << 16,
        )
        .await?;
        Ok(())
    }
}
