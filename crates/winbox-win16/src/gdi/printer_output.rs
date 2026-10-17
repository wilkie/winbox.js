//! Drawing on a printer driver's device context, as Windows' GDI hands it
//! to the driver: the pens and brushes realized by the driver's
//! `RealizeObject`, the colours by its `ColorInfo`, and the figures and
//! the text by its `Output` and `ExtTextOut`. The twin of
//! `src/win16/gdi/printer-output.ts`.
//!
//! What GDI keeps of a context in its own heap -- the `DRAWMODE` at +44h,
//! the realized pen and brush, the `TEXTXFORM` -- is kept here in a block
//! of global memory of the context's own, and given to the driver by far
//! pointers as GDI gives its own.

use std::collections::HashMap;
use std::future::Future;

use winbox_cpu::{SP, SS};
use winbox_raster::ClipRegion;

use crate::call::{Answer, Args, Implementation, Later, Stop, call_named};
use crate::engine::{Engine, GuestArg};
use crate::gdi::objects::{GdiObject, LogBrush, LogPen};
use crate::system::System;

const COLOR_INFO: u16 = 2;
const OUTPUT: u16 = 8;
const REALIZE_OBJECT: u16 = 10;
const EXT_TEXT_OUT: u16 = 14;
const STRETCH_DIBITS: u16 = 28;

const OBJ_PEN: u16 = 1;
const OBJ_BRUSH: u16 = 2;

const OS_ARC: u16 = 3;
const OS_RECTANGLE: u16 = 6;
const OS_ELLIPSE: u16 = 7;
const OS_POLYLINE: u16 = 0x12;
const OS_WINDPOLYGON: u16 = 0x14;
const OS_ALTPOLYGON: u16 = 0x16;
const OS_PIE: u16 = 0x17;
const OS_CHORD: u16 = 0x27;
const OS_CIRCLE: u16 = 0x37;
const OS_ROUNDRECT: u16 = 0x48;

const PS_SOLID: u16 = 0;
const PS_NULL: u16 = 5;
const PS_INSIDEFRAME: u16 = 6;
const BS_HOLLOW: u16 = 1;

/// The `DRAWMODE` and the `TEXTXFORM` in the context's block.
const DRAWMODE: u32 = 0;
const TEXTXFORM: u32 = 0x20;
const FT_ACCELERATOR: usize = 0x0f;
const DP_TEXT: usize = 0x22;
const DP_RASTER: usize = 0x26;
const RC_GDI20_OUTPUT: u16 = 0x10;
const TC_EA_DOUBLE: u16 = 0x200;
const TC_IA_ABLE: u16 = 0x400;
const BLOCK_SIZE: u32 = 0x40;

/// A pen or a brush the driver realized: its block, and what it was
/// realized for -- a pen's width; a hatched brush's background, a brush's
/// origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Realized {
    pub handle: u16,
    pub far: u32,
    pub key: Vec<i32>,
}

/// What `SaveDC` keeps of a driver's context with the rest: the realized
/// pen, its width and height in device units (+88h, +8Ah), the realized
/// brush (+36h), and the physical colours `ColorInfo` gave, as the
/// `DRAWMODE` keeps them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriverState {
    pub pen: Option<Realized>,
    pub pen_width: i32,
    pub pen_height: i32,
    pub brush: Option<Realized>,
    pub bk_color: u32,
    pub text_color: u32,
}

/// What GDI keeps of a driver's context for drawing: the block standing
/// for its heap, and each pen and brush realized, as GDI keeps them on the
/// object for the device (seg1 `26be`, `2335`).
#[derive(Debug, Clone, Default)]
pub struct Drawing {
    pub handle: u16,
    pub far: u32,
    pub realized: HashMap<usize, Vec<Realized>>,
}

type Rect = [i32; 4];

fn offset_by(far: u32, at: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff)
}

fn write16(system: &mut System, far: u32, at: u32, value: u16) {
    system.write_far(offset_by(far, at), &value.to_le_bytes());
}

fn write32(system: &mut System, far: u32, at: u32, value: u32) {
    system.write_far(offset_by(far, at), &value.to_le_bytes());
}

fn words(values: &[i32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|&value| (value as u16).to_le_bytes())
        .collect()
}

fn caps(system: &System, dc: usize, at: usize) -> u16 {
    super::printer_driver::device_info(system, dc)
        .map_or(0, |info| u16::from_le_bytes([info[at], info[at + 1]]))
}

fn proc(system: &System, dc: usize, ordinal: u16) -> (u32, u32) {
    super::printer_driver::device_proc(system, dc, ordinal)
}

async fn call_driver(engine: &Engine, procedure: u32, args: &[GuestArg]) -> Result<u32, Stop> {
    let (answer, _) = engine.call_with(procedure, args, &[]).await?;

    Ok(answer)
}

/// Bytes laid below the stack for a call, as GDI lays its own on its
/// stack: given to `body` as a far pointer; its answer, and the bytes as
/// they were left.
async fn on_stack<T, F: Future<Output = Result<T, Stop>>>(
    engine: &Engine,
    bytes: &[u8],
    body: impl FnOnce(u32) -> F,
) -> Result<(T, Vec<u8>), Stop> {
    let (saved, far) = {
        let mut system = engine.system();
        let saved = system.cpu.regs[SP];
        let sp = saved.wrapping_sub(((bytes.len() + 1) & !1) as u16);
        let far = u32::from(system.cpu.segments[SS].selector) << 16 | u32::from(sp);

        system.write_far(far, bytes);
        system.cpu.regs[SP] = sp.wrapping_sub(4);
        (saved, far)
    };
    let answer = body(far).await;
    let mut system = engine.system();
    let left = system.read_far(far, bytes.len());

    system.cpu.regs[SP] = saved;
    Ok((answer?, left))
}

async fn kernel(engine: &Engine, name: &'static str, args: &[GuestArg]) -> Result<u32, Stop> {
    let (answer, _) = call_named(engine, "KERNEL", name, args).await?;

    Ok(answer.value().unwrap_or(0))
}

fn state(system: &System, dc: usize) -> Option<&DriverState> {
    system.gdi.dcs[dc].state.driver.as_ref()
}

fn state_mut(system: &mut System, dc: usize) -> Option<&mut DriverState> {
    system.gdi.dcs[dc].state.driver.as_mut()
}

/// A driver's context made ready to draw on, as GDI's `CreateDC` makes it
/// (`GDI.EXE` seg1 `0192`-`0210`): the `DRAWMODE`'s `R2_COPYPEN` and
/// `OPAQUE`; the background white and the text black, each through the
/// driver's `ColorInfo`; the white brush and the black pen realized.
pub async fn start_drawing(engine: &Engine, dc: usize) -> Result<(), Stop> {
    let handle = kernel(
        engine,
        "GlobalAlloc",
        &[GuestArg::Word(0x2042), GuestArg::Long(BLOCK_SIZE)],
    )
    .await? as u16;
    let far = if handle == 0 {
        0
    } else {
        kernel(engine, "GlobalLock", &[GuestArg::Word(handle)]).await?
    };

    {
        let mut system = engine.system();

        system.printing.drivers.drawing.insert(
            dc,
            Drawing {
                handle,
                far,
                realized: HashMap::new(),
            },
        );
        system.gdi.dcs[dc].state.driver = Some(DriverState {
            pen: None,
            pen_width: 1,
            pen_height: 1,
            brush: None,
            bk_color: 0,
            text_color: 0,
        });
    }

    if far == 0 {
        return Ok(());
    }

    {
        let mut system = engine.system();

        write16(&mut system, far, DRAWMODE, 13);
        write16(&mut system, far, DRAWMODE + 2, 2);
    }

    let bk = color_info(engine, dc, 0x00ff_ffff).await?;
    let text = color_info(engine, dc, 0).await?;

    if let Some(driver) = state_mut(&mut engine.system(), dc) {
        driver.bk_color = bk;
        driver.text_color = text;
    }

    realize_brush(engine, dc).await?;
    realize_pen(engine, dc).await?;
    Ok(())
}

/// The context's drawing block let go, with what was realized for it.
pub async fn stop_drawing(engine: &Engine, dc: usize) -> Result<(), Stop> {
    let Some(drawing) = engine.system().printing.drivers.drawing.remove(&dc) else {
        return Ok(());
    };

    for realized in drawing.realized.values().flatten() {
        kernel(engine, "GlobalFree", &[GuestArg::Word(realized.handle)]).await?;
    }

    if drawing.handle != 0 {
        kernel(engine, "GlobalFree", &[GuestArg::Word(drawing.handle)]).await?;
    }

    engine.system().gdi.dcs[dc].state.driver = None;
    Ok(())
}

/// A colour as the driver makes it physical (seg1 `1526`): its
/// `ColorInfo` with the colour and somewhere to write the physical one,
/// which GDI keeps in the `DRAWMODE`.
async fn color_info(engine: &Engine, dc: usize, rgb: u32) -> Result<u32, Stop> {
    let (procedure, lp_pdevice) = proc(&engine.system(), dc, COLOR_INFO);

    if procedure == 0 {
        return Ok(0);
    }

    let ((), physical) = on_stack(engine, &[0; 4], |far| async move {
        call_driver(
            engine,
            procedure,
            &[
                GuestArg::Long(lp_pdevice),
                GuestArg::Long(rgb),
                GuestArg::Long(far),
            ],
        )
        .await?;
        Ok(())
    })
    .await?;

    Ok(u32::from_le_bytes([
        physical[0],
        physical[1],
        physical[2],
        physical[3],
    ]))
}

/// `SetBkColor` or `SetTextColor` on a driver's context (seg1 `1476`,
/// `14dc`): the physical colour the driver's `ColorInfo` makes of it kept
/// for the `DRAWMODE`. A hatched brush selected is selected again where
/// the background's physical colour changed (`1556`-`1575`), and so
/// realized for it.
async fn set_driver_color(
    engine: &Engine,
    dc: usize,
    background: bool,
    rgb: u32,
) -> Result<(), Stop> {
    let physical = color_info(engine, dc, rgb).await?;
    let changed = {
        let mut system = engine.system();
        let hatched = brush_style(&system, dc) == 2;

        state_mut(&mut system, dc).is_some_and(|driver| {
            if background {
                let before = std::mem::replace(&mut driver.bk_color, physical);

                hatched && before != physical
            } else {
                driver.text_color = physical;
                false
            }
        })
    };

    if changed {
        realize_brush(engine, dc).await?;
    }

    Ok(())
}

/// The driver's `RealizeObject` for a pen or a brush (seg1 `26e5`,
/// `256f`): asked the size with nought for the object, then given a block
/// that large; none for none. One realized before for the object and the
/// key is taken again.
async fn realize_object(
    engine: &Engine,
    dc: usize,
    object: usize,
    key: Vec<i32>,
    style: u16,
    logical: &[u8],
    fifth: impl Fn(u32) -> u32,
) -> Result<Option<Realized>, Stop> {
    let kept = engine
        .system()
        .printing
        .drivers
        .drawing
        .get(&dc)
        .and_then(|drawing| drawing.realized.get(&object))
        .and_then(|list| list.iter().find(|each| each.key == key).cloned());

    if kept.is_some() {
        return Ok(kept);
    }

    let (procedure, lp_pdevice) = proc(&engine.system(), dc, REALIZE_OBJECT);

    if procedure == 0 {
        return Ok(None);
    }

    let args = |lp: u32, out: u32| {
        [
            GuestArg::Long(lp_pdevice),
            GuestArg::Word(style),
            GuestArg::Long(lp),
            GuestArg::Long(out),
            GuestArg::Long(fifth(out)),
        ]
    };
    let (size, _) = on_stack(engine, logical, |lp| {
        let args = args(lp, 0);

        async move { call_driver(engine, procedure, &args).await }
    })
    .await?;
    let size = size as u16;

    if size == 0 {
        return Ok(None);
    }

    let handle = kernel(
        engine,
        "GlobalAlloc",
        &[GuestArg::Word(0x2042), GuestArg::Long(u32::from(size))],
    )
    .await? as u16;

    if handle == 0 {
        return Ok(None);
    }

    let far = kernel(engine, "GlobalLock", &[GuestArg::Word(handle)]).await?;
    let (done, _) = on_stack(engine, logical, |lp| {
        let args = args(lp, far);

        async move { call_driver(engine, procedure, &args).await }
    })
    .await?;

    if done as u16 == 0 {
        kernel(engine, "GlobalFree", &[GuestArg::Word(handle)]).await?;
        return Ok(None);
    }

    let realized = Realized { handle, far, key };

    if let Some(drawing) = engine.system().printing.drivers.drawing.get_mut(&dc) {
        drawing
            .realized
            .entry(object)
            .or_default()
            .insert(0, realized.clone());
    }

    Ok(Some(realized))
}

fn logpen_of(system: &System, dc: usize) -> (usize, LogPen) {
    let object = system.gdi.dcs[dc].state.pen;
    let logpen = match &system.gdi.objects[object] {
        GdiObject::Pen(pen) => pen.logpen,
        _ => None,
    };

    (
        object,
        logpen.unwrap_or(LogPen {
            style: PS_SOLID,
            width: 0,
            y: 0,
            color: 0,
        }),
    )
}

fn logbrush_of(system: &System, dc: usize) -> (usize, LogBrush) {
    let object = system.gdi.dcs[dc].state.brush;
    let logbrush = match &system.gdi.objects[object] {
        GdiObject::Brush(brush) => brush.logbrush,
        _ => None,
    };

    (
        object,
        logbrush.unwrap_or(LogBrush {
            style: 0,
            color: 0x00ff_ffff,
            hatch: 0,
        }),
    )
}

/// The selected pen realized (seg1 `2640`): its `LOGPEN` with the width
/// made device units, `MulDiv` by the viewport's extent over the window's,
/// its size; the height the width by the device's aspects. GDI keeps a pen
/// realized for each device and width; here one for each context.
pub async fn realize_pen(engine: &Engine, dc: usize) -> Result<bool, Stop> {
    let (object, logpen, width, aspect_x, aspect_y) = {
        let system = engine.system();
        let (object, logpen) = logpen_of(&system, dc);
        let m = super::mapping::mapping_of(&system, dc);
        let width =
            super::calls::mul_div(i32::from(logpen.width), m.vex as i32, m.wex as i32).abs();

        (
            object,
            logpen,
            width,
            i32::from(caps(&system, dc, 0x28)),
            i32::from(caps(&system, dc, 0x2a)),
        )
    };
    let logical = words(&[
        i32::from(logpen.style),
        width,
        i32::from(logpen.y),
        (logpen.color & 0xffff) as i32,
        (logpen.color >> 16) as i32,
    ]);
    let Some(realized) =
        realize_object(engine, dc, object, vec![width], OBJ_PEN, &logical, |out| {
            out
        })
        .await?
    else {
        return Ok(false);
    };

    if let Some(driver) = state_mut(&mut engine.system(), dc) {
        driver.pen = Some(realized);
        driver.pen_width = width;
        driver.pen_height = super::calls::mul_div(width, aspect_x, aspect_y);
    }

    Ok(true)
}

/// The selected brush realized (seg1 `2304`): its `LOGBRUSH`, and after it
/// the background's physical colour (`23a1`), and the brush's origin as
/// the fifth argument. A hatched brush is realized again for another
/// background; a pattern's for another origin (`2345`-`2373`).
pub async fn realize_brush(engine: &Engine, dc: usize) -> Result<bool, Stop> {
    let (object, logbrush, origin, bk) = {
        let system = engine.system();
        let (object, logbrush) = logbrush_of(&system, dc);
        let origin = system.gdi.dcs[dc].state.brush_org.unwrap_or((0, 0));
        let bk = state(&system, dc).map_or(0, |driver| driver.bk_color);

        (object, logbrush, origin, bk)
    };
    let key = match logbrush.style {
        2 => vec![bk as i32],
        3 => vec![i32::from(origin.0), i32::from(origin.1)],
        _ => Vec::new(),
    };
    let logical = words(&[
        i32::from(logbrush.style),
        (logbrush.color & 0xffff) as i32,
        (logbrush.color >> 16) as i32,
        i32::from(logbrush.hatch),
        (bk & 0xffff) as i32,
        (bk >> 16) as i32,
    ]);
    let packed = u32::from(origin.0 as u16) | u32::from(origin.1 as u16) << 16;
    let Some(realized) =
        realize_object(engine, dc, object, key, OBJ_BRUSH, &logical, |_| packed).await?
    else {
        return Ok(false);
    };

    if let Some(driver) = state_mut(&mut engine.system(), dc) {
        driver.brush = Some(realized);
    }

    Ok(true)
}

/// The `DRAWMODE` as the context has it now.
fn draw_mode(system: &mut System, dc: usize) -> u32 {
    let Some(far) = system
        .printing
        .drivers
        .drawing
        .get(&dc)
        .map(|drawing| drawing.far)
    else {
        return 0;
    };
    let dc_state = system.gdi.dcs[dc].state.clone();
    let driver = dc_state.driver.clone();
    let justified = dc_state.justification;
    let at = offset_by(far, DRAWMODE);

    write16(system, at, 0, dc_state.rop2.unwrap_or(13));
    write16(system, at, 2, dc_state.back_mode);
    write32(
        system,
        at,
        4,
        driver.as_ref().map_or(0, |driver| driver.bk_color),
    );
    write32(
        system,
        at,
        8,
        driver.as_ref().map_or(0, |driver| driver.text_color),
    );
    write16(
        system,
        at,
        0x0c,
        justified.map_or(0, |j| (j.extra * j.count + j.rem) as u16),
    );
    write16(system, at, 0x0e, justified.map_or(0, |j| j.extra as u16));
    write16(system, at, 0x10, justified.map_or(0, |j| j.err as u16));
    write16(system, at, 0x12, justified.map_or(0, |j| j.rem as u16));
    write16(system, at, 0x14, justified.map_or(0, |j| j.count as u16));
    write16(system, at, 0x16, dc_state.char_extra);
    write32(system, at, 0x18, dc_state.back_color.unwrap_or(0x00ff_ffff));
    write32(system, at, 0x1c, dc_state.text_color.unwrap_or(0));
    at
}

/// The context's visible region, as GDI keeps it at +1Eh: the page, and
/// the clip within it.
fn visible_region(system: &mut System, dc: usize) -> ClipRegion {
    super::regions::clip_of(system, dc)
}

/// The rectangles of the visible region within a rectangle, as GDI walks
/// them (seg1 `2b62`): each band's runs cut to the rectangle, the empty
/// left out; the bands from the bottom up, or from the top down.
fn region_rects(system: &mut System, dc: usize, within: Rect, top_down: bool) -> Vec<Rect> {
    let mut bands = visible_region(system, dc).bands;
    let mut rects = Vec::new();

    if !top_down {
        bands.reverse();
    }

    for band in bands {
        let top = band.top.max(within[1]);
        let bottom = band.bottom.min(within[3]);

        if top >= bottom {
            continue;
        }

        for (left, right) in band.spans {
            let (l, r) = (left.max(within[0]), right.min(within[2]));

            if l < r {
                rects.push([l, top, r, bottom]);
            }
        }
    }

    rects
}

/// Where a figure's bounds are against the visible region (seg18
/// `0000`): 2 where the region is one rectangle and holds them, else 1.
fn placement(system: &mut System, dc: usize, bounds: Rect) -> u16 {
    let region = visible_region(system, dc);

    if region.kind() != 2 {
        return 1;
    }

    let b = region.bounds();

    if b.left <= bounds[0] && b.top <= bounds[1] && b.right > bounds[2] && b.bottom > bounds[3] {
        2
    } else {
        1
    }
}

/// The driver's `Output`, once, with the clip rectangle given or none. Its
/// answer, signed.
async fn output(
    engine: &Engine,
    dc: usize,
    style: u16,
    points: &[i32],
    brush: bool,
    clip: Option<Rect>,
) -> Result<i16, Stop> {
    let (procedure, lp_pdevice, pen, brush_far, mode) = {
        let mut system = engine.system();
        let (procedure, lp_pdevice) = proc(&system, dc, OUTPUT);
        let driver = state(&system, dc).cloned();
        let pen = driver
            .as_ref()
            .and_then(|d| d.pen.as_ref())
            .map_or(0, |p| p.far);
        let brush_far = if brush {
            driver
                .as_ref()
                .and_then(|d| d.brush.as_ref())
                .map_or(0, |b| b.far)
        } else {
            0
        };
        let mode = draw_mode(&mut system, dc);

        (procedure, lp_pdevice, pen, brush_far, mode)
    };

    if procedure == 0 {
        return Ok(0);
    }

    let mut bytes = words(points);

    bytes.extend(words(&clip.unwrap_or([0; 4])));

    let count = (points.len() / 2) as u16;
    let at = (points.len() * 2) as u32;
    let (answer, _) = on_stack(engine, &bytes, |far| async move {
        call_driver(
            engine,
            procedure,
            &[
                GuestArg::Long(lp_pdevice),
                GuestArg::Word(style),
                GuestArg::Word(count),
                GuestArg::Long(far),
                GuestArg::Long(pen),
                GuestArg::Long(brush_far),
                GuestArg::Long(mode),
                GuestArg::Long(if clip.is_some() {
                    offset_by(far, at)
                } else {
                    0
                }),
            ],
        )
        .await
    })
    .await?;

    Ok(answer as i16)
}

/// A figure GDI hands the driver whole (seg25 `082f`), with the pen and
/// the brush: no clip rectangle where it is inside the visible region; the
/// region's rectangle where that is all the region is; else once for each
/// of the region's rectangles within the figure's bounds, or the region's,
/// out by the pen's width. The last answer.
async fn figure(
    engine: &Engine,
    dc: usize,
    style: u16,
    points: &[i32],
    inside: bool,
    bounds: Option<Rect>,
) -> Result<i16, Stop> {
    if inside {
        return output(engine, dc, style, points, true, None).await;
    }

    let (rects, simple) = {
        let mut system = engine.system();
        let region = visible_region(&mut system, dc);
        let b = region.bounds();

        if region.kind() == 2 {
            (vec![[b.left, b.top, b.right, b.bottom]], true)
        } else {
            let (width, height) =
                state(&system, dc).map_or((0, 0), |driver| (driver.pen_width, driver.pen_height));
            let base = bounds.unwrap_or([b.left, b.top, b.right, b.bottom]);
            let within = [
                base[0] - width,
                base[1] - height,
                base[2] + width,
                base[3] + height,
            ];

            (region_rects(&mut system, dc, within, true), false)
        }
    };
    let mut answer = 0;

    for rect in rects {
        answer = output(engine, dc, style, points, true, Some(rect)).await?;
    }

    let _ = simple;
    Ok(answer)
}

/// Whether the driver can be given a figure not inside the region (seg25
/// `0375`).
fn clips_figures(system: &System, dc: usize) -> bool {
    let clip = caps(system, dc, 0x24);

    clip & 2 != 0 || (clip & 1 != 0 && caps(system, dc, 2) != 0)
}

fn pen_style(system: &System, dc: usize) -> u16 {
    logpen_of(system, dc).1.style
}

fn brush_style(system: &System, dc: usize) -> u16 {
    logbrush_of(system, dc).1.style
}

fn pen_size(system: &System, dc: usize) -> (i32, i32) {
    state(system, dc).map_or((1, 1), |driver| (driver.pen_width, driver.pen_height))
}

fn device_point(system: &System, dc: usize, x: i32, y: i32) -> (i32, i32) {
    super::draw::device_point(&super::mapping::mapping_of(system, dc), x, y)
}

/// `Rectangle` on a driver's context (`GDI.EXE` seg25 `0093`): nothing for
/// one with no width or height, which answers 1; the corners mapped and
/// put in order; the bounds the pen reaches, half its width out on the
/// left and top and the rest on the right and bottom, but for
/// `PS_INSIDEFRAME`. A driver whose `dpPolygonalCaps` has `PC_RECTANGLE`
/// and what the pen and brush need is given `OS_RECTANGLE` with the two
/// corners, inside the frame for `PS_INSIDEFRAME`. 1 where it drew. Not
/// followed: GDI's own drawing for a driver that cannot
/// (`OS_BEGINNSCAN`), and plotters' pens and brushes.
pub async fn driver_rectangle(engine: &Engine, dc: usize, rect: Rect) -> Result<u16, Stop> {
    let [left, top, right, bottom] = rect;

    if left == right || top == bottom {
        return Ok(1);
    }

    let (corners, inside) = {
        let mut system = engine.system();
        let (mut x0, mut y0) = device_point(&system, dc, left, top);
        let (mut x1, mut y1) = device_point(&system, dc, right, bottom);

        if x1 < x0 {
            std::mem::swap(&mut x0, &mut x1);
        }

        if y1 < y0 {
            std::mem::swap(&mut y0, &mut y1);
        }

        let pen = pen_style(&system, dc);
        let (pen_width, pen_height) = pen_size(&system, dc);
        let (width, height) = if pen == PS_NULL {
            (0, 0)
        } else {
            (pen_width.max(1), pen_height.max(1))
        };
        let mut needs = 2;

        if brush_style(&system, dc) != BS_HOLLOW {
            needs |= 0x80;
        }

        if pen != PS_NULL {
            if width > 1 {
                needs |= 0x10;
            }

            if pen != PS_SOLID && pen != PS_INSIDEFRAME {
                needs |= 0x20;
            }
        }

        let bounds = if pen == PS_INSIDEFRAME {
            [x0, y0, x1, y1]
        } else {
            [
                x0 - (width >> 1),
                y0 - (height >> 1),
                x1 + ((width - 1) >> 1),
                y1 + ((height - 1) >> 1),
            ]
        };
        let inside = placement(&mut system, dc, bounds) == 2;

        if caps(&system, dc, 0x20) & needs != needs || (!inside && !clips_figures(&system, dc)) {
            return Ok(0);
        }

        let corners = if pen == PS_INSIDEFRAME {
            [
                x0 + (width >> 1),
                y0 + (height >> 1),
                x1 - (width >> 1),
                y1 - (height >> 1),
            ]
        } else {
            [x0, y0, x1, y1]
        };

        (corners, (inside, bounds))
    };
    let answer = figure(engine, dc, OS_RECTANGLE, &corners, inside.0, Some(inside.1)).await?;

    Ok(u16::from(answer != -1))
}

/// The curves GDI's routine draws (seg9 `0000`-`014a`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Curve {
    Ellipse,
    Arc,
    Chord,
    Pie,
    RoundRect,
}

impl Curve {
    /// What each gives GDI's routine: its flags, its style, its points and
    /// the `dpCurveCaps` it needs.
    fn given(self) -> (u16, u16, usize, u16) {
        match self {
            Self::Ellipse => (8, OS_ELLIPSE, 2, 8),
            Self::Arc => (1, OS_ARC, 5, 2),
            Self::Chord => (2, OS_CHORD, 5, 2),
            Self::Pie => (4, OS_PIE, 5, 2),
            Self::RoundRect => (0x10, OS_ROUNDRECT, 3, 0x100),
        }
    }
}

/// The curves on a driver's context (`GDI.EXE` seg9 `02c4`): `Ellipse`,
/// `Arc`, `Chord`, `Pie` and `RoundRect`. The rectangle's corners and the
/// two points mapped -- a round rectangle's corner as a point out from the
/// left and top -- the corners put in order, the right and bottom brought
/// in by one; none left, nothing drawn. A round rectangle's corner is made
/// a size again, no larger than the rectangle; with none it is a
/// rectangle. A driver whose `dpCurveCaps` has what the curve and the pen
/// and brush need is given the curve with the corners and the points
/// (`05ff`): an ellipse whose sides are as long by the aspects is
/// `OS_CIRCLE` where the driver has `CC_CIRCLES`. Not followed: the arcs
/// whose two points meet, GDI's own drawing for a driver that cannot, and
/// the wide frames GDI draws itself.
pub async fn driver_curve(
    engine: &Engine,
    dc: usize,
    curve: Curve,
    rect: Rect,
    first: (i32, i32),
    second: (i32, i32),
) -> Result<u16, Stop> {
    let (flags, base_style, count, base_needs) = curve.given();
    let [left, top, right, bottom] = rect;
    let mut p1 = first;

    if flags & 0x10 != 0 {
        let (cw, ch) = (first.0.abs(), first.1.abs());

        p1 = (
            left + if left >= right { -cw } else { cw },
            top + if top >= bottom { -ch } else { ch },
        );
    }

    let plan = |system: &mut System| -> Result<Plan, Stop> {
        let (dl, dt) = device_point(system, dc, left, top);
        let (dr, db) = device_point(system, dc, right, bottom);
        let d1 = device_point(system, dc, p1.0, p1.1);
        let d2 = device_point(system, dc, second.0, second.1);
        let (l, r) = (dl.min(dr), dl.max(dr) - 1);
        let (t, b) = (dt.min(db), dt.max(db) - 1);

        if l > r || t > b {
            return Ok(Plan::Nothing);
        }

        let mut radial = [d1.0, d1.1, d2.0, d2.1];

        if flags & 0x10 != 0 {
            let across = (d1.0 - dl).abs();
            let down = (d1.1 - dt).abs();

            if across == 0 || down == 0 {
                return Ok(Plan::Rectangle);
            }

            radial = [across.min(r - l), down.min(b - t), d2.0, d2.1];
        }

        let pen = pen_style(system, dc);
        let (pen_width, pen_height) = pen_size(system, dc);
        let mut needs = base_needs;
        let mut style = base_style;

        if pen != PS_NULL {
            if pen_width > 1 {
                needs |= 0x10;
            } else if pen != PS_SOLID {
                needs |= 0x20;
            }
        }

        if brush_style(system, dc) != BS_HOLLOW {
            needs |= 0x80;
        }

        let curves = caps(system, dc, 0x1c);

        if needs & 8 != 0
            && curves & 1 != 0
            && (r - l) * i32::from(caps(system, dc, 0x28))
                == (b - t) * i32::from(caps(system, dc, 0x2a))
        {
            style = OS_CIRCLE;
            needs &= !8;
        }

        if curves & needs != needs {
            return Ok(Plan::Nothing);
        }

        let reach_x = (pen_width >> 1) + 1;
        let reach_y = (pen_height >> 1) + 1;
        let mut corners = [l, t, r, b];

        if pen == PS_INSIDEFRAME {
            corners[0] += reach_x - 1;
            corners[1] += reach_y - 1;
            corners[2] -= reach_x - 1;
            corners[3] -= reach_y - 1;
        }

        let inside = placement(
            system,
            dc,
            [l - reach_x, t - reach_y, r + reach_x, b + reach_y],
        ) == 2;

        if !inside && !clips_figures(system, dc) {
            return Ok(Plan::Nothing);
        }

        let mut points: Vec<i32> = corners.iter().chain(radial.iter()).copied().collect();

        points.extend([0, 0]);
        points.truncate(count * 2);
        Ok(Plan::Figure(points, style, inside))
    };

    let planned = plan(&mut engine.system())?;

    match planned {
        Plan::Nothing => Ok(0),
        Plan::Rectangle => driver_rectangle(engine, dc, rect).await,
        Plan::Figure(points, style, inside) => {
            let answer = figure(engine, dc, style, &points, inside, None).await?;

            Ok(u16::from(answer != -1))
        }
    }
}

/// What a curve comes to: nothing, a rectangle, or a figure for the
/// driver -- its points, its style, and whether it is inside the region.
enum Plan {
    Nothing,
    Rectangle,
    Figure(Vec<i32>, u16, bool),
}

/// A polyline on a driver's context (`GDI.EXE` seg21 `0726`): the points
/// mapped; the bounds of them, out by the pen's reach, their right and
/// bottom made outside, and cut to the visible region; nothing drawn for
/// none left. A pen wider than a pixel needs `LC_WIDE` (and
/// `LC_WIDESTYLED` for a style) and goes as a whole figure (`10cd`); a
/// thin one is given `OS_POLYLINE` with the bounds as the clip rectangle
/// (`0801`), a line of two points along an axis across the region's edge
/// cut to it first. A null pen draws nothing. Not followed: GDI's own
/// lines for a driver that cannot draw them.
pub async fn driver_polyline(
    engine: &Engine,
    dc: usize,
    logical: &[(i32, i32)],
) -> Result<u16, Stop> {
    let line = polyline_plan(&mut engine.system(), dc, logical);

    match line {
        Line::Answer(answer) => Ok(answer),
        Line::Wide(flat, inside, bounds) => {
            figure(engine, dc, OS_POLYLINE, &flat, inside, Some(bounds)).await?;
            Ok(1)
        }
        Line::Thin(flat, bounds) => {
            output(engine, dc, OS_POLYLINE, &flat, false, Some(bounds)).await?;
            Ok(1)
        }
    }
}

/// What a polyline comes to: an answer with nothing drawn, a wide line
/// given whole, or a thin one given with its clip rectangle.
enum Line {
    Answer(u16),
    Wide(Vec<i32>, bool, Rect),
    Thin(Vec<i32>, Rect),
}

fn polyline_plan(system: &mut System, dc: usize, logical: &[(i32, i32)]) -> Line {
    let pen = pen_style(system, dc);

    if pen == PS_NULL || pen > PS_INSIDEFRAME || logical.len() < 2 {
        return Line::Answer(0);
    }

    let mut points: Vec<(i32, i32)> = logical
        .iter()
        .map(|&(x, y)| device_point(system, dc, x, y))
        .collect();
    let (pen_width, pen_height) = pen_size(system, dc);
    let reach = ((pen_width + 1) >> 1) - pen_width;
    let mut bounds = [
        points.iter().map(|p| p.0).min().unwrap_or(0) + reach,
        points.iter().map(|p| p.1).min().unwrap_or(0) + reach,
        points.iter().map(|p| p.0).max().unwrap_or(0) - reach,
        points.iter().map(|p| p.1).max().unwrap_or(0) - reach,
    ];

    if bounds[3] != 0x7fff {
        bounds[3] += 1;
    }

    if bounds[2] != 0x7fff {
        bounds[2] += 1;
    }

    let region = visible_region(system, dc);

    if region.kind() == 1 {
        return Line::Answer(1);
    }

    let mut cut = 0;

    if region.kind() == 2 {
        let b = region.bounds();

        if b.left > bounds[0] {
            bounds[0] = b.left;
            cut += 1;
        }

        if b.top > bounds[1] {
            bounds[1] = b.top;
            cut += 1;
        }

        if b.right < bounds[2] {
            bounds[2] = b.right;
            cut += 1;
        }

        if b.bottom < bounds[3] {
            bounds[3] = b.bottom;
            cut += 1;
        }

        if bounds[3] <= bounds[1] || bounds[2] <= bounds[0] {
            return Line::Answer(1);
        }
    } else {
        cut = 2;
    }

    let lines = caps(system, dc, 0x1e);

    if pen_width > 1 {
        let needs = if pen == PS_SOLID || pen == PS_INSIDEFRAME {
            0x10
        } else {
            0x50
        };
        let inside = placement(
            system,
            dc,
            [
                bounds[0] - pen_width,
                bounds[1] - pen_height,
                bounds[2] + pen_width,
                bounds[3] + pen_height,
            ],
        ) == 2;

        if lines & needs != needs || (!inside && !clips_figures(system, dc)) {
            return Line::Answer(0);
        }

        let flat: Vec<i32> = points.iter().flat_map(|&(x, y)| [x, y]).collect();

        return Line::Wide(flat, inside, bounds);
    }

    if lines == 0 || (pen != PS_SOLID && pen != PS_INSIDEFRAME && lines & 0x20 == 0) {
        return Line::Answer(0);
    }

    // A thin solid line of two points across the region's edge is cut to
    // it, where it runs along an axis: its ends put in order, each a pixel
    // on where they turn round, as the line leaves out its last point
    // (`09c1`).
    if cut != 0 && points.len() == 2 && pen == PS_SOLID {
        let [(ax, ay), (bx, by)] = [points[0], points[1]];

        if ay == by {
            let (from, to) = if ax > bx { (bx + 1, ax + 1) } else { (ax, bx) };

            points[0] = (from.max(bounds[0]), ay);
            points[1] = (to.min(bounds[2]), by);
            cut = 0;
        } else if ax == bx {
            let (from, to) = if ay >= by { (by + 1, ay + 1) } else { (ay, by) };

            points[0] = (ax, from.max(bounds[1]));
            points[1] = (bx, to.min(bounds[3]));
            cut = 0;
        } else {
            cut = 1;
        }
    }

    if cut > 1 || (cut == 1 && caps(system, dc, 0x24) & 1 == 0) {
        return Line::Answer(0);
    }

    let flat: Vec<i32> = points.iter().flat_map(|&(x, y)| [x, y]).collect();

    Line::Thin(flat, bounds)
}

/// `Polygon` on a driver's context (`GDI.EXE` seg24 `0254`, `0396`): the
/// last point left off where it is the first; fewer than two, nothing,
/// and one answered. The points mapped and the first put again at the end; the bounds of
/// them. A driver whose `dpPolygonalCaps` has `PC_POLYGON` for `ALTERNATE`
/// or `PC_WINDPOLYGON` for `WINDING`, and what the pen and brush need, is
/// given `OS_ALTPOLYGON` or `OS_WINDPOLYGON`. 1 where it drew. Not
/// followed: GDI's own drawing for a driver that cannot.
pub async fn driver_polygon(
    engine: &Engine,
    dc: usize,
    logical: &[(i32, i32)],
) -> Result<u16, Stop> {
    let mut given = logical.to_vec();

    if given.len() > 1 && given[0] == given[given.len() - 1] {
        given.pop();
    }

    if given.len() < 2 {
        return Ok(1);
    }

    let (flat, style, inside, bounds) = {
        let mut system = engine.system();
        let mut points: Vec<(i32, i32)> = given
            .iter()
            .map(|&(x, y)| device_point(&system, dc, x, y))
            .collect();

        points.push(points[0]);

        let bounds = [
            points.iter().map(|p| p.0).min().unwrap_or(0),
            points.iter().map(|p| p.1).min().unwrap_or(0),
            points.iter().map(|p| p.0).max().unwrap_or(0),
            points.iter().map(|p| p.1).max().unwrap_or(0),
        ];
        let pen = pen_style(&system, dc);
        let winding = system.gdi.dcs[dc].state.poly_fill_mode == Some(2);
        let mut needs: u16 = if winding { 4 } else { 1 };

        if brush_style(&system, dc) != BS_HOLLOW {
            needs |= 0x80;
        }

        if pen != PS_NULL {
            if pen_size(&system, dc).0 > 1 {
                needs |= 0x10;
            }

            if pen != PS_SOLID {
                needs |= 0x20;
            }
        }

        let inside = placement(&mut system, dc, bounds) == 2;

        if caps(&system, dc, 0x20) & needs != needs || (!inside && !clips_figures(&system, dc)) {
            return Ok(0);
        }

        let flat: Vec<i32> = points.iter().flat_map(|&(x, y)| [x, y]).collect();

        (
            flat,
            if winding {
                OS_WINDPOLYGON
            } else {
                OS_ALTPOLYGON
            },
            inside,
            bounds,
        )
    };
    let answer = figure(engine, dc, style, &flat, inside, Some(bounds)).await?;

    Ok(u16::from(answer != -1))
}

/// `ExtTextOut` on a driver's context, for a font the driver realized
/// (`GDI.EXE` seg1 `3162`, `397a`): the start mapped; with the region one
/// rectangle, the driver's `ExtTextOut` given the start, the region's
/// rectangle as the clip, the string and its count, the realized
/// `FONTINFO`, the `DRAWMODE`, the `TEXTXFORM`, the opaque rectangle GDI
/// was given, mapped, and the options. 1. Not followed: the alignments
/// other than the top left, the current position, the spacing given
/// (`lpDx`) and justification's second call, rotation, a complex region,
/// and GDI's own text for a font it realized itself.
#[allow(clippy::too_many_arguments, clippy::many_single_char_names)]
pub async fn driver_ext_text_out(
    engine: &Engine,
    dc: usize,
    x: i32,
    y: i32,
    options: u16,
    rect: u32,
    string: u32,
    count: u16,
) -> Result<u16, Stop> {
    let (procedure, lp_pdevice) = proc(&engine.system(), dc, EXT_TEXT_OUT);
    let Some(realized) = super::printer_driver::device_font(engine, dc).await? else {
        return Ok(0);
    };
    let (bytes, has_opaque, args) = {
        let mut system = engine.system();
        let region = visible_region(&mut system, dc);

        if procedure == 0 || region.kind() != 2 {
            return Ok(0);
        }

        let block = system
            .printing
            .drivers
            .drawing
            .get(&dc)
            .map_or(0, |drawing| drawing.far);
        let xform = offset_by(block, TEXTXFORM);

        system.write_far(xform, &realized.xform);

        let (dx, dy) = device_point(&system, dc, x, y);
        let b = region.bounds();
        let mode = draw_mode(&mut system, dc);
        let mut values = vec![b.left, b.top, b.right, b.bottom];
        let mut has_opaque = false;

        if rect != 0 {
            let bytes = system.read_far(rect, 8);
            let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));
            let (l, t) = device_point(&system, dc, word(0), word(2));
            let (r, bo) = device_point(&system, dc, word(4), word(6));

            values.extend([l.min(r), t.min(bo), l.max(r), t.max(bo)]);
            has_opaque = true;
        }

        (words(&values), has_opaque, (dx, dy, xform, mode))
    };
    let (dx, dy, xform, mode) = args;
    let font = realized.far;

    on_stack(engine, &bytes, |far| async move {
        call_driver(
            engine,
            procedure,
            &[
                GuestArg::Long(lp_pdevice),
                GuestArg::Word(dx as u16),
                GuestArg::Word(dy as u16),
                GuestArg::Long(far),
                GuestArg::Long(string),
                GuestArg::Word(count),
                GuestArg::Long(font),
                GuestArg::Long(mode),
                GuestArg::Long(xform),
                GuestArg::Long(0),
                GuestArg::Long(if has_opaque { offset_by(far, 8) } else { 0 }),
                GuestArg::Word(options),
            ],
        )
        .await
    })
    .await?;
    Ok(1)
}

/// `GetTextExtent` on a driver's context, for a font the driver realized
/// (`GDI.EXE` seg1 `3c57`, `3ba3`): nought for no characters (`3c75`);
/// else the driver's `ExtTextOut` (its
/// `dpRaster` having `RC_GDI20_OUTPUT`) given no start, no clip, the
/// string, its count negated, the realized `FONTINFO`, the `DRAWMODE`, the
/// `TEXTXFORM` and no spacing, rectangle or options, which answers the
/// extent, the height above the width. What the driver cannot simulate of
/// the font's accelerators, `ftAccelerator` less `dpText`, adds to the
/// width: one more than the count for `TC_EA_DOUBLE`, half the height less
/// one for `TC_IA_ABLE`. Under a mapping mode each is scaled back to
/// logical units. Not followed: the driver's `StrBlt` for one without
/// `RC_GDI20_OUTPUT`, the justification, and GDI's own measure for a font
/// it realized itself.
///
/// # Errors
///
/// What the driver's code stops with.
pub async fn driver_text_extent(
    engine: &Engine,
    dc: usize,
    string: u32,
    count: u16,
) -> Result<u32, Stop> {
    let (procedure, lp_pdevice) = proc(&engine.system(), dc, EXT_TEXT_OUT);

    if count == 0 {
        return Ok(0);
    }

    let Some(realized) = super::printer_driver::device_font(engine, dc).await? else {
        return Ok(0);
    };

    if procedure == 0 || caps(&engine.system(), dc, DP_RASTER) & RC_GDI20_OUTPUT == 0 {
        return Ok(0);
    }

    let xform_word = |at: usize| u16::from_le_bytes([realized.xform[at], realized.xform[at + 1]]);
    let (mut width, mut height) = {
        let (xform, mode) = {
            let mut system = engine.system();
            let block = system
                .printing
                .drivers
                .drawing
                .get(&dc)
                .map_or(0, |drawing| drawing.far);
            let xform = offset_by(block, TEXTXFORM);

            system.write_far(xform, &realized.xform);
            (xform, draw_mode(&mut system, dc))
        };
        let answer = call_driver(
            engine,
            procedure,
            &[
                GuestArg::Long(lp_pdevice),
                GuestArg::Word(0),
                GuestArg::Word(0),
                GuestArg::Long(0),
                GuestArg::Long(string),
                GuestArg::Word(count.wrapping_neg()),
                GuestArg::Long(realized.far),
                GuestArg::Long(mode),
                GuestArg::Long(xform),
                GuestArg::Long(0),
                GuestArg::Long(0),
                GuestArg::Word(0),
            ],
        )
        .await?;

        (answer as u16, (answer >> 16) as u16)
    };

    let system = engine.system();
    let simulated = !caps(&system, dc, DP_TEXT) & xform_word(FT_ACCELERATOR);

    if simulated & TC_EA_DOUBLE != 0 {
        width = width.wrapping_add(1).wrapping_add(count);
    }

    if simulated & TC_IA_ABLE != 0 {
        width = width.wrapping_add(xform_word(0).wrapping_sub(1) >> 1);
    }

    let mapping = super::mapping::mapping_of(&system, dc);

    if !mapping.is_identity() {
        let scale = super::mapping::scale;

        width = scale(
            i64::from(width as i16),
            mapping.wex.abs(),
            mapping.vex.abs(),
        )
        .unsigned_abs() as u16;
        height = scale(
            i64::from(height as i16),
            mapping.wey.abs(),
            mapping.vey.abs(),
        )
        .unsigned_abs() as u16;
    }

    Ok(u32::from(width) | u32::from(height) << 16)
}

/// `GetTextExtent` on a driver's context, measured by the driver.
fn get_text_extent_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, "GetTextExtent", args).await;
        };
        let (string, count) = {
            let mut args = args;
            let system = engine.system();

            args.word(&system);
            (args.dword(&system), args.word(&system))
        };

        Ok(Answer::Dword(
            driver_text_extent(engine, dc, string, count).await?,
        ))
    })
}

/// A `RECT` laid below the stack, as USER lays one on its own for GDI,
/// given to `body` as a far pointer.
///
/// # Errors
///
/// What `body` stops with.
pub async fn with_rect<T, F: Future<Output = Result<T, Stop>>>(
    engine: &Engine,
    rect: [i32; 4],
    body: impl FnOnce(u32) -> F,
) -> Result<T, Stop> {
    Ok(on_stack(engine, &words(&rect), body).await?.0)
}

/// Bytes laid below the stack, given to `body` as a far pointer.
///
/// # Errors
///
/// What `body` stops with.
pub async fn with_bytes<T, F: Future<Output = Result<T, Stop>>>(
    engine: &Engine,
    bytes: &[u8],
    body: impl FnOnce(u32) -> F,
) -> Result<T, Stop> {
    Ok(on_stack(engine, bytes, body).await?.0)
}

/// What `StretchDIBits` was given.
#[derive(Debug, Clone, Copy)]
pub struct Stretched {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub src_x: i32,
    pub src_y: i32,
    pub src_width: i32,
    pub src_height: i32,
    pub bits: u32,
    pub info: u32,
    pub usage: u16,
    pub rop: u32,
}

/// `StretchDIBits` on a driver's context whose `dpRaster` has
/// `RC_STRETCHDIB` (`GDI.EXE` seg11 `1058`): the destination's corners
/// mapped, its size their difference; for each of the visible region's
/// rectangles within the destination, put in order, from the bottom up,
/// the driver's `StretchDIBits` given the destination, the source, the
/// bits and the header as the program gave them, no conversion, the
/// raster operation, the brush, the `DRAWMODE` and the rectangle as the
/// clip. The answer is the source's height. Not followed: a header GDI
/// converts (a core header, `DIB_PAL_COLORS`, a palette device), and GDI's
/// own drawing where the driver answers -1 or has no `RC_STRETCHDIB`.
pub async fn driver_stretch_dibits(
    engine: &Engine,
    dc: usize,
    given: Stretched,
) -> Result<u16, Stop> {
    let (procedure, lp_pdevice, rects, corners, brush) = {
        let mut system = engine.system();
        let (procedure, lp_pdevice) = proc(&system, dc, STRETCH_DIBITS);

        if procedure == 0 || caps(&system, dc, 0x26) & 0x2000 == 0 || given.usage != 0 {
            return Ok(0);
        }

        let (x0, y0) = device_point(&system, dc, given.x, given.y);
        let (x1, y1) = device_point(&system, dc, given.x + given.width, given.y + given.height);
        let within = [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)];
        let brush = state(&system, dc)
            .and_then(|driver| driver.brush.as_ref())
            .map_or(0, |b| b.far);

        (
            procedure,
            lp_pdevice,
            region_rects(&mut system, dc, within, false),
            (x0, y0, x1, y1),
            brush,
        )
    };
    let (x0, y0, x1, y1) = corners;

    for rect in rects {
        let mode = draw_mode(&mut engine.system(), dc);
        let (answer, _) = on_stack(engine, &words(&rect), |far| async move {
            call_driver(
                engine,
                procedure,
                &[
                    GuestArg::Long(lp_pdevice),
                    GuestArg::Word(0),
                    GuestArg::Word(x0 as u16),
                    GuestArg::Word(y0 as u16),
                    GuestArg::Word((x1 - x0) as u16),
                    GuestArg::Word((y1 - y0) as u16),
                    GuestArg::Word(given.src_x as u16),
                    GuestArg::Word(given.src_y as u16),
                    GuestArg::Word(given.src_width as u16),
                    GuestArg::Word(given.src_height as u16),
                    GuestArg::Long(given.bits),
                    GuestArg::Long(given.info),
                    GuestArg::Long(0),
                    GuestArg::Long(given.rop),
                    GuestArg::Long(brush),
                    GuestArg::Long(mode),
                    GuestArg::Long(far),
                ],
            )
            .await
        })
        .await?;

        if answer as u16 == 0xffff {
            return Ok(0);
        }
    }

    Ok(given.src_height as u16)
}

/// The points a program gave, `count` of them at a far pointer.
fn points_at(system: &System, far: u32, count: i16) -> Vec<(i32, i32)> {
    let count = usize::try_from(count).unwrap_or(0);
    let bytes = system.read_far(far, count * 4);

    bytes
        .chunks_exact(4)
        .map(|point| {
            (
                i32::from(i16::from_le_bytes([point[0], point[1]])),
                i32::from(i16::from_le_bytes([point[2], point[3]])),
            )
        })
        .collect()
}

/// The call as the rest of GDI answers it, for a context not a driver's.
async fn otherwise(engine: &Engine, name: &str, mut args: Args) -> Result<Answer, Stop> {
    match super::base_implementation(name) {
        Some(Implementation::Sync(answer)) => answer(&mut engine.system(), &mut args),
        Some(Implementation::Async(answer)) => answer(engine, args).await,
        None => Ok(Answer::Word(0)),
    }
}

fn driver_of(system: &System, hdc: u16) -> Option<usize> {
    super::printer_driver::driver_dc_of(system, hdc)
}

/// A call on a device context: the context's handle and, for a driver's,
/// its index; the arguments as they were, for the rest of GDI.
fn first(engine: &Engine, args: &Args) -> (u16, Option<usize>) {
    let mut peek = *args;
    let system = engine.system();
    let hdc = peek.word(&system);

    (hdc, driver_of(&system, hdc))
}

/// The words of a call after its device context.
fn read_words(engine: &Engine, args: &mut Args, count: usize) -> Vec<i32> {
    let system = engine.system();

    args.word(&system);
    (0..count)
        .map(|_| i32::from(args.signed(&system)))
        .collect()
}

fn select_object_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, driver) = first(engine, &args);
        let Some(dc) = driver else {
            return otherwise(engine, "SelectObject", args).await;
        };
        let (before, kind) = {
            let mut peek = args;
            let system = engine.system();

            peek.word(&system);

            let handle = peek.word(&system);
            let kind = match system.gdi_object_of(handle) {
                Some((_, GdiObject::Pen(_))) => Some(true),
                Some((_, GdiObject::Brush(_))) => Some(false),
                _ => None,
            };
            let state = &system.gdi.dcs[dc].state;

            ((state.pen, state.brush), kind)
        };
        let answer = otherwise(engine, "SelectObject", args).await?;

        // A printer driver's from the drive realizes it at once, and a pen
        // or brush it cannot leaves the one before selected and answers
        // nought (`GDI.EXE` seg1 `1b9f`, `1b72`).
        let realized = match kind {
            Some(true) => realize_pen(engine, dc).await?,
            Some(false) => realize_brush(engine, dc).await?,
            None => return Ok(answer),
        };

        if !realized {
            let mut system = engine.system();
            let state = &mut system.gdi.dcs[dc].state;

            if kind == Some(true) {
                state.pen = before.0;
            } else {
                state.brush = before.1;
            }

            return Ok(Answer::Word(0));
        }

        let _ = hdc;
        Ok(answer)
    })
}

fn colour_call(engine: &Engine, args: Args, background: bool) -> Later<'_> {
    Box::pin(async move {
        let name = if background {
            "SetBkColor"
        } else {
            "SetTextColor"
        };
        let (_, driver) = first(engine, &args);
        let rgb = {
            let mut peek = args;
            let system = engine.system();

            peek.word(&system);
            peek.dword(&system)
        };
        let answer = otherwise(engine, name, args).await?;

        // A printer driver's from the drive is asked the physical colour
        // (`GDI.EXE` seg1 `1476`, `14dc`).
        if let Some(dc) = driver {
            set_driver_color(engine, dc, background, rgb).await?;
        }

        Ok(answer)
    })
}

fn set_bk_color_call(engine: &Engine, args: Args) -> Later<'_> {
    colour_call(engine, args, true)
}

fn set_text_color_call(engine: &Engine, args: Args) -> Later<'_> {
    colour_call(engine, args, false)
}

fn rectangle_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, "Rectangle", args).await;
        };
        let mut args = args;
        let v = read_words(engine, &mut args, 4);

        Ok(Answer::Word(
            driver_rectangle(engine, dc, [v[0], v[1], v[2], v[3]]).await?,
        ))
    })
}

fn curve_call<'a>(engine: &'a Engine, args: Args, curve: Curve, name: &'static str) -> Later<'a> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, name, args).await;
        };
        let mut args = args;
        let count = match curve {
            Curve::Ellipse => 4,
            Curve::RoundRect => 6,
            _ => 8,
        };
        let mut v = read_words(engine, &mut args, count);

        v.resize(8, 0);

        let rect = [v[0], v[1], v[2], v[3]];

        Ok(Answer::Word(
            driver_curve(engine, dc, curve, rect, (v[4], v[5]), (v[6], v[7])).await?,
        ))
    })
}

fn ellipse_call(engine: &Engine, args: Args) -> Later<'_> {
    curve_call(engine, args, Curve::Ellipse, "Ellipse")
}

fn round_rect_call(engine: &Engine, args: Args) -> Later<'_> {
    curve_call(engine, args, Curve::RoundRect, "RoundRect")
}

fn arc_call(engine: &Engine, args: Args) -> Later<'_> {
    curve_call(engine, args, Curve::Arc, "Arc")
}

fn chord_call(engine: &Engine, args: Args) -> Later<'_> {
    curve_call(engine, args, Curve::Chord, "Chord")
}

fn pie_call(engine: &Engine, args: Args) -> Later<'_> {
    curve_call(engine, args, Curve::Pie, "Pie")
}

/// `LineTo` on a driver's context: the current position moved, and a
/// polyline of two points drawn from where it was (`GDI.EXE` seg21
/// `0b06`); 1.
fn line_to_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, "LineTo", args).await;
        };
        let mut args = args;
        let v = read_words(engine, &mut args, 2);
        let from = {
            let mut system = engine.system();
            let state = &mut system.gdi.dcs[dc].state;
            let from = state.position;

            state.position = (v[0], v[1]);
            from
        };

        driver_polyline(engine, dc, &[from, (v[0], v[1])]).await?;
        Ok(Answer::Word(1))
    })
}

fn points_call<'a>(engine: &'a Engine, args: Args, polygon: bool, name: &'static str) -> Later<'a> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, name, args).await;
        };
        let points = {
            let mut args = args;
            let system = engine.system();

            args.word(&system);

            let far = args.dword(&system);
            let count = args.signed(&system);

            if far == 0 || count < 2 {
                return Ok(Answer::Word(0));
            }

            points_at(&system, far, count)
        };
        let answer = if polygon {
            driver_polygon(engine, dc, &points).await?
        } else {
            driver_polyline(engine, dc, &points).await?
        };

        Ok(Answer::Word(answer))
    })
}

fn polyline_call(engine: &Engine, args: Args) -> Later<'_> {
    points_call(engine, args, false, "Polyline")
}

fn polygon_call(engine: &Engine, args: Args) -> Later<'_> {
    points_call(engine, args, true, "Polygon")
}

/// `TextOut` on a driver's context: `ExtTextOut` with no options,
/// rectangle or spacing (`GDI.EXE` seg1 `3884`).
fn text_out_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, "TextOut", args).await;
        };
        let (x, y, string, count) = {
            let mut args = args;
            let system = engine.system();

            args.word(&system);
            (
                i32::from(args.signed(&system)),
                i32::from(args.signed(&system)),
                args.dword(&system),
                args.word(&system),
            )
        };

        Ok(Answer::Word(
            driver_ext_text_out(engine, dc, x, y, 0, 0, string, count).await?,
        ))
    })
}

fn ext_text_out_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, "ExtTextOut", args).await;
        };
        let (x, y, options, rect, string, count) = {
            let mut args = args;
            let system = engine.system();

            args.word(&system);
            (
                i32::from(args.signed(&system)),
                i32::from(args.signed(&system)),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
                args.word(&system),
            )
        };

        Ok(Answer::Word(
            driver_ext_text_out(engine, dc, x, y, options, rect, string, count).await?,
        ))
    })
}

fn stretch_dibits_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some(dc) = first(engine, &args).1 else {
            return otherwise(engine, "StretchDIBits", args).await;
        };
        let given = {
            let mut args = args;
            let system = engine.system();
            let mut signed = || i32::from(args.signed(&system));

            let _ = signed();
            let (x, y, width, height) = (signed(), signed(), signed(), signed());
            let (src_x, src_y, src_width, src_height) = (signed(), signed(), signed(), signed());

            Stretched {
                x,
                y,
                width,
                height,
                src_x,
                src_y,
                src_width,
                src_height,
                bits: args.dword(&system),
                info: args.dword(&system),
                usage: args.word(&system),
                rop: args.dword(&system),
            }
        };

        Ok(Answer::Word(
            driver_stretch_dibits(engine, dc, given).await?,
        ))
    })
}

/// The calls a printer driver's context answers through its driver; any
/// other context, as the rest of GDI answers them.
pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "SelectObject" => select_object_call,
        "SetBkColor" => set_bk_color_call,
        "SetTextColor" => set_text_color_call,
        "Rectangle" => rectangle_call,
        "Ellipse" => ellipse_call,
        "RoundRect" => round_rect_call,
        "Arc" => arc_call,
        "Chord" => chord_call,
        "Pie" => pie_call,
        "LineTo" => line_to_call,
        "Polyline" => polyline_call,
        "Polygon" => polygon_call,
        "TextOut" => text_out_call,
        "ExtTextOut" => ext_text_out_call,
        "GetTextExtent" => get_text_extent_call,
        "StretchDIBits" => stretch_dibits_call,
        _ => return None,
    }))
}
