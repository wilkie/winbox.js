//! Device contexts as state: what a context keeps -- its colours and modes,
//! the objects selected into it, its brush origin, its mapping and its
//! current position -- and what `SaveDC` saves of it. A memory device
//! context and the screen's are made here; a window's comes with windows.
//!
//! A handle that stands for something other than a device context is
//! answered here as no device context is. The TypeScript engine reads and
//! sets the field on whatever object the handle stands for, a pen or a
//! window, and answers what that object has, its own default else; nothing
//! recorded turns on it.

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::system::System;

use super::mapping::Mapping;
use super::objects::{Brush, GdiObject, Pen, SYSTEM_FONT, get_stock_object, stock_font_handle};
use super::{pack, put_dword};

/// What a device context keeps that `SaveDC` saves. The clip region and the
/// text justification are saved too, and come with the calls that set
/// them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DcState {
    /// `OPAQUE`, 2, for a new device context; `TRANSPARENT` is 1.
    pub back_mode: u16,
    /// `TA_LEFT | TA_TOP`, nought, for a new device context.
    pub text_align: u16,
    /// The colour text is drawn in, as the program gave it: none draws
    /// black, and is answered as black.
    pub text_color: Option<u32>,
    /// The gap added after every character.
    pub char_extra: u16,
    /// The background colour, as the program gave it: none is white.
    pub back_color: Option<u32>,
    /// The colour `SetTextColor` gives beside the text's: none is white,
    /// as a new device context's is.
    pub fore_color: Option<u32>,
    /// The objects selected, by their indices among GDI's objects.
    pub brush: usize,
    pub pen: usize,
    pub font: Option<usize>,
    /// The drawing mode, the polygon fill mode and the stretching mode,
    /// where set: `R2_COPYPEN`, `ALTERNATE` and `BLACKONWHITE` else.
    pub rop2: Option<u16>,
    pub poly_fill_mode: Option<u16>,
    pub stretch_mode: Option<u16>,
    /// The brush origin, where set: the screen's corner of the device
    /// context else.
    pub brush_org: Option<(i16, i16)>,
    /// The mapping, where set: `MM_TEXT` else.
    pub mapping: Option<Mapping>,
    /// The current position, as `MoveTo` and `LineTo` leave it.
    pub position: (i32, i32),
}

/// The bitmap a device context draws into, as far as its state goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DcBitmap {
    /// The one-by-one monochrome bitmap Windows selects into every new
    /// memory device context, until the program selects its own.
    Placeholder,
    /// The screen's, at the display's depth.
    Screen,
}

/// A device context.
#[derive(Debug, Clone)]
pub struct Dc {
    pub state: DcState,
    /// What `SaveDC` saved, the first first.
    pub saved: Vec<DcState>,
    pub bitmap: DcBitmap,
    /// A memory device context's: its driver is GDI's own for bitmaps, not
    /// the display's.
    pub memory: bool,
    /// The font mapper's flags (`SetMapperFlags`).
    pub mapper_flags: u32,
}

impl System {
    /// A new device context, its first pen and brush its own: the stock
    /// white brush, which `SelectObject` answers as that; a black pen,
    /// which it answers as nothing. Its background colour is white, which
    /// every probe that draws text without touching `SetBkColor` comes back
    /// on.
    fn new_dc(&mut self, bitmap: DcBitmap, memory: bool) -> usize {
        let brush = self.gdi_object(GdiObject::Brush(Brush {
            color: [0xff, 0xff, 0xff, 0xff],
            colorref: None,
            hatch: None,
            logbrush: None,
            stock: Some(0),
            realised: None,
        }));
        let pen = self.gdi_object(GdiObject::Pen(Pen {
            color: [0x00, 0x00, 0x00, 0xff],
            width: None,
            style: None,
            logpen: None,
        }));

        self.gdi.dcs.push(Dc {
            state: DcState {
                back_mode: 2,
                text_align: 0,
                text_color: None,
                char_extra: 0,
                back_color: None,
                fore_color: None,
                brush,
                pen,
                font: None,
                rop2: None,
                poly_fill_mode: None,
                stretch_mode: None,
                brush_org: None,
                mapping: None,
                position: (0, 0),
            },
            saved: Vec::new(),
            bitmap,
            memory,
            mapper_flags: 0,
        });
        self.gdi.dcs.len() - 1
    }

    /// The system font's object, as a new device context has it selected.
    fn system_font(&mut self) -> Option<usize> {
        let handle = stock_font_handle(self, SYSTEM_FONT)?;

        match self.handles.resolve(handle)? {
            Object::Gdi(index) => Some(index),
            _ => None,
        }
    }

    /// The screen's device context, made the first time it is asked for:
    /// off the page, at the display's depth. `GetDC(NULL)` is to answer it
    /// too, when windows come.
    pub fn screen_dc(&mut self) -> usize {
        if let Some(screen) = self.gdi.screen {
            return screen;
        }

        let screen = self.new_dc(DcBitmap::Screen, false);

        self.gdi.screen = Some(screen);
        screen
    }
}

/// The device context a handle stands for.
pub fn dc_of(system: &System, hdc: u16) -> Option<usize> {
    match system.handles.resolve(hdc)? {
        Object::Dc(index) => Some(index),
        _ => None,
    }
}

/// A device context's state, by its handle.
fn state_of(system: &mut System, hdc: u16) -> Option<&mut DcState> {
    let index = dc_of(system, hdc)?;

    Some(&mut system.gdi.dcs[index].state)
}

/// A memory device context: the one-by-one monochrome bitmap every new one
/// starts with until the program selects its own, and the System font
/// selected, as every Windows context starts -- Calendar and `DrawText`
/// measure text in one without selecting a font first. Its handle is
/// GDI's, from those its objects have (`gdinum`). Nought where `hdc` is
/// given and stands for nothing.
pub fn create_compatible_dc(system: &mut System, hdc: u16) -> u16 {
    if hdc != 0 && system.handles.resolve(hdc).is_none() {
        return 0;
    }

    let font = system.system_font();
    let index = system.new_dc(DcBitmap::Placeholder, true);

    system.gdi.dcs[index].state.font = font;
    system
        .handles
        .allocate(Kind::Gdi, Object::Dc(index))
        .unwrap_or(0)
}

pub(crate) fn create_compatible_dc_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    Ok(Answer::Word(create_compatible_dc(system, hdc)))
}

/// A device context for a device, by its driver's name. The only device
/// here is the display: `DISPLAY` gives a context over the whole screen, as
/// `GetDC(NULL)` does, a new handle for the screen's one context each time,
/// which `DeleteDC` gives back; it has the System font selected, as every
/// context starts -- the Visual Basic runtime measures a digit in a
/// `DISPLAY` information context as it starts, without selecting a font.
///
/// `CreateIC` is the same, for asking about a device without drawing on
/// it.
///
/// Any other driver stops here. The TypeScript engine has a printer of its
/// own, `WBPRINT`, a page to draw into, and installs it in `WIN.INI` for a
/// program to find as its default; any other driver it answers nought for.
/// Neither the printer nor its `WIN.INI` entries are here yet, so a program
/// that would print is stopped rather than told there is no printer --
/// which `printing`, finding none in `WIN.INI`, would take and end on.
pub fn create_dc(system: &mut System, driver: &[u8]) -> Result<u16, Stop> {
    if !driver.eq_ignore_ascii_case(b"DISPLAY") {
        return Err(Stop::Unsupported(
            "CreateDC of a device other than the display",
        ));
    }

    let screen = system.screen_dc();

    if system.gdi.dcs[screen].state.font.is_none() {
        let font = system.system_font();

        system.gdi.dcs[screen].state.font = font;
    }

    Ok(system
        .handles
        .allocate(Kind::Dc, Object::Dc(screen))
        .unwrap_or(0))
}

pub(crate) fn create_dc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let driver = args.dword(system);
    let _device = args.dword(system);
    let _output = args.dword(system);
    let _data = args.dword(system);
    let driver = if driver == 0 {
        Vec::new()
    } else {
        system.read_string(driver)
    };

    Ok(Answer::Word(create_dc(system, &driver)?))
}

/// A device context given back. Any handle that stands for something is
/// let go, as the TypeScript engine lets it.
pub fn delete_dc(system: &mut System, hdc: u16) -> bool {
    if system.handles.resolve(hdc).is_none() {
        return false;
    }

    system.handles.free(hdc);
    true
}

pub(crate) fn delete_dc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    Ok(Answer::Word(u16::from(delete_dc(system, hdc))))
}

/// A device context's state saved, to be put back by `RestoreDC`: the
/// level saved, 1 for the first; nought for no device context.
///
/// **Recorded** by `clipdc`: after `RestoreDC` it counts on from the level
/// restored. The text and background colours, the stretch mode and the
/// clip region are put back. Also saved, and not recorded: the background
/// mode, text alignment, character spacing, brush, pen, font, drawing mode,
/// brush origin, mapping and the current position. Not saved: the bitmap.
pub fn save_dc(system: &mut System, hdc: u16) -> u16 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let dc = &mut system.gdi.dcs[index];

    dc.saved.push(dc.state.clone());
    dc.saved.len() as u16
}

pub(crate) fn save_dc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    Ok(Answer::Word(save_dc(system, hdc)))
}

/// The state `SaveDC` saved at a level put back, and that level and those
/// after dropped: the level restored, or nought for a level there is not,
/// which changes nothing.
///
/// **Recorded** by `clipdc`: a negative level counts back from the last, -1
/// the last; nought is taken as level 1.
pub fn restore_dc(system: &mut System, hdc: u16, asked: i16) -> u16 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let dc = &mut system.gdi.dcs[index];
    let count = dc.saved.len() as i32;
    let asked = i32::from(asked);
    let level = match asked {
        ..0 => count + asked + 1,
        0 => 1,
        _ => asked,
    };

    if level < 1 || level > count {
        return 0;
    }

    dc.state = dc.saved[level as usize - 1].clone();
    dc.saved.truncate(level as usize - 1);
    level as u16
}

pub(crate) fn restore_dc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let level = args.signed(system);

    Ok(Answer::Word(restore_dc(system, hdc, level)))
}

/// Where a device context's brush origin is: where `SetBrushOrg` put it,
/// else the screen's corner of the context -- nought for a memory context
/// and the screen's. A window's context, when windows come, has its own.
fn brush_org_of(system: &System, index: usize) -> (i32, i32) {
    system.gdi.dcs[index]
        .state
        .brush_org
        .map_or((0, 0), |(x, y)| (i32::from(x), i32::from(y)))
}

/// An object selected into a device context, in place of the one of its
/// kind there: the handle of the one replaced.
///
/// * A pen's and a font's: the handle that stands for it, or 1 where none
///   does -- a device context's own first pen.
/// * A brush's: likewise, but a device context's own first brush is the
///   stock white brush, and answers as that (`patbrush`). A brush is
///   realised as it is selected: its pattern, a hatch, and a colour the
///   display dithers keep where they were first realised, until
///   `UnrealizeObject` (`brushrlz`).
///
/// A region is the clip, as `SelectClipRgn` makes it, and a bitmap a
/// memory context's pixels; those come with regions and bitmaps. Anything
/// else, and no device context, is nought.
pub fn select_object(system: &mut System, hdc: u16, handle: u16) -> u16 {
    if hdc == 0 {
        return 0;
    }

    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let Some((object, item)) = system.gdi_object_of(handle) else {
        return 0;
    };
    let state = &system.gdi.dcs[index].state;

    match item {
        GdiObject::Pen(_) => {
            let before = system.handles.lookup(Object::Gdi(state.pen)).unwrap_or(1);

            system.gdi.dcs[index].state.pen = object;
            before
        }
        GdiObject::Font(_) => {
            let before = state
                .font
                .and_then(|font| system.handles.lookup(Object::Gdi(font)))
                .unwrap_or(1);

            system.gdi.dcs[index].state.font = Some(object);
            before
        }
        GdiObject::Brush(_) => {
            let selected = state.brush;
            let stock = match &system.gdi.objects[selected] {
                GdiObject::Brush(brush) => brush.stock,
                _ => None,
            };
            let before = match system.handles.lookup(Object::Gdi(selected)) {
                Some(handle) => handle,
                None => stock.map_or(1, |stock| get_stock_object(system, stock)),
            };
            let origin = brush_org_of(system, index);

            system.gdi.dcs[index].state.brush = object;

            if let GdiObject::Brush(brush) = &mut system.gdi.objects[object]
                && brush.realised.is_none()
            {
                brush.realised = Some(origin);
            }

            before
        }
        GdiObject::Palette(_) => 0,
    }
}

pub(crate) fn select_object_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let handle = args.word(system);

    Ok(Answer::Word(select_object(system, hdc, handle)))
}

/// The background colour set, as it was given -- one the display has not,
/// or one of a palette, too -- and the colour before answered so: white
/// for a new device context (`bkcolor`). `80000000h` for no device
/// context.
///
/// The TypeScript engine also keeps the colour a palette's `COLORREF`
/// stands for in the device context's palette as it is set; here the
/// colour is to be looked up from the `COLORREF` when drawing comes, which
/// differs only where another palette is selected between.
pub fn set_bk_color(system: &mut System, hdc: u16, colorref: u32) -> u32 {
    let Some(state) = state_of(system, hdc) else {
        return 0x8000_0000;
    };

    state.back_color.replace(colorref).unwrap_or(0x00ff_ffff)
}

pub(crate) fn set_bk_color_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let colorref = args.dword(system);

    Ok(Answer::Dword(set_bk_color(system, hdc, colorref)))
}

/// The background colour, as it was given: white for a new device context;
/// nought for none.
pub(crate) fn get_bk_color_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let colour = state_of(system, hdc).map_or(0, |state| state.back_color.unwrap_or(0x00ff_ffff));

    Ok(Answer::Dword(colour))
}

/// The text colour set, as it was given, and the colour before answered
/// so: black for a new device context (`bkcolor`). It is also the colour
/// `rotstyle` and `smeargnd` draw white text on a black ground in, through
/// this call. `80000000h` for no device context. A palette's colour is
/// kept as `SetBkColor` keeps one.
pub fn set_text_color(system: &mut System, hdc: u16, colorref: u32) -> u32 {
    let Some(state) = state_of(system, hdc) else {
        return 0x8000_0000;
    };

    state.fore_color = Some(colorref);
    state.text_color.replace(colorref).unwrap_or(0)
}

pub(crate) fn set_text_color_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let colorref = args.dword(system);

    Ok(Answer::Dword(set_text_color(system, hdc, colorref)))
}

/// The text colour, as it was given: black for a new device context;
/// nought for none.
pub(crate) fn get_text_color_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let colour = state_of(system, hdc).map_or(0, |state| state.text_color.unwrap_or(0));

    Ok(Answer::Dword(colour))
}

/// Which of a device context's words a call sets: the field, and what it
/// is until set.
type Field = fn(&mut DcState) -> (&mut Option<u16>, u16);

/// A word of a device context's state set: the one before answered, its
/// default where never set; `none` for no device context.
fn set_word(system: &mut System, args: &mut Args, none: u16, field: Field) -> Answer {
    let hdc = args.word(system);
    let value = args.word(system);
    let Some(state) = state_of(system, hdc) else {
        return Answer::Word(none);
    };
    let (slot, default) = field(state);

    Answer::Word(slot.replace(value).unwrap_or(default))
}

/// A word of a device context's state: its default where never set;
/// nought for no device context.
fn get_word(system: &mut System, args: &mut Args, field: Field) -> Answer {
    let hdc = args.word(system);
    let Some(state) = state_of(system, hdc) else {
        return Answer::Word(0);
    };
    let (slot, default) = field(state);

    Answer::Word(slot.unwrap_or(default))
}

/// The drawing mode: `R2_COPYPEN`, 13, until set.
fn rop2(state: &mut DcState) -> (&mut Option<u16>, u16) {
    (&mut state.rop2, 13)
}

/// The polygon fill mode: `ALTERNATE`, 1, until set.
fn poly_fill_mode(state: &mut DcState) -> (&mut Option<u16>, u16) {
    (&mut state.poly_fill_mode, 1)
}

/// The stretching mode: `BLACKONWHITE`, 1, until set.
fn stretch_mode(state: &mut DcState) -> (&mut Option<u16>, u16) {
    (&mut state.stretch_mode, 1)
}

pub(crate) fn set_rop2_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(set_word(system, args, 0, rop2))
}

pub(crate) fn get_rop2_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(get_word(system, args, rop2))
}

pub(crate) fn set_poly_fill_mode_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(set_word(system, args, 0, poly_fill_mode))
}

pub(crate) fn get_poly_fill_mode_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(get_word(system, args, poly_fill_mode))
}

pub(crate) fn set_stretch_blt_mode_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(set_word(system, args, 0, stretch_mode))
}

pub(crate) fn get_stretch_blt_mode_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(get_word(system, args, stretch_mode))
}

/// Which of a device context's words, always set, a call sets.
type Plain = fn(&mut DcState) -> &mut u16;

/// A word of a device context's state that always has a value set: the
/// one before answered; `none` for no device context.
fn set_plain(system: &mut System, args: &mut Args, none: u16, field: Plain) -> Answer {
    let hdc = args.word(system);
    let value = args.word(system);
    let Some(state) = state_of(system, hdc) else {
        return Answer::Word(none);
    };

    Answer::Word(std::mem::replace(field(state), value))
}

fn get_plain(system: &mut System, args: &mut Args, field: Plain) -> Answer {
    let hdc = args.word(system);

    Answer::Word(state_of(system, hdc).map_or(0, |state| *field(state)))
}

fn back_mode(state: &mut DcState) -> &mut u16 {
    &mut state.back_mode
}

fn text_align(state: &mut DcState) -> &mut u16 {
    &mut state.text_align
}

fn char_extra(state: &mut DcState) -> &mut u16 {
    &mut state.char_extra
}

/// The background mode: `OPAQUE`, 2, for a new device context; nought for
/// no device context.
pub(crate) fn set_bk_mode_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(set_plain(system, args, 0, back_mode))
}

pub(crate) fn get_bk_mode_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(get_plain(system, args, back_mode))
}

/// The text alignment: `TA_LEFT | TA_TOP`, nought, for a new device
/// context; `FFFFh` for no device context.
pub(crate) fn set_text_align_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(set_plain(system, args, 0xffff, text_align))
}

pub(crate) fn get_text_align_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(get_plain(system, args, text_align))
}

/// The gap added after every character: none for a new device context;
/// `8000h` for no device context.
pub(crate) fn set_text_character_extra_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(set_plain(system, args, 0x8000, char_extra))
}

pub(crate) fn get_text_character_extra_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(get_plain(system, args, char_extra))
}

/// The brush origin set, the one before answered, x in the low word;
/// nought for no device context.
pub fn set_brush_org(system: &mut System, hdc: u16, x: i16, y: i16) -> u32 {
    let Some(index) = dc_of(system, hdc) else {
        return 0;
    };
    let (old_x, old_y) = brush_org_of(system, index);

    system.gdi.dcs[index].state.brush_org = Some((x, y));
    pack(i64::from(old_x), i64::from(old_y))
}

pub(crate) fn set_brush_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);

    Ok(Answer::Dword(set_brush_org(system, hdc, x, y)))
}

/// The brush origin, x in the low word; nought for no device context.
pub fn get_brush_org(system: &System, hdc: u16) -> u32 {
    dc_of(system, hdc).map_or(0, |index| {
        let (x, y) = brush_org_of(system, index);

        pack(i64::from(x), i64::from(y))
    })
}

pub(crate) fn get_brush_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    Ok(Answer::Dword(get_brush_org(system, hdc)))
}

/// An Ex form that asks: its plain form's answer put in a `POINT` or
/// `SIZE`, where one is given -- nought, with no device context -- and 1
/// answered (`exfuncs`).
pub(crate) fn asks(system: &mut System, args: &mut Args, plain: fn(&System, u16) -> u32) -> Answer {
    let hdc = args.word(system);
    let far = args.dword(system);
    let value = plain(system, hdc);

    put_dword(system, far, value);
    Answer::Word(1)
}

pub(crate) fn get_brush_org_ex_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(asks(system, args, get_brush_org))
}

/// The current position moved, the one before answered, x in the low word;
/// nought for no device context.
pub fn move_to(system: &mut System, hdc: u16, x: i16, y: i16) -> u32 {
    let Some(state) = state_of(system, hdc) else {
        return 0;
    };
    let (old_x, old_y) = std::mem::replace(&mut state.position, (i32::from(x), i32::from(y)));

    pack(i64::from(old_x), i64::from(old_y))
}

pub(crate) fn move_to_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);

    Ok(Answer::Dword(move_to(system, hdc, x, y)))
}

/// `MoveTo`, answering in a `POINT`, where one is given, and with whether
/// there was a device context. **Recorded** by `brushind`: no device
/// context answers nought and leaves the point as it was.
pub(crate) fn move_to_ex_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);
    let far = args.dword(system);

    if dc_of(system, hdc).is_none() {
        return Ok(Answer::Word(0));
    }

    let before = move_to(system, hdc, x, y);

    put_dword(system, far, before);
    Ok(Answer::Word(1))
}

/// The current position, as `MoveTo` and `LineTo` leave it: x in the low
/// word, y in the high, (0, 0) for a new device context. **Recorded** by
/// `minis2`.
pub fn get_current_position(system: &System, hdc: u16) -> u32 {
    dc_of(system, hdc).map_or(0, |index| {
        let (x, y) = system.gdi.dcs[index].state.position;

        pack(i64::from(x), i64::from(y))
    })
}

pub(crate) fn get_current_position_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let hdc = args.word(system);

    Ok(Answer::Dword(get_current_position(system, hdc)))
}

pub(crate) fn get_current_position_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    Ok(asks(system, args, get_current_position))
}

/// Where a device context's origin is on the screen, the column in the low
/// word: a window's client area's corner, the screen's nought (`queries`).
/// A memory context and the screen's are at nought; a window's comes with
/// windows.
pub(crate) fn get_dc_org_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Dword(0))
}

/// The font mapper's flags set, the ones before answered: nought for a new
/// device context, and for none.
pub(crate) fn set_mapper_flags_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let flags = args.dword(system);
    let Some(index) = dc_of(system, hdc) else {
        return Ok(Answer::Dword(0));
    };

    Ok(Answer::Dword(std::mem::replace(
        &mut system.gdi.dcs[index].mapper_flags,
        flags,
    )))
}

/// The aspect ratio the font mapper keeps to: nothing until
/// `SetMapperFlags` sets bit 1, and then the display's, 96 by 96 on the VGA
/// (`queries`). That it is the display's logical pixels an inch is taken
/// from the documentation; on the VGA they and the recording agree.
fn aspect_ratio_filter(system: &System, index: usize) -> u32 {
    if system.gdi.dcs[index].mapper_flags & 1 == 0 {
        return 0;
    }

    let caps = &system.display.caps;

    pack(
        i64::from(caps.logical_pixels_x),
        i64::from(caps.logical_pixels_y),
    )
}

pub(crate) fn get_aspect_ratio_filter_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let filter = dc_of(system, hdc).map_or(0, |index| aspect_ratio_filter(system, index));

    Ok(Answer::Dword(filter))
}

pub(crate) fn get_aspect_ratio_filter_ex_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let far = args.dword(system);
    let Some(index) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };
    let filter = aspect_ratio_filter(system, index);

    put_dword(system, far, filter);
    Ok(Answer::Word(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gdi::objects::{create_pen, create_solid_brush, delete_object};

    fn stretch(system: &mut System, hdc: u16, mode: u16) {
        let index = dc_of(system, hdc).unwrap();

        system.gdi.dcs[index].state.stretch_mode = Some(mode);
    }

    fn summary(system: &System, hdc: u16) -> (u32, u32, u16) {
        let state = &system.gdi.dcs[dc_of(system, hdc).unwrap()].state;

        (
            state.text_color.unwrap_or(0),
            state.back_color.unwrap_or(0x00ff_ffff),
            state.stretch_mode.unwrap_or(1),
        )
    }

    #[test]
    fn makes_a_memory_context_among_gdis_handles() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);

        // Its handle GDI's; the system font placed at its own as it was made.
        assert_eq!(hdc, 0xc6a);
        assert!(system.handles.resolve(0xafa).is_some());
        assert_eq!(create_solid_brush(&mut system, 0), 0xc66);
        assert_eq!(create_compatible_dc(&mut system, 0x1234), 0);
        assert!(delete_dc(&mut system, hdc));
        assert!(!delete_dc(&mut system, hdc));
        // `gdinum`: a pen a memory context's.
        assert_eq!(create_pen(&mut system, 0, 1, 0), 0xc6a);
    }

    #[test]
    fn answers_what_each_selection_replaced() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);
        let pen = create_pen(&mut system, 0, 1, 0x0000_00ff);
        let brush = create_solid_brush(&mut system, 0x0000_ff00);
        let font = get_stock_object(&mut system, 10);
        let palette = get_stock_object(&mut system, 15);

        // A new context's pen is no object's; its brush the stock white
        // one (`patbrush`); its font the system font.
        assert_eq!(select_object(&mut system, hdc, pen), 1);
        assert_eq!(select_object(&mut system, hdc, brush), 0xac6);
        assert_eq!(select_object(&mut system, hdc, font), 0xafa);
        assert_eq!(select_object(&mut system, hdc, palette), 0);
        assert_eq!(select_object(&mut system, hdc, 0x1234), 0);
        assert_eq!(select_object(&mut system, 0, pen), 0);
        // A stock object is there once asked for.
        assert_eq!(select_object(&mut system, hdc, 0xae2), 0);
        assert_eq!(get_stock_object(&mut system, 7), 0xae2);
        assert_eq!(get_stock_object(&mut system, 4), 0xad6);
        assert_eq!(select_object(&mut system, hdc, 0xae2), pen);
        assert_eq!(select_object(&mut system, hdc, 0xad6), brush);
        assert_eq!(select_object(&mut system, hdc, 0xaee), font);

        // An object deleted while selected is no object's after.
        let other = create_solid_brush(&mut system, 0);

        assert_eq!(select_object(&mut system, hdc, other), 0xad6);
        delete_object(&mut system, other);
        assert_eq!(select_object(&mut system, hdc, brush), 1);
    }

    #[test]
    fn realises_a_brush_where_it_is_first_selected() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);
        let brush = create_solid_brush(&mut system, 0);

        assert_eq!(set_brush_org(&mut system, hdc, 3, -4), 0);
        assert_eq!(get_brush_org(&system, hdc), 0xfffc_0003);
        select_object(&mut system, hdc, brush);
        set_brush_org(&mut system, hdc, 5, 6);
        select_object(&mut system, hdc, brush);

        let Some((_, GdiObject::Brush(realised))) = system.gdi_object_of(brush) else {
            panic!("a brush");
        };

        assert_eq!(realised.realised, Some((3, -4)));
    }

    #[test]
    fn answers_the_colours_as_they_were_given() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);

        // `bkcolor`.
        assert_eq!(set_bk_color(&mut system, hdc, 0x0012_3456), 0x00ff_ffff);
        assert_eq!(set_bk_color(&mut system, hdc, 0x00c0_c0c0), 0x0012_3456);
        assert_eq!(set_bk_color(&mut system, hdc, 0x0200_0080), 0x00c0_c0c0);
        assert_eq!(set_text_color(&mut system, hdc, 0x0012_3456), 0);
        assert_eq!(set_text_color(&mut system, hdc, 0x0200_0080), 0x0012_3456);
        assert_eq!(set_bk_color(&mut system, 0, 0), 0x8000_0000);
        assert_eq!(set_text_color(&mut system, 0x1234, 0), 0x8000_0000);
    }

    #[test]
    fn saves_and_restores_by_level() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);

        // `clipdc`'s levels.
        set_text_color(&mut system, hdc, 0x00ff_0000);
        set_bk_color(&mut system, hdc, 0x0000_00ff);
        stretch(&mut system, hdc, 3);
        assert_eq!(save_dc(&mut system, hdc), 1);
        set_text_color(&mut system, hdc, 0x0000_ff00);
        set_bk_color(&mut system, hdc, 0x00ff_ff00);
        stretch(&mut system, hdc, 2);
        assert_eq!(save_dc(&mut system, hdc), 2);
        set_text_color(&mut system, hdc, 0);
        assert_eq!(save_dc(&mut system, hdc), 3);
        assert_eq!(restore_dc(&mut system, hdc, -1), 3);
        assert_eq!(summary(&system, hdc), (0, 0x00ff_ff00, 2));
        assert_eq!(restore_dc(&mut system, hdc, 1), 1);
        assert_eq!(summary(&system, hdc), (0x00ff_0000, 0x0000_00ff, 3));
        assert_eq!(restore_dc(&mut system, hdc, 1), 0);
        assert_eq!(save_dc(&mut system, hdc), 1);
        assert_eq!(restore_dc(&mut system, hdc, 5), 0);
        assert_eq!(restore_dc(&mut system, hdc, 0), 1);
        assert_eq!(restore_dc(&mut system, hdc, -2), 0);
        assert_eq!(save_dc(&mut system, hdc), 1);
        assert_eq!(save_dc(&mut system, hdc), 2);
        assert_eq!(save_dc(&mut system, hdc), 3);
        assert_eq!(restore_dc(&mut system, hdc, -2), 2);
        assert_eq!(restore_dc(&mut system, hdc, -1), 1);
        assert_eq!(restore_dc(&mut system, hdc, -1), 0);
        assert_eq!(save_dc(&mut system, 0), 0);
    }

    #[test]
    fn keeps_the_current_position() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);

        assert_eq!(get_current_position(&system, hdc), 0);
        assert_eq!(move_to(&mut system, hdc, 7, -8), 0);
        assert_eq!(move_to(&mut system, hdc, 1, 2), 0xfff8_0007);
        assert_eq!(get_current_position(&system, hdc), 0x0002_0001);
        save_dc(&mut system, hdc);
        move_to(&mut system, hdc, 9, 9);
        restore_dc(&mut system, hdc, -1);
        assert_eq!(get_current_position(&system, hdc), 0x0002_0001);
        assert_eq!(move_to(&mut system, 0, 1, 1), 0);
    }

    #[test]
    fn gives_the_screens_one_context_a_handle_each_time() {
        let mut system = System::new();
        let first = create_dc(&mut system, b"DISPLAY").unwrap();
        let second = create_dc(&mut system, b"display").unwrap();

        assert_eq!((first, second), (0x9002, 0x9006));
        set_bk_color(&mut system, first, 0x0012_3456);
        assert_eq!(set_bk_color(&mut system, second, 0), 0x0012_3456);
        assert!(create_dc(&mut system, b"EPSON").is_err());
        assert!(create_dc(&mut system, b"").is_err());
        assert!(create_dc(&mut system, b"wbprint.drv").is_err());
        assert!(delete_dc(&mut system, first));
        assert_eq!(dc_of(&system, second), system.gdi.screen);
        assert_eq!(select_object(&mut system, second, 0xafa), 0xafa);
    }
}
