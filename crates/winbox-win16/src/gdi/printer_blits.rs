//! Bitmaps drawn through a printer's driver, as Windows' GDI hands them to
//! it: `BitBlt` and `PatBlt` to the driver's `BitBlt`, `StretchBlt` to its
//! `StretchBlt` and `SetDIBitsToDevice` to its `DIBToDevice`; and a memory
//! context made compatible with a driver's context. What GDI draws itself
//! for a driver that cannot is `printer_stretch.rs`. The twin of
//! `src/win16/gdi/printer-blits.ts`.
//!
//! Not followed: a memory context's own drawing through its printer's
//! driver, but for what GDI draws into bitmaps of its own.

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::handles::Object;
use crate::system::System;

use super::dc::DcBitmap;
use super::ddb::Bitmap;
use super::objects::GdiObject;
use super::printer_output::{
    call_driver, device_point, draw_mode, kernel, on_stack, proc, state, words,
};

const BIT_BLT: u16 = 1;
const DIB_TO_DEVICE: u16 = 21;
const STRETCH_BLT: u16 = 27;
const RC_DIBTODEV: u16 = 0x200;
const RC_STRETCHBLT: u16 = 0x800;
const RASTERCAPS: i16 = 0x26;

pub(super) type Rect = [i32; 4];

/// The rectangles of the visible region within a rectangle, GDI's walk of
/// them for a blit (seg1 `2b62`, its flags 183h at first): from the top
/// down or the bottom up, and in each band from the left or from the
/// right.
pub(super) fn blit_rects(
    system: &mut System,
    dc: usize,
    within: Rect,
    top_down: bool,
    left_to_right: bool,
) -> Vec<Rect> {
    let mut bands = super::regions::clip_of(system, dc).bands;
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

        let mut spans = band.spans.clone();

        if !left_to_right {
            spans.reverse();
        }

        for (left, right) in spans {
            let l = left.max(within[0]);
            let r = right.min(within[2]);

            if l < r {
                rects.push([l, top, r, bottom]);
            }
        }
    }

    rects
}

/// A blit's rectangle in device terms (seg1 `312c`): its corner and its
/// extents mapped, the corners put in order.
fn blit_box(system: &System, dc: usize, x: i32, y: i32, width: i32, height: i32) -> Rect {
    let (x0, y0) = device_point(system, dc, x, y);
    let (x1, y1) = device_point(system, dc, x + width, y + height);

    [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]
}

fn is_empty(rect: Rect) -> bool {
    rect[0] == rect[2] || rect[1] == rect[3]
}

/// The device a context draws through: a driver's context's, or a memory
/// context's made compatible with one.
pub(super) fn device_of(system: &System, dc: usize) -> Option<u32> {
    system
        .printing
        .drivers
        .contexts
        .get(&dc)
        .or_else(|| system.printing.drivers.compatible.get(&dc))
        .copied()
}

/// Whether a source can be given to a driver: a context of the same
/// driver, or a memory context made compatible with one (seg1 `2e06`-
/// `2e10`: where either is a device, their drivers must be the same).
pub(super) fn same_driver(system: &System, dc: usize, source: usize) -> bool {
    let driver = |dc: usize| {
        device_of(system, dc)
            .and_then(|id| system.printing.drivers.devices.get(&id))
            .map(|pdevice| pdevice.driver.clone())
    };

    driver(dc).is_some() && driver(dc) == driver(source)
}

/// A context of the call's, by the handle at its place: its index.
pub(super) fn dc_index(system: &System, hdc: u16) -> Option<usize> {
    match system.handles.resolve(hdc)? {
        Object::Dc(index) => Some(index),
        _ => None,
    }
}

fn driver_dc(system: &System, hdc: u16) -> Option<usize> {
    super::printer_driver::driver_dc_of(system, hdc)
}

/// A memory context's bitmap, where it has one of GDI's.
pub(super) fn dc_bitmap(system: &System, dc: usize) -> Option<Bitmap> {
    let DcBitmap::Bitmap(object) = system.gdi.dcs[dc].bitmap else {
        return None;
    };
    let GdiObject::Bitmap(bitmap) = &system.gdi.objects[object] else {
        return None;
    };

    Some((**bitmap).clone())
}

/// A bitmap as GDI hands it to a driver: its `BITMAP` -- the type nought,
/// the width, the height, the bytes a row, the planes, the bits a pixel,
/// the bits' far pointer and the bytes a plane -- and its bits after it,
/// in rows padded to words. In a block of its own, let go after
/// (`free_block`): its handle and far pointer.
pub(super) async fn block_of(engine: &Engine, bitmap: &Bitmap) -> Result<(u16, u32), Stop> {
    let image = {
        let pixels = &bitmap.pixels;
        let (planes, bits) = super::ddb::format_of(pixels);
        let size = super::ddb::bits_size(pixels).max(0);
        let width = i64::from(pixels.width());
        let height = i64::from(pixels.height());
        let width_bytes = super::ddb::row_bytes(i64::from(bits), width);
        let data: Vec<u8> = (0..size)
            .map(|at| super::ddb::read_byte(bitmap, at))
            .collect();

        (planes, bits, width, height, width_bytes, data)
    };
    let (planes, bits, width, height, width_bytes, data) = image;
    let handle = kernel(
        engine,
        "GlobalAlloc",
        &[
            GuestArg::Word(0x2042),
            GuestArg::Long(0x20 + data.len() as u32),
        ],
    )
    .await? as u16;

    if handle == 0 {
        return Ok((0, 0));
    }

    let far = kernel(engine, "GlobalLock", &[GuestArg::Word(handle)]).await?;
    let bits_far = (far & 0xffff_0000) | (far.wrapping_add(0x20) & 0xffff);
    let plane = (width_bytes * height) as u32;
    let mut header = words(&[
        0,
        width as i32,
        height as i32,
        width_bytes as i32,
        i32::from(planes) | i32::from(bits) << 8,
    ]);

    header.extend(bits_far.to_le_bytes());
    header.extend(plane.to_le_bytes());
    header.resize(0x20, 0);
    header.extend(data);
    engine.system().write_far(far, &header);
    Ok((handle, far))
}

/// A bitmap's bits as a driver left them in its block.
pub(super) fn read_back(system: &System, far: u32, bitmap: &mut Bitmap) {
    if far == 0 {
        return;
    }

    let size = super::ddb::bits_size(&bitmap.pixels).max(0);
    let at = (far & 0xffff_0000) | (far.wrapping_add(0x20) & 0xffff);
    let bytes = system.read_far(at, size as usize);

    for (offset, byte) in bytes.into_iter().enumerate() {
        super::ddb::write_byte(bitmap, offset as i64, byte);
    }
}

pub(super) async fn free_block(engine: &Engine, handle: u16) -> Result<(), Stop> {
    if handle != 0 {
        kernel(engine, "GlobalFree", &[GuestArg::Word(handle)]).await?;
    }

    Ok(())
}

pub(super) fn brush_far(system: &System, dc: usize) -> u32 {
    state(system, dc)
        .and_then(|driver| driver.brush.as_ref())
        .map_or(0, |brush| brush.far)
}

/// `BitBlt` or `PatBlt` on a driver's context (`GDI.EXE` seg1 `305b`,
/// `2d0d`): the destination's rectangle in device terms, empty answering
/// 1; a source not of the same driver answers nought; else `blit_device`.
async fn driver_bit_blt(
    engine: &Engine,
    dc: usize,
    dest: Rect,
    source: Option<usize>,
    from: (i32, i32),
    rop: u32,
) -> Result<u16, Stop> {
    let (within, origin, procedure) = {
        let system = engine.system();
        let within = blit_box(&system, dc, dest[0], dest[1], dest[2], dest[3]);
        let origin = source.map_or(within, |source| {
            blit_box(&system, source, from.0, from.1, dest[2], dest[3])
        });

        (within, origin, proc(&system, dc, BIT_BLT).0)
    };

    if is_empty(within) || (source.is_some() && is_empty(origin)) {
        return Ok(1);
    }

    if source.is_some_and(|source| !same_driver(&engine.system(), dc, source)) || procedure == 0 {
        return Ok(0);
    }

    let bitmap = source.and_then(|source| dc_bitmap(&engine.system(), source));

    blit_device(
        engine,
        dc,
        within,
        bitmap.as_ref(),
        (origin[0], origin[1]),
        rop,
        None,
    )
    .await
}

/// A blit in device terms to a driver's context (seg1 `2d0d`): the
/// driver's `BitBlt` once for each of the visible region's rectangles
/// within the destination -- and within `limit`, a clip rectangle GDI sets
/// itself -- from the bottom up where the source is above, from the right
/// where it is to the left (`2da8`), with that rectangle's corner, the
/// source and its corner moved as far, the extent, the raster operation,
/// the realized brush and the `DRAWMODE` (`2e92`); 1.
pub(super) async fn blit_device(
    engine: &Engine,
    dc: usize,
    within: Rect,
    bitmap: Option<&Bitmap>,
    origin: (i32, i32),
    rop: u32,
    limit: Option<Rect>,
) -> Result<u16, Stop> {
    let (procedure, lp_pdevice) = proc(&engine.system(), dc, BIT_BLT);

    if procedure == 0 {
        return Ok(0);
    }

    let area = limit.map_or(within, |limit| {
        [
            within[0].max(limit[0]),
            within[1].max(limit[1]),
            within[2].min(limit[2]),
            within[3].min(limit[3]),
        ]
    });
    let (handle, source_far) = match bitmap {
        Some(bitmap) => block_of(engine, bitmap).await?,
        None => (0, 0),
    };
    let rects = if area[0] < area[2] && area[1] < area[3] {
        blit_rects(
            &mut engine.system(),
            dc,
            area,
            origin.1 >= within[1],
            origin.0 >= within[0],
        )
    } else {
        Vec::new()
    };

    for rect in rects {
        let (brush, mode) = {
            let mut system = engine.system();

            (brush_far(&system, dc), draw_mode(&mut system, dc))
        };

        call_driver(
            engine,
            procedure,
            &[
                GuestArg::Long(lp_pdevice),
                GuestArg::Word(rect[0] as u16),
                GuestArg::Word(rect[1] as u16),
                GuestArg::Long(source_far),
                GuestArg::Word((rect[0] - within[0] + origin.0) as u16),
                GuestArg::Word((rect[1] - within[1] + origin.1) as u16),
                GuestArg::Word((rect[2] - rect[0]) as u16),
                GuestArg::Word((rect[3] - rect[1]) as u16),
                GuestArg::Long(rop),
                GuestArg::Long(brush),
                GuestArg::Long(mode),
            ],
        )
        .await?;
    }

    free_block(engine, handle).await?;
    Ok(1)
}

/// Whether a raster operation reads its source: its source bits differ
/// from its others (`GDI.EXE` seg1 `2fbf`).
fn uses_source(rop: u32) -> bool {
    let low = rop & 0xff;

    (low >> 2) & 0x33 != low & 0x33
}

fn bit_blt_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dc, source, values, rop) = {
            let system = engine.system();
            let mut peek = args;
            let hdc = peek.word(&system);
            let x = peek.signed(&system);
            let y = peek.signed(&system);
            let width = peek.signed(&system);
            let height = peek.signed(&system);
            let hdc_src = peek.word(&system);
            let sx = peek.signed(&system);
            let sy = peek.signed(&system);
            let rop = peek.dword(&system);

            (
                driver_dc(&system, hdc),
                dc_index(&system, hdc_src),
                [x, y, width, height, sx, sy].map(i32::from),
                rop,
            )
        };
        let Some(dc) = dc else {
            return super::printer_output::otherwise(engine, "BitBlt", args).await;
        };
        let source = if uses_source(rop) { source } else { None };
        let answer = driver_bit_blt(
            engine,
            dc,
            [values[0], values[1], values[2], values[3]],
            source,
            (values[4], values[5]),
            rop,
        )
        .await?;

        Ok(Answer::Word(answer))
    })
}

fn pat_blt_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dc, values, rop) = {
            let system = engine.system();
            let mut peek = args;
            let hdc = peek.word(&system);
            let values = [
                peek.signed(&system),
                peek.signed(&system),
                peek.signed(&system),
                peek.signed(&system),
            ]
            .map(i32::from);

            (driver_dc(&system, hdc), values, peek.dword(&system))
        };
        let Some(dc) = dc else {
            return super::printer_output::otherwise(engine, "PatBlt", args).await;
        };

        Ok(Answer::Word(
            driver_bit_blt(engine, dc, values, None, (0, 0), rop).await?,
        ))
    })
}

/// `StretchBlt` on a driver's context (`GDI.EXE` seg1 `305b`, seg32
/// `03ba`): both rectangles in device terms, either with no width or
/// height answering 1 (seg1 `312c`); extents alike a copy (`30bc`); from a
/// memory context, a far corner beyond its bitmap answers nought (`30da`);
/// else `printer_stretch::stretch_on_driver`. 1 where winbox.js does not
/// follow what GDI does.
fn stretch_blt_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, hdc_src, dc, source, values, rop) = {
            let system = engine.system();
            let mut peek = args;
            let hdc = peek.word(&system);
            let mut values = [0; 8];

            for value in values.iter_mut().take(4) {
                *value = i32::from(peek.signed(&system));
            }

            let hdc_src = peek.word(&system);

            for value in values.iter_mut().skip(4) {
                *value = i32::from(peek.signed(&system));
            }

            (
                hdc,
                hdc_src,
                driver_dc(&system, hdc),
                dc_index(&system, hdc_src),
                values,
                peek.dword(&system),
            )
        };
        let (Some(dc), Some(source)) = (dc, source) else {
            return super::printer_output::otherwise(engine, "StretchBlt", args).await;
        };
        let [x, y, width, height, sx, sy, swidth, sheight] = values;
        let answer = stretch_on_context(
            engine,
            (dc, hdc),
            (source, hdc_src),
            [x, y, width, height],
            [sx, sy, swidth, sheight],
            rop,
        )
        .await?;

        Ok(Answer::Word(answer.unwrap_or(1)))
    })
}

/// `StretchBlt` from one context to a driver's, the rectangles in the
/// contexts' own terms (seg1 `305b`): see `stretch_blt_call`. None where
/// winbox.js does not follow what GDI does.
pub(super) async fn stretch_on_context(
    engine: &Engine,
    (dc, hdc): (usize, u16),
    (source, hdc_src): (usize, u16),
    [x, y, width, height]: Rect,
    [sx, sy, swidth, sheight]: Rect,
    rop: u32,
) -> Result<Option<u16>, Stop> {
    let (p, q, beyond) = {
        let system = engine.system();
        let (x0, y0) = device_point(&system, dc, x, y);
        let (x1, y1) = device_point(&system, dc, x + width, y + height);
        let (s0, t0) = device_point(&system, source, sx, sy);
        let (s1, t1) = device_point(&system, source, sx + swidth, sy + sheight);
        let beyond = system.gdi.dcs[source].memory
            && dc_bitmap(&system, source)
                .is_some_and(|bitmap| s1 > bitmap.pixels.width() || t1 > bitmap.pixels.height());

        ([x0, y0, x1, y1], [s0, t0, s1, t1], beyond)
    };
    let [x0, y0, x1, y1] = p;
    let [s0, t0, s1, t1] = q;

    if x0 == x1 || y0 == y1 || s0 == s1 || t0 == t1 {
        return Ok(Some(1));
    }

    if x1 - x0 == s1 - s0 && y1 - y0 == t1 - t0 {
        let answer = driver_bit_blt(
            engine,
            dc,
            [x, y, width, height],
            Some(source),
            (sx, sy),
            rop,
        )
        .await?;

        return Ok(Some(answer));
    }

    if beyond {
        return Ok(Some(0));
    }

    super::printer_stretch::stretch_on_driver(engine, dc, hdc, source, hdc_src, p, q, rop).await
}

/// The driver's own `StretchBlt`, where its `dpRaster` has
/// `RC_STRETCHBLT` (`GDI.EXE` seg32 `05fa`): the destination put in order,
/// a destination given the wrong way round starting a pixel on from its
/// far edge (`11bb`); a flip made the source's, its corner its far edge
/// and its extent negative (`0658`); the driver's `StretchBlt` once for
/// each of the visible region's rectangles within the destination, that
/// rectangle as the clip (`0687`). 1; none where the driver cannot, or
/// answers below nought, and GDI stretches for it.
pub(super) async fn driver_stretch(
    engine: &Engine,
    dc: usize,
    source: usize,
    [x0, y0, x1, y1]: Rect,
    [s0, t0, s1, t1]: Rect,
    rop: u32,
) -> Result<Option<u16>, Stop> {
    let (procedure, lp_pdevice, caps) = {
        let system = engine.system();
        let (procedure, lp_pdevice) = proc(&system, dc, STRETCH_BLT);

        (
            procedure,
            lp_pdevice,
            super::printer_driver::driver_caps(&system, dc, RASTERCAPS),
        )
    };

    if procedure == 0 || caps & RC_STRETCHBLT == 0 || !same_driver(&engine.system(), dc, source) {
        return Ok(None);
    }

    let within = [
        if x1 < x0 { x1 + 1 } else { x0 },
        if y1 < y0 { y1 + 1 } else { y0 },
        if x1 < x0 { x0 + 1 } else { x1 },
        if y1 < y0 { y0 + 1 } else { y1 },
    ];
    let (mut fx, mut fy) = (s0.min(s1), t0.min(t1));
    let (mut fw, mut fh) = ((s1 - s0).abs(), (t1 - t0).abs());

    if (x1 < x0) != (s1 < s0) {
        fx += fw;
        fw = -fw;
    }

    if (y1 < y0) != (t1 < t0) {
        fy += fh;
        fh = -fh;
    }

    let bitmap = dc_bitmap(&engine.system(), source);
    let (handle, source_far) = match &bitmap {
        Some(bitmap) => block_of(engine, bitmap).await?,
        None => (0, 0),
    };
    let rects = blit_rects(&mut engine.system(), dc, within, true, true);
    let mut answer = Some(1);

    for rect in rects {
        let (brush, mode) = {
            let mut system = engine.system();

            (brush_far(&system, dc), draw_mode(&mut system, dc))
        };
        let (given, _) = on_stack(engine, &words(&rect), |clip| async move {
            call_driver(
                engine,
                procedure,
                &[
                    GuestArg::Long(lp_pdevice),
                    GuestArg::Word(within[0] as u16),
                    GuestArg::Word(within[1] as u16),
                    GuestArg::Word((within[2] - within[0]) as u16),
                    GuestArg::Word((within[3] - within[1]) as u16),
                    GuestArg::Long(source_far),
                    GuestArg::Word(fx as u16),
                    GuestArg::Word(fy as u16),
                    GuestArg::Word(fw as u16),
                    GuestArg::Word(fh as u16),
                    GuestArg::Long(rop),
                    GuestArg::Long(brush),
                    GuestArg::Long(mode),
                    GuestArg::Long(clip),
                ],
            )
            .await
        })
        .await?;

        if given & 0x8000 != 0 {
            answer = None;
            break;
        }
    }

    free_block(engine, handle).await?;
    Ok(answer)
}

/// `SetDIBitsToDevice` on a driver's context whose `dpRaster` has
/// `RC_DIBTODEV` (`GDI.EXE` seg11 `0b13`): the destination's corner in
/// device terms; the driver given that corner less the source's x, and
/// moved down so the rows given land where they belong -- the corner's y,
/// the source's y and the height, less the DIB's height (`0c61`-`0c78`)
/// --, the first scan and the count, the visible region's rectangle
/// within the destination as the clip, the `DRAWMODE`, the bits, the
/// `BITMAPINFO` and no translation (`0cac`). The answer the driver's; the
/// count of scans where nothing is visible. Where the driver cannot, or
/// answers below nought, GDI draws the DIB itself
/// (`printer_stretch::dib_to_device_fallback`).
fn set_dibits_to_device_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, dc, values, bits, info, usage) = {
            let system = engine.system();
            let mut peek = args;
            let hdc = peek.word(&system);
            let values: Vec<i32> = (0..8).map(|_| i32::from(peek.signed(&system))).collect();

            let bits = peek.dword(&system);
            let info = peek.dword(&system);

            (
                hdc,
                driver_dc(&system, hdc),
                values,
                bits,
                info,
                peek.word(&system),
            )
        };
        let Some(dc) = dc else {
            return super::printer_output::otherwise(engine, "SetDIBitsToDevice", args).await;
        };
        let [x, y, width, height, sx, sy, start, count] =
            [0, 1, 2, 3, 4, 5, 6, 7].map(|at| values[at]);
        let given = super::printer_stretch::DibArgs {
            x,
            y,
            width,
            height,
            src_x: sx,
            src_y: sy,
            start: start & 0xffff,
            count: count & 0xffff,
            bits,
            info,
            usage,
        };
        let answer = driver_dib_to_device(engine, dc, given).await?;
        let answer = match answer {
            Some(answer) => answer,
            None => super::printer_stretch::dib_to_device_fallback(engine, hdc, dc, given)
                .await?
                .unwrap_or(0),
        };

        Ok(Answer::Word(answer))
    })
}

/// The driver's `DIBToDevice` (seg11 `0b13`-`0ce7`); none where it has no
/// `RC_DIBTODEV`, the colours are `DIB_PAL_COLORS`, or it answers below
/// nought.
pub(super) async fn driver_dib_to_device(
    engine: &Engine,
    dc: usize,
    given: super::printer_stretch::DibArgs,
) -> Result<Option<u16>, Stop> {
    let super::printer_stretch::DibArgs {
        x,
        y,
        width,
        height,
        src_x: sx,
        src_y: sy,
        start,
        count,
        bits,
        info,
        usage,
    } = given;
    let (procedure, lp_pdevice, caps, dib_height, dx, dy) = {
        let system = engine.system();
        let (procedure, lp_pdevice) = proc(&system, dc, DIB_TO_DEVICE);
        let caps = super::printer_driver::driver_caps(&system, dc, RASTERCAPS);
        let at = (info & 0xffff_0000) | (info.wrapping_add(8) & 0xffff);
        let bytes = system.read_far(at, 2);
        let dib_height = i32::from(i16::from_le_bytes([bytes[0], bytes[1]]));
        let (dx, dy) = device_point(&system, dc, x, y);

        (procedure, lp_pdevice, caps, dib_height, dx, dy)
    };

    if procedure == 0 || caps & RC_DIBTODEV == 0 || usage != 0 {
        return Ok(None);
    }

    let within = [dx, dy, dx + width, dy + height];
    let rects = blit_rects(&mut engine.system(), dc, within, true, true);
    let mut answer = count as u16;

    for rect in rects {
        let mode = draw_mode(&mut engine.system(), dc);
        let (given, _) = on_stack(engine, &words(&rect), |clip| async move {
            call_driver(
                engine,
                procedure,
                &[
                    GuestArg::Long(lp_pdevice),
                    GuestArg::Word((dx - sx) as u16),
                    GuestArg::Word((dy + sy + height - dib_height) as u16),
                    GuestArg::Word(start as u16),
                    GuestArg::Word(count as u16),
                    GuestArg::Long(clip),
                    GuestArg::Long(mode),
                    GuestArg::Long(bits),
                    GuestArg::Long(info),
                    GuestArg::Long(0),
                ],
            )
            .await
        })
        .await?;

        if given & 0x8000 != 0 {
            return Ok(None);
        }

        answer = given as u16;
    }

    Ok(Some(answer))
}

/// `CreateCompatibleDC` of a driver's context, or of a memory context
/// made compatible with one: a memory context of the driver's, which
/// answers its `GetDeviceCaps`, whose bitmap can be given to the driver,
/// and whose colours, brush and pen the driver makes as a printer's
/// context's (seg1 `0078`, `01cd`-`0210`).
pub(super) async fn compatible_dc(engine: &Engine, hdc: u16) -> Result<u16, Stop> {
    let device = {
        let system = engine.system();

        dc_index(&system, hdc).and_then(|dc| device_of(&system, dc))
    };
    let handle = super::dc::create_compatible_dc(&mut engine.system(), hdc);
    let index = dc_index(&engine.system(), handle);

    if let (Some(device), Some(index)) = (device, index) {
        engine
            .system()
            .printing
            .drivers
            .compatible
            .insert(index, device);
        super::printer_output::start_drawing(engine, index).await?;
    }

    Ok(handle)
}

/// A memory context GDI made for itself given back, as `DeleteDC` gives
/// one back: its drawing block let go, for one of a printer's.
pub(super) async fn release_dc(engine: &Engine, hdc: u16) -> Result<(), Stop> {
    let compatible = {
        let system = engine.system();

        dc_index(&system, hdc)
            .filter(|index| system.printing.drivers.compatible.contains_key(index))
    };

    super::dc::delete_dc(&mut engine.system(), hdc);

    if let Some(dc) = compatible {
        super::printer_output::stop_drawing(engine, dc).await?;
        engine.system().printing.drivers.compatible.remove(&dc);
    }

    Ok(())
}

fn create_compatible_dc_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let device = {
            let system = engine.system();
            let mut peek = args;
            let hdc = peek.word(&system);

            dc_index(&system, hdc).and_then(|dc| device_of(&system, dc))
        };
        let Some(device) = device else {
            return super::printer_output::otherwise(engine, "CreateCompatibleDC", args).await;
        };
        let answer = super::printer_output::otherwise(engine, "CreateCompatibleDC", args).await?;
        let handle = answer.value().unwrap_or(0) as u16;
        let index = dc_index(&engine.system(), handle);

        if let Some(index) = index {
            engine
                .system()
                .printing
                .drivers
                .compatible
                .insert(index, device);
            super::printer_output::start_drawing(engine, index).await?;
        }

        Ok(Answer::Word(handle))
    })
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "BitBlt" => bit_blt_call,
        "PatBlt" => pat_blt_call,
        "StretchBlt" => stretch_blt_call,
        "SetDIBitsToDevice" => set_dibits_to_device_call,
        "CreateCompatibleDC" => create_compatible_dc_call,
        "SetDIBits" => super::printer_stretch::set_dibits_call,
        "GetDIBits" => super::printer_stretch::get_dibits_call,
        "CreateDIBitmap" => super::printer_stretch::create_dibitmap_call,
        _ => return None,
    }))
}
