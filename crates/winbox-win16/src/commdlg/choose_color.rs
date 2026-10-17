//! COMMDLG's Color dialog: `ChooseColor` (5), its procedure `ColorDlgProc`
//! (8) and `WantArrows` (25), the procedure its two grids are subclassed
//! with. **Read out** of `COMMDLG.DLL` seg1 and **recorded** by
//! `choosclr`; each step is COMMDLG's, at the address the comments give
//! ([[topic:choose-color]] in the knowledge base). Its words are kept as
//! COMMDLG keeps them, signed or not as its code takes them.

use std::collections::HashMap;

use super::colour_math::{hls_to_rgb, rgb_to_hls};
use super::guest_calls::{self as support, A, Call, api, call, rect_bytes, rect_of};
use super::templates::{BASIC_COLOURS, COLOR_TEMPLATE};
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;

const WM_MOVE: u16 = 0x0003;
const WM_SETFOCUS: u16 = 0x0007;
const WM_KILLFOCUS: u16 = 0x0008;
const WM_PAINT: u16 = 0x000f;
const WM_GETDLGCODE: u16 = 0x0087;
const WM_KEYDOWN: u16 = 0x0100;
const WM_CHAR: u16 = 0x0102;
const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;
const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONDOWN: u16 = 0x0201;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_LBUTTONDBLCLK: u16 = 0x0203;
const EN_KILLFOCUS: u16 = 0x0200;
const EN_CHANGE: u16 = 0x0300;
const EM_SETSEL: u16 = 0x0401;

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const PSH_HELP: u16 = 0x40e;
const ID_LUMINOSITY: u16 = 0x2be;
const ID_HUE: u16 = 0x2bf;
const ID_SAT: u16 = 0x2c0;
const ID_LUM: u16 = 0x2c1;
const ID_RED: u16 = 0x2c2;
const ID_BLUE: u16 = 0x2c4;
const ID_SAMPLE: u16 = 0x2c5;
const ID_SPECTRUM: u16 = 0x2c6;
const ID_ADD: u16 = 0x2c8;
const ID_SOLID: u16 = 0x2c9;
const ID_DEFINE: u16 = 0x2cf;
const ID_BASIC: u16 = 0x2d0;
const ID_CUSTOM: u16 = 0x2d1;
const ID_HUE_LABEL: u16 = 0x2d3;
const ID_BLUE_LABEL: u16 = 0x2d8;

const CC_RGBINIT: u32 = 0x1;
const CC_FULLOPEN: u32 = 0x2;
const CC_PREVENTFULLOPEN: u32 = 0x4;
const CC_SHOWHELP: u32 = 0x8;
const CC_ENABLEHOOK: u32 = 0x10;
const CC_ENABLETEMPLATE: u32 = 0x20;
const CC_ENABLETEMPLATEHANDLE: u32 = 0x40;

const CDERR_NOTEMPLATE: u32 = 0x3;
const CDERR_NOHINSTANCE: u32 = 0x4;
const CDERR_FINDRESFAILURE: u32 = 0x6;
const CDERR_LOADRESFAILURE: u32 = 0x7;
const CDERR_NOHOOK: u32 = 0xb;
const CDERR_DIALOGFAILURE: u32 = 0xffff;

const SM_CYCAPTION: u16 = 4;
const SM_CXBORDER: u16 = 5;
const SM_CYBORDER: u16 = 6;
const SM_CXSIZE: u16 = 30;
const COLOR_WINDOW: u16 = 5;
const GWL_WNDPROC: u16 = 0xfffc;
const GWL_STYLE: u16 = 0xfff0;
const GWW_ID: u16 = 0xfff4;
const WS_TABSTOP: u32 = 0x0001_0000;
const SRCCOPY: u32 = 0x00cc_0020;
const SW_HIDE: u16 = 0;
const SW_SHOWNORMAL: u16 = 1;
const PS_SOLID: u16 = 0;
const WHITE_BRUSH: u16 = 0;
const NULL_BRUSH: u16 = 5;
const BLACK_PEN: u16 = 7;
const RT_DIALOG: u32 = 5;

/// The structure's fields, by offset.
const HWND_OWNER: u32 = 0x04;
const H_INSTANCE: u32 = 0x06;
const RGB_RESULT: u32 = 0x08;
const CUST_COLORS: u32 = 0x0c;
const FLAGS: u32 = 0x10;
const HOOK: u32 = 0x18;
const TEMPLATE_NAME: u32 = 0x1c;

type Rect = [i16; 4];

/// What COMMDLG keeps for its Color dialogs in its data: one memory DC and
/// one spectrum for all, and the boxes' rectangles of the last measured.
#[derive(Debug, Default, Clone)]
pub(crate) struct ColourGlobals {
    /// `[2C8h]`.
    memory_dc: u16,
    /// `[0AA4h]`.
    spectrum: u16,
    /// `[0AA8h]`: the 64 boxes, client coordinates.
    boxes: Vec<Rect>,
    /// `[0AA2h]`, `[0A52h]`: a box's pitch.
    pitch: (i16, i16),
    /// `[0A94h]`: how many basic colours.
    count: i16,
    /// `[0D56h]`: the mouse captured.
    tracking: bool,
    /// `[0A9Ah]`: the grids' own procedure.
    static_proc: u32,
    /// `[10h]`: the hook, kept while the dialog runs.
    hook: u32,
    /// Each dialog's data, by the number under its property A000h.
    dialogs: HashMap<u16, Dialog>,
}

/// A dialog's data (COMMDLG's 15Eh bytes).
#[derive(Debug, Clone)]
struct Dialog {
    hwnd: u16,
    lpcc: u32,
    rgb: u32,
    hue: u16,
    sat: u16,
    lum: u16,
    width: u16,
    height: u16,
    lum_height: u16,
    custom: u16,
    basic: u16,
    current: u16,
    x: u16,
    y: u16,
    lum_y: u16,
    window: Rect,
    spectrum: Rect,
    mark: Rect,
    bar: Rect,
    colour: Rect,
    solid: Rect,
    sample: Rect,
    full: bool,
    colours: [u32; 64],
}

impl Default for Dialog {
    fn default() -> Self {
        Self {
            hwnd: 0,
            lpcc: 0,
            rgb: 0,
            hue: 0,
            sat: 0,
            lum: 0,
            width: 0,
            height: 0,
            lum_height: 0,
            custom: 0,
            basic: 0,
            current: 0,
            x: 0,
            y: 0,
            lum_y: 0,
            window: [0; 4],
            spectrum: [0; 4],
            mark: [0; 4],
            bar: [0; 4],
            colour: [0; 4],
            solid: [0; 4],
            sample: [0; 4],
            full: false,
            colours: [0; 64],
        }
    }
}

fn at(far: u32, step: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(step) & 0xffff)
}

fn dword(engine: &Engine, far: u32, step: u32) -> u32 {
    let bytes = engine.system().read_far(at(far, step), 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn word(engine: &Engine, far: u32, step: u32) -> u16 {
    dword(engine, far, step) as u16
}

fn set_dword(engine: &Engine, far: u32, step: u32, value: u32) {
    engine
        .system()
        .write_far(at(far, step), &value.to_le_bytes());
}

fn globals(engine: &Engine) -> std::cell::RefMut<'_, ColourGlobals> {
    std::cell::RefMut::map(engine.system(), |system| &mut system.commdlg.colour)
}

fn get(engine: &Engine, id: u16) -> Dialog {
    globals(engine)
        .dialogs
        .get(&id)
        .cloned()
        .unwrap_or_default()
}

fn put(engine: &Engine, id: u16, dialog: &Dialog) {
    globals(engine).dialogs.insert(id, dialog.clone());
}

/// A packed point.
fn point(x: i16, y: i16) -> u32 {
    u32::from(y as u16) << 16 | u32::from(x as u16)
}

fn in_rect(r: Rect, x: i16, y: i16) -> bool {
    x >= r[0] && x < r[2] && y >= r[1] && y < r[3]
}

/// `IntersectRect`: the overlap, if any.
fn intersect(a: Rect, b: Rect) -> Option<Rect> {
    let r = [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ];

    (r[0] < r[2] && r[1] < r[3]).then_some(r)
}

async fn item(engine: &Engine, dialog: u16, id: u16) -> Result<u16, Stop> {
    Ok(api(engine, "USER", "GetDlgItem", &[A::W(dialog), A::W(id)]).await? as u16)
}

async fn metric(engine: &Engine, index: u16) -> Result<i16, Stop> {
    Ok(api(engine, "USER", "GetSystemMetrics", &[A::W(index)]).await? as i16)
}

async fn enable(engine: &Engine, hwnd: u16, on: u16) -> Result<(), Stop> {
    api(engine, "USER", "EnableWindow", &[A::W(hwnd), A::W(on)]).await?;
    Ok(())
}

/// A window's rectangle on the screen.
async fn window_rect(engine: &Engine, hwnd: u16) -> Result<Rect, Stop> {
    let (_, structs) = call(
        engine,
        Call {
            module: "USER",
            name: "GetWindowRect",
            args: &[A::W(hwnd), A::S(0)],
            structs: vec![rect_bytes([0; 4])],
        },
    )
    .await?;

    Ok(rect_of(&structs[0]))
}

/// A rectangle's two corners each taken to a window's client area, as
/// COMMDLG's two calls of `ScreenToClient` do.
async fn to_client(engine: &Engine, hwnd: u16, r: Rect) -> Result<Rect, Stop> {
    let mut out = r;

    for corner in 0..2 {
        let (_, structs) = call(
            engine,
            Call {
                module: "USER",
                name: "ScreenToClient",
                args: &[A::W(hwnd), A::S(0)],
                structs: vec![rect_bytes([r[corner * 2], r[corner * 2 + 1], 0, 0])],
            },
        )
        .await?;
        let p = rect_of(&structs[0]);

        out[corner * 2] = p[0];
        out[corner * 2 + 1] = p[1];
    }

    Ok(out)
}

async fn to_screen(engine: &Engine, hwnd: u16, r: Rect) -> Result<Rect, Stop> {
    let mut out = r;

    for corner in 0..2 {
        let (_, structs) = call(
            engine,
            Call {
                module: "USER",
                name: "ClientToScreen",
                args: &[A::W(hwnd), A::S(0)],
                structs: vec![rect_bytes([r[corner * 2], r[corner * 2 + 1], 0, 0])],
            },
        )
        .await?;
        let p = rect_of(&structs[0]);

        out[corner * 2] = p[0];
        out[corner * 2 + 1] = p[1];
    }

    Ok(out)
}

/// A call with one rectangle.
async fn with_rect(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    before: &[A],
    r: Rect,
    after: &[A],
) -> Result<u32, Stop> {
    let args: Vec<A> = before
        .iter()
        .copied()
        .chain(std::iter::once(A::S(0)))
        .chain(after.iter().copied())
        .collect();

    Ok(call(
        engine,
        Call {
            module,
            name,
            args: &args,
            structs: vec![rect_bytes(r)],
        },
    )
    .await?
    .0)
}

async fn invalidate(engine: &Engine, hwnd: u16, r: Rect) -> Result<(), Stop> {
    with_rect(
        engine,
        "USER",
        "InvalidateRect",
        &[A::W(hwnd)],
        r,
        &[A::W(0)],
    )
    .await?;
    Ok(())
}

async fn validate(engine: &Engine, hwnd: u16, r: Rect) -> Result<(), Stop> {
    with_rect(engine, "USER", "ValidateRect", &[A::W(hwnd)], r, &[]).await?;
    Ok(())
}

async fn fill(engine: &Engine, hdc: u16, r: Rect, hbr: u16) -> Result<(), Stop> {
    with_rect(engine, "USER", "FillRect", &[A::W(hdc)], r, &[A::W(hbr)]).await?;
    Ok(())
}

async fn brush(engine: &Engine, colour: u32) -> Result<u16, Stop> {
    Ok(api(engine, "GDI", "CreateSolidBrush", &[A::D(colour)]).await? as u16)
}

async fn delete(engine: &Engine, object: u16) -> Result<(), Stop> {
    api(engine, "GDI", "DeleteObject", &[A::W(object)]).await?;
    Ok(())
}

async fn select(engine: &Engine, hdc: u16, object: u16) -> Result<u16, Stop> {
    Ok(api(engine, "GDI", "SelectObject", &[A::W(hdc), A::W(object)]).await? as u16)
}

async fn stock(engine: &Engine, index: u16) -> Result<u16, Stop> {
    Ok(api(engine, "GDI", "GetStockObject", &[A::W(index)]).await? as u16)
}

async fn rectangle(engine: &Engine, hdc: u16, r: Rect) -> Result<(), Stop> {
    api(
        engine,
        "GDI",
        "Rectangle",
        &[
            A::W(hdc),
            A::W(r[0] as u16),
            A::W(r[1] as u16),
            A::W(r[2] as u16),
            A::W(r[3] as u16),
        ],
    )
    .await?;
    Ok(())
}

async fn get_dc(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    Ok(api(engine, "USER", "GetDC", &[A::W(hwnd)]).await? as u16)
}

async fn release_dc(engine: &Engine, hwnd: u16, hdc: u16) -> Result<(), Stop> {
    api(engine, "USER", "ReleaseDC", &[A::W(hwnd), A::W(hdc)]).await?;
    Ok(())
}

async fn nearest(engine: &Engine, hdc: u16, colour: u32) -> Result<u32, Stop> {
    api(engine, "GDI", "GetNearestColor", &[A::W(hdc), A::D(colour)]).await
}

async fn set_int(engine: &Engine, dialog: u16, id: u16, value: u16) -> Result<(), Stop> {
    api(
        engine,
        "USER",
        "SetDlgItemInt",
        &[A::W(dialog), A::W(id), A::W(value), A::W(0)],
    )
    .await?;
    Ok(())
}

/// `GetDlgItemInt` unsigned: the number and whether it was one.
async fn get_int(engine: &Engine, dialog: u16, id: u16) -> Result<(u16, bool), Stop> {
    let (value, structs) = call(
        engine,
        Call {
            module: "USER",
            name: "GetDlgItemInt",
            args: &[A::W(dialog), A::W(id), A::S(0), A::W(0)],
            structs: vec![vec![0, 0]],
        },
    )
    .await?;

    Ok((value as u16, structs[0] != [0, 0]))
}

/// Whether a control's text is not empty: `GetDlgItemText` into two bytes.
async fn has_text(engine: &Engine, dialog: u16, id: u16) -> Result<bool, Stop> {
    Ok(call(
        engine,
        Call {
            module: "USER",
            name: "GetDlgItemText",
            args: &[A::W(dialog), A::W(id), A::S(0), A::W(2)],
            structs: vec![vec![0, 0]],
        },
    )
    .await?
    .0 != 0)
}

/// The number put back and selected (`0ab4`, `2b78`).
async fn select_all(engine: &Engine, dialog: u16, id: u16) -> Result<(), Stop> {
    api(
        engine,
        "USER",
        "SendDlgItemMessage",
        &[
            A::W(dialog),
            A::W(id),
            A::W(EM_SETSEL),
            A::W(0),
            A::D(0x7fff_0000),
        ],
    )
    .await?;
    Ok(())
}

pub fn choose_color(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let lpcc = args.dword(&engine.system());

        Ok(Answer::Word(choose(engine, lpcc).await?))
    })
}

/// `ChooseColor` (seg1 `0ea1`).
async fn choose(engine: &Engine, lpcc: u32) -> Result<u16, Stop> {
    let fail = |code: Option<u32>| {
        if let Some(code) = code {
            support::set_extended_error(&mut engine.system(), code);
        }

        globals(engine).hook = 0;
        Ok(0)
    };

    if dword(engine, lpcc, 0) != 0x20 {
        return Ok(0);
    }

    let flags = dword(engine, lpcc, FLAGS);

    if flags & CC_ENABLEHOOK != 0 {
        let hook = dword(engine, lpcc, HOOK);

        if hook == 0 {
            support::set_extended_error(&mut engine.system(), CDERR_NOHOOK);
            return Ok(0);
        }

        globals(engine).hook = hook;
    } else {
        set_dword(engine, lpcc, HOOK, 0);
    }

    let program = word(engine, lpcc, H_INSTANCE);
    let (handle, own) = if flags & CC_ENABLETEMPLATEHANDLE != 0 {
        if program == 0 {
            return fail(Some(CDERR_NOTEMPLATE));
        }

        (program, false)
    } else if flags & CC_ENABLETEMPLATE != 0 {
        let name = dword(engine, lpcc, TEMPLATE_NAME);

        if name == 0 {
            return fail(Some(CDERR_NOTEMPLATE));
        }

        if program == 0 {
            return fail(Some(CDERR_NOHINSTANCE));
        }

        let found = api(
            engine,
            "KERNEL",
            "FindResource",
            &[A::W(program), A::D(name), A::D(RT_DIALOG)],
        )
        .await? as u16;

        if found == 0 {
            return fail(Some(CDERR_FINDRESFAILURE));
        }

        let loaded = api(
            engine,
            "KERNEL",
            "LoadResource",
            &[A::W(program), A::W(found)],
        )
        .await? as u16;

        if loaded == 0 {
            return fail(Some(CDERR_LOADRESFAILURE));
        }

        (loaded, false)
    } else {
        (support::own_template(engine, COLOR_TEMPLATE).await?, true)
    };

    if api(engine, "KERNEL", "LockResource", &[A::W(handle)]).await? == 0 {
        return fail(None);
    }

    let instance = support::instance(engine);
    let proc = support::export_address(engine, 8);
    let owner = word(engine, lpcc, HWND_OWNER);
    let mut answer = api(
        engine,
        "USER",
        "DialogBoxIndirectParam",
        &[
            A::W(instance),
            A::W(handle),
            A::W(owner),
            A::D(proc),
            A::D(lpcc),
        ],
    )
    .await? as u16;

    if answer == 0xffff {
        support::set_extended_error(&mut engine.system(), CDERR_DIALOGFAILURE);
        answer = 0;
    }

    api(engine, "KERNEL", "GlobalUnlock", &[A::W(handle)]).await?;

    if own {
        support::free_template(engine, handle).await?;
    }

    globals(engine).hook = 0;
    Ok(answer)
}

pub fn color_dlg_proc(engine: &Engine, mut args: Args) -> Later<'_> {
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

/// The dialog's number under its property: nought before it starts.
async fn number(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    Ok(api(engine, "USER", "GetProp", &[A::W(hwnd), A::D(0xa000)]).await? as u16)
}

/// The dialog's procedure (seg1 `0197`).
#[allow(clippy::too_many_lines)]
async fn procedure(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    let id = number(engine, hwnd).await?;

    if id != 0 {
        let lpcc = get(engine, id).lpcc;

        if dword(engine, lpcc, FLAGS) & CC_ENABLEHOOK != 0 {
            let hook = dword(engine, lpcc, HOOK);
            let words = [hwnd, message, wparam, (lparam >> 16) as u16, lparam as u16];
            let answer = support::call_hook(engine, hook, &words).await?;

            if answer != 0 {
                return Ok(answer);
            }
        }
    }

    let x = lparam as i16;
    let y = (lparam >> 16) as i16;

    match message {
        WM_MOVE => {
            let mut d = get(engine, id);

            measure(engine, &mut d).await?;
            put(engine, id, &d);
            return Ok(0);
        }
        WM_PAINT => {
            let (_, structs) = call(
                engine,
                Call {
                    module: "USER",
                    name: "BeginPaint",
                    args: &[A::W(hwnd), A::S(0)],
                    structs: vec![vec![0; 32]],
                },
            )
            .await?;
            let ps = &structs[0];
            let hdc = u16::from_le_bytes([ps[0], ps[1]]);
            let area = rect_of(&ps[4..12]);

            paint(engine, hwnd, id, hdc, area).await?;
            call(
                engine,
                Call {
                    module: "USER",
                    name: "EndPaint",
                    args: &[A::W(hwnd), A::S(0)],
                    structs: vec![ps.clone()],
                },
            )
            .await?;
        }
        WM_GETDLGCODE => return Ok(0x0d),
        WM_KEYDOWN => {
            if let Some(index) = key(engine, id, wparam).await? {
                move_focus(engine, id, index).await?;
            }
        }
        WM_CHAR => {
            if wparam == 0x20 {
                return space(engine, hwnd, id).await;
            }
        }
        WM_INITDIALOG => {
            support::wait_cursor(engine, true);

            let answer = start(engine, hwnd, wparam, lparam).await?;

            support::wait_cursor(engine, false);

            if answer != 0 {
                api(
                    engine,
                    "USER",
                    "ShowWindow",
                    &[A::W(hwnd), A::W(SW_SHOWNORMAL)],
                )
                .await?;
            }

            return Ok(answer);
        }
        WM_COMMAND => return command(engine, hwnd, id, wparam, lparam).await,
        WM_MOUSEMOVE | WM_LBUTTONDOWN => {
            if message == WM_MOUSEMOVE && !globals(engine).tracking {
                return Ok(1);
            }

            return press(engine, hwnd, id, message, x, y).await;
        }
        WM_LBUTTONUP => {
            if globals(engine).tracking {
                globals(engine).tracking = false;
                api(engine, "USER", "SetCapture", &[A::W(0)]).await?;
                api(engine, "USER", "ClipCursor", &[A::D(0)]).await?;

                let mut d = get(engine, id);

                if in_rect(d.spectrum, x, y) {
                    let hdc = get_dc(engine, hwnd).await?;

                    d.x = x as u16;
                    d.y = y as u16;
                    put(engine, id, &d);
                    cross(engine, hdc, d.x, d.y, &d).await?;
                    paint_parts(engine, &d, hdc, d.bar).await?;
                    release_dc(engine, hwnd, hdc).await?;
                    validate(engine, hwnd, d.spectrum).await?;
                } else if in_rect(d.bar, x, y) {
                    let hdc = get_dc(engine, hwnd).await?;

                    arrow(engine, hdc, &d).await?;
                    release_dc(engine, hwnd, hdc).await?;
                    validate(engine, hwnd, d.bar).await?;
                }
            }
        }
        WM_LBUTTONDBLCLK => {
            let d = get(engine, id);

            if in_rect(d.solid, x, y) {
                solid(engine, id).await?;
            }
        }
        _ => {
            let set_rgb = support::registered_message(engine, "commdlg_SetRGBColor");

            if message != set_rgb {
                return Ok(0);
            }

            let mut d = get(engine, id);

            if find_colour(engine, &mut d, lparam).await? {
                d.rgb = lparam;

                if d.custom > d.current {
                    d.basic = d.current;
                } else {
                    d.custom = d.current;
                }
            }

            put(engine, id, &d);

            if d.full {
                let mut d = get(engine, id);

                d.rgb = lparam;
                put(engine, id, &d);
                rgb_changed(engine, id).await?;
                set_hls_edits(engine, id, 0).await?;
                set_rgb_edits(engine, id, 0).await?;

                let d = get(engine, id);
                let hdc = get_dc(engine, hwnd).await?;

                paint_parts(engine, &d, hdc, d.sample).await?;
                release_dc(engine, hwnd, hdc).await?;
            }
        }
    }

    Ok(1)
}

/// The colour looked for among the 64 boxes; found, it is chosen (`014e`).
async fn find_colour(engine: &Engine, d: &mut Dialog, rgb: u32) -> Result<bool, Stop> {
    let Some(index) = d.colours.iter().position(|&c| c == rgb) else {
        return Ok(false);
    };

    choose_box(engine, d, index as u16).await?;
    d.current = index as u16;
    Ok(true)
}

/// A box's frame, black or the window's colour, a pixel outside it
/// (`1023`).
async fn frame(engine: &Engine, hdc: u16, index: u16, black: bool) -> Result<(), Stop> {
    let b = globals(engine).boxes[index as usize];
    let r = [b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1];
    let colour = if black {
        0
    } else {
        api(engine, "USER", "GetSysColor", &[A::W(COLOR_WINDOW)]).await?
    };
    let hbr = brush(engine, colour).await?;

    with_rect(engine, "USER", "FrameRect", &[A::W(hdc)], r, &[A::W(hbr)]).await?;
    delete(engine, hbr).await
}

/// A box chosen: its frame moved to it, and the colour taken (`1086`).
async fn choose_box(engine: &Engine, d: &mut Dialog, index: u16) -> Result<(), Stop> {
    let hdc = get_dc(engine, d.hwnd).await?;

    frame(engine, hdc, d.current, false).await?;
    frame(engine, hdc, index, true).await?;
    release_dc(engine, d.hwnd, hdc).await?;
    d.rgb = d.colours[index as usize];
    Ok(())
}

/// The focus box moved within its grid (`10d9`): the old one's focus
/// rectangle drawn over in the window's colour, the new one's drawn.
async fn move_focus(engine: &Engine, id: u16, index: u16) -> Result<(), Stop> {
    let mut d = get(engine, id);
    let colour = api(engine, "USER", "GetSysColor", &[A::W(COLOR_WINDOW)]).await?;
    let pen = api(
        engine,
        "GDI",
        "CreatePen",
        &[A::W(PS_SOLID), A::W(1), A::D(colour)],
    )
    .await? as u16;
    let hollow = stock(engine, NULL_BRUSH).await?;
    let hdc = get_dc(engine, d.hwnd).await?;
    let old_pen = select(engine, hdc, pen).await?;
    let old_brush = select(engine, hdc, hollow).await?;
    let custom = index >= 0x30;
    let old = if custom { d.custom } else { d.basic };
    let inflated = |i: u16| {
        let b = globals(engine).boxes[i as usize];

        [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3]
    };

    rectangle(engine, hdc, inflated(old)).await?;

    if custom {
        d.custom = index;
    } else {
        d.basic = index;
    }

    put(engine, id, &d);

    let r = inflated(index);

    rectangle(engine, hdc, r).await?;
    with_rect(engine, "USER", "DrawFocusRect", &[A::W(hdc)], r, &[]).await?;

    let pen = select(engine, hdc, old_pen).await?;

    select(engine, hdc, old_brush).await?;
    release_dc(engine, d.hwnd, hdc).await?;
    delete(engine, pen).await
}

/// The keys of a grid (`11ff`): the box the focus moves to, if it moves to
/// one not chosen in either grid.
async fn key(engine: &Engine, id: u16, vk: u16) -> Result<Option<u16>, Stop> {
    let d = get(engine, id);
    let focus = api(engine, "USER", "GetFocus", &[]).await? as u16;
    let control = api(
        engine,
        "USER",
        "GetWindowWord",
        &[A::W(focus), A::W(GWW_ID)],
    )
    .await? as u16;
    let mut i = match control {
        ID_BASIC => d.basic,
        ID_CUSTOM => d.custom,
        _ => return Ok(None),
    };
    let count = globals(engine).count as u16;

    match vk {
        0x23 => {
            i = if d.basic == i {
                count.wrapping_sub(1)
            } else {
                0x3f
            }
        }
        0x24 => i = if d.basic == i { 0 } else { 0x30 },
        0x25 if i & 7 != 0 => i -= 1,
        0x26 if i >= 0x38 || (8..0x30).contains(&i) => i -= 8,
        0x27 => {
            i += 1;

            if i.trailing_zeros() >= 3 {
                i -= 1;
            }
        }
        0x28 if i < 0x28 || (0x30..0x38).contains(&i) => i += 8,
        _ => {}
    }

    if count <= i && i < 0x30 {
        i = d.basic;
    }

    Ok((i != d.basic && i != d.custom).then_some(i))
}

/// Space on a grid: its focus box chosen (`0751`).
async fn space(engine: &Engine, hwnd: u16, id: u16) -> Result<u16, Stop> {
    let focus = api(engine, "USER", "GetFocus", &[]).await? as u16;
    let mut d = get(engine, id);
    let index = if item(engine, hwnd, ID_BASIC).await? == focus {
        d.basic
    } else if item(engine, hwnd, ID_CUSTOM).await? == focus {
        d.custom
    } else {
        return Ok(0);
    };

    d.rgb = d.colours[index as usize];
    put(engine, id, &d);
    rgb_changed(engine, id).await?;

    let mut d = get(engine, id);

    invalidate(engine, hwnd, d.sample).await?;
    choose_box(engine, &mut d, index).await?;
    d.current = index;
    put(engine, id, &d);

    if d.full {
        set_hls_edits(engine, id, 0).await?;
        set_rgb_edits(engine, id, 0).await?;
    }

    Ok(1)
}

/// The rectangles measured (`1654`).
async fn measure(engine: &Engine, d: &mut Dialog) -> Result<(), Stop> {
    let hwnd = d.hwnd;
    let half = metric(engine, SM_CXSIZE).await? >> 1;
    let s = window_rect(engine, item(engine, hwnd, ID_SPECTRUM).await?).await?;

    d.spectrum = to_client(engine, hwnd, [s[0] + 1, s[1] + 1, s[2] - 1, s[3] - 1]).await?;

    let mut b = window_rect(engine, item(engine, hwnd, ID_LUMINOSITY).await?).await?;

    b[2] += half;
    d.bar = to_client(engine, hwnd, b).await?;
    d.mark = [d.bar[2], d.bar[1], d.bar[2] + half, d.bar[3]];
    d.lum_height = (d.bar[3] - d.bar[1]) as u16;

    let c = window_rect(engine, item(engine, hwnd, ID_SAMPLE).await?).await?;
    let left = c[0] + 1;
    // `idiv`, a signed division by two (`1760`).
    #[allow(clippy::manual_midpoint)]
    let middle = (c[2] + left) / 2;

    d.colour = to_client(engine, hwnd, [left, c[1] + 1, middle, c[3] - 1]).await?;
    d.solid = to_client(engine, hwnd, [middle, c[1] + 1, c[2] - 1, c[3] - 1]).await?;
    d.sample = [d.colour[0], d.colour[1], d.solid[2], d.solid[3]];
    Ok(())
}

/// The grids measured and subclassed, and the basic colours read
/// (`139a`).
async fn grids(engine: &Engine, d: &mut Dialog) -> Result<(), Stop> {
    let hwnd = d.hwnd;
    let basic = item(engine, hwnd, ID_BASIC).await?;
    let custom = item(engine, hwnd, ID_CUSTOM).await?;
    let old = api(
        engine,
        "USER",
        "GetWindowLong",
        &[A::W(basic), A::W(GWL_WNDPROC)],
    )
    .await?;
    let arrows = support::export_address(engine, 25);

    globals(engine).static_proc = old;

    for grid in [basic, custom] {
        api(
            engine,
            "USER",
            "SetWindowLong",
            &[A::W(grid), A::W(GWL_WNDPROC), A::D(arrows)],
        )
        .await?;
    }

    let r = window_rect(engine, basic).await?;
    let r = to_client(engine, hwnd, r).await?;
    let (left, top) = (r[0] + 3, r[1] + 3);
    let pitch_w = (r[2] - 3 - left) / 8;
    let pitch_h = (r[3] - 3 - top) / 6;
    let (count, colours) = display_colours(engine).await?;
    let mut boxes = vec![[0i16; 4]; 64];

    for i in 0..48i16 {
        let l = (i % 8) * pitch_w + left;
        let t = (i / 8) * pitch_h + top;

        boxes[i as usize] = [l, t, l + pitch_w - 5, t + pitch_h - 5];
        d.colours[i as usize] = if i < count {
            colours[i as usize]
        } else if count != 0 {
            0x00ff_ffff
        } else {
            BASIC_COLOURS[i as usize]
        };
    }

    let r = window_rect(engine, custom).await?;
    let r = to_client(engine, hwnd, r).await?;
    let (left, top) = (r[0] + 3, r[1] + 3);

    for j in 0..16i16 {
        let l = (j % 8) * pitch_w + left;
        let t = (j / 8) * pitch_h + top;

        boxes[(0x30 + j) as usize] = [l, t, l + pitch_w - 5, t + pitch_h - 5];
    }

    let mut g = globals(engine);

    g.boxes = boxes;
    g.pitch = (pitch_w, pitch_h);
    g.count = if count == 0 { 0x30 } else { count };
    Ok(())
}

/// The display driver's colours, `OEMBIN` 2: how many, at most 48, and
/// they; none without it.
async fn display_colours(engine: &Engine) -> Result<(i16, Vec<u32>), Stop> {
    let module = call(
        engine,
        Call {
            module: "KERNEL",
            name: "GetModuleHandle",
            args: &[A::S(0)],
            structs: vec![b"DISPLAY\0".to_vec()],
        },
    )
    .await?
    .0 as u16;
    let found = call(
        engine,
        Call {
            module: "KERNEL",
            name: "FindResource",
            args: &[A::W(module), A::D(2), A::S(0)],
            structs: vec![b"OEMBIN\0".to_vec()],
        },
    )
    .await?
    .0 as u16;

    if found == 0 {
        return Ok((0, Vec::new()));
    }

    let loaded = api(
        engine,
        "KERNEL",
        "LoadResource",
        &[A::W(module), A::W(found)],
    )
    .await? as u16;

    if loaded == 0 {
        return Ok((0, Vec::new()));
    }

    let far = api(engine, "KERNEL", "LockResource", &[A::W(loaded)]).await?;
    let mut count = 0;
    let mut colours = Vec::new();

    if far != 0 {
        count = (word(engine, far, 0) as i16).min(0x30);

        for i in 0..count.max(0) as u32 {
            colours.push(dword(engine, far, 2 + i * 4));
        }

        api(engine, "KERNEL", "GlobalUnlock", &[A::W(loaded)]).await?;
    }

    api(engine, "KERNEL", "FreeResource", &[A::W(loaded)]).await?;
    Ok((count, colours))
}

/// `WM_INITDIALOG` (`17c5`).
#[allow(clippy::too_many_lines)]
async fn start(engine: &Engine, hwnd: u16, wparam: u16, lpcc: u32) -> Result<u16, Stop> {
    let solid_button = item(engine, hwnd, ID_SOLID).await?;

    if globals(engine).memory_dc == 0 {
        let hdc = get_dc(engine, hwnd).await?;
        let memory = api(engine, "GDI", "CreateCompatibleDC", &[A::W(hdc)]).await? as u16;

        release_dc(engine, hwnd, hdc).await?;
        globals(engine).memory_dc = memory;

        if memory == 0 {
            return Ok(0);
        }
    }

    let id = support::next_number(engine);
    let handle = id;
    api(
        engine,
        "USER",
        "SetProp",
        &[A::W(hwnd), A::D(0xa000), A::W(handle)],
    )
    .await?;
    globals(engine).hook = dword(engine, lpcc, HOOK);

    let mut d = Dialog {
        hwnd,
        lpcc,
        ..Dialog::default()
    };

    measure(engine, &mut d).await?;

    let flags = dword(engine, lpcc, FLAGS);

    d.rgb = if flags & CC_RGBINIT != 0 {
        dword(engine, lpcc, RGB_RESULT)
    } else {
        0
    };
    put(engine, id, &d);

    if flags & (CC_FULLOPEN | CC_PREVENTFULLOPEN) != 0 {
        enable(engine, item(engine, hwnd, ID_DEFINE).await?, 0).await?;
    }

    if flags & CC_FULLOPEN != 0 {
        draw_spectrum(engine, id).await?;

        let mut d = get(engine, id);
        let (h, l, s) = rgb_to_hls(d.rgb);

        d.full = true;
        d.hue = h;
        d.sat = s;
        d.lum = l;
        put(engine, id, &d);
        set_rgb_edits(engine, id, 0).await?;
        set_hls_edits(engine, id, 0).await?;
    } else {
        for control in (ID_HUE..=ID_BLUE).chain(ID_HUE_LABEL..=ID_BLUE_LABEL) {
            enable(engine, item(engine, hwnd, control).await?, 0).await?;
        }

        enable(engine, item(engine, hwnd, ID_ADD).await?, 0).await?;
        enable(engine, solid_button, 0).await?;

        let mut d = get(engine, id);

        d.full = false;

        let basic = window_rect(engine, item(engine, hwnd, ID_BASIC).await?).await?;
        let spectrum = window_rect(engine, item(engine, hwnd, ID_SPECTRUM).await?).await?;
        let w = window_rect(engine, hwnd).await?;

        d.window = w;
        put(engine, id, &d);

        // A signed division by two (`19b5`).
        #[allow(clippy::manual_midpoint)]
        let width = (spectrum[0] + basic[2]) / 2 - w[0];

        api(
            engine,
            "USER",
            "MoveWindow",
            &[
                A::W(hwnd),
                A::W(w[0] as u16),
                A::W(w[1] as u16),
                A::W(width as u16),
                A::W((w[3] - w[1]) as u16),
                A::W(0),
            ],
        )
        .await?;
    }

    let mut d = get(engine, id);

    grids(engine, &mut d).await?;

    let custom = dword(engine, lpcc, CUST_COLORS);

    for i in 0..16 {
        d.colours[0x30 + i] = dword(engine, custom, i as u32 * 4);
    }

    d.basic = 0;
    d.current = 0;
    d.custom = 0x30;

    let rgb = d.rgb;

    find_colour(engine, &mut d, rgb).await?;

    if d.custom > d.current {
        d.basic = d.current;
    } else {
        d.custom = d.current;
    }

    put(engine, id, &d);

    if flags & CC_SHOWHELP == 0 {
        let help = item(engine, hwnd, PSH_HELP).await?;

        enable(engine, help, 0).await?;
        api(engine, "USER", "ShowWindow", &[A::W(help), A::W(SW_HIDE)]).await?;
    }

    let style = api(
        engine,
        "USER",
        "GetWindowLong",
        &[A::W(solid_button), A::W(GWL_STYLE)],
    )
    .await?;

    api(
        engine,
        "USER",
        "SetWindowLong",
        &[
            A::W(solid_button),
            A::W(GWL_STYLE),
            A::D(style & !WS_TABSTOP),
        ],
    )
    .await?;

    if flags & CC_ENABLEHOOK != 0 {
        let hook = dword(engine, lpcc, HOOK);
        let words = [
            hwnd,
            WM_INITDIALOG,
            wparam,
            (lpcc >> 16) as u16,
            lpcc as u16,
        ];

        return support::call_hook(engine, hook, &words).await;
    }

    Ok(1)
}

/// The spectrum drawn into its bitmap, and the numbers and marks set from
/// the colour (`23f8`).
async fn draw_spectrum(engine: &Engine, id: u16) -> Result<bool, Stop> {
    let mut d = get(engine, id);
    let (hue, lum, sat) = rgb_to_hls(d.rgb);

    measure(engine, &mut d).await?;
    d.width = (d.spectrum[2] - d.spectrum[0]) as u16;
    d.height = (d.spectrum[3] - d.spectrum[1]) as u16;
    d.hue = hue;
    d.sat = sat;
    d.lum = lum;
    positions(&mut d, 0);
    put(engine, id, &d);
    set_rgb_edits(engine, id, 0).await?;
    set_hls_edits(engine, id, 0).await?;

    let hwnd = d.hwnd;
    let mut hdc = 0;

    if globals(engine).spectrum == 0 {
        hdc = get_dc(engine, hwnd).await?;

        let bitmap = api(
            engine,
            "GDI",
            "CreateCompatibleBitmap",
            &[A::W(hdc), A::W(d.width), A::W(d.height)],
        )
        .await? as u16;

        globals(engine).spectrum = bitmap;

        if bitmap == 0 {
            return Ok(false);
        }
    }

    let (memory, bitmap) = {
        let g = globals(engine);

        (g.memory_dc, g.spectrum)
    };
    let old = select(engine, memory, bitmap).await?;
    let (w, h) = (u32::from(d.width), u32::from(d.height));
    let mut bottom = 0i16;
    let mut sat = 240u16;

    while sat != 0 {
        let top = bottom;

        bottom = ((240 * h).wrapping_sub(u32::from(sat - 8) * h) / 240) as i16;

        let mut right = 0i16;
        let mut hue = 0u16;

        while hue < 239 {
            let left = right;

            right = (u32::from(hue + 4) * w / 240) as i16;

            let hbr = brush(engine, hls_to_rgb(hue, 120, sat)).await?;

            fill(engine, memory, [left, top, right, bottom], hbr).await?;
            delete(engine, hbr).await?;
            hue += 4;
        }

        sat -= 8;
    }

    select(engine, memory, old).await?;

    if hdc != 0 {
        release_dc(engine, hwnd, hdc).await?;
    }

    api(engine, "USER", "UpdateWindow", &[A::W(hwnd)]).await?;
    Ok(true)
}

/// Hue, saturation and luminosity from where the marks are (`21ba`).
fn numbers(d: &mut Dialog, id: u16) {
    let hue = |d: &Dialog, less: u32| {
        let span = u32::from(d.width).wrapping_sub(less) & 0xffff;
        let x = u32::from((d.x as i16).wrapping_sub(d.spectrum[0]) as u16);

        ((x * 239) / span.max(1)) as u16
    };
    let sat = |d: &Dialog, less: u32| {
        let span = u32::from(d.height).wrapping_sub(less) & 0xffff;
        let y = u32::from((d.y as i16).wrapping_sub(d.spectrum[1]) as u16);

        240u16.wrapping_sub(((y * 240) / span.max(1)) as u16)
    };
    let lum = |d: &Dialog, less: u32| {
        let span = u32::from(d.lum_height).wrapping_sub(less) & 0xffff;
        let y = u32::from((d.lum_y as i16).wrapping_sub(d.bar[1]) as u16);

        240u16.wrapping_sub(((y * 240) / span.max(1)) as u16)
    };

    match id {
        ID_HUE => d.hue = hue(d, 1),
        ID_SAT => d.sat = sat(d, 1),
        ID_LUM => d.lum = lum(d, 1),
        _ => {
            d.hue = hue(d, 0);
            d.sat = sat(d, 0);
            d.lum = lum(d, 0);
        }
    }
}

/// Where the marks go for the numbers (`2276`).
fn positions(d: &mut Dialog, id: u16) {
    let x =
        |d: &Dialog| ((u32::from(d.hue) * u32::from(d.width)) / 239) as u16 as i16 + d.spectrum[0];
    let y = |d: &Dialog| {
        ((u32::from(240u16.wrapping_sub(d.sat)) * u32::from(d.height.wrapping_sub(1))) / 240) as u16
            as i16
            + d.spectrum[1]
    };
    let lum_y = |d: &Dialog| {
        ((u32::from(240u16.wrapping_sub(d.lum)) * u32::from(d.lum_height.wrapping_sub(1))) / 240)
            as u16 as i16
            + d.bar[1]
    };

    match id {
        ID_HUE => d.x = x(d) as u16,
        ID_SAT => d.y = y(d) as u16,
        ID_LUM => d.lum_y = lum_y(d) as u16,
        _ => {
            d.x = x(d) as u16;
            d.y = y(d) as u16;
            d.lum_y = lum_y(d) as u16;
        }
    }
}

/// The hue, saturation and luminosity controls set (`2314`).
async fn set_hls_edits(engine: &Engine, id: u16, which: u16) -> Result<(), Stop> {
    let d = get(engine, id);

    match which {
        ID_HUE => set_int(engine, d.hwnd, ID_HUE, d.hue).await,
        ID_SAT => set_int(engine, d.hwnd, ID_SAT, d.sat).await,
        ID_LUM => set_int(engine, d.hwnd, ID_LUM, d.lum).await,
        _ => {
            set_int(engine, d.hwnd, ID_HUE, d.hue).await?;
            set_int(engine, d.hwnd, ID_SAT, get(engine, id).sat).await?;
            set_int(engine, d.hwnd, ID_LUM, get(engine, id).lum).await
        }
    }
}

/// The red, green and blue controls set (`237b`): from the colour as the
/// call began.
async fn set_rgb_edits(engine: &Engine, id: u16, which: u16) -> Result<(), Stop> {
    let d = get(engine, id);
    let part = |shift: u32| ((d.rgb >> shift) & 0xff) as u16;

    match which {
        ID_RED => set_int(engine, d.hwnd, ID_RED, part(0)).await,
        0x2c3 => set_int(engine, d.hwnd, 0x2c3, part(8)).await,
        ID_BLUE => set_int(engine, d.hwnd, ID_BLUE, part(16)).await,
        _ => {
            set_int(engine, d.hwnd, ID_RED, part(0)).await?;
            set_int(engine, d.hwnd, 0x2c3, part(8)).await?;
            set_int(engine, d.hwnd, ID_BLUE, part(16)).await
        }
    }
}

/// The colour changed: its hue, saturation and luminosity, the marks moved
/// and the bar painted again where they changed (`1c52`).
async fn rgb_changed(engine: &Engine, id: u16) -> Result<(), Stop> {
    let d = get(engine, id);
    let (h, l, s) = rgb_to_hls(d.rgb);
    let hwnd = d.hwnd;

    if d.lum != l {
        let hdc = get_dc(engine, hwnd).await?;

        erase_arrow(engine, hdc, &get(engine, id)).await?;

        let mut d = get(engine, id);

        d.lum = l;
        positions(&mut d, ID_LUM);
        put(engine, id, &d);
        arrow(engine, hdc, &d).await?;
        release_dc(engine, hwnd, hdc).await?;
    }

    let d = get(engine, id);

    if d.hue != h || d.sat != s {
        let mut d = d;

        d.hue = h;
        d.sat = s;
        put(engine, id, &d);
        invalidate(engine, hwnd, d.bar).await?;

        let hdc = get_dc(engine, hwnd).await?;

        erase_cross(engine, hdc, &d).await?;
        positions(&mut d, ID_HUE);
        positions(&mut d, ID_SAT);
        put(engine, id, &d);
        cross(engine, hdc, d.x, d.y, &d).await?;
        release_dc(engine, hwnd, hdc).await?;
    }

    Ok(())
}

/// The luminosity's mark (`1d0b`): a triangle, black-edged and white,
/// pointing at the bar from its right.
async fn arrow(engine: &Engine, hdc: u16, d: &Dialog) -> Result<(), Stop> {
    let c = metric(engine, SM_CYCAPTION).await? >> 2;
    let y = d.lum_y as i16;
    let points: Vec<u8> = [d.mark[0] + 2, y, d.mark[2] - 1, y - c, d.mark[2] - 1, y + c]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    let pen = stock(engine, BLACK_PEN).await?;
    let old_pen = select(engine, hdc, pen).await?;
    let white = stock(engine, WHITE_BRUSH).await?;
    let old_brush = select(engine, hdc, white).await?;

    call(
        engine,
        Call {
            module: "GDI",
            name: "Polygon",
            args: &[A::W(hdc), A::S(0), A::W(3)],
            structs: vec![points],
        },
    )
    .await?;
    select(engine, hdc, old_pen).await?;
    select(engine, hdc, old_brush).await?;
    Ok(())
}

/// The mark taken away: filled with the window's colour (`1d96`).
async fn erase_arrow(engine: &Engine, hdc: u16, d: &Dialog) -> Result<(), Stop> {
    let window = api(engine, "USER", "GetSysColor", &[A::W(COLOR_WINDOW)]).await?;
    let colour = nearest(engine, hdc, window).await?;
    let hbr = brush(engine, colour).await?;
    let c = metric(engine, SM_CYCAPTION).await? >> 2;
    let y = d.lum_y as i16;

    fill(
        engine,
        hdc,
        [d.mark[0] + 1, y - c - 1, d.mark[2], y + c + 1],
        hbr,
    )
    .await?;
    delete(engine, hbr).await
}

/// The cross taken away: the spectrum copied back round it (`1dfd`).
async fn erase_cross(engine: &Engine, hdc: u16, d: &Dialog) -> Result<(), Stop> {
    let area = d.spectrum;
    let dy = 10i16.wrapping_mul(metric(engine, SM_CYBORDER).await?);
    let dx = 10i16.wrapping_mul(metric(engine, SM_CXBORDER).await?);
    let (across, down) = (d.x, d.y);
    let top = {
        let at = down.wrapping_sub(dy as u16);

        if at < area[1] as u16 {
            area[1] as u16
        } else {
            at
        }
    };
    let bottom = {
        let at = down.wrapping_add(dy as u16);

        if at > area[3] as u16 {
            area[3] as u16
        } else {
            at
        }
    };
    let left = {
        let at = across.wrapping_sub(dx as u16);

        if at < area[0] as u16 {
            area[0] as u16
        } else {
            at
        }
    };
    let right = {
        let at = across.wrapping_add(dx as u16);

        if at > area[2] as u16 {
            area[2] as u16
        } else {
            at
        }
    };
    let (memory, bitmap) = {
        let g = globals(engine);

        (g.memory_dc, g.spectrum)
    };
    let old = select(engine, memory, bitmap).await?;

    api(
        engine,
        "GDI",
        "BitBlt",
        &[
            A::W(hdc),
            A::W(left),
            A::W(top),
            A::W(right.wrapping_sub(left)),
            A::W(bottom.wrapping_sub(top)),
            A::W(memory),
            A::W(left.wrapping_sub(area[0] as u16)),
            A::W(top.wrapping_sub(area[1] as u16)),
            A::D(SRCCOPY),
        ],
    )
    .await?;
    select(engine, memory, old).await?;
    Ok(())
}

/// The cross at a point (`1ec7`): four arms of three lines each, kept
/// inside the spectrum, in the DC's pen.
#[allow(clippy::many_single_char_names, clippy::similar_names)]
async fn cross(engine: &Engine, hdc: u16, x: u16, y: u16, d: &Dialog) -> Result<(), Stop> {
    let [left, top, right, bottom] = d.spectrum;
    let (x, y) = (x as i16, y as i16);
    let a = 5i16.wrapping_mul(metric(engine, SM_CYBORDER).await?);
    let b = 5i16.wrapping_mul(metric(engine, SM_CXBORDER).await?);
    let y_2a = (y - 2 * a).max(top);
    let y2a = (y + 2 * a).min(bottom);
    let x_2b = (x - 2 * b).max(left);
    let x2b = (x + 2 * b).min(right);
    let y_a = (y - a).max(top);
    let ya = (a + y).min(bottom);
    let x_b = (x - b).max(left);
    let xb = (b + x).min(right);
    let line = |x0: i16, y0: i16, x1: i16, y1: i16| async move {
        api(
            engine,
            "GDI",
            "MoveTo",
            &[A::W(hdc), A::W(x0 as u16), A::W(y0 as u16)],
        )
        .await?;
        api(
            engine,
            "GDI",
            "LineTo",
            &[A::W(hdc), A::W(x1 as u16), A::W(y1 as u16)],
        )
        .await?;
        Ok::<(), Stop>(())
    };
    let columns = [(x - 1, x > left), (x, x < right), (x + 1, x + 1 < right)];
    let rows = [(y - 1, y > top), (y, y < bottom), (y + 1, y + 1 < bottom)];

    if y_a > top {
        for &(column, shown) in &columns {
            if shown {
                line(column, y_a, column, y_2a).await?;
            }
        }
    }

    if bottom > ya {
        for &(column, shown) in &columns {
            if shown {
                line(column, ya, column, y2a).await?;
            }
        }
    }

    if left < x_b {
        for &(row, shown) in &rows {
            if shown {
                line(x_b, row, x_2b, row).await?;
            }
        }
    }

    if right > xb {
        for &(row, shown) in &rows {
            if shown {
                line(xb, row, x2b, row).await?;
            }
        }
    }

    Ok(())
}

/// The spectrum copied to the dialog where it is to be painted, and the
/// cross drawn (`255d`).
async fn copy_spectrum(engine: &Engine, hdc: u16, area: Rect, d: &Dialog) -> Result<(), Stop> {
    let (memory, bitmap) = {
        let g = globals(engine);

        (g.memory_dc, g.spectrum)
    };

    if bitmap == 0 {
        return Ok(());
    }

    let old = select(engine, memory, bitmap).await?;

    api(
        engine,
        "GDI",
        "BitBlt",
        &[
            A::W(hdc),
            A::W(area[0] as u16),
            A::W(area[1] as u16),
            A::W((area[2] - area[0]) as u16),
            A::W((area[3] - area[1]) as u16),
            A::W(memory),
            A::W((area[0] - d.spectrum[0]) as u16),
            A::W((area[1] - d.spectrum[1]) as u16),
            A::D(SRCCOPY),
        ],
    )
    .await?;
    select(engine, memory, old).await?;
    cross(engine, hdc, d.x, d.y, d).await?;
    api(engine, "USER", "UpdateWindow", &[A::W(d.hwnd)]).await?;
    Ok(())
}

/// The sample, the bar, its mark and the spectrum, each where it meets the
/// area painted (`25e4`).
async fn paint_parts(engine: &Engine, d: &Dialog, hdc: u16, area: Rect) -> Result<(), Stop> {
    if let Some(r) = intersect(area, d.colour) {
        let hbr = brush(engine, d.rgb).await?;

        fill(engine, hdc, r, hbr).await?;
        delete(engine, hbr).await?;
    }

    if let Some(r) = intersect(area, d.solid) {
        let colour = nearest(engine, hdc, d.rgb).await?;
        let hbr = brush(engine, colour).await?;

        fill(engine, hdc, r, hbr).await?;
        delete(engine, hbr).await?;
    }

    if intersect(area, d.bar).is_some() {
        let bar = d.bar;
        let mut r = [bar[0], bar[3] - 4, bar[2], bar[3]];
        let hbr = brush(engine, hls_to_rgb(d.hue, 0, d.sat)).await?;

        fill(engine, hdc, r, hbr).await?;
        delete(engine, hbr).await?;

        let mut lum = 8u16;

        while lum < 240 {
            r[3] = r[1];

            let whole = i32::from(bar[3] + 4) * 240;
            let less = u32::from(d.lum_height) * u32::from(lum + 8);

            r[1] = ((whole as u32).wrapping_sub(less) / 240) as i16;

            let hbr = brush(engine, hls_to_rgb(d.hue, lum, d.sat)).await?;

            fill(engine, hdc, r, hbr).await?;
            delete(engine, hbr).await?;
            lum += 8;
        }

        r[3] = r[1];
        r[1] = bar[1];

        let hbr = brush(engine, hls_to_rgb(d.hue, 240, d.sat)).await?;

        fill(engine, hdc, r, hbr).await?;
        delete(engine, hbr).await?;

        if area != bar {
            let hollow = stock(engine, NULL_BRUSH).await?;
            let old = select(engine, hdc, hollow).await?;

            rectangle(
                engine,
                hdc,
                [bar[0] - 1, bar[1] - 1, bar[2] + 1, bar[3] + 1],
            )
            .await?;
            select(engine, hdc, old).await?;
        }
    }

    if intersect(area, d.mark).is_some() {
        arrow(engine, hdc, d).await?;
    }

    if let Some(r) = intersect(area, d.spectrum) {
        copy_spectrum(engine, hdc, r, d).await?;
    }

    Ok(())
}

/// A box drawn: a rectangle in the DC's pen, filled with its colour, and
/// the chosen one's frame (`1316`).
async fn draw_box(engine: &Engine, d: &Dialog, hdc: u16, index: u16) -> Result<(), Stop> {
    let (count, b) = {
        let g = globals(engine);

        (g.count as u16, g.boxes[index as usize])
    };

    if index < 0x30 && index >= count {
        return Ok(());
    }

    let hbr = brush(engine, d.colours[index as usize]).await?;
    let old = select(engine, hdc, hbr).await?;

    rectangle(engine, hdc, b).await?;

    let hbr = select(engine, hdc, old).await?;

    delete(engine, hbr).await?;

    if d.current == index {
        frame(engine, hdc, index, true).await?;
    }

    Ok(())
}

/// `WM_PAINT` (`1aaf`).
async fn paint(engine: &Engine, hwnd: u16, id: u16, hdc: u16, area: Rect) -> Result<(), Stop> {
    let d = get(engine, id);
    let count = globals(engine).count as u16;

    for index in (0..count).chain(0x30..0x40) {
        draw_box(engine, &d, hdc, index).await?;
    }

    let focus = api(engine, "USER", "GetFocus", &[]).await? as u16;

    if item(engine, hwnd, ID_BASIC).await? == focus {
        move_focus(engine, id, d.basic).await?;
    } else if item(engine, hwnd, ID_CUSTOM).await? == focus {
        move_focus(engine, id, d.custom).await?;
    }

    paint_parts(engine, &get(engine, id), hdc, area).await
}

/// A press, or a move with the mouse captured (`02e7`).
#[allow(clippy::too_many_lines)]
async fn press(
    engine: &Engine,
    hwnd: u16,
    id: u16,
    message: u16,
    x: i16,
    y: i16,
) -> Result<u16, Stop> {
    let d = get(engine, id);

    if in_rect(d.spectrum, x, y) {
        if message == WM_LBUTTONDOWN {
            let hdc = get_dc(engine, hwnd).await?;

            erase_cross(engine, hdc, &d).await?;
            release_dc(engine, hwnd, hdc).await?;
        }

        let mut d = get(engine, id);

        d.x = x as u16;
        numbers(&mut d, ID_HUE);
        put(engine, id, &d);
        set_hls_edits(engine, id, ID_HUE).await?;

        let mut d = get(engine, id);

        d.y = y as u16;
        numbers(&mut d, ID_SAT);
        put(engine, id, &d);
        set_hls_edits(engine, id, ID_SAT).await?;

        let mut d = get(engine, id);

        d.rgb = hls_to_rgb(d.hue, d.lum, d.sat);
        put(engine, id, &d);

        let hdc = get_dc(engine, hwnd).await?;

        paint_parts(engine, &d, hdc, d.bar).await?;
        paint_parts(engine, &d, hdc, d.sample).await?;
        release_dc(engine, hwnd, hdc).await?;
        set_rgb_edits(engine, id, 0).await?;

        if !globals(engine).tracking {
            capture(engine, hwnd, d.spectrum).await?;
        }

        return Ok(1);
    }

    if in_rect(d.bar, x, y) || in_rect(d.mark, x, y) {
        let hdc = get_dc(engine, hwnd).await?;

        erase_arrow(engine, hdc, &d).await?;

        let mut d = get(engine, id);

        d.lum_y = y as u16;
        put(engine, id, &d);
        arrow(engine, hdc, &d).await?;
        numbers(&mut d, ID_LUM);
        put(engine, id, &d);
        set_hls_edits(engine, id, ID_LUM).await?;

        let mut d = get(engine, id);

        d.rgb = hls_to_rgb(d.hue, d.lum, d.sat);
        put(engine, id, &d);
        paint_parts(engine, &d, hdc, d.sample).await?;
        release_dc(engine, hwnd, hdc).await?;
        validate(engine, hwnd, d.mark).await?;
        validate(engine, hwnd, d.sample).await?;
        set_rgb_edits(engine, id, 0).await?;

        if !globals(engine).tracking {
            capture(engine, hwnd, d.mark).await?;
        }

        return Ok(1);
    }

    // A grid (`04db`).
    let child = api(
        engine,
        "USER",
        "ChildWindowFromPoint",
        &[A::W(hwnd), A::D(point(x, y))],
    )
    .await? as u16;
    let boxes = globals(engine).boxes.clone();
    let (area, rows, base) = if child == item(engine, hwnd, ID_BASIC).await? {
        let last = boxes[0x2f];

        (
            [boxes[0][0], boxes[0][1], last[2] + 5, last[3] + 5],
            6u16,
            0u16,
        )
    } else if child == item(engine, hwnd, ID_CUSTOM).await? {
        let last = boxes[0x3f];

        (
            [boxes[0x30][0], boxes[0x30][1], last[2] + 5, last[3] + 5],
            2,
            0x30,
        )
    } else {
        return Ok(0);
    };

    if api(engine, "USER", "GetFocus", &[]).await? as u16 != child {
        api(engine, "USER", "SetFocus", &[A::W(child)]).await?;
    }

    let (pitch_w, pitch_h) = globals(engine).pitch;
    let (ux, uy) = (x as u16, y as u16);

    if uy >= area[3] as u16 || ux >= area[2] as u16 {
        return Ok(1);
    }

    let dx = ux.wrapping_sub(area[0] as u16);
    let dy = uy.wrapping_sub(area[1] as u16);

    if dx % pitch_w as u16 >= (pitch_w - 5) as u16 || dy % pitch_h as u16 >= (pitch_h - 5) as u16 {
        return Ok(1);
    }

    let row = (u32::from(dy) * u32::from(rows) / u32::from((area[3] - area[1]) as u16)) as u16;
    let column = ((u32::from(dx) << 3) / u32::from((area[2] - area[0]) as u16)) as u16;
    let index = base + (row << 3) + column;
    let count = globals(engine).count as u16;

    if (index as i16) < count as i16 || index >= 0x30 {
        let mut d = get(engine, id);

        choose_box(engine, &mut d, index).await?;
        d.current = index;
        put(engine, id, &d);
        move_focus(engine, id, index).await?;

        let mut d = get(engine, id);

        if index >= 0x30 {
            d.custom = d.current;
        } else {
            d.basic = d.current;
        }

        d.rgb = d.colours[d.current as usize];
        put(engine, id, &d);

        let hdc = get_dc(engine, hwnd).await?;

        if d.full {
            rgb_changed(engine, id).await?;
            set_hls_edits(engine, id, 0).await?;
            set_rgb_edits(engine, id, 0).await?;
            paint_parts(engine, &get(engine, id), hdc, d.sample).await?;
        }

        let d = get(engine, id);

        draw_box(engine, &d, hdc, d.basic).await?;
        draw_box(engine, &d, hdc, d.custom).await?;
        release_dc(engine, hwnd, hdc).await?;
    }

    Ok(1)
}

/// The mouse captured and the cursor kept in a rectangle.
async fn capture(engine: &Engine, hwnd: u16, r: Rect) -> Result<(), Stop> {
    api(engine, "USER", "SetCapture", &[A::W(hwnd)]).await?;

    let screen = to_screen(engine, hwnd, r).await?;

    with_rect(engine, "USER", "ClipCursor", &[], screen, &[]).await?;
    globals(engine).tracking = true;
    Ok(())
}

/// The colour made its nearest pure one (`2115`).
async fn solid(engine: &Engine, id: u16) -> Result<(), Stop> {
    let d = get(engine, id);
    let hwnd = d.hwnd;
    let hdc = get_dc(engine, hwnd).await?;

    erase_cross(engine, hdc, &d).await?;
    erase_arrow(engine, hdc, &d).await?;

    let mut d = get(engine, id);

    d.rgb = nearest(engine, hdc, d.rgb).await?;

    let (h, l, s) = rgb_to_hls(d.rgb);

    d.hue = h;
    d.lum = l;
    d.sat = s;
    positions(&mut d, 0);
    put(engine, id, &d);
    cross(engine, hdc, d.x, d.y, &d).await?;
    arrow(engine, hdc, &d).await?;
    release_dc(engine, hwnd, hdc).await?;
    set_hls_edits(engine, id, 0).await?;
    set_rgb_edits(engine, id, 0).await?;
    invalidate(engine, hwnd, d.sample).await?;
    invalidate(engine, hwnd, d.bar).await
}

/// `WM_COMMAND` (`081c`).
#[allow(clippy::too_many_lines)]
async fn command(
    engine: &Engine,
    hwnd: u16,
    id: u16,
    control: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    let notification = (lparam >> 16) as u16;

    match control {
        IDOK | IDCANCEL | 3 => {
            let d = get(engine, id);

            if control == IDOK {
                set_dword(engine, d.lpcc, RGB_RESULT, d.rgb);
            }

            if control != 3 {
                if globals(engine).tracking {
                    globals(engine).tracking = false;
                    api(engine, "USER", "SetCapture", &[A::W(0)]).await?;
                    api(engine, "USER", "ClipCursor", &[A::D(0)]).await?;
                }

                let custom = dword(engine, d.lpcc, CUST_COLORS);

                for i in 0..16u32 {
                    set_dword(engine, custom, i * 4, d.colours[0x30 + i as usize]);
                }

                let hook = dword(engine, d.lpcc, HOOK);

                if control == IDOK && hook != 0 {
                    let ok = support::registered_message(engine, "commdlg_ColorOK");
                    let words = [hwnd, ok, 0, (d.lpcc >> 16) as u16, d.lpcc as u16];

                    if support::call_hook(engine, hook, &words).await? != 0 {
                        return Ok(1);
                    }
                }
            }

            let (memory, bitmap) = {
                let g = globals(engine);

                (g.memory_dc, g.spectrum)
            };

            if memory != 0 {
                api(engine, "GDI", "DeleteDC", &[A::W(memory)]).await?;
                globals(engine).memory_dc = 0;
            }

            if bitmap != 0 {
                delete(engine, bitmap).await?;
                globals(engine).spectrum = 0;
            }

            api(engine, "USER", "RemoveProp", &[A::W(hwnd), A::D(0xa000)]).await?;

            globals(engine).hook = dword(engine, d.lpcc, HOOK);
            globals(engine).dialogs.remove(&id);

            let result = if control == 3 {
                lparam as u16
            } else {
                u16::from(control == IDOK)
            };

            api(engine, "USER", "EndDialog", &[A::W(hwnd), A::W(result)]).await?;
        }
        ID_HUE | ID_SAT | ID_LUM if notification == EN_CHANGE => {
            number_typed(engine, hwnd, id, control).await?;
        }
        0x2c2..=0x2c4 => {
            if notification == EN_CHANGE {
                rgb_typed(engine, id, control).await?;
                invalidate(engine, hwnd, get(engine, id).sample).await?;
            } else if notification == EN_KILLFOCUS {
                let (_, ok) = get_int(engine, hwnd, control).await?;

                if !ok {
                    set_rgb_edits(engine, id, control).await?;
                }
            }
        }
        ID_ADD => {
            let mut d = get(engine, id);
            let index = d.custom;

            d.colours[index as usize] = d.rgb;
            put(engine, id, &d);

            let b = globals(engine).boxes[index as usize];

            invalidate(engine, hwnd, b).await?;

            let mut d = get(engine, id);

            d.custom = if index >= 0x3f {
                0x30
            } else if index >= 0x38 {
                index - 7
            } else {
                index + 8
            };
            put(engine, id, &d);
        }
        ID_SOLID => solid(engine, id).await?,
        ID_DEFINE => define(engine, hwnd, id).await?,
        PSH_HELP => {
            let help = support::registered_message(engine, "commdlg_help");
            let lpcc = get(engine, id).lpcc;
            let owner = word(engine, lpcc, HWND_OWNER);

            if help != 0 && owner != 0 {
                api(
                    engine,
                    "USER",
                    "SendMessage",
                    &[A::W(owner), A::W(help), A::W(hwnd), A::D(lpcc)],
                )
                .await?;
            }
        }
        _ => {}
    }

    Ok(1)
}

/// Hue, saturation or luminosity typed (`0a11`, `0ad8`, `0bb9`).
async fn number_typed(engine: &Engine, hwnd: u16, id: u16, control: u16) -> Result<(), Stop> {
    let (mut value, ok) = get_int(engine, hwnd, control).await?;

    if !ok {
        if has_text(engine, hwnd, control).await? {
            set_hls_edits(engine, id, control).await?;
            select_all(engine, hwnd, control).await?;
        }

        return Ok(());
    }

    let most = if control == ID_HUE { 239 } else { 240 };

    if value > most {
        value = most;
        set_int(engine, hwnd, control, most).await?;
    }

    let d = get(engine, id);
    let now = match control {
        ID_HUE => d.hue,
        ID_SAT => d.sat,
        _ => d.lum,
    };

    if now == value {
        return Ok(());
    }

    let hdc = get_dc(engine, hwnd).await?;

    if control == ID_LUM {
        erase_arrow(engine, hdc, &d).await?;
    } else {
        erase_cross(engine, hdc, &d).await?;
    }

    let mut d = get(engine, id);

    match control {
        ID_HUE => d.hue = value,
        ID_SAT => d.sat = value,
        _ => d.lum = value,
    }

    if control == ID_LUM {
        positions(&mut d, ID_LUM);
    }

    d.rgb = hls_to_rgb(d.hue, d.lum, d.sat);
    put(engine, id, &d);
    set_rgb_edits(engine, id, 0).await?;

    let mut d = get(engine, id);

    if control == ID_LUM {
        arrow(engine, hdc, &d).await?;
        release_dc(engine, hwnd, hdc).await?;
    } else {
        positions(&mut d, control);
        put(engine, id, &d);
        cross(engine, hdc, d.x, d.y, &d).await?;
        release_dc(engine, hwnd, hdc).await?;
        invalidate(engine, hwnd, d.bar).await?;
    }

    invalidate(engine, hwnd, d.sample).await?;
    api(engine, "USER", "UpdateWindow", &[A::W(hwnd)]).await?;
    Ok(())
}

/// Red, green or blue typed (`2ae3`).
async fn rgb_typed(engine: &Engine, id: u16, control: u16) -> Result<(), Stop> {
    let hwnd = get(engine, id).hwnd;
    let (mut value, ok) = get_int(engine, hwnd, control).await?;
    let shift = u32::from(control - ID_RED) * 8;

    if !ok {
        if has_text(engine, hwnd, control).await? {
            set_rgb_edits(engine, id, control).await?;
            select_all(engine, hwnd, control).await?;
        }

        return Ok(());
    }

    if value as i16 > 255 {
        value = 255;
        set_int(engine, hwnd, control, 255).await?;
    }

    let mut d = get(engine, id);

    if (d.rgb >> shift) & 0xff == u32::from(value & 0xff) {
        return Ok(());
    }

    d.rgb = (d.rgb & !(0xff << shift)) | u32::from(value & 0xff) << shift;
    put(engine, id, &d);
    rgb_changed(engine, id).await?;
    set_hls_edits(engine, id, control).await
}

/// "Define Custom Colors..." (`0cfd`).
async fn define(engine: &Engine, hwnd: u16, id: u16) -> Result<(), Stop> {
    support::wait_cursor(engine, true);
    draw_spectrum(engine, id).await?;

    for control in (ID_HUE..=ID_BLUE).chain(ID_HUE_LABEL..=ID_BLUE_LABEL) {
        enable(engine, item(engine, hwnd, control).await?, 1).await?;
    }

    enable(engine, item(engine, hwnd, ID_ADD).await?, 1).await?;
    enable(engine, item(engine, hwnd, ID_SOLID).await?, 1).await?;
    enable(engine, item(engine, hwnd, ID_DEFINE).await?, 0).await?;

    let now = window_rect(engine, hwnd).await?;
    let w = get(engine, id).window;

    api(
        engine,
        "USER",
        "SetWindowPos",
        &[
            A::W(hwnd),
            A::W(0),
            A::W(w[0] as u16),
            A::W(w[1] as u16),
            A::W((w[2] - w[0]) as u16),
            A::W((w[3] - w[1]) as u16),
            A::W(0x16),
        ],
    )
    .await?;
    invalidate(engine, hwnd, [w[0], now[1], now[0], now[3]]).await?;
    support::wait_cursor(engine, false);

    let hue = item(engine, hwnd, ID_HUE).await?;

    api(engine, "USER", "SetFocus", &[A::W(hue)]).await?;

    let mut d = get(engine, id);

    d.full = true;
    put(engine, id, &d);
    Ok(())
}

pub fn want_arrows(engine: &Engine, mut args: Args) -> Later<'_> {
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

        Ok(Answer::Dword(
            arrows(engine, hwnd, message, wparam, lparam).await?,
        ))
    })
}

/// `WantArrows` (`1b46`): the grids' arrows and characters sent to the
/// dialog, and their focus rectangle drawn as they gain and lose the focus.
async fn arrows(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    match message {
        WM_GETDLGCODE => Ok(0x81),
        WM_KEYDOWN | WM_CHAR => {
            let parent = api(engine, "USER", "GetParent", &[A::W(hwnd)]).await? as u16;

            api(
                engine,
                "USER",
                "SendMessage",
                &[A::W(parent), A::W(message), A::W(wparam), A::D(lparam)],
            )
            .await
        }
        WM_SETFOCUS | WM_KILLFOCUS => {
            let parent = api(engine, "USER", "GetParent", &[A::W(hwnd)]).await? as u16;
            let id = number(engine, parent).await?;

            if id == 0 {
                return old_proc(engine, hwnd, message, wparam, lparam).await;
            }

            let d = get(engine, id);
            let control =
                api(engine, "USER", "GetWindowWord", &[A::W(hwnd), A::W(GWW_ID)]).await? as u16;
            let index = if control == ID_BASIC {
                d.basic
            } else {
                d.custom
            };
            let hdc = get_dc(engine, parent).await?;
            let b = globals(engine).boxes[index as usize];

            with_rect(
                engine,
                "USER",
                "DrawFocusRect",
                &[A::W(hdc)],
                [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3],
                &[],
            )
            .await?;
            api(engine, "USER", "ReleaseDC", &[A::W(parent), A::W(hdc)]).await
        }
        _ => old_proc(engine, hwnd, message, wparam, lparam).await,
    }
}

async fn old_proc(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    let proc = globals(engine).static_proc;

    api(
        engine,
        "USER",
        "CallWindowProc",
        &[
            A::D(proc),
            A::W(hwnd),
            A::W(message),
            A::W(wparam),
            A::D(lparam),
        ],
    )
    .await
}
