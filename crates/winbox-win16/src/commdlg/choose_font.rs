//! COMMDLG's Font dialog: `ChooseFont` (15), its procedure
//! `FormatCharDlgProc` (16), and the two procedures it gives GDI's
//! `EnumFontFamilies`, `FontStyleEnumProc` (18) and `FontFamilyEnumProc`
//! (19). **Read out** of `COMMDLG.DLL` seg4 and **recorded** by `chfont`
//! and `chfont2`; each step is COMMDLG's, at the address the comments give
//! ([[topic:choose-font]] in the knowledge base), and each call into
//! USER, GDI and KERNEL is made as COMMDLG makes it (`guest_calls.rs`).
//! As `src/win16/commdlg/choose-font.ts`.
//!
//! Where COMMDLG runs on Windows 3.0 (`[0CAEh]` below 30Ah) it takes other
//! ways -- `EnumFonts` for `EnumFontFamilies`, a private notification
//! 5F4h, lists invalidated after they fill; WinBox is Windows 3.10, and
//! only the 3.10 ways are followed.

use std::collections::HashMap;

use super::guest_calls::{self as support, A, Call, api, call, rect_bytes, rect_of};
use super::templates::{FONT_BITMAP, FONT_COLOURS, FONT_TEMPLATE};
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;

type Rect = [i16; 4];

const WM_SETREDRAW: u16 = 0x000b;
const WM_PAINT: u16 = 0x000f;
const WM_SYSCOLORCHANGE: u16 = 0x0015;
const WM_NEXTDLGCTL: u16 = 0x0028;
const WM_DRAWITEM: u16 = 0x002b;
const WM_MEASUREITEM: u16 = 0x002c;
const WM_GETFONT: u16 = 0x0031;
const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;
/// `WM_CHOOSEFONT_GETLOGFONT`, `WM_USER + 1`.
const WM_CHOOSEFONT_GETLOGFONT: u16 = 0x0401;

const CB_LIMITTEXT: u16 = 0x0401;
const CB_SETEDITSEL: u16 = 0x0402;
const CB_ADDSTRING: u16 = 0x0403;
const CB_DELETESTRING: u16 = 0x0404;
const CB_GETCOUNT: u16 = 0x0406;
const CB_GETCURSEL: u16 = 0x0407;
const CB_GETLBTEXT: u16 = 0x0408;
const CB_INSERTSTRING: u16 = 0x040a;
const CB_RESETCONTENT: u16 = 0x040b;
const CB_SETCURSEL: u16 = 0x040e;
const CB_GETITEMDATA: u16 = 0x0410;
const CB_SETITEMDATA: u16 = 0x0411;
const CB_SETITEMHEIGHT: u16 = 0x0413;
const CB_GETITEMHEIGHT: u16 = 0x0414;

const CBN_SELCHANGE: u16 = 1;
const CBN_KILLFOCUS: u16 = 4;
const CBN_EDITUPDATE: u16 = 6;
/// COMMDLG's own notification, posted for a name typed: chosen where it is
/// listed whole (`0ece`, `0f6a`).
const TYPED: u16 = 0x05f5;

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const IDABORT: u16 = 3;
const PSH_APPLY: u16 = 0x0402;
const PSH_HELP: u16 = 0x040e;
const CHX_STRIKEOUT: u16 = 0x0410;
const CHX_UNDERLINE: u16 = 0x0411;
const GRP_EFFECTS: u16 = 0x0430;
const STC_COLOR: u16 = 0x0443;
const STC_SAMPLE: u16 = 0x0444;
const STC_DESCRIPTION: u16 = 0x0445;
const CMB_FACES: u16 = 0x0470;
const CMB_STYLES: u16 = 0x0471;
const CMB_SIZES: u16 = 0x0472;
const CMB_COLORS: u16 = 0x0473;

const CF_SCREENFONTS: u32 = 0x0000_0001;
const CF_PRINTERFONTS: u32 = 0x0000_0002;
const CF_SHOWHELP: u32 = 0x0000_0004;
const CF_ENABLEHOOK: u32 = 0x0000_0008;
const CF_ENABLETEMPLATE: u32 = 0x0000_0010;
const CF_ENABLETEMPLATEHANDLE: u32 = 0x0000_0020;
const CF_INITTOLOGFONTSTRUCT: u32 = 0x0000_0040;
const CF_USESTYLE: u32 = 0x0000_0080;
const CF_EFFECTS: u32 = 0x0000_0100;
const CF_APPLY: u32 = 0x0000_0200;
const CF_ANSIONLY: u32 = 0x0000_0400;
const CF_NOVECTORFONTS: u32 = 0x0000_0800;
const CF_NOSIMULATIONS: u32 = 0x0000_1000;
const CF_LIMITSIZE: u32 = 0x0000_2000;
const CF_FIXEDPITCHONLY: u32 = 0x0000_4000;
const CF_WYSIWYG: u32 = 0x0000_8000;
const CF_FORCEFONTEXIST: u32 = 0x0001_0000;
const CF_SCALABLEONLY: u32 = 0x0002_0000;
const CF_TTONLY: u32 = 0x0004_0000;
const CF_NOFACESEL: u32 = 0x0008_0000;
const CF_NOSTYLESEL: u32 = 0x0010_0000;
const CF_NOSIZESEL: u32 = 0x0020_0000;

const RASTER_FONTTYPE: u16 = 0x0001;
const TRUETYPE_FONTTYPE: u16 = 0x0004;
const BOLD_FONTTYPE: u16 = 0x0100;
const ITALIC_FONTTYPE: u16 = 0x0200;
const REGULAR_FONTTYPE: u16 = 0x0400;
const SCREEN_FONTTYPE: u16 = 0x2000;
const PRINTER_FONTTYPE: u16 = 0x4000;
const SIMULATED_FONTTYPE: u16 = 0x8000;
/// A device face of the printer's: `PRINTER_FONTTYPE` and
/// `DEVICE_FONTTYPE` (`2030`, `260b`).
const PRINTER_DEVICE: u16 = 0x4002;

const CDERR_STRUCTSIZE: u32 = 0x0001;
const CDERR_FINDRESFAILURE: u32 = 0x0006;
const CDERR_LOADRESFAILURE: u32 = 0x0007;
const CDERR_NOHOOK: u32 = 0x000b;
const CDERR_DIALOGFAILURE: u32 = 0xffff;
const CFERR_NOFONTS: u32 = 0x2001;
const CFERR_MAXLESSTHANMIN: u32 = 0x2002;

const COLOR_HIGHLIGHT: u16 = 0x0d;
const COLOR_HIGHLIGHTTEXT: u16 = 0x0e;
const COLOR_WINDOW: u16 = 0x05;
const COLOR_WINDOWTEXT: u16 = 0x08;
const SM_CXBORDER: u16 = 5;
const SM_CYBORDER: u16 = 6;
const LOGPIXELSY: u16 = 90;
const ETO_OPAQUE: u16 = 0x0002;
const ETO_CLIPPED: u16 = 0x0004;
const SRCCOPY: u32 = 0x00cc_0020;
const MB_ICONINFORMATION: u16 = 0x0040;
const RT_DIALOG: u32 = 5;
const IDC_ARROW: u32 = 0x7f00;
const IDC_WAIT: u32 = 0x7f02;
const MM_TEXT: u16 = 1;
const MM_ISOTROPIC: u16 = 7;
const MM_ANISOTROPIC: u16 = 8;
/// `EnumFontFamilies`, GDI's ordinal 330, found by `GetProcAddress`
/// (`1250`).
const ENUM_FONT_FAMILIES: u32 = 330;
/// What `LoadString` is given for a style's name, and for a colour's.
const STYLE_NAME_SIZE: usize = 0x20;
const COLOUR_NAME_SIZE: usize = 0x10;

/// The ordinals COMMDLG hands out.
const FORMAT_CHAR_DLG_PROC: u16 = 16;
const FONT_STYLE_ENUM_PROC: u16 = 18;
const FONT_FAMILY_ENUM_PROC: u16 = 19;

// CHOOSEFONT's fields.
const LSTRUCTSIZE: u32 = 0x00;
const HWND_OWNER: u32 = 0x04;
const HDC: u32 = 0x06;
const LP_LOGFONT: u32 = 0x08;
const I_POINT_SIZE: u32 = 0x0c;
const FLAGS: u32 = 0x0e;
const RGB_COLORS: u32 = 0x12;
const HOOK: u32 = 0x1a;
const TEMPLATE_NAME: u32 = 0x1e;
const H_INSTANCE: u32 = 0x22;
const LPSZ_STYLE: u32 = 0x24;
const N_FONT_TYPE: u32 = 0x28;
const N_SIZE_MIN: u32 = 0x2a;
const N_SIZE_MAX: u32 = 0x2c;

// LOGFONT's.
const LF_HEIGHT: u32 = 0x00;
const LF_WEIGHT: u32 = 0x08;
const LF_ITALIC: u32 = 0x0a;
const LF_UNDERLINE: u32 = 0x0b;
const LF_STRIKEOUT: u32 = 0x0c;
const LF_CHARSET: u32 = 0x0d;
const LF_PITCH_AND_FAMILY: u32 = 0x11;
const LF_FACENAME: u32 = 0x12;
const LOGFONT_SIZE: usize = 0x32;
const FW_NORMAL: u16 = 400;
const FW_BOLD: u16 = 700;

/// The standard sizes listed for a font that is not raster (`1745`).
const STANDARD_SIZES: [i16; 16] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/// What COMMDLG keeps for its Font dialogs in its data.
#[derive(Debug, Default, Clone)]
pub(crate) struct FontGlobals {
    /// `[17Ah]`: the hook, kept while the dialog is made.
    hook: u32,
    /// `[170h]`: the pictures of the faces' types, made once from bitmap 38.
    bitmap: u16,
    /// `[0A86h]`: the sample's rectangle, client coordinates.
    sample: Rect,
    /// `[0A82h]`: the style's type the description was last given for.
    described: u16,
    /// Each dialog's structure, by the number under its property A000h
    /// (the four bytes of local memory COMMDLG puts there, `0428`).
    dialogs: HashMap<u16, u32>,
    /// Each style's copy of its `LOGFONT`, 50 bytes COMMDLG keeps in its
    /// local memory, by the number its row's data holds in its low word
    /// (`157a`).
    styles: HashMap<u16, Vec<u8>>,
    /// The last such number given.
    next_style: u16,
}

fn globals(engine: &Engine) -> std::cell::RefMut<'_, FontGlobals> {
    std::cell::RefMut::map(engine.system(), |system| &mut system.commdlg.font)
}

fn at(far: u32, step: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(step) & 0xffff)
}

fn bytes(engine: &Engine, far: u32, step: u32, length: usize) -> Vec<u8> {
    engine.system().read_far(at(far, step), length)
}

fn byte(engine: &Engine, far: u32, step: u32) -> u8 {
    bytes(engine, far, step, 1)[0]
}

fn word(engine: &Engine, far: u32, step: u32) -> u16 {
    let b = bytes(engine, far, step, 2);

    u16::from_le_bytes([b[0], b[1]])
}

fn dword(engine: &Engine, far: u32, step: u32) -> u32 {
    let b = bytes(engine, far, step, 4);

    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

fn put(engine: &Engine, far: u32, step: u32, value: &[u8]) {
    engine.system().write_far(at(far, step), value);
}

fn put_word(engine: &Engine, far: u32, step: u32, value: u16) {
    put(engine, far, step, &value.to_le_bytes());
}

fn put_dword(engine: &Engine, far: u32, step: u32, value: u32) {
    put(engine, far, step, &value.to_le_bytes());
}

fn flags(engine: &Engine, lpcf: u32) -> u32 {
    dword(engine, lpcf, FLAGS)
}

/// A flag of the program's `Flags` set or cleared.
fn set_flag(engine: &Engine, lpcf: u32, flag: u32, on: bool) {
    let value = flags(engine, lpcf);

    put_dword(
        engine,
        lpcf,
        FLAGS,
        if on { value | flag } else { value & !flag },
    );
}

/// One of COMMDLG's strings, as `LoadString` gives it into a buffer of
/// `size` bytes.
fn string(id: u16, size: usize) -> Vec<u8> {
    let mut text = support::string(id).unwrap_or_default();

    text.truncate(size.saturating_sub(1));
    text
}

/// A string with its `%d`s filled, as `wsprintf` fills them.
fn format(text: &[u8], numbers: &[i16]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut next = numbers.iter();
    let mut at = 0;

    while at < text.len() {
        if text[at] == b'%' && text.get(at + 1) == Some(&b'd') {
            out.extend(next.next().copied().unwrap_or(0).to_string().bytes());
            at += 2;
        } else {
            out.push(text[at]);
            at += 1;
        }
    }

    out
}

fn text_arg(text: &[u8]) -> Vec<u8> {
    let mut bytes = text.to_vec();

    bytes.push(0);
    bytes
}

fn until_nought(bytes: &[u8]) -> Vec<u8> {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());

    bytes[..end].to_vec()
}

async fn item(engine: &Engine, dialog: u16, id: u16) -> Result<u16, Stop> {
    Ok(api(engine, "USER", "GetDlgItem", &[A::W(dialog), A::W(id)]).await? as u16)
}

async fn send(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    api(
        engine,
        "USER",
        "SendMessage",
        &[A::W(hwnd), A::W(message), A::W(wparam), A::D(lparam)],
    )
    .await
}

/// `SendMessage` with bytes of COMMDLG's for `lParam`: its answer and the
/// bytes as they were left.
async fn send_bytes(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    bytes: Vec<u8>,
) -> Result<(u32, Vec<u8>), Stop> {
    let (answer, mut structs) = call(
        engine,
        Call {
            module: "USER",
            name: "SendMessage",
            args: &[A::W(hwnd), A::W(message), A::W(wparam), A::S(0)],
            structs: vec![bytes],
        },
    )
    .await?;

    Ok((answer, structs.remove(0)))
}

async fn send_item(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    api(
        engine,
        "USER",
        "SendDlgItemMessage",
        &[
            A::W(dialog),
            A::W(id),
            A::W(message),
            A::W(wparam),
            A::D(lparam),
        ],
    )
    .await
}

async fn send_item_bytes(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    bytes: Vec<u8>,
) -> Result<u32, Stop> {
    Ok(call(
        engine,
        Call {
            module: "USER",
            name: "SendDlgItemMessage",
            args: &[A::W(dialog), A::W(id), A::W(message), A::W(wparam), A::S(0)],
            structs: vec![bytes],
        },
    )
    .await?
    .0)
}

/// A call with one string of COMMDLG's, given where `A::S(0)` stands.
async fn with_text(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    args: &[A],
    text: &[u8],
) -> Result<u32, Stop> {
    Ok(call(
        engine,
        Call {
            module,
            name,
            args,
            structs: vec![text_arg(text)],
        },
    )
    .await?
    .0)
}

/// A call that fills a buffer of `size` bytes, given where `A::S(0)`
/// stands: its answer and the buffer's string.
async fn into_buffer(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    args: &[A],
    size: usize,
) -> Result<(u32, Vec<u8>), Stop> {
    let (answer, structs) = call(
        engine,
        Call {
            module,
            name,
            args,
            structs: vec![vec![0; size]],
        },
    )
    .await?;

    Ok((answer, until_nought(&structs[0])))
}

async fn get_dc(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    Ok(api(engine, "USER", "GetDC", &[A::W(hwnd)]).await? as u16)
}

async fn release_dc(engine: &Engine, hwnd: u16, hdc: u16) -> Result<(), Stop> {
    api(engine, "USER", "ReleaseDC", &[A::W(hwnd), A::W(hdc)]).await?;
    Ok(())
}

async fn device_caps(engine: &Engine, hdc: u16, index: u16) -> Result<i16, Stop> {
    Ok(api(engine, "GDI", "GetDeviceCaps", &[A::W(hdc), A::W(index)]).await? as i16)
}

async fn mul_div(engine: &Engine, a: i16, b: i16, c: i16) -> Result<i16, Stop> {
    Ok(api(
        engine,
        "GDI",
        "MulDiv",
        &[A::W(a as u16), A::W(b as u16), A::W(c as u16)],
    )
    .await? as i16)
}

async fn sys_colour(engine: &Engine, index: u16) -> Result<u32, Stop> {
    api(engine, "USER", "GetSysColor", &[A::W(index)]).await
}

async fn set_bk_colour(engine: &Engine, hdc: u16, colour: u32) -> Result<u32, Stop> {
    api(engine, "GDI", "SetBkColor", &[A::W(hdc), A::D(colour)]).await
}

async fn set_text_colour(engine: &Engine, hdc: u16, colour: u32) -> Result<u32, Stop> {
    api(engine, "GDI", "SetTextColor", &[A::W(hdc), A::D(colour)]).await
}

async fn select(engine: &Engine, hdc: u16, object: u16) -> Result<u16, Stop> {
    Ok(api(engine, "GDI", "SelectObject", &[A::W(hdc), A::W(object)]).await? as u16)
}

async fn delete_object(engine: &Engine, object: u16) -> Result<(), Stop> {
    api(engine, "GDI", "DeleteObject", &[A::W(object)]).await?;
    Ok(())
}

async fn metric(engine: &Engine, index: u16) -> Result<i16, Stop> {
    Ok(api(engine, "USER", "GetSystemMetrics", &[A::W(index)]).await? as i16)
}

/// `GetTextMetrics`: the structure's 31 bytes.
async fn text_metrics(engine: &Engine, hdc: u16) -> Result<Vec<u8>, Stop> {
    let (_, structs) = call(
        engine,
        Call {
            module: "GDI",
            name: "GetTextMetrics",
            args: &[A::W(hdc), A::S(0)],
            structs: vec![vec![0; 0x1f]],
        },
    )
    .await?;

    Ok(structs[0].clone())
}

/// `ExtTextOut` with a rectangle and text of COMMDLG's, no widths.
async fn ext_text_out(
    engine: &Engine,
    hdc: u16,
    x: i16,
    y: i16,
    options: u16,
    rect: Rect,
    text: Option<&[u8]>,
) -> Result<(), Stop> {
    let mut structs = vec![rect_bytes(rect)];
    let string = match text {
        Some(text) => {
            structs.push(text_arg(text));
            A::S(1)
        }
        None => A::D(0),
    };

    call(
        engine,
        Call {
            module: "GDI",
            name: "ExtTextOut",
            args: &[
                A::W(hdc),
                A::W(x as u16),
                A::W(y as u16),
                A::W(options),
                A::S(0),
                string,
                A::W(text.map_or(0, |text| text.len() as u16)),
                A::D(0),
            ],
            structs,
        },
    )
    .await?;
    Ok(())
}

/// A control hidden and disabled (`0229`): `EnableWindow`, then
/// `ShowWindow`.
async fn hide(engine: &Engine, dialog: u16, id: u16) -> Result<(), Stop> {
    let control = item(engine, dialog, id).await?;

    api(engine, "USER", "EnableWindow", &[A::W(control), A::W(0)]).await?;

    let control = item(engine, dialog, id).await?;

    api(engine, "USER", "ShowWindow", &[A::W(control), A::W(0)]).await?;
    Ok(())
}

fn lf_word(lf: &[u8], at: u32) -> u16 {
    u16::from_le_bytes([lf[at as usize], lf[at as usize + 1]])
}

/// A style's copy of its `LOGFONT`, by the low word of its row's data.
fn style_font(engine: &Engine, handle: u16) -> Vec<u8> {
    globals(engine)
        .styles
        .get(&handle)
        .cloned()
        .unwrap_or_else(|| vec![0; LOGFONT_SIZE])
}

// ---------------------------------------------------------------------
// The lists' small helpers.

/// The row whose text is `text`, by `lstrcmpi`, or -1 (`0a18`).
async fn find_exact(engine: &Engine, combo: u16, text: &[u8]) -> Result<i16, Stop> {
    let count = send(engine, combo, CB_GETCOUNT, 0, 0).await? as i16;

    for index in 0..count.max(0) {
        let (_, row) = send_bytes(engine, combo, CB_GETLBTEXT, index as u16, vec![0; 0x24]).await?;
        let row = until_nought(&row);
        let compared = call(
            engine,
            Call {
                module: "USER",
                name: "lstrcmpi",
                args: &[A::S(0), A::S(1)],
                structs: vec![text_arg(&row), text_arg(text)],
            },
        )
        .await?
        .0 as u16;

        if compared == 0 {
            return Ok(index);
        }
    }

    Ok(-1)
}

/// The row whose text is `text` chosen, where there is one (`0995`).
async fn choose_exact(engine: &Engine, combo: u16, text: &[u8]) -> Result<i16, Stop> {
    let index = find_exact(engine, combo, text).await?;

    if index >= 0 {
        send(engine, combo, CB_SETCURSEL, index as u16, 0).await?;
    }

    Ok(index)
}

/// The row chosen's text put in the box (`094f`): the row, or -1.
async fn selection_to_box(engine: &Engine, combo: u16) -> Result<i16, Stop> {
    let index = send(engine, combo, CB_GETCURSEL, 0, 0).await? as i16;

    if index >= 0 {
        let (_, text) =
            send_bytes(engine, combo, CB_GETLBTEXT, index as u16, vec![0; 0x20]).await?;

        with_text(
            engine,
            "USER",
            "SetWindowText",
            &[A::W(combo), A::S(0)],
            &until_nought(&text),
        )
        .await?;
    }

    Ok(index)
}

/// The box's text, at most `size` bytes, and the row it names whole with
/// that row's data (`09c8`).
async fn box_row(engine: &Engine, combo: u16, size: usize) -> Result<(Vec<u8>, i16, u32), Stop> {
    let (_, text) = into_buffer(
        engine,
        "USER",
        "GetWindowText",
        &[A::W(combo), A::S(0), A::W(size as u16)],
        size,
    )
    .await?;
    let index = find_exact(engine, combo, &text).await?;
    let data = if index >= 0 {
        send(engine, combo, CB_GETITEMDATA, index as u16, 0).await?
    } else {
        0
    };

    Ok((text, index, data))
}

/// The style nearest a `LOGFONT`'s weight chosen (`088c`): first among
/// those of its italic, then, where that found only the first row, among
/// all, the best difference carried over.
async fn nearest_style(engine: &Engine, combo: u16, lf: u32) -> Result<(), Stop> {
    let mut best: i16 = 1000;
    let count = send(engine, combo, CB_GETCOUNT, 0, 0).await? as i16;
    let mut chosen: i16 = 0;
    let mut all = false;
    let weight = word(engine, lf, LF_WEIGHT) as i16;
    let italic = byte(engine, lf, LF_ITALIC) != 0;

    loop {
        for index in 0..count.max(0) {
            let handle = send(engine, combo, CB_GETITEMDATA, index as u16, 0).await? as u16;
            let style = style_font(engine, handle);
            let theirs = style[LF_ITALIC as usize] != 0;

            if !all && theirs != italic {
                continue;
            }

            let difference = weight
                .wrapping_sub(lf_word(&style, LF_WEIGHT) as i16)
                .wrapping_abs();

            if best > difference {
                best = difference;
                chosen = index;
            }
        }

        if all || chosen != 0 {
            break;
        }

        all = true;
    }

    send(engine, combo, CB_SETCURSEL, chosen as u16, 0).await?;
    Ok(())
}

/// A style chosen for the program's `LOGFONT` (`016d`): with
/// `CF_USESTYLE` as the dialog starts, the one `lpszStyle` names, its
/// weight and italic written into the `LOGFONT`, or weight 400 and not
/// italic where none has that name; else the nearest. Nothing with
/// `CF_NOSTYLESEL`.
async fn choose_style(engine: &Engine, hwnd: u16, lpcf: u32, starting: bool) -> Result<(), Stop> {
    let flags = flags(engine, lpcf);

    if flags & CF_NOSTYLESEL != 0 {
        return Ok(());
    }

    let styles = item(engine, hwnd, CMB_STYLES).await?;
    let lf = dword(engine, lpcf, LP_LOGFONT);

    if starting && flags & CF_USESTYLE != 0 {
        let style = dword(engine, lpcf, LPSZ_STYLE);
        let name = engine.system().read_string(style);
        let index = choose_exact(engine, styles, &name).await?;

        if index >= 0 {
            let handle =
                send_item(engine, hwnd, CMB_STYLES, CB_GETITEMDATA, index as u16, 0).await? as u16;
            let style = style_font(engine, handle);

            put_word(engine, lf, LF_WEIGHT, lf_word(&style, LF_WEIGHT));
            put(engine, lf, LF_ITALIC, &[style[LF_ITALIC as usize]]);
        } else {
            put_word(engine, lf, LF_WEIGHT, FW_NORMAL);
            put(engine, lf, LF_ITALIC, &[0]);
        }
    } else {
        nearest_style(engine, styles, lf).await?;
    }

    let styles = item(engine, hwnd, CMB_STYLES).await?;

    selection_to_box(engine, styles).await?;
    Ok(())
}

/// The default `LOGFONT` written to the program's (`1a2a`).
async fn default_font(engine: &Engine, lf: u32) -> Result<(), Stop> {
    let mut bytes = bytes(engine, lf, 0, LOGFONT_SIZE);

    default_logfont_bytes(engine, &mut bytes).await?;
    put(engine, lf, 0, &bytes);
    Ok(())
}

/// A size in points on a device, from a height in its pixels, and its
/// text (`267c`).
async fn points(engine: &Engine, hdc: u16, height: i16) -> Result<(i16, Vec<u8>), Stop> {
    let pixels = device_caps(engine, hdc, LOGPIXELSY).await?;
    let size = mul_div(engine, height.wrapping_abs(), 72, pixels).await?;

    Ok((size, size.to_string().into_bytes()))
}

/// A size added to the sizes' list in order by its number, once, and with
/// `CF_LIMITSIZE` only within the limits (`1400`).
async fn add_size(engine: &Engine, lpcf: u32, size: i16, sizes: u16) -> Result<(), Stop> {
    if flags(engine, lpcf) & CF_LIMITSIZE != 0
        && (size > word(engine, lpcf, N_SIZE_MAX) as i16
            || size < word(engine, lpcf, N_SIZE_MIN) as i16)
    {
        return Ok(());
    }

    let text = size.to_string().into_bytes();
    let count = send(engine, sizes, CB_GETCOUNT, 0, 0).await? as i16;
    let mut last: i16 = -1;
    let mut index: i16 = 0;

    while index < count {
        last = send(engine, sizes, CB_GETITEMDATA, index as u16, 0).await? as i16;

        if last >= size {
            break;
        }

        index += 1;
    }

    if last == size {
        return Ok(());
    }

    let at = send_bytes(
        engine,
        sizes,
        CB_INSERTSTRING,
        index as u16,
        text_arg(&text),
    )
    .await?
    .0 as i16;

    if at >= 0 {
        send(
            engine,
            sizes,
            CB_SETITEMDATA,
            at as u16,
            u32::from(size as u16),
        )
        .await?;
    }

    Ok(())
}

/// The sixteen standard sizes (`1745`).
async fn standard_sizes(engine: &Engine, lpcf: u32, sizes: u16) -> Result<(), Stop> {
    for size in STANDARD_SIZES {
        add_size(engine, lpcf, size, sizes).await?;
    }

    Ok(())
}

/// A style's name inserted by its weight, an italic after the upright of
/// its weight (`14bb`): its row, or below nought.
async fn insert_style(engine: &Engine, combo: u16, name: &[u8], lf: &[u8]) -> Result<i16, Stop> {
    let count = send(engine, combo, CB_GETCOUNT, 0, 0).await? as i16;
    let weight = lf_word(lf, LF_WEIGHT) as i16;
    let italic = lf[LF_ITALIC as usize] != 0;
    let mut index: i16 = 0;

    while index < count {
        let handle = send(engine, combo, CB_GETITEMDATA, index as u16, 0).await? as u16;
        let theirs = style_font(engine, handle);
        let their_weight = lf_word(&theirs, LF_WEIGHT) as i16;

        if their_weight > weight {
            break;
        }

        if their_weight == weight {
            if italic && theirs[LF_ITALIC as usize] == 0 {
                index += 1;
            }

            break;
        }

        index += 1;
    }

    Ok(
        send_bytes(engine, combo, CB_INSERTSTRING, index as u16, text_arg(name))
            .await?
            .0 as i16,
    )
}

/// A style added where its name is not listed (`153e`): its copy of its
/// `LOGFONT` kept, the row's data that copy's number and its type.
async fn add_style(
    engine: &Engine,
    combo: u16,
    name: &[u8],
    kind: u16,
    lf: &[u8],
) -> Result<(), Stop> {
    if find_exact(engine, combo, name).await? >= 0 {
        return Ok(());
    }

    let index = insert_style(engine, combo, name, lf).await?;

    if index < 0 {
        return Ok(());
    }

    let handle = {
        let mut state = globals(engine);

        state.next_style = state.next_style.wrapping_add(1).max(1);

        while state.styles.contains_key(&state.next_style) {
            state.next_style = state.next_style.wrapping_add(1).max(1);
        }

        let handle = state.next_style;

        state.styles.insert(handle, lf[..LOGFONT_SIZE].to_vec());
        handle
    };

    send(
        engine,
        combo,
        CB_SETITEMDATA,
        index as u16,
        u32::from(kind) << 16 | u32::from(handle),
    )
    .await?;
    Ok(())
}

/// The styles a face lacks made from those it has (`15ce`), each typed
/// with the last listed style's type, `SIMULATED_FONTTYPE` and its own
/// bits.
async fn simulate(engine: &Engine, combo: u16) -> Result<(), Stop> {
    let count = send(engine, combo, CB_GETCOUNT, 0, 0).await? as i16;
    let mut italic_of = 0;
    let mut bold_of = 0;
    let mut regular_of = 0;
    let mut bold_italic = false;
    let mut italic = false;
    let mut bold = false;
    let mut kind: u16 = 0;

    for index in 0..count.max(0) {
        let data = send(engine, combo, CB_GETITEMDATA, index as u16, 0).await?;
        let handle = data as u16;

        kind = (data >> 16) as u16;

        if kind & BOLD_FONTTYPE != 0 && kind & ITALIC_FONTTYPE != 0 {
            bold_italic = true;
        } else if kind & BOLD_FONTTYPE != 0 {
            bold = true;
            bold_of = handle;
        } else if kind & ITALIC_FONTTYPE != 0 {
            italic = true;
            italic_of = handle;
        } else {
            regular_of = handle;
        }
    }

    kind |= SIMULATED_FONTTYPE;

    if !bold && regular_of != 0 {
        let mut lf = style_font(engine, regular_of);

        lf[LF_WEIGHT as usize..LF_WEIGHT as usize + 2].copy_from_slice(&FW_BOLD.to_le_bytes());
        add_style(
            engine,
            combo,
            &string(0x505, STYLE_NAME_SIZE),
            kind | BOLD_FONTTYPE,
            &lf,
        )
        .await?;
    }

    if !italic && regular_of != 0 {
        let mut lf = style_font(engine, regular_of);

        lf[LF_ITALIC as usize] = 1;
        add_style(
            engine,
            combo,
            &string(0x506, STYLE_NAME_SIZE),
            kind | ITALIC_FONTTYPE,
            &lf,
        )
        .await?;
    }

    if !bold_italic && (bold_of != 0 || italic_of != 0 || regular_of != 0) {
        let from = if italic_of != 0 {
            italic_of
        } else if bold_of != 0 {
            bold_of
        } else {
            regular_of
        };
        let mut lf = style_font(engine, from);

        lf[LF_ITALIC as usize] = 1;
        lf[LF_WEIGHT as usize..LF_WEIGHT as usize + 2].copy_from_slice(&FW_BOLD.to_le_bytes());
        add_style(
            engine,
            combo,
            &string(0x507, STYLE_NAME_SIZE),
            kind | BOLD_FONTTYPE | ITALIC_FONTTYPE,
            &lf,
        )
        .await?;
    }

    Ok(())
}

/// The styles' copies let go and the list emptied (`19d0`).
async fn free_styles(engine: &Engine, combo: u16) -> Result<(), Stop> {
    let count = send(engine, combo, CB_GETCOUNT, 0, 0).await? as i16;

    for index in 0..count.max(0) {
        let handle = send(engine, combo, CB_GETITEMDATA, index as u16, 0).await? as u16;

        globals(engine).styles.remove(&handle);
    }

    send(engine, combo, CB_RESETCONTENT, 0, 0).await?;
    Ok(())
}

/// `EnumFontFamilies` found as COMMDLG finds it: `GetModuleHandle("GDI")`
/// and `GetProcAddress` of its ordinal (`122d`, `1ab0`). Whether it is.
async fn enumeration_found(engine: &Engine) -> Result<bool, Stop> {
    let gdi = with_text(engine, "KERNEL", "GetModuleHandle", &[A::S(0)], b"GDI").await? as u16;

    Ok(api(
        engine,
        "KERNEL",
        "GetProcAddress",
        &[A::W(gdi), A::D(ENUM_FONT_FAMILIES)],
    )
    .await?
        != 0)
}

/// `EnumFontFamilies` with a face, or none, an export of COMMDLG's and the
/// data it is given, laid out as COMMDLG's stack holds it.
async fn enumerate(
    engine: &Engine,
    hdc: u16,
    face: Option<&[u8]>,
    ordinal: u16,
    data: Vec<u8>,
) -> Result<(), Stop> {
    let proc = support::export_address(engine, ordinal);
    let mut structs = vec![data];
    let face_arg = match face {
        Some(face) => {
            structs.push(text_arg(face));
            A::S(1)
        }
        None => A::D(0),
    };

    call(
        engine,
        Call {
            module: "GDI",
            name: "EnumFontFamilies",
            args: &[A::W(hdc), face_arg, A::D(proc), A::S(0)],
            structs,
        },
    )
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------
// The faces (`1226`) and FontFamilyEnumProc (`1096`).

/// The faces listed (`1226`): whether any are.
async fn list_faces(engine: &Engine, hwnd: u16, printer: u16, flags: u32) -> Result<bool, Stop> {
    if !enumeration_found(engine).await? {
        return Ok(false);
    }

    let faces = item(engine, hwnd, CMB_FACES).await?;
    let data = |hdc: u16, printer_pass: u16| {
        let mut data = vec![0; 0x16];

        data[0..2].copy_from_slice(&faces.to_le_bytes());
        data[6..8].copy_from_slice(&hdc.to_le_bytes());
        data[8..12].copy_from_slice(&flags.to_le_bytes());
        data[0x10..0x12].copy_from_slice(&printer_pass.to_le_bytes());
        data
    };
    let screen = get_dc(engine, 0).await?;

    enumerate(engine, screen, None, FONT_FAMILY_ENUM_PROC, data(screen, 0)).await?;
    release_dc(engine, 0, screen).await?;

    if flags & CF_PRINTERFONTS != 0 {
        enumerate(
            engine,
            printer,
            None,
            FONT_FAMILY_ENUM_PROC,
            data(printer, 1),
        )
        .await?;
    }

    // Faces only the screen has, without CF_SCREENFONTS (`12e0`); with
    // CF_WYSIWYG, faces not both the screen's and the printer's (`133d`).
    for (wanted, keep) in [
        (flags & CF_SCREENFONTS == 0, SCREEN_FONTTYPE),
        (flags & CF_WYSIWYG != 0, SCREEN_FONTTYPE | PRINTER_FONTTYPE),
    ] {
        if !wanted {
            continue;
        }

        let count = send(engine, faces, CB_GETCOUNT, 0, 0).await? as i16;

        for index in (0..count.max(0)).rev() {
            let kind = send(engine, faces, CB_GETITEMDATA, index as u16, 0).await? as u16;
            let bits = kind & (SCREEN_FONTTYPE | PRINTER_FONTTYPE);
            let gone = if keep == SCREEN_FONTTYPE {
                bits == SCREEN_FONTTYPE
            } else {
                bits != keep
            };

            if gone {
                send(engine, faces, CB_DELETESTRING, index as u16, 0).await?;
            }
        }
    }

    if send(engine, faces, CB_GETCOUNT, 0, 0).await? as i16 > 0 {
        return Ok(true);
    }

    let caption = string(0x500, 0x28);
    let text = string(0x501, 0x64);

    call(
        engine,
        Call {
            module: "USER",
            name: "MessageBox",
            args: &[A::W(hwnd), A::S(0), A::S(1), A::W(MB_ICONINFORMATION)],
            structs: vec![text_arg(&text), text_arg(&caption)],
        },
    )
    .await?;
    Ok(false)
}

/// Which of two faces' types ranks above (`1079`): TrueType, device,
/// vector, raster -- the screen and printer bits cleared and the raster
/// bit flipped, the new less the old.
fn ranks_above(new: u16, old: u16) -> bool {
    let rank = |kind: u16| (kind & !(SCREEN_FONTTYPE | PRINTER_FONTTYPE)) ^ RASTER_FONTTYPE;

    (rank(new).wrapping_sub(rank(old)) as i16) > 0
}

pub fn font_family_enum_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (lpelf, lpntm, kind, data) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            family(engine, lpelf, lpntm, kind, data).await?,
        ))
    })
}

/// `FontFamilyEnumProc` (`1096`): a face of GDI's taken, left out, or
/// put in place of the same face of a lower type.
async fn family(
    engine: &Engine,
    lpelf: u32,
    _lpntm: u32,
    kind: u16,
    data: u32,
) -> Result<u16, Stop> {
    let combo = word(engine, data, 0);
    let flags = dword(engine, data, 8);
    let printer = word(engine, data, 0x10) != 0;
    let charset = byte(engine, lpelf, LF_CHARSET);

    if (flags & CF_TTONLY != 0 && kind & TRUETYPE_FONTTYPE == 0)
        || (flags & CF_SCALABLEONLY != 0 && kind & RASTER_FONTTYPE != 0)
        || (flags & CF_ANSIONLY != 0 && charset != 0)
        || (flags & CF_FIXEDPITCHONLY != 0 && byte(engine, lpelf, LF_PITCH_AND_FAMILY) & 2 != 0)
        || (flags & CF_NOVECTORFONTS != 0 && charset == 0xff)
    {
        return Ok(1);
    }

    let kind = kind
        | if printer {
            PRINTER_FONTTYPE
        } else {
            SCREEN_FONTTYPE
        };
    let face = engine.system().read_string(at(lpelf, LF_FACENAME));
    let index = find_exact(engine, combo, &face).await?;

    if index < 0 {
        let index = send_bytes(engine, combo, CB_ADDSTRING, 0, text_arg(&face))
            .await?
            .0 as i16;

        if index < 0 {
            return Ok(0);
        }

        send(engine, combo, CB_SETITEMDATA, index as u16, u32::from(kind)).await?;
        return Ok(1);
    }

    let mut old = send(engine, combo, CB_GETITEMDATA, index as u16, 0).await? as u16;
    let printer_over_screen = flags & CF_SCREENFONTS == 0
        && flags & CF_PRINTERFONTS != 0
        && kind & PRINTER_FONTTYPE != 0
        && old & SCREEN_FONTTYPE != 0;

    if printer_over_screen {
        old = 0;
    }

    let mut value = if printer_over_screen || ranks_above(kind, old) {
        send_bytes(
            engine,
            combo,
            CB_INSERTSTRING,
            index as u16,
            text_arg(&face),
        )
        .await?;
        send(engine, combo, CB_DELETESTRING, index as u16 + 1, 0).await?;
        kind
    } else {
        old
    };

    value |= (old | kind) & (SCREEN_FONTTYPE | PRINTER_FONTTYPE);
    send(
        engine,
        combo,
        CB_SETITEMDATA,
        index as u16,
        u32::from(value),
    )
    .await?;
    Ok(1)
}

// ---------------------------------------------------------------------
// The styles and sizes (`1aaa`) and FontStyleEnumProc (`184e`).

/// The styles and sizes listed for the face chosen (`1aaa`).
#[allow(clippy::too_many_lines)]
async fn list_styles(engine: &Engine, hwnd: u16, lpcf: u32) -> Result<(), Stop> {
    if !enumeration_found(engine).await? {
        return Ok(());
    }

    let styles = item(engine, hwnd, CMB_STYLES).await?;

    free_styles(engine, styles).await?;

    let styles = item(engine, hwnd, CMB_STYLES).await?;
    let sizes = item(engine, hwnd, CMB_SIZES).await?;
    let flags = flags(engine, lpcf);
    let face = send_item(engine, hwnd, CMB_FACES, CB_GETCURSEL, 0, 0).await? as i16;

    if face < 0 {
        // No face: the four styles of the default LOGFONT, and the standard
        // sizes (`1b4b`).
        let mut lf = vec![0u8; LOGFONT_SIZE];

        default_logfont_bytes(engine, &mut lf).await?;
        add_style(
            engine,
            styles,
            &string(0x504, STYLE_NAME_SIZE),
            REGULAR_FONTTYPE,
            &lf,
        )
        .await?;
        lf[LF_WEIGHT as usize..LF_WEIGHT as usize + 2].copy_from_slice(&FW_BOLD.to_le_bytes());
        add_style(
            engine,
            styles,
            &string(0x505, STYLE_NAME_SIZE),
            BOLD_FONTTYPE,
            &lf,
        )
        .await?;
        lf[LF_WEIGHT as usize..LF_WEIGHT as usize + 2].copy_from_slice(&FW_NORMAL.to_le_bytes());
        lf[LF_ITALIC as usize] = 1;
        add_style(
            engine,
            styles,
            &string(0x506, STYLE_NAME_SIZE),
            ITALIC_FONTTYPE,
            &lf,
        )
        .await?;
        lf[LF_WEIGHT as usize..LF_WEIGHT as usize + 2].copy_from_slice(&FW_BOLD.to_le_bytes());
        add_style(
            engine,
            styles,
            &string(0x507, STYLE_NAME_SIZE),
            BOLD_FONTTYPE | ITALIC_FONTTYPE,
            &lf,
        )
        .await?;
        standard_sizes(engine, lpcf, sizes).await?;
        return Ok(());
    }

    let kind = send_item(engine, hwnd, CMB_FACES, CB_GETITEMDATA, face as u16, 0).await? as u16;

    send(engine, sizes, CB_RESETCONTENT, 0, 0).await?;
    send(engine, sizes, WM_SETREDRAW, 0, 0).await?;
    send(engine, styles, WM_SETREDRAW, 0, 0).await?;

    let (_, name) = into_buffer(
        engine,
        "USER",
        "GetDlgItemText",
        &[A::W(hwnd), A::W(CMB_FACES), A::S(0), A::W(0x20)],
        0x20,
    )
    .await?;
    let data = |hdc: u16, printer: u16| {
        let mut data = vec![0; 0x16];

        data[2..4].copy_from_slice(&styles.to_le_bytes());
        data[4..6].copy_from_slice(&sizes.to_le_bytes());
        data[6..8].copy_from_slice(&hdc.to_le_bytes());
        data[8..12].copy_from_slice(&flags.to_le_bytes());
        data[0x0c..0x0e].copy_from_slice(&kind.to_le_bytes());
        data[0x0e..0x10].copy_from_slice(&1u16.to_le_bytes());
        data[0x10..0x12].copy_from_slice(&printer.to_le_bytes());
        data[0x12..0x16].copy_from_slice(&lpcf.to_le_bytes());
        data
    };

    if flags & CF_SCREENFONTS != 0 {
        let screen = get_dc(engine, 0).await?;

        enumerate(
            engine,
            screen,
            Some(&name),
            FONT_STYLE_ENUM_PROC,
            data(screen, 0),
        )
        .await?;
        release_dc(engine, 0, screen).await?;
    }

    if flags & CF_PRINTERFONTS != 0 {
        let printer = word(engine, lpcf, HDC);
        let mode = api(engine, "GDI", "GetMapMode", &[A::W(printer)]).await? as u16;
        let mut extents = (0, 0);

        if mode != MM_TEXT {
            if mode == MM_ISOTROPIC || mode == MM_ANISOTROPIC {
                extents.0 = api(engine, "GDI", "GetViewportExt", &[A::W(printer)]).await?;
                extents.1 = api(engine, "GDI", "GetWindowExt", &[A::W(printer)]).await?;
            }

            api(engine, "GDI", "SetMapMode", &[A::W(printer), A::W(MM_TEXT)]).await?;
        }

        enumerate(
            engine,
            printer,
            Some(&name),
            FONT_STYLE_ENUM_PROC,
            data(printer, 1),
        )
        .await?;

        if mode != MM_TEXT {
            api(engine, "GDI", "SetMapMode", &[A::W(printer), A::W(mode)]).await?;

            if mode == MM_ISOTROPIC || mode == MM_ANISOTROPIC {
                let (viewport, window) = extents;

                api(
                    engine,
                    "GDI",
                    "SetWindowExt",
                    &[
                        A::W(printer),
                        A::W(window as u16),
                        A::W((window >> 16) as u16),
                    ],
                )
                .await?;
                api(
                    engine,
                    "GDI",
                    "SetViewportExt",
                    &[
                        A::W(printer),
                        A::W(viewport as u16),
                        A::W((viewport >> 16) as u16),
                    ],
                )
                .await?;
            }
        }
    }

    if flags & CF_NOSIMULATIONS == 0 {
        simulate(engine, styles).await?;
    }

    send(engine, styles, WM_SETREDRAW, 1, 0).await?;
    send(engine, sizes, WM_SETREDRAW, 1, 0).await?;
    Ok(())
}

/// The default `LOGFONT` (`1a2a`): weight 400, ten points high on the
/// screen, the rest nought and the face empty -- the bytes of the face
/// after its first left as they were.
async fn default_logfont_bytes(engine: &Engine, lf: &mut [u8]) -> Result<(), Stop> {
    lf[LF_WEIGHT as usize..LF_WEIGHT as usize + 2].copy_from_slice(&FW_NORMAL.to_le_bytes());
    lf[LF_CHARSET as usize..LF_CHARSET as usize + 5].fill(0);
    lf[LF_ITALIC as usize] = 0;
    lf[LF_STRIKEOUT as usize] = 0;
    lf[LF_UNDERLINE as usize] = 0;
    lf[2..8].fill(0);
    lf[LF_FACENAME as usize] = 0;

    let hdc = get_dc(engine, 0).await?;
    let pixels = device_caps(engine, hdc, LOGPIXELSY).await?;
    let height = mul_div(engine, 10, pixels, 72).await?;

    lf[0..2].copy_from_slice(&height.wrapping_neg().to_le_bytes());
    release_dc(engine, 0, hdc).await?;
    Ok(())
}

pub fn font_style_enum_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (lpelf, lpntm, kind, data) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(style(engine, lpelf, lpntm, kind, data).await?))
    })
}

/// `FontStyleEnumProc` (`184e`): a style of the face's own kind listed,
/// and the face's sizes.
async fn style(engine: &Engine, lpelf: u32, lpntm: u32, kind: u16, data: u32) -> Result<u16, Stop> {
    let face = word(engine, data, 0x0c);

    if face & 7 != kind {
        return Ok(1);
    }

    let styles = word(engine, data, 2);
    let sizes = word(engine, data, 4);
    let hdc = word(engine, data, 6);
    let lpcf = dword(engine, data, 0x12);

    if kind & RASTER_FONTTYPE == 0 {
        if word(engine, data, 0x0e) != 0
            && send(engine, sizes, CB_GETCOUNT, 0, 0).await? as u16 == 0
        {
            standard_sizes(engine, lpcf, sizes).await?;
        }
    } else {
        let height = (word(engine, lpntm, 0) as i16).wrapping_sub(word(engine, lpntm, 6) as i16);
        let (size, text) = points(engine, hdc, height).await?;

        if find_exact(engine, sizes, &text).await? < 0 {
            add_size(engine, lpcf, size, sizes).await?;
        }
    }

    let mut kind = kind | (face & (SCREEN_FONTTYPE | PRINTER_FONTTYPE));
    let lf = bytes(engine, lpelf, 0, LOGFONT_SIZE);
    let name = if kind & TRUETYPE_FONTTYPE != 0 {
        let flags = byte(engine, lpntm, 0x1f);

        if flags & 0x21 == 0 {
            kind |= REGULAR_FONTTYPE;
        }

        if flags & 0x01 != 0 {
            kind |= ITALIC_FONTTYPE;
        }

        if flags & 0x20 != 0 {
            kind |= BOLD_FONTTYPE;
        }

        engine.system().read_string(at(lpelf, 0x72))
    } else {
        let weight = lf_word(&lf, LF_WEIGHT) as i16;
        let italic = lf[LF_ITALIC as usize] != 0;
        let (id, bits) = match (weight >= FW_BOLD as i16, italic) {
            (true, true) => (0x507, BOLD_FONTTYPE | ITALIC_FONTTYPE),
            (true, false) => (0x505, BOLD_FONTTYPE),
            (false, true) => (0x506, ITALIC_FONTTYPE),
            (false, false) => (0x504, REGULAR_FONTTYPE),
        };

        kind |= bits;
        string(id, STYLE_NAME_SIZE)
    };

    add_style(engine, styles, &name, kind, &lf).await?;
    Ok(1)
}

// ---------------------------------------------------------------------
// The call: ChooseFont (`0000`).

pub fn choose_font(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let lpcf = args.dword(&engine.system());

        Ok(Answer::Word(choose(engine, lpcf).await?))
    })
}

/// `ChooseFont` (`0000`).
async fn choose(engine: &Engine, lpcf: u32) -> Result<u16, Stop> {
    let cursor = api(engine, "USER", "LoadCursor", &[A::W(0), A::D(IDC_WAIT)]).await?;

    api(engine, "USER", "SetCursor", &[A::W(cursor as u16)]).await?;
    support::set_extended_error(&mut engine.system(), 0);

    if dword(engine, lpcf, LSTRUCTSIZE) != 0x2e {
        support::set_extended_error(&mut engine.system(), CDERR_STRUCTSIZE);
        return Ok(0);
    }

    let flags = flags(engine, lpcf);

    if flags & CF_ENABLEHOOK != 0 && dword(engine, lpcf, HOOK) == 0 {
        support::set_extended_error(&mut engine.system(), CDERR_NOHOOK);
        return Ok(0);
    }

    let program = word(engine, lpcf, H_INSTANCE);
    let (handle, own) = if flags & CF_ENABLETEMPLATE != 0 {
        let found = api(
            engine,
            "KERNEL",
            "FindResource",
            &[
                A::W(program),
                A::D(dword(engine, lpcf, TEMPLATE_NAME)),
                A::D(RT_DIALOG),
            ],
        )
        .await? as u16;

        if found == 0 {
            support::set_extended_error(&mut engine.system(), CDERR_FINDRESFAILURE);
            return Ok(0);
        }

        let loaded = api(
            engine,
            "KERNEL",
            "LoadResource",
            &[A::W(program), A::W(found)],
        )
        .await? as u16;

        if loaded == 0 {
            support::set_extended_error(&mut engine.system(), CDERR_LOADRESFAILURE);
            return Ok(0);
        }

        (loaded, false)
    } else if flags & CF_ENABLETEMPLATEHANDLE != 0 {
        (program, false)
    } else {
        let handle = support::own_template(engine, FONT_TEMPLATE).await?;

        if handle == 0 {
            support::set_extended_error(&mut engine.system(), CDERR_LOADRESFAILURE);
            return Ok(0);
        }

        (handle, true)
    };

    let mut answer = 0;

    if api(engine, "KERNEL", "LockResource", &[A::W(handle)]).await? != 0 {
        if flags & CF_ENABLEHOOK != 0 {
            globals(engine).hook = dword(engine, lpcf, HOOK);
        }

        let instance = support::instance(engine);
        let proc = support::export_address(engine, FORMAT_CHAR_DLG_PROC);
        let owner = word(engine, lpcf, HWND_OWNER);

        answer = api(
            engine,
            "USER",
            "DialogBoxIndirectParam",
            &[
                A::W(instance),
                A::W(handle),
                A::W(owner),
                A::D(proc),
                A::D(lpcf),
            ],
        )
        .await? as u16;
        api(engine, "KERNEL", "GlobalUnlock", &[A::W(handle)]).await?;
        globals(engine).hook = 0;

        if answer == 0xffff {
            support::set_extended_error(&mut engine.system(), CDERR_DIALOGFAILURE);
            answer = 0;
        }
    }

    // The template let go unless it was the program's handle (`0147`).
    if own {
        support::free_template(engine, handle).await?;
    } else if flags & CF_ENABLETEMPLATEHANDLE == 0 {
        api(engine, "KERNEL", "FreeResource", &[A::W(handle)]).await?;
    }

    Ok(u16::from(answer == 1))
}

// ---------------------------------------------------------------------
// The procedure: FormatCharDlgProc (`02b0`).

pub fn format_char_dlg_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            procedure(engine, hwnd, message, wparam, lparam).await?,
        ))
    })
}

/// The dialog's number under its property A000h: nought before
/// `WM_INITDIALOG` puts it there.
async fn number(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    Ok(api(engine, "USER", "GetProp", &[A::W(hwnd), A::D(0xa000)]).await? as u16)
}

/// The dialog's procedure (`02b0`).
async fn procedure(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    let id = number(engine, hwnd).await?;
    let mut lpcf = 0;

    if id != 0 {
        lpcf = globals(engine).dialogs.get(&id).copied().unwrap_or(0);

        if flags(engine, lpcf) & CF_ENABLEHOOK != 0 {
            let hook = dword(engine, lpcf, HOOK);
            let answer = support::call_hook(
                engine,
                hook,
                &[hwnd, message, wparam, (lparam >> 16) as u16, lparam as u16],
            )
            .await?;

            if answer != 0 {
                return Ok(answer);
            }
        }
    } else {
        let hook = globals(engine).hook;

        if hook != 0 && message != WM_INITDIALOG {
            let answer = support::call_hook(
                engine,
                hook,
                &[hwnd, message, wparam, (lparam >> 16) as u16, lparam as u16],
            )
            .await?;

            if answer != 0 {
                return Ok(answer);
            }
        }
    }

    match message {
        WM_PAINT => {
            let (hdc, structs) = call(
                engine,
                Call {
                    module: "USER",
                    name: "BeginPaint",
                    args: &[A::W(hwnd), A::S(0)],
                    structs: vec![vec![0; 32]],
                },
            )
            .await?;

            if hdc as u16 != 0 {
                paint_sample(engine, hwnd, lpcf, hdc as u16).await?;
                call(
                    engine,
                    Call {
                        module: "USER",
                        name: "EndPaint",
                        args: &[A::W(hwnd), A::S(0)],
                        structs,
                    },
                )
                .await?;
            }

            Ok(1)
        }
        WM_SYSCOLORCHANGE => {
            let old = globals(engine).bitmap;

            delete_object(engine, old).await?;

            let bitmap = make_bitmap(engine).await?;

            globals(engine).bitmap = bitmap;
            Ok(1)
        }
        WM_DRAWITEM => {
            if word(engine, lparam, 4) != 0xffff {
                match word(engine, lparam, 2) {
                    CMB_COLORS => draw_colour(engine, lparam).await?,
                    CMB_FACES => draw_face(engine, lparam).await?,
                    _ => draw_size(engine, lparam).await?,
                }
            }

            Ok(1)
        }
        WM_MEASUREITEM => {
            measure(engine, hwnd, lparam).await?;
            Ok(1)
        }
        WM_INITDIALOG => start(engine, hwnd, message, wparam, lparam).await,
        WM_COMMAND => {
            command(
                engine,
                hwnd,
                lpcf,
                wparam,
                (lparam >> 16) as u16,
                lparam as u16,
            )
            .await
        }
        WM_CHOOSEFONT_GETLOGFONT => logfont(engine, hwnd, lpcf, lparam, true).await,
        _ => Ok(0),
    }
}

/// `WM_MEASUREITEM` (`0787`): a row the dialog's font's height, at least
/// 12; the edit field that height and one.
async fn measure(engine: &Engine, hwnd: u16, lparam: u32) -> Result<(), Stop> {
    let hdc = get_dc(engine, hwnd).await?;
    let mut old = send(engine, hwnd, WM_GETFONT, 0, 0).await? as u16;

    if old != 0 {
        old = select(engine, hdc, old).await?;
    }

    let tm = text_metrics(engine, hdc).await?;

    if old != 0 {
        select(engine, hdc, old).await?;
    }

    release_dc(engine, hwnd, hdc).await?;

    let height = lf_word(&tm, 0) as i16;
    let value = if word(engine, lparam, 4) == 0xffff {
        height.wrapping_add(1)
    } else {
        height.max(12)
    };

    put_word(engine, lparam, 8, value as u16);
    Ok(())
}

/// A row's colours set for its state, the highlight's for one selected:
/// the old background and text colours.
async fn row_colours(engine: &Engine, hdc: u16, selected: bool) -> Result<(u32, u32), Stop> {
    let (back, fore) = if selected {
        (COLOR_HIGHLIGHT, COLOR_HIGHLIGHTTEXT)
    } else {
        (COLOR_WINDOW, COLOR_WINDOWTEXT)
    };
    let colour = sys_colour(engine, back).await?;
    let old_back = set_bk_colour(engine, hdc, colour).await?;
    let colour = sys_colour(engine, fore).await?;
    let old_fore = set_text_colour(engine, hdc, colour).await?;

    Ok((old_back, old_fore))
}

async fn restore_colours(engine: &Engine, hdc: u16, (back, fore): (u32, u32)) -> Result<(), Stop> {
    set_text_colour(engine, hdc, fore).await?;
    set_bk_colour(engine, hdc, back).await?;
    Ok(())
}

/// A `DRAWITEMSTRUCT`'s fields.
struct Drawn {
    item: u16,
    state: u16,
    control: u16,
    hdc: u16,
    rect: Rect,
    data: u32,
}

fn drawn(engine: &Engine, far: u32) -> Drawn {
    let b = bytes(engine, far, 0, 26);
    let w = |at: usize| u16::from_le_bytes([b[at], b[at + 1]]);

    Drawn {
        item: w(4),
        state: w(8),
        control: w(0x0a),
        hdc: w(0x0c),
        rect: rect_of(&b[0x0e..0x16]),
        data: u32::from(w(0x16)) | u32::from(w(0x18)) << 16,
    }
}

/// A row's text, by `CB_GETLBTEXT` into a buffer of `size` bytes.
async fn row_text(engine: &Engine, d: &Drawn, size: usize) -> Result<Vec<u8>, Stop> {
    let (_, text) = send_bytes(engine, d.control, CB_GETLBTEXT, d.item, vec![0; size]).await?;

    Ok(until_nought(&text))
}

/// A size's row (`1e67`): its number, `SM_CXBORDER` in.
async fn draw_size(engine: &Engine, far: u32) -> Result<(), Stop> {
    let d = drawn(engine, far);
    let old = row_colours(engine, d.hdc, d.state & 1 != 0).await?;
    let text = row_text(engine, &d, 0x0a).await?;
    let border = metric(engine, SM_CXBORDER).await?;

    ext_text_out(
        engine,
        d.hdc,
        border.wrapping_add(d.rect[0]),
        d.rect[1],
        ETO_OPAQUE,
        d.rect,
        Some(&text),
    )
    .await?;
    restore_colours(engine, d.hdc, old).await
}

/// A face's row (`1f44`): its name 20 pixels in, and for a TrueType face or
/// a printer's device face its picture from bitmap 38.
async fn draw_face(engine: &Engine, far: u32) -> Result<(), Stop> {
    let d = drawn(engine, far);
    let old = row_colours(engine, d.hdc, d.state & 1 != 0).await?;
    let text = row_text(engine, &d, 0x32).await?;

    ext_text_out(
        engine,
        d.hdc,
        d.rect[0].wrapping_add(20),
        d.rect[1],
        ETO_OPAQUE,
        d.rect,
        Some(&text),
    )
    .await?;

    let memory = api(engine, "GDI", "CreateCompatibleDC", &[A::W(d.hdc)]).await? as u16;

    if memory != 0 {
        let bitmap = globals(engine).bitmap;

        if bitmap != 0 {
            let previous = select(engine, memory, bitmap).await?;
            let kind = d.data as u16;
            let source = if kind & TRUETYPE_FONTTYPE != 0 {
                Some(0)
            } else if kind & PRINTER_DEVICE == PRINTER_DEVICE {
                Some(20)
            } else {
                None
            };

            if let Some(x) = source {
                let y = d.rect[1]
                    .wrapping_add((d.rect[3].wrapping_sub(d.rect[1]).wrapping_sub(12)) / 2);

                api(
                    engine,
                    "GDI",
                    "BitBlt",
                    &[
                        A::W(d.hdc),
                        A::W(d.rect[0] as u16),
                        A::W(y as u16),
                        A::W(20),
                        A::W(12),
                        A::W(memory),
                        A::W(x),
                        A::W(if d.state & 1 != 0 { 12 } else { 0 }),
                        A::D(SRCCOPY),
                    ],
                )
                .await?;
            }

            select(engine, memory, previous).await?;
        }

        api(engine, "GDI", "DeleteDC", &[A::W(memory)]).await?;
    }

    restore_colours(engine, d.hdc, old).await
}

/// A colour's row (`20c4`): the row filled, a rectangle of the colour twice
/// as wide as high a border in, and its name two borders right of it.
async fn draw_colour(engine: &Engine, far: u32) -> Result<(), Stop> {
    let d = drawn(engine, far);
    let old = row_colours(engine, d.hdc, d.state & 1 != 0).await?;

    ext_text_out(
        engine, d.hdc, d.rect[0], d.rect[1], ETO_OPAQUE, d.rect, None,
    )
    .await?;

    let cx = metric(engine, SM_CXBORDER).await?;
    let cy = metric(engine, SM_CYBORDER).await?;
    let top = cy.wrapping_add(d.rect[1]);
    let bottom = d.rect[3].wrapping_sub(cy);
    let left = d.rect[0].wrapping_add(cx);
    let right = left.wrapping_add(bottom.wrapping_sub(top).wrapping_mul(2));
    let brush = api(engine, "GDI", "CreateSolidBrush", &[A::D(d.data)]).await? as u16;

    if brush == 0 {
        return Ok(());
    }

    let previous = select(engine, d.hdc, brush).await?;

    api(
        engine,
        "GDI",
        "Rectangle",
        &[
            A::W(d.hdc),
            A::W(left as u16),
            A::W(top as u16),
            A::W(right as u16),
            A::W(bottom as u16),
        ],
    )
    .await?;

    let made = select(engine, d.hdc, previous).await?;

    delete_object(engine, made).await?;

    let text = row_text(engine, &d, 0x10).await?;

    call(
        engine,
        Call {
            module: "GDI",
            name: "TextOut",
            args: &[
                A::W(d.hdc),
                A::W(cx.wrapping_mul(2).wrapping_add(right) as u16),
                A::W(d.rect[1] as u16),
                A::S(0),
                A::W(text.len() as u16),
            ],
            structs: vec![text_arg(&text)],
        },
    )
    .await?;
    restore_colours(engine, d.hdc, old).await
}

/// The pictures of the faces' types (`26d9`): bitmap 38, its colour
/// table's pure blue made the window's colour and its magenta the
/// highlight's, made a bitmap for the screen and given to COMMDLG.
async fn make_bitmap(engine: &Engine) -> Result<u16, Stop> {
    let highlight = sys_colour(engine, COLOR_HIGHLIGHT).await?;
    let window = sys_colour(engine, COLOR_WINDOW).await?;
    let quad = |colour: u32| [(colour >> 16) as u8, (colour >> 8) as u8, colour as u8, 0];
    let mut dib = super::templates::bytes(FONT_BITMAP);
    let header = u32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]) as usize;

    for entry in 0..16 {
        let at = header + entry * 4;
        let rgb = &dib[at..at + 4];

        if rgb == [0xff, 0, 0, 0] {
            dib[at..at + 4].copy_from_slice(&quad(window));
        } else if rgb == [0xff, 0, 0xff, 0] {
            dib[at..at + 4].copy_from_slice(&quad(highlight));
        }
    }

    let bits_at = header + (1usize << (dib[0x0e] + 2));
    let info = dib[..bits_at].to_vec();
    let bits = dib[bits_at..].to_vec();
    let hdc = get_dc(engine, 0).await?;
    let (bitmap, _) = call(
        engine,
        Call {
            module: "GDI",
            name: "CreateDIBitmap",
            args: &[A::W(hdc), A::S(0), A::D(4), A::S(1), A::S(0), A::W(0)],
            structs: vec![info, bits],
        },
    )
    .await?;

    release_dc(engine, 0, hdc).await?;

    let instance = support::instance(engine);

    api(
        engine,
        "GDI",
        "SetObjectOwner",
        &[A::W(bitmap as u16), A::W(instance)],
    )
    .await?;
    Ok(bitmap as u16)
}

// ---------------------------------------------------------------------
// WM_INITDIALOG (`037a`).

#[allow(clippy::too_many_lines)]
async fn start(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lpcf: u32,
) -> Result<u16, Stop> {
    let fail = |code: u32| async move {
        support::set_extended_error(&mut engine.system(), code);
        api(engine, "USER", "EndDialog", &[A::W(hwnd), A::W(0)]).await?;
        Ok::<u16, Stop>(0)
    };

    // The styles' names, strings 504h to 507h, are WinBox's own and always
    // there: CDERR_LOADSTRFAILURE (`03e2`) cannot happen.
    let flags = flags(engine, lpcf);

    if flags & CF_LIMITSIZE != 0
        && word(engine, lpcf, N_SIZE_MIN) as i16 > word(engine, lpcf, N_SIZE_MAX) as i16
    {
        return fail(CFERR_MAXLESSTHANMIN).await;
    }

    let id = support::next_number(engine);

    api(
        engine,
        "USER",
        "SetProp",
        &[A::W(hwnd), A::D(0xa000), A::W(id)],
    )
    .await?;
    {
        let mut state = globals(engine);

        state.hook = 0;
        state.dialogs.insert(id, lpcf);
    }

    if globals(engine).bitmap == 0 {
        let bitmap = make_bitmap(engine).await?;

        globals(engine).bitmap = bitmap;
    }

    if flags & CF_APPLY == 0 {
        hide(engine, hwnd, PSH_APPLY).await?;
    }

    if flags & CF_EFFECTS == 0 {
        hide(engine, hwnd, STC_COLOR).await?;
        hide(engine, hwnd, CMB_COLORS).await?;
    } else {
        list_colours(engine, hwnd).await?;

        let rgb = dword(engine, lpcf, RGB_COLORS);
        let mut index: u16 = 15;

        while index > 0 {
            if send_item(engine, hwnd, CMB_COLORS, CB_GETITEMDATA, index, 0).await? == rgb {
                break;
            }

            index -= 1;
        }

        send_item(engine, hwnd, CMB_COLORS, CB_SETCURSEL, index, 0).await?;
    }

    sample_rect(engine, hwnd).await?;

    // The faces' and sizes' edit fields as high as the styles' (`025a`).
    let height = send_item(engine, hwnd, CMB_STYLES, CB_GETITEMHEIGHT, 0xffff, 0).await? as i16;
    let height = i32::from(height) as u32;

    send_item(engine, hwnd, CMB_FACES, CB_SETITEMHEIGHT, 0xffff, height).await?;
    send_item(engine, hwnd, CMB_SIZES, CB_SETITEMHEIGHT, 0xffff, height).await?;

    let lf = dword(engine, lpcf, LP_LOGFONT);

    if flags & CF_INITTOLOGFONTSTRUCT == 0 {
        default_font(engine, lf).await?;
    }

    if flags & CF_EFFECTS == 0 {
        hide(engine, hwnd, GRP_EFFECTS).await?;
        hide(engine, hwnd, CHX_STRIKEOUT).await?;
        hide(engine, hwnd, CHX_UNDERLINE).await?;
    } else {
        let strike = byte(engine, lf, LF_STRIKEOUT);

        api(
            engine,
            "USER",
            "CheckDlgButton",
            &[A::W(hwnd), A::W(CHX_STRIKEOUT), A::W(u16::from(strike))],
        )
        .await?;

        let under = byte(engine, lf, LF_UNDERLINE);

        api(
            engine,
            "USER",
            "CheckDlgButton",
            &[A::W(hwnd), A::W(CHX_UNDERLINE), A::W(u16::from(under))],
        )
        .await?;
    }

    globals(engine).described = 0;

    if !list_faces(engine, hwnd, word(engine, lpcf, HDC), flags).await? {
        support::set_extended_error(&mut engine.system(), CFERR_NOFONTS);
        api(engine, "USER", "EndDialog", &[A::W(hwnd), A::W(0)]).await?;
        remove_property(engine, hwnd, lpcf).await?;
        return Ok(0);
    }

    let flags = self::flags(engine, lpcf);

    if flags & CF_NOFACESEL == 0 && byte(engine, lf, LF_FACENAME) != 0 {
        let faces = item(engine, hwnd, CMB_FACES).await?;
        let face = engine.system().read_string(at(lf, LF_FACENAME));

        choose_exact(engine, faces, &face).await?;

        let faces = item(engine, hwnd, CMB_FACES).await?;

        selection_to_box(engine, faces).await?;
    }

    list_styles(engine, hwnd, lpcf).await?;

    if self::flags(engine, lpcf) & CF_NOSTYLESEL == 0 {
        choose_style(engine, hwnd, lpcf, true).await?;
    }

    if self::flags(engine, lpcf) & CF_NOSIZESEL == 0 && word(engine, lf, LF_HEIGHT) != 0 {
        let hdc = get_dc(engine, 0).await?;
        let (_, text) = points(engine, hdc, word(engine, lf, LF_HEIGHT) as i16).await?;

        release_dc(engine, 0, hdc).await?;

        let sizes = item(engine, hwnd, CMB_SIZES).await?;

        choose_exact(engine, sizes, &text).await?;
        with_text(
            engine,
            "USER",
            "SetDlgItemText",
            &[A::W(hwnd), A::W(CMB_SIZES), A::S(0)],
            &text,
        )
        .await?;
    }

    if self::flags(engine, lpcf) & CF_SHOWHELP == 0 {
        let help = item(engine, hwnd, PSH_HELP).await?;

        api(engine, "USER", "ShowWindow", &[A::W(help), A::W(0)]).await?;
        api(engine, "USER", "EnableWindow", &[A::W(help), A::W(0)]).await?;
    }

    send_item(engine, hwnd, CMB_FACES, CB_LIMITTEXT, 0x1f, 0).await?;
    send_item(engine, hwnd, CMB_STYLES, CB_LIMITTEXT, 0x1f, 0).await?;
    send_item(engine, hwnd, CMB_SIZES, CB_LIMITTEXT, 4, 0).await?;

    if self::flags(engine, lpcf) & CF_ENABLEHOOK != 0 {
        let hook = dword(engine, lpcf, HOOK);

        return support::call_hook(
            engine,
            hook,
            &[hwnd, message, wparam, (lpcf >> 16) as u16, lpcf as u16],
        )
        .await;
    }

    let cursor = api(engine, "USER", "LoadCursor", &[A::W(0), A::D(IDC_ARROW)]).await?;

    api(engine, "USER", "SetCursor", &[A::W(cursor as u16)]).await?;
    Ok(1)
}

/// The sixteen colours listed, each named by its string and with its
/// `COLORREF` as its data (`1db7`).
async fn list_colours(engine: &Engine, hwnd: u16) -> Result<(), Stop> {
    for (index, colour) in FONT_COLOURS.iter().enumerate() {
        let name = string(0x410 + index as u16, COLOUR_NAME_SIZE);
        let at = send_item_bytes(
            engine,
            hwnd,
            CMB_COLORS,
            CB_INSERTSTRING,
            index as u16,
            text_arg(&name),
        )
        .await? as i16;

        if at >= 0 {
            send_item(engine, hwnd, CMB_COLORS, CB_SETITEMDATA, at as u16, *colour).await?;
        }
    }

    Ok(())
}

/// The sample's rectangle, 444h's in the dialog's client coordinates
/// (`1e2d`).
async fn sample_rect(engine: &Engine, hwnd: u16) -> Result<(), Stop> {
    let control = item(engine, hwnd, STC_SAMPLE).await?;
    let (_, structs) = call(
        engine,
        Call {
            module: "USER",
            name: "GetWindowRect",
            args: &[A::W(control), A::S(0)],
            structs: vec![rect_bytes([0; 4])],
        },
    )
    .await?;
    let mut rect = rect_of(&structs[0]);

    for corner in 0..2 {
        let (_, structs) = call(
            engine,
            Call {
                module: "USER",
                name: "ScreenToClient",
                args: &[A::W(hwnd), A::S(0)],
                structs: vec![rect_bytes([rect[corner * 2], rect[corner * 2 + 1], 0, 0])],
            },
        )
        .await?;
        let point = rect_of(&structs[0]);

        rect[corner * 2] = point[0];
        rect[corner * 2 + 1] = point[1];
    }

    globals(engine).sample = rect;
    Ok(())
}

// ---------------------------------------------------------------------
// The size typed (`0a78`), the LOGFONT (`241e`) and the sample (`226b`).

/// The size typed (`0a78`). `default` makes an empty box ten points;
/// `check` puts up a box for one not a number or outside `CF_LIMITSIZE`'s
/// limits, answering none. Without `default`, an empty box answers none;
/// without `check`, text not a number answers nought.
async fn size_typed(
    engine: &Engine,
    hwnd: u16,
    lpcf: u32,
    default: bool,
    check: bool,
) -> Result<Option<i16>, Stop> {
    let (length, _) = into_buffer(
        engine,
        "USER",
        "GetDlgItemText",
        &[A::W(hwnd), A::W(CMB_SIZES), A::S(0), A::W(0x5a)],
        0x5a,
    )
    .await?;
    let (size, mut good) = if length != 0 {
        let (value, structs) = call(
            engine,
            Call {
                module: "USER",
                name: "GetDlgItemInt",
                args: &[A::W(hwnd), A::W(CMB_SIZES), A::S(0), A::W(1)],
                structs: vec![vec![0, 0]],
            },
        )
        .await?;
        let good = structs[0] != [0, 0];

        (if good { value as i16 } else { 0 }, good)
    } else if default {
        (10, true)
    } else {
        return Ok(None);
    };

    if !check {
        return Ok(Some(size));
    }

    let message = if flags(engine, lpcf) & CF_LIMITSIZE != 0 {
        let min = word(engine, lpcf, N_SIZE_MIN) as i16;
        let max = word(engine, lpcf, N_SIZE_MAX) as i16;

        if !good || max < size || min > size {
            good = false;
            format(&string(0x44b, 0x5a), &[min, max])
        } else {
            Vec::new()
        }
    } else if !good {
        string(0x44a, 0x5a)
    } else {
        Vec::new()
    };

    if good {
        return Ok(Some(size));
    }

    let (_, caption) = into_buffer(
        engine,
        "USER",
        "GetWindowText",
        &[A::W(hwnd), A::S(0), A::W(0x5a)],
        0x5a,
    )
    .await?;

    message_box(engine, hwnd, &message, &caption).await?;
    Ok(None)
}

async fn message_box(engine: &Engine, hwnd: u16, text: &[u8], caption: &[u8]) -> Result<(), Stop> {
    call(
        engine,
        Call {
            module: "USER",
            name: "MessageBox",
            args: &[A::W(hwnd), A::S(0), A::S(1), A::W(MB_ICONINFORMATION)],
            structs: vec![text_arg(text), text_arg(caption)],
        },
    )
    .await?;
    Ok(())
}

/// The `LOGFONT` as the dialog stands written to `lf` (`241e`), and with
/// `update` the program's `CF_NOFACESEL`, `CF_NOSTYLESEL` and
/// `CF_NOSIZESEL` set and cleared; with `CF_PRINTERFONTS`, the font's
/// description given where the style's type changed. Whether face, style
/// and size are all chosen.
async fn logfont(
    engine: &Engine,
    hwnd: u16,
    lpcf: u32,
    lf: u32,
    update: bool,
) -> Result<u16, Stop> {
    let mut bytes = bytes(engine, lf, 0, LOGFONT_SIZE);
    let chosen = logfont_bytes(engine, hwnd, lpcf, &mut bytes, update).await?;

    put(engine, lf, 0, &bytes);
    Ok(chosen)
}

/// `logfont` on bytes of WinBox's, those of the `LOGFONT` it is given as
/// they were: what each step writes written over them.
#[allow(clippy::too_many_lines)]
async fn logfont_bytes(
    engine: &Engine,
    hwnd: u16,
    lpcf: u32,
    lf: &mut [u8],
    update: bool,
) -> Result<u16, Stop> {
    let mut chosen = 1;

    default_logfont_bytes(engine, lf).await?;

    let (_, face) = into_buffer(
        engine,
        "USER",
        "GetDlgItemText",
        &[A::W(hwnd), A::W(CMB_FACES), A::S(0), A::W(0x20)],
        0x20,
    )
    .await?;
    let named = text_arg(&face);

    lf[LF_FACENAME as usize..LF_FACENAME as usize + named.len()].copy_from_slice(&named);

    let faces = item(engine, hwnd, CMB_FACES).await?;
    let listed = find_exact(engine, faces, &face).await? >= 0;

    if !listed {
        chosen = 0;
    }

    if update {
        set_flag(engine, lpcf, CF_NOFACESEL, !listed);
    }

    let styles = item(engine, hwnd, CMB_STYLES).await?;
    let (_, index, data) = box_row(engine, styles, 0x20).await?;
    let kind = if index >= 0 {
        let style = style_font(engine, data as u16);

        lf[..LOGFONT_SIZE].copy_from_slice(&style);
        lf[2..4].fill(0);

        if update {
            set_flag(engine, lpcf, CF_NOSTYLESEL, false);
        }

        (data >> 16) as u16
    } else {
        chosen = 0;

        if update {
            set_flag(engine, lpcf, CF_NOSTYLESEL, true);
        }

        0
    };

    let size = size_typed(engine, hwnd, lpcf, false, false)
        .await?
        .unwrap_or(0);
    let hdc = get_dc(engine, 0).await?;

    if size != 0 {
        let pixels = device_caps(engine, hdc, LOGPIXELSY).await?;
        let height = mul_div(engine, size, pixels, 72).await?;

        lf[0..2].copy_from_slice(&height.wrapping_neg().to_le_bytes());

        if update {
            set_flag(engine, lpcf, CF_NOSIZESEL, false);
        }
    } else {
        let pixels = device_caps(engine, hdc, LOGPIXELSY).await?;
        let height = mul_div(engine, 10, pixels, 72).await?;

        lf[0..2].copy_from_slice(&height.wrapping_neg().to_le_bytes());
        chosen = 0;

        if update {
            set_flag(engine, lpcf, CF_NOSIZESEL, true);
        }
    }

    release_dc(engine, 0, hdc).await?;

    let strike = api(
        engine,
        "USER",
        "IsDlgButtonChecked",
        &[A::W(hwnd), A::W(CHX_STRIKEOUT)],
    )
    .await?;

    lf[LF_STRIKEOUT as usize] = strike as u8;

    let under = api(
        engine,
        "USER",
        "IsDlgButtonChecked",
        &[A::W(hwnd), A::W(CHX_UNDERLINE)],
    )
    .await?;

    lf[LF_UNDERLINE as usize] = under as u8;

    let described = globals(engine).described;

    if kind != described && flags(engine, lpcf) & CF_PRINTERFONTS != 0 {
        let id = if kind & SIMULATED_FONTTYPE != 0 {
            Some(0x44c)
        } else if kind & TRUETYPE_FONTTYPE != 0 {
            Some(0x44d)
        } else if kind & (SCREEN_FONTTYPE | PRINTER_FONTTYPE) == SCREEN_FONTTYPE {
            Some(0x44f)
        } else if kind & PRINTER_DEVICE == PRINTER_DEVICE {
            Some(0x44e)
        } else {
            None
        };
        let text = id.map(|id| string(id, 0x80)).unwrap_or_default();

        with_text(
            engine,
            "USER",
            "SetDlgItemText",
            &[A::W(hwnd), A::W(STC_DESCRIPTION), A::S(0)],
            &text,
        )
        .await?;
    }

    globals(engine).described = kind;
    Ok(chosen)
}

/// The sample drawn (`226b`): the font as the dialog stands, in the colour
/// chosen, centred across where it fits, its baseline placing the ascent
/// less the internal leading centred down, never below the bottom.
async fn paint_sample(engine: &Engine, hwnd: u16, lpcf: u32, hdc: u16) -> Result<(), Stop> {
    // The LOGFONT made on COMMDLG's stack (`[bp-58h]`); what its stack held
    // there before is not known, and WinBox starts from noughts.
    let mut lf = vec![0u8; LOGFONT_SIZE];
    let complete = logfont_bytes(engine, hwnd, lpcf, &mut lf, false).await?;
    let (font, _) = call(
        engine,
        Call {
            module: "GDI",
            name: "CreateFontIndirect",
            args: &[A::S(0)],
            structs: vec![lf],
        },
    )
    .await?;
    let font = font as u16;

    if font == 0 {
        return Ok(());
    }

    let old_font = select(engine, hdc, font).await?;
    let window = sys_colour(engine, COLOR_WINDOW).await?;
    let old_back = set_bk_colour(engine, hdc, window).await?;
    let mut colour = None;

    if flags(engine, lpcf) & CF_EFFECTS != 0 {
        let index = send_item(engine, hwnd, CMB_COLORS, CB_GETCURSEL, 0, 0).await? as u16;

        if index != 0xffff {
            colour = Some(send_item(engine, hwnd, CMB_COLORS, CB_GETITEMDATA, index, 0).await?);
        }
    }

    let colour = match colour {
        Some(colour) => colour,
        None => sys_colour(engine, COLOR_WINDOWTEXT).await?,
    };
    let old_fore = set_text_colour(engine, hdc, colour).await?;
    let text = if complete != 0 {
        into_buffer(
            engine,
            "USER",
            "GetDlgItemText",
            &[A::W(hwnd), A::W(STC_SAMPLE), A::S(0), A::W(0x32)],
            0x32,
        )
        .await?
        .1
    } else {
        Vec::new()
    };
    let tm = text_metrics(engine, hdc).await?;
    let extent = with_text(
        engine,
        "GDI",
        "GetTextExtent",
        &[A::W(hdc), A::S(0), A::W(text.len() as u16)],
        &text,
    )
    .await? as i16;
    let ascent = lf_word(&tm, 2) as i16;
    let above = ascent.wrapping_sub(lf_word(&tm, 6) as i16);
    let rect = globals(engine).sample;
    let x = if rect[2].wrapping_sub(rect[0]) > extent && extent > 0 {
        rect[2].wrapping_sub(extent).wrapping_sub(rect[0]) / 2 + rect[0]
    } else {
        rect[0]
    };
    let baseline = (above.wrapping_sub(rect[3]).wrapping_add(rect[1]) / 2)
        .wrapping_add(rect[3])
        .min(rect[3]);

    ext_text_out(
        engine,
        hdc,
        x,
        baseline.wrapping_sub(ascent),
        ETO_OPAQUE | ETO_CLIPPED,
        rect,
        Some(&text),
    )
    .await?;
    set_bk_colour(engine, hdc, old_back).await?;
    set_text_colour(engine, hdc, old_fore).await?;

    if old_font != 0 {
        let made = select(engine, hdc, old_font).await?;

        delete_object(engine, made).await?;
    }

    Ok(())
}

/// The sample painted again: its rectangle invalidated, not erased, and
/// the dialog updated (`0eb3`).
async fn repaint(engine: &Engine, hwnd: u16) -> Result<(), Stop> {
    let rect = globals(engine).sample;

    call(
        engine,
        Call {
            module: "USER",
            name: "InvalidateRect",
            args: &[A::W(hwnd), A::S(0), A::W(0)],
            structs: vec![rect_bytes(rect)],
        },
    )
    .await?;
    api(engine, "USER", "UpdateWindow", &[A::W(hwnd)]).await?;
    Ok(())
}

// ---------------------------------------------------------------------
// WM_COMMAND (`0b9d`).

#[allow(clippy::too_many_lines)]
async fn command(
    engine: &Engine,
    hwnd: u16,
    lpcf: u32,
    id: u16,
    code: u16,
    control: u16,
) -> Result<u16, Stop> {
    match id {
        IDOK => ok(engine, hwnd, lpcf).await?,
        IDCANCEL => {
            let styles = item(engine, hwnd, CMB_STYLES).await?;

            free_styles(engine, styles).await?;
            end(engine, hwnd, lpcf, 0).await?;
        }
        IDABORT => {
            let styles = item(engine, hwnd, CMB_STYLES).await?;

            free_styles(engine, styles).await?;
            end(engine, hwnd, lpcf, control).await?;
        }
        PSH_HELP => {
            let help = support::registered_message(engine, "commdlg_help");
            let owner = word(engine, lpcf, HWND_OWNER);

            if help != 0 && owner != 0 {
                api(
                    engine,
                    "USER",
                    "SendMessage",
                    &[A::W(owner), A::W(help), A::W(hwnd), A::D(lpcf)],
                )
                .await?;
            }
        }
        CHX_STRIKEOUT | CHX_UNDERLINE => repaint(engine, hwnd).await?,
        CMB_FACES => match code {
            CBN_SELCHANGE => {
                selection_to_box(engine, control).await?;
                face_changed(engine, hwnd, lpcf).await?;
            }
            CBN_EDITUPDATE => {
                api(
                    engine,
                    "USER",
                    "PostMessage",
                    &[
                        A::W(hwnd),
                        A::W(WM_COMMAND),
                        A::W(id),
                        A::D(u32::from(TYPED) << 16 | u32::from(control)),
                    ],
                )
                .await?;
            }
            TYPED => {
                let (_, text) = into_buffer(
                    engine,
                    "USER",
                    "GetWindowText",
                    &[A::W(control), A::S(0), A::W(0x20)],
                    0x20,
                )
                .await?;
                let index = find_exact(engine, control, &text).await?;

                if index >= 0 {
                    send(engine, control, CB_SETCURSEL, index as u16, 0).await?;
                    send(engine, control, CB_SETEDITSEL, 0, 0xffff_ffff).await?;
                    face_changed(engine, hwnd, lpcf).await?;
                }
            }
            _ => {}
        },
        CMB_STYLES | CMB_SIZES => match code {
            CBN_SELCHANGE => {
                let index = selection_to_box(engine, control).await?;

                if index >= 0 && id == CMB_STYLES {
                    let handle =
                        send(engine, control, CB_GETITEMDATA, index as u16, 0).await? as u16;
                    let style = style_font(engine, handle);
                    let lf = dword(engine, lpcf, LP_LOGFONT);

                    put_word(engine, lf, LF_WEIGHT, lf_word(&style, LF_WEIGHT));
                    put(engine, lf, LF_ITALIC, &[style[LF_ITALIC as usize]]);
                }

                repaint(engine, hwnd).await?;
            }
            CBN_KILLFOCUS => repaint(engine, hwnd).await?,
            CBN_EDITUPDATE => {
                api(
                    engine,
                    "USER",
                    "PostMessage",
                    &[
                        A::W(hwnd),
                        A::W(WM_COMMAND),
                        A::W(id),
                        A::D(u32::from(TYPED) << 16 | u32::from(control)),
                    ],
                )
                .await?;
            }
            TYPED if id == CMB_STYLES => {
                let (_, text) = into_buffer(
                    engine,
                    "USER",
                    "GetWindowText",
                    &[A::W(control), A::S(0), A::W(0x20)],
                    0x20,
                )
                .await?;
                let index = find_exact(engine, control, &text).await?;

                if index >= 0 {
                    send(engine, control, CB_SETCURSEL, index as u16, 0).await?;
                    send(engine, control, CB_SETEDITSEL, 0, 0xffff_ffff).await?;
                    repaint(engine, hwnd).await?;
                }
            }
            _ => {}
        },
        CMB_COLORS => {
            if code == CBN_SELCHANGE {
                repaint(engine, hwnd).await?;
            }
        }
        _ => return Ok(0),
    }

    Ok(1)
}

/// A face chosen (`0dfe`): the size typed kept, the styles and sizes listed
/// again, the nearest style chosen, the size chosen where it is listed and
/// typed back where not, and the sample painted.
async fn face_changed(engine: &Engine, hwnd: u16, lpcf: u32) -> Result<(), Stop> {
    let (_, typed) = into_buffer(
        engine,
        "USER",
        "GetDlgItemText",
        &[A::W(hwnd), A::W(CMB_SIZES), A::S(0), A::W(0x0a)],
        0x0a,
    )
    .await?;

    list_styles(engine, hwnd, lpcf).await?;
    choose_style(engine, hwnd, lpcf, false).await?;

    let sizes = item(engine, hwnd, CMB_SIZES).await?;
    let index = find_exact(engine, sizes, &typed).await?;

    if index < 0 {
        with_text(
            engine,
            "USER",
            "SetDlgItemText",
            &[A::W(hwnd), A::W(CMB_SIZES), A::S(0)],
            &typed,
        )
        .await?;
    } else {
        send_item(engine, hwnd, CMB_SIZES, CB_SETCURSEL, index as u16, 0).await?;
    }

    repaint(engine, hwnd).await
}

/// The dialog ended (`0bfc`): its property removed, and the hook kept in
/// COMMDLG's data again for the messages of its ending.
async fn end(engine: &Engine, hwnd: u16, lpcf: u32, result: u16) -> Result<(), Stop> {
    api(engine, "USER", "EndDialog", &[A::W(hwnd), A::W(result)]).await?;
    remove_property(engine, hwnd, lpcf).await
}

/// The dialog's property removed, its data let go, and the hook kept in
/// COMMDLG's data again (`0c07`, `05b4`).
async fn remove_property(engine: &Engine, hwnd: u16, lpcf: u32) -> Result<(), Stop> {
    let id = api(engine, "USER", "RemoveProp", &[A::W(hwnd), A::D(0xa000)]).await? as u16;

    globals(engine).dialogs.remove(&id);

    if flags(engine, lpcf) & CF_ENABLEHOOK != 0 {
        globals(engine).hook = dword(engine, lpcf, HOOK);
    }

    Ok(())
}

/// OK (`0c35`).
async fn ok(engine: &Engine, hwnd: u16, lpcf: u32) -> Result<(), Stop> {
    let next = |id: u16| async move {
        let control = item(engine, hwnd, id).await?;

        api(
            engine,
            "USER",
            "PostMessage",
            &[A::W(hwnd), A::W(WM_NEXTDLGCTL), A::W(control), A::D(1)],
        )
        .await?;
        Ok::<(), Stop>(())
    };

    let Some(size) = size_typed(engine, hwnd, lpcf, true, true).await? else {
        return next(CMB_SIZES).await;
    };

    put_word(engine, lpcf, I_POINT_SIZE, size.wrapping_mul(10) as u16);

    let lf = dword(engine, lpcf, LP_LOGFONT);

    logfont(engine, hwnd, lpcf, lf, true).await?;

    let flags = flags(engine, lpcf);

    if flags & CF_FORCEFONTEXIST != 0 {
        let wrong = if flags & CF_NOFACESEL != 0 {
            Some((CMB_FACES, 0x502))
        } else if flags & CF_NOSTYLESEL != 0 {
            Some((CMB_STYLES, 0x503))
        } else {
            None
        };

        if let Some((control, text)) = wrong {
            let text = string(text, 0xa0);
            let (_, caption) = into_buffer(
                engine,
                "USER",
                "GetWindowText",
                &[A::W(hwnd), A::S(0), A::W(0xa0)],
                0xa0,
            )
            .await?;

            message_box(engine, hwnd, &text, &caption).await?;
            return next(control).await;
        }
    }

    if flags & CF_EFFECTS != 0 {
        let index = send_item(engine, hwnd, CMB_COLORS, CB_GETCURSEL, 0, 0).await? as u16;
        let colour = send_item(engine, hwnd, CMB_COLORS, CB_GETITEMDATA, index, 0).await?;

        put_dword(engine, lpcf, RGB_COLORS, colour);
    }

    let styles = item(engine, hwnd, CMB_STYLES).await?;
    let (name, _, data) = box_row(engine, styles, 0x20).await?;

    // Where the style is not listed COMMDLG writes a word of its stack it
    // never set (`0d90`); WinBox writes nought.
    put_word(engine, lpcf, N_FONT_TYPE, (data >> 16) as u16);

    if flags & CF_USESTYLE != 0 {
        put(engine, dword(engine, lpcf, LPSZ_STYLE), 0, &text_arg(&name));
    }

    let styles = item(engine, hwnd, CMB_STYLES).await?;

    free_styles(engine, styles).await?;
    end(engine, hwnd, lpcf, 1).await
}
