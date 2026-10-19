//! What Windows' GDI draws itself for a printer's driver that cannot
//! stretch or take a DIB: bitmaps of its own, stretched and converted by
//! GDI, copied with the driver's `BitBlt`. The twin of
//! `src/win16/gdi/printer-stretch.ts`.
//!
//! Followed for a printer of one plane of one bit. Not followed: a
//! printer's context as the source of a stretch, a printer of colours,
//! `DIB_PAL_COLORS`, a driver with `RC_DI_BITMAP`, and GDI's halving of
//! its bitmaps where memory runs short (only where their sizes pass a
//! segment).

use std::cell::RefCell;
use std::future::Future;
use std::rc::Rc;

use winbox_raster::device_palette::Rgb;
use winbox_raster::dib::decode_dib;
use winbox_raster::stretch::{mono_stretch_rows, stretch_columns};
use winbox_raster::{DeviceBitmap, palette_for_display};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::handles::Object;
use crate::system::System;

use super::ddb::{Bitmap, bits_size};
use super::objects::GdiObject;
use super::printer_blits::{
    Rect, blit_device, blit_rects, block_of, brush_far, compatible_dc, dc_bitmap, dc_index,
    device_of, driver_dib_to_device, driver_stretch, free_block, read_back, release_dc,
    same_driver,
};
use super::printer_output::{Stretched, call_driver, device_point, draw_mode, proc};

const BIT_BLT: u16 = 1;
const STRETCH_BLT: u16 = 27;
const SRCCOPY: u32 = 0x00cc_0020;
const DP_RASTER: usize = 0x26;
const RC_DI_BITMAP: u16 = 0x80;
const RC_DIBTODEV: u16 = 0x200;
const RC_STRETCHBLT: u16 = 0x800;

const BLACK_AND_WHITE: [Rgb; 2] = [[0, 0, 0], [255, 255, 255]];

/// What `SetDIBitsToDevice` was given.
#[derive(Debug, Clone, Copy)]
pub struct DibArgs {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub src_x: i32,
    pub src_y: i32,
    pub start: i32,
    pub count: i32,
    pub bits: u32,
    pub info: u32,
    pub usage: u16,
}

/// Whether GDI makes a colour white in a monochrome bitmap: blue, twice
/// the red and five times the green come to 1020 or more (`GDI.EXE` seg11
/// `0479`).
pub fn white_of([red, green, blue]: Rgb) -> bool {
    u32::from(blue) + 2 * u32::from(red) + 5 * u32::from(green) >= 0x3fc
}

/// A device's `GDIINFO` word.
fn device_caps(system: &System, id: u32, at: usize) -> u16 {
    system
        .printing
        .drivers
        .devices
        .get(&id)
        .map_or(0, |pdevice| {
            u16::from_le_bytes([pdevice.info[at], pdevice.info[at + 1]])
        })
}

/// Whether a printer's own bitmaps are of one plane of one bit
/// (`dpBitsPixel`, `dpPlanes`).
fn printer_mono(system: &System, id: u32) -> bool {
    device_caps(system, id, 0x0c) == 1 && device_caps(system, id, 0x0e) == 1
}

/// The device of a printer's context, not of a memory context's.
fn driver_device(system: &System, dc: usize) -> Option<u32> {
    system.printing.drivers.contexts.get(&dc).copied()
}

/// A monochrome bitmap of GDI's own, as `CreateBitmap` makes one.
fn mono_bitmap(system: &System, width: i32, height: i32) -> Bitmap {
    Bitmap::new(DeviceBitmap::new(
        width,
        height,
        1,
        None,
        Some(palette_for_display(system.display_kind(), Some(1))),
    ))
}

/// A bitmap compatible with a context (`GDI.EXE` seg4 `01fb`): a
/// printer's of its format, one plane of one bit; a memory context's of
/// its bitmap's.
fn compatible_bitmap(system: &System, dc: usize, width: i32, height: i32) -> Bitmap {
    if driver_device(system, dc).is_some() {
        return mono_bitmap(system, width, height);
    }

    let (depth, palette) = dc_bitmap(system, dc).map_or_else(
        || {
            let display = system.display_kind();

            (display.depth(), palette_for_display(display, None))
        },
        |like| (like.pixels.depth, Rc::clone(&like.pixels.device_palette)),
    );

    Bitmap::new(DeviceBitmap::new(width, height, depth, None, Some(palette)))
}

/// A memory context GDI makes for itself: its handle and index.
async fn memory_dc(engine: &Engine, hdc: u16) -> Result<(u16, usize), Stop> {
    let handle = compatible_dc(engine, hdc).await?;
    let index = dc_index(&engine.system(), handle).unwrap_or(0);

    Ok((handle, index))
}

/// The driver's `BitBlt` into a bitmap of a memory context of the
/// printer's, as GDI's `BitBlt` makes it (seg1 `2f9a`, `2d0d`): the
/// rectangle within the bitmap, the source moved as far, the memory
/// context's brush and `DRAWMODE`; the bitmap's bits as the driver left
/// them. 1, or nought where the driver answers so.
async fn blit_into_bitmap(
    engine: &Engine,
    memory: usize,
    target: &mut Bitmap,
    [x, y, width, height]: Rect,
    source: &Bitmap,
    (sx, sy): (i32, i32),
) -> Result<u16, Stop> {
    let procedure = {
        let system = engine.system();

        if system.printing.drivers.compatible.contains_key(&memory) {
            proc(&system, memory, BIT_BLT).0
        } else {
            0
        }
    };
    let left = x.max(0);
    let top = y.max(0);
    let right = (x + width).min(target.pixels.width());
    let bottom = (y + height).min(target.pixels.height());

    if left >= right || top >= bottom {
        return Ok(1);
    }

    if procedure == 0 {
        return Ok(0);
    }

    let (dest_handle, dest_far) = block_of(engine, target).await?;
    let (source_handle, source_far) = block_of(engine, source).await?;
    let (brush, mode) = {
        let mut system = engine.system();

        (brush_far(&system, memory), draw_mode(&mut system, memory))
    };
    let answer = call_driver(
        engine,
        procedure,
        &[
            GuestArg::Long(dest_far),
            GuestArg::Word(left as u16),
            GuestArg::Word(top as u16),
            GuestArg::Long(source_far),
            GuestArg::Word((sx + left - x) as u16),
            GuestArg::Word((sy + top - y) as u16),
            GuestArg::Word((right - left) as u16),
            GuestArg::Word((bottom - top) as u16),
            GuestArg::Long(SRCCOPY),
            GuestArg::Long(brush),
            GuestArg::Long(mode),
        ],
    )
    .await?;

    free_block(engine, source_handle).await?;
    read_back(&engine.system(), dest_far, target);
    free_block(engine, dest_handle).await?;
    Ok(answer as u16)
}

/// The driver's `BitBlt` to its device of one rectangle from a bitmap of
/// GDI's own, at `from` in it (seg32 `0906`, `1124`).
async fn rect_to_device(
    engine: &Engine,
    dc: usize,
    rect: Rect,
    bitmap: &Bitmap,
    from: (i32, i32),
    rop: u32,
) -> Result<(), Stop> {
    let (procedure, lp_pdevice) = proc(&engine.system(), dc, BIT_BLT);
    let (handle, far) = block_of(engine, bitmap).await?;
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
            GuestArg::Long(far),
            GuestArg::Word(from.0 as u16),
            GuestArg::Word(from.1 as u16),
            GuestArg::Word((rect[2] - rect[0]) as u16),
            GuestArg::Word((rect[3] - rect[1]) as u16),
            GuestArg::Long(rop),
            GuestArg::Long(brush),
            GuestArg::Long(mode),
        ],
    )
    .await?;
    free_block(engine, handle).await
}

/// The driver's `BitBlt` to its device for each of the visible region's
/// rectangles within a band, top down and from the left, from a bitmap of
/// GDI's own, from its row as far down as the rectangle is in the band
/// (seg32 `1124`).
async fn band_to_device(
    engine: &Engine,
    dc: usize,
    band: Rect,
    bitmap: &Bitmap,
    rop: u32,
) -> Result<(), Stop> {
    let rects = blit_rects(&mut engine.system(), dc, band, true, true);

    for rect in rects {
        rect_to_device(
            engine,
            dc,
            rect,
            bitmap,
            (rect[0] - band[0], rect[1] - band[1]),
            rop,
        )
        .await?;
    }

    Ok(())
}

/// A rectangle's edge and extent from its two corners, and whether it was
/// turned over (seg32 `11bb`).
fn ordered(a: i32, b: i32) -> (i32, i32, bool) {
    if a > b {
        (b + 1, a - b, true)
    } else {
        (a, b - a, false)
    }
}

/// How many bits a pixel a DIB of a bitmap of this depth has (seg32
/// `0a6c`).
fn dib_bits(depth: u8) -> i32 {
    match depth {
        1 => 1,
        2..=4 => 4,
        5..=8 => 8,
        _ => 24,
    }
}

/// A DIB's row of `width` pixels, in bytes, to a doubleword (seg32
/// `1222`).
fn dib_row(width: i32, bits: i32) -> i32 {
    if bits == 24 {
        (width * 3 + 3) & !3
    } else {
        (((width * bits + 31) >> 5) << 2) & 0xffff
    }
}

/// The pixels of a bitmap's rows, as indices.
fn rows_of(bitmap: &DeviceBitmap, x: i32, y: i32, width: i32, count: i32) -> Vec<Vec<u8>> {
    (0..count)
        .map(|row| {
            (0..width)
                .map(|at| bitmap.index_at(x + at, y + row).unwrap_or(0))
                .collect()
        })
        .collect()
}

/// Rows of pixels written into a bitmap from its top.
fn put_rows(bitmap: &DeviceBitmap, rows: &[Vec<u8>]) {
    for (row, line) in rows.iter().enumerate() {
        for (x, &index) in line.iter().enumerate() {
            bitmap.put(x as i32, row as i32, index);
        }
    }
}

/// Rows of a DIB's indices made a monochrome bitmap, each colour white or
/// black (seg12 `0cba`).
fn mono_of(system: &System, width: i32, rows: &[Vec<u8>], table: &[Rgb]) -> Bitmap {
    let mono = mono_bitmap(system, width, rows.len() as i32);
    let lines: Vec<Vec<u8>> = rows
        .iter()
        .map(|line| {
            line.iter()
                .map(|&index| {
                    u8::from(white_of(
                        table.get(usize::from(index)).copied().unwrap_or([0, 0, 0]),
                    ))
                })
                .collect()
        })
        .collect();

    put_rows(&mono.pixels, &lines);
    mono
}

/// `SetDIBits` into a bitmap of a printer's, whose driver has no
/// `RC_DI_BITMAP` (`GDI.EXE` seg11 `094c`): through a memory context made
/// compatible with the printer's with the bitmap in it, the rows put at
/// the bitmap's top as `dib_to_target` puts them. The answer as it
/// answers.
async fn set_rows(
    engine: &Engine,
    hdc: u16,
    bitmap: &mut Bitmap,
    rows: &[Vec<u8>],
    table: &[Rgb],
    width: i32,
) -> Result<u16, Stop> {
    let (holder, holder_index) = memory_dc(engine, hdc).await?;
    let (own, _) = memory_dc(engine, holder).await?;
    let mono = mono_of(&engine.system(), width, rows, table);

    if !rows.is_empty() {
        blit_into_bitmap(
            engine,
            holder_index,
            bitmap,
            [0, 0, width, rows.len() as i32],
            &mono,
            (0, 0),
        )
        .await?;
    }

    release_dc(engine, own).await?;
    release_dc(engine, holder).await?;
    Ok(rows.len() as u16)
}

/// `GetDIBits` of a bitmap of a printer's, whose driver has no
/// `RC_DI_BITMAP` (`GDI.EXE` seg12 `0d92`): a monochrome bitmap of GDI's
/// own as wide as the DIB and `count` rows high, two memory contexts made
/// compatible with the printer's, and the driver's `BitBlt` of the rows
/// from the bitmap into it, from `height - start - count` down. Its rows,
/// top down.
async fn get_rows(
    engine: &Engine,
    hdc: u16,
    bitmap: &Bitmap,
    (width, height): (i32, i32),
    start: i32,
    count: i32,
) -> Result<Vec<Vec<u8>>, Stop> {
    let mut mono = mono_bitmap(&engine.system(), width, count);
    let (into, into_index) = memory_dc(engine, hdc).await?;
    let (from, _) = memory_dc(engine, hdc).await?;

    blit_into_bitmap(
        engine,
        into_index,
        &mut mono,
        [0, 0, width, count],
        bitmap,
        (0, height - start - count),
    )
    .await?;
    release_dc(engine, from).await?;
    release_dc(engine, into).await?;
    Ok(rows_of(&mono.pixels, 0, 0, width, count))
}

/// The rows of the destination one chunk of source rows makes (`GDI.EXE`
/// seg32 `0e29`-`0f09`): enlarging down, each source row made a row and
/// copied while the error stays above nought; reducing, in `COLORONCOLOR`
/// the row at which the error falls to nought, in the others each source
/// row combined into the row until it does. A chunk starts each row
/// afresh, all ones in `BLACKONWHITE` and noughts in `WHITEONBLACK`.
fn chunk_rows(
    chunk: &[Vec<u8>],
    error: &mut i32,
    (sh, dh, dw): (i32, i32, i32),
    groups: &[Vec<i32>],
    mode: u16,
    all: u8,
) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let fresh = || vec![if mode == 1 { all } else { 0 }; dw.max(0) as usize];
    let combine = |row: &mut Vec<u8>, line: &[u8]| {
        let pixel = |column: i32| line.get(column as usize).copied().unwrap_or(0);

        for (x, slot) in row.iter_mut().enumerate() {
            let group = &groups[x];

            if mode == 3 {
                *slot = group.last().map_or(0, |&column| pixel(column));
                continue;
            }

            for &column in group {
                *slot = if mode == 1 {
                    *slot & pixel(column)
                } else {
                    *slot | pixel(column)
                };
            }
        }
    };

    if dh >= sh {
        for line in chunk {
            let mut row = fresh();

            combine(&mut row, line);
            out.push(row.clone());
            *error -= sh;

            while *error > 0 {
                out.push(row.clone());
                *error -= sh;
            }

            *error += dh;
        }
    } else if mode == 3 {
        for line in chunk {
            *error -= dh;

            if *error > 0 {
                continue;
            }

            *error += sh;

            let mut row = fresh();

            combine(&mut row, line);
            out.push(row);
        }
    } else {
        let mut row = fresh();

        for line in chunk {
            combine(&mut row, line);
            *error -= dh;

            if *error <= 0 {
                *error += sh;
                out.push(std::mem::replace(&mut row, fresh()));
            }
        }
    }

    out
}

/// One stretch, both rectangles in order.
struct Stretch {
    dc: usize,
    hdc: u16,
    source: usize,
    hdc_src: u16,
    from: Rect,
    to: Rect,
    mirror_x: bool,
    mirror_y: bool,
    colour: bool,
    mode: u16,
    rop: u32,
}

/// `StretchBlt` to a printer's context where the extents differ
/// (`GDI.EXE` seg32 `03ba`): both rectangles put in order, a side given
/// the wrong way round starting a pixel on from its far edge, and turned
/// over where one side is and the other is not (`11bb`).
///
/// * Neither turned over and each within a pixel of the other's size, a
///   copy of the smaller, and the last column and row copied again where
///   the destination is the larger, by GDI's `BitBlt` (`04fb`): the answer
///   the source's height, where it is not the smaller, else its width,
///   else the last `BitBlt`'s.
/// * A driver with `RC_STRETCHBLT` stretches it (`05fa`).
/// * Neither turned over, not both of colours, the source no larger than
///   a segment: `fast` (`06c9`); else `general` (`099e`).
///
/// The stretch mode is the context's, `BLACKONWHITE` as it starts, and
/// `WHITEONBLACK` for any but the three. None where winbox.js does not
/// follow what GDI does.
#[allow(clippy::too_many_arguments)]
pub(super) async fn stretch_on_driver(
    engine: &Engine,
    dc: usize,
    hdc: u16,
    source: usize,
    hdc_src: u16,
    p: Rect,
    q: Rect,
    rop: u32,
) -> Result<Option<u16>, Stop> {
    let (dx, dw, dmirror) = ordered(p[0], p[2]);
    let (dy, dh, dflip) = ordered(p[1], p[3]);
    let (sx, sw, smirror) = ordered(q[0], q[2]);
    let (sy, sh, sflip) = ordered(q[1], q[3]);
    let mirror_x = dmirror != smirror;
    let mirror_y = dflip != sflip;
    let (bitmap, mono, stretch_caps, stretch_mode) = {
        let system = engine.system();
        let id = driver_device(&system, dc).unwrap_or(0);
        let bitmap = if system.gdi.dcs[source].memory {
            dc_bitmap(&system, source)
        } else {
            None
        };
        let stretching = proc(&system, dc, STRETCH_BLT).0 != 0
            && device_caps(&system, id, DP_RASTER) & RC_STRETCHBLT != 0;

        (
            bitmap,
            printer_mono(&system, id),
            stretching,
            system.gdi.dcs[dc].state.stretch_mode.unwrap_or(1),
        )
    };
    let Some(bitmap) = bitmap.filter(|_| mono) else {
        return Ok(None);
    };

    if !mirror_x && !mirror_y && (sw - dw).abs() <= 1 && (sh - dh).abs() <= 1 {
        return Ok(Some(
            near_copy(
                engine,
                dc,
                source,
                &bitmap,
                [dx, dy, dw, dh],
                [sx, sy, sw, sh],
                rop,
            )
            .await?,
        ));
    }

    if stretch_caps {
        if !same_driver(&engine.system(), dc, source) {
            return Ok(None);
        }

        if let Some(answer) = driver_stretch(engine, dc, source, p, q, rop).await? {
            return Ok(Some(answer));
        }
    }

    let job = Stretch {
        dc,
        hdc,
        source,
        hdc_src,
        from: [sx, sy, sw, sh],
        to: [dx, dy, dw, dh],
        mirror_x,
        mirror_y,
        colour: bitmap.pixels.depth != 1,
        mode: if (1..=3).contains(&stretch_mode) {
            stretch_mode
        } else {
            2
        },
        rop,
    };

    if !mirror_x
        && !mirror_y
        && bits_size(&bitmap.pixels) <= 0xffff
        && let Some(answer) = fast(engine, &job, &bitmap).await?
    {
        return Ok(Some(answer));
    }

    Ok(Some(general(engine, &job, &bitmap).await?))
}

/// A stretch within a pixel either way, as GDI's `BitBlt`s (seg32
/// `04fb`).
async fn near_copy(
    engine: &Engine,
    dc: usize,
    source: usize,
    bitmap: &Bitmap,
    [dx, dy, dw, dh]: Rect,
    [sx, sy, sw, sh]: Rect,
    rop: u32,
) -> Result<u16, Stop> {
    let same = same_driver(&engine.system(), dc, source);
    let blit = |x: i32, y: i32, width: i32, height: i32, fx: i32, fy: i32| async move {
        if width == 0 || height == 0 {
            Ok(1)
        } else if same {
            blit_device(
                engine,
                dc,
                [x, y, x + width, y + height],
                Some(bitmap),
                (fx, fy),
                rop,
                None,
            )
            .await
        } else {
            Ok(0)
        }
    };
    let width = sw.min(dw);
    let height = sh.min(dh);

    blit(dx, dy, width, height, sx, sy).await?;

    if sw < dw {
        blit(dx + width, dy, 1, height, sx + width - 1, sy).await?;
    }

    if sh >= dh {
        return Ok(sh as u16);
    }

    blit(dx, dy + height, width, 1, sx, sy + height - 1).await?;

    if sw >= dw {
        return Ok(sw as u16);
    }

    blit(
        dx + width,
        dy + height,
        1,
        1,
        sx + width - 1,
        sy + height - 1,
    )
    .await
}

/// GDI's stretch through one bitmap of its own (`GDI.EXE` seg32 `06c9`):
/// as wide as the wider side and as high as the higher, and a row more
/// where the source is first copied into it -- a source of colours, copied
/// by its own driver, made monochrome, to its bottom rows; compatible with
/// the source, or with the printer's context for a source of colours. A
/// bitmap past a segment is `general`'s (none). For each band of the
/// destination, all of it unless the source was copied in, each of the
/// visible region's rectangles within it: the rows it covers stretched
/// into the bitmap's top by `mono_stretch_rows`, once for each top and
/// bottom, and the driver's `BitBlt` from there to the device.
async fn fast(engine: &Engine, job: &Stretch, bitmap: &Bitmap) -> Result<Option<u16>, Stop> {
    let [sx, sy, sw, sh] = job.from;
    let [dx, dy, dw, dh] = job.to;
    let copied = job.colour;
    let width = sw.max(dw);
    let height = sh.max(dh) + i32::from(copied);
    let size = i64::from((width + 15) >> 3) * i64::from(height);

    if size > 0xffff || size + 0x21 > 0xffff {
        return Ok(None);
    }

    let temp = {
        let owner = if copied { job.dc } else { job.source };

        compatible_bitmap(&engine.system(), owner, width, height)
    };
    let (read, origin) = if copied {
        let mut system = engine.system();

        super::draw::copy_into(
            &mut system,
            &temp.pixels,
            (0, height - sh, sw, sh),
            job.source,
            (sx, sy),
        );

        let snapshot = temp.pixels.indices.borrow().clone();

        (
            DeviceBitmap::new(
                width,
                height,
                1,
                Some(Rc::new(RefCell::new(snapshot))),
                Some(Rc::clone(&temp.pixels.device_palette)),
            ),
            (0, height - sh),
        )
    } else {
        (bitmap.pixels.clone(), (sx, sy))
    };
    let pixel = |x: i32, y: i32| read.index_at(x, y).unwrap_or(0);
    let mut done = 0;

    while done < dh {
        let band = if copied && height - 1 < dh {
            done * sh / dh + (height - sh)
        } else {
            height
        };
        let top = dy + done;
        let bottom = (top + band).min(dy + dh);
        let rects = blit_rects(
            &mut engine.system(),
            job.dc,
            [dx, top, dx + dw, bottom],
            true,
            true,
        );
        let mut last: Option<Rect> = None;

        for rect in rects {
            if last.is_none_or(|last| last[1] != rect[1] || last[3] != rect[3]) {
                put_rows(
                    &temp.pixels,
                    &mono_stretch_rows(
                        pixel,
                        (origin.0, origin.1, sw, sh),
                        dw,
                        dh,
                        job.mode,
                        rect[1] - dy,
                        rect[3] - dy - 1,
                    ),
                );
                last = Some(rect);
            }

            // Each rectangle's source starts at the bitmap's top.
            rect_to_device(engine, job.dc, rect, &temp, (rect[0] - dx, 0), job.rop).await?;
        }

        done += band;
    }

    Ok(Some(1))
}

/// GDI's stretch through DIBs (`GDI.EXE` seg32 `099e`): two memory
/// contexts, compatible with the source's and the printer's; a bitmap
/// compatible with the source's as wide as the source, and one as wide as
/// the destination, compatible with the source's for a monochrome source
/// and the printer's otherwise. Their heights halve, and a band's rows
/// with them, until the DIB rows of both come within a segment
/// (`0ba9`-`0c26`). Then for each band of the source: its rows copied into
/// the first by the source's driver, with no brush; for each chunk of
/// them, `GetDIBits`, the chunk stretched (`chunk_rows`, across by
/// `stretch_columns`), `SetDIBits` of as many rows as the second holds at
/// a time into it, and the driver's `BitBlt` from it to each of the
/// visible region's rectangles within those rows of the destination, from
/// its bottom up where it is turned over (`0f17`-`1033`). A `SetDIBits` of
/// no rows fails it, nought.
#[allow(clippy::too_many_lines)]
async fn general(engine: &Engine, job: &Stretch, bitmap: &Bitmap) -> Result<u16, Stop> {
    let [sx, sy, sw, sh] = job.from;
    let [dx, dy, dw, dh] = job.to;
    let depth = bitmap.pixels.depth;
    let bits = dib_bits(depth);
    let table: Vec<Rgb> = if depth == 1 {
        BLACK_AND_WHITE.to_vec()
    } else {
        bitmap
            .pixels
            .device_palette
            .borrow()
            .colours
            .iter()
            .take(1 << bits)
            .copied()
            .collect()
    };
    let printed = engine
        .system()
        .printing
        .drivers
        .compatible
        .get(&job.source)
        .copied();
    let src_row = i64::from(dib_row(sw, bits));
    let dst_row = i64::from(dib_row(dw, bits));
    let ratio = if sh > dh { 1 } else { dh / sh + 1 };
    let fits = |si: i32, di: i32| {
        let src_buf = src_row * i64::from(si);
        let dst_buf = dst_row * i64::from(di);

        if src_buf > 0xffff || dst_buf > 0xffff {
            return false;
        }

        if !job.mirror_y && job.mode == 3 {
            i64::from(si.max(di) + 1) * src_row.max(dst_row) <= 0xffff
        } else {
            src_buf + dst_buf <= 0xffff
        }
    };

    // The rows a band, a chunk and the second bitmap take.
    let mut band = sh;
    let mut band_rows = dh;
    let mut si = band;
    let mut di = band_rows;

    loop {
        if fits(si, di) {
            break;
        }

        if si >> 1 != 0 && di >> 1 != 0 {
            si = (si >> 1) + (si & 1);
            di = (di >> 1) + (di & 1) + ratio;
            continue;
        }

        if band >> 1 == 0 || band_rows >> 1 == 0 {
            return Ok(0);
        }

        band = (band >> 1) + (band & 1);
        band_rows = (band_rows >> 1) + (band_rows & 1) + ratio;
        si = band;
        di = band_rows;
    }

    let (of_source, _) = memory_dc(engine, job.hdc_src).await?;
    let (of_dest, _) = memory_dc(engine, job.hdc).await?;
    let (mut first, mut second) = {
        let system = engine.system();
        let owner = if depth == 1 { job.source } else { job.dc };

        (
            compatible_bitmap(&system, job.source, sw, band),
            compatible_bitmap(&system, owner, dw, di),
        )
    };
    let groups = stretch_columns(sw, dw, job.mirror_x);
    let mut error = sh.max(dh) - (sh.min(dh) >> 1);
    let all = ((1u32 << bits) - 1) as u8;
    let mut answer = 1;
    let mut src_done = 0;
    let mut dest_done = 0;
    let mut total = 0;

    'stretching: loop {
        let rows = (sh - src_done).min(band);

        if let Some(id) = printed {
            let procedure = {
                let system = engine.system();

                system
                    .printing
                    .drivers
                    .devices
                    .get(&id)
                    .map_or(0, |pdevice| {
                        super::printer_driver::proc_named(&system, &pdevice.driver, BIT_BLT)
                    })
            };
            let (dest_handle, dest_far) = block_of(engine, &first).await?;
            let (source_handle, source_far) = block_of(engine, bitmap).await?;
            let mode = draw_mode(&mut engine.system(), job.source);

            call_driver(
                engine,
                procedure,
                &[
                    GuestArg::Long(dest_far),
                    GuestArg::Word(0),
                    GuestArg::Word(0),
                    GuestArg::Long(source_far),
                    GuestArg::Word(sx as u16),
                    GuestArg::Word((sy + src_done) as u16),
                    GuestArg::Word(sw as u16),
                    GuestArg::Word(rows as u16),
                    GuestArg::Long(SRCCOPY),
                    GuestArg::Long(0),
                    GuestArg::Long(mode),
                ],
            )
            .await?;
            free_block(engine, source_handle).await?;
            read_back(&engine.system(), dest_far, &mut first);
            free_block(engine, dest_handle).await?;
        } else {
            put_rows(
                &first.pixels,
                &rows_of(&bitmap.pixels, sx, sy + src_done, sw, rows),
            );
        }

        let mut chunk_done = 0;

        while chunk_done < rows {
            let count = (band - chunk_done).min(si);
            let start = band - chunk_done - count;
            let lines = if printed.is_some() {
                get_rows(engine, job.hdc_src, &first, (sw, band), start, count).await?
            } else {
                rows_of(&first.pixels, 0, band - start - count, sw, count)
            };
            let made = chunk_rows(&lines, &mut error, (sh, dh, dw), &groups, job.mode, all);
            let mut set = 0;

            loop {
                let n = (made.len() as i32 - set).min(di);
                let top = if job.mirror_y {
                    dy + dh - dest_done - set - n
                } else {
                    dy + dest_done + set
                };
                let mut slice: Vec<Vec<u8>> = made[set as usize..(set + n) as usize].to_vec();

                if job.mirror_y {
                    slice.reverse();
                }

                if set_rows(engine, job.hdc, &mut second, &slice, &table, dw).await? == 0 {
                    answer = 0;
                    break 'stretching;
                }

                band_to_device(
                    engine,
                    job.dc,
                    [dx, top, dx + dw, top + n],
                    &second,
                    job.rop,
                )
                .await?;
                total += n;

                if total >= dh {
                    break 'stretching;
                }

                if n + set < made.len() as i32 {
                    set += n;
                    continue;
                }

                dest_done += n + set;
                break;
            }

            chunk_done += count;
        }

        src_done += rows;

        if src_done >= sh {
            break;
        }
    }

    release_dc(engine, of_dest).await?;
    release_dc(engine, of_source).await?;
    Ok(answer)
}

/// A DIB's header as GDI reads it, its colour table, and the bytes to
/// decode it from.
struct DibOf {
    width: i32,
    height: i32,
    compression: u32,
    valid: bool,
    header: Vec<u8>,
    info: u32,
    bits: u32,
    bit_count: u16,
    core: bool,
}

fn dib_of(system: &System, info: u32, bits: u32) -> DibOf {
    let head = super::dib::huge_read(system, info, 40);
    let word = |at: usize| u16::from_le_bytes([head[at], head[at + 1]]);
    let dword = |at: usize| u32::from(word(at)) | u32::from(word(at + 2)) << 16;
    let size = dword(0);
    let core = size == 12;
    let width = if core {
        i32::from(word(4))
    } else {
        dword(4) as i32
    };
    let height = i32::from(word(if core { 6 } else { 8 }) as i16);
    let bit_count = word(if core { 10 } else { 14 });
    let compression = if core { 0 } else { dword(16) };
    let used = if core { 0 } else { dword(32) };
    let colours = if bit_count <= 8 {
        if used == 0 { 1 << bit_count } else { used }
    } else {
        0
    };
    let length = size + colours * if core { 3 } else { 4 };
    let valid = (compression == 0 && [1, 4, 8, 24].contains(&bit_count))
        || (compression == 1 && bit_count == 8)
        || (compression == 2 && bit_count == 4);

    DibOf {
        width,
        height,
        compression,
        valid,
        header: super::dib::huge_read(system, info, length as usize),
        info,
        bits,
        bit_count,
        core,
    }
}

impl DibOf {
    /// Decoded: `rows` scans of the bits, or all of a compressed one.
    fn decode(&self, system: &System, rows: i32) -> Option<winbox_raster::dib::Dib> {
        let lines = if self.compression != 0 {
            self.height
        } else {
            rows
        };
        let mut header = self.header.clone();

        if self.compression == 0 {
            if self.core {
                header[6..8].copy_from_slice(&(lines as u16).to_le_bytes());
            } else {
                header[8..12].copy_from_slice(&[lines as u8, (lines >> 8) as u8, 0, 0]);
            }
        }

        let length = if self.compression != 0 {
            let head = super::dib::huge_read(system, self.info, 24);

            u32::from_le_bytes([head[20], head[21], head[22], head[23]]) as usize
        } else {
            ((((self.width * i32::from(self.bit_count) + 31) >> 5) << 2) * lines).max(0) as usize
        };

        header.extend(super::dib::huge_read(system, self.bits, length));
        decode_dib(&header).ok()
    }
}

/// Where `dib_to_target` draws: a printer's context, within a clip
/// rectangle of GDI's own, or a bitmap of a memory context's.
enum Into<'a> {
    Device(usize, Rect),
    Bitmap(usize, &'a mut Bitmap),
}

/// A DIB drawn by GDI itself (`GDI.EXE` seg12 `094f`): nought for a header
/// GDI does not take, or no scans from `start`; else a monochrome bitmap
/// of its own as wide as the DIB and as high as the scans given, each
/// pixel white where its colour is (`white_of`), the first scan at its
/// bottom (`0cba`; compressed, decoded whole, `08b3`); a memory context
/// made compatible; and GDI's `BitBlt` of it, `width` by `height` from
/// `x_src, y_src`, to `x, y` of the target. The answer the scans given, or
/// 1 for a compressed DIB.
#[allow(clippy::too_many_arguments)]
async fn dib_to_target(
    engine: &Engine,
    hdc: u16,
    target: Into<'_>,
    [x, y, width, height]: Rect,
    (x_src, y_src): (i32, i32),
    start: i32,
    count: i32,
    bits: u32,
    info: u32,
) -> Result<u16, Stop> {
    let (dib, decoded) = {
        let system = engine.system();
        let dib = dib_of(&system, info, bits);
        let decoded = dib.decode(&system, count);

        (dib, decoded)
    };
    let rows = dib.height - start;

    if !dib.valid || rows <= 0 {
        return Ok(0);
    }

    let scans = count.min(rows);
    let Some(decoded) = decoded else {
        return Ok(0);
    };
    let first_row = decoded.height - scans;
    let mono = if decoded.rgb.is_empty() {
        let lines: Vec<Vec<u8>> = (0..scans)
            .map(|row| {
                (0..dib.width)
                    .map(|px| {
                        decoded
                            .pixels
                            .get(((first_row + row) * decoded.width + px) as usize)
                            .copied()
                            .unwrap_or(0)
                    })
                    .collect()
            })
            .collect();

        mono_of(&engine.system(), dib.width, &lines, &decoded.colours)
    } else {
        let made = mono_bitmap(&engine.system(), dib.width, scans);

        for row in 0..scans {
            for px in 0..dib.width {
                let colour = decoded
                    .rgb
                    .get(((first_row + row) * dib.width + px) as usize)
                    .copied()
                    .unwrap_or([0, 0, 0]);

                made.pixels.put(px, row, u8::from(white_of(colour)));
            }
        }

        made
    };
    let (own, _) = memory_dc(engine, hdc).await?;

    match target {
        Into::Bitmap(memory, bitmap) => {
            blit_into_bitmap(
                engine,
                memory,
                bitmap,
                [x, y, width, height],
                &mono,
                (x_src, y_src),
            )
            .await?;
        }
        Into::Device(dc, limit) => {
            blit_device(
                engine,
                dc,
                [x, y, x + width, y + height],
                Some(&mono),
                (x_src, y_src),
                SRCCOPY,
                Some(limit),
            )
            .await?;
        }
    }

    release_dc(engine, own).await?;
    Ok(if dib.compression != 0 {
        1
    } else {
        scans as u16
    })
}

/// Whether GDI draws DIBs itself for a context: one of a printer of one
/// plane of one bit whose driver has no `RC_DI_BITMAP`.
fn draws_dibs(system: &System, dc: usize) -> bool {
    device_of(system, dc).is_some_and(|id| {
        printer_mono(system, id) && device_caps(system, id, DP_RASTER) & RC_DI_BITMAP == 0
    })
}

/// `SetDIBitsToDevice` on a printer's context whose driver has no
/// `RC_DIBTODEV` or answers below nought (`GDI.EXE` seg11 `0ce9`): the
/// corner in device terms; the context saved, set to `MM_TEXT` and clipped
/// to the destination's rectangle; `dib_to_target` of the scans given,
/// placed so that they land where they belong -- the DIB's height less the
/// first scan and the count, and the corner's y less the source's --,
/// from the source's x; the context restored. None for `DIB_PAL_COLORS`.
pub(super) async fn dib_to_device_fallback(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    given: DibArgs,
) -> Result<Option<u16>, Stop> {
    let (x, y, dib_height) = {
        let system = engine.system();

        if given.usage != 0 || !draws_dibs(&system, dc) {
            return Ok(None);
        }

        let (x, y) = device_point(&system, dc, given.x, given.y);

        (x, y, dib_of(&system, given.info, given.bits).height)
    };

    Ok(Some(
        dib_to_target(
            engine,
            hdc,
            Into::Device(dc, [x, y, x + given.width, y + given.height]),
            [
                x,
                dib_height - given.start - given.count + y - given.src_y,
                given.width,
                given.count,
            ],
            (given.src_x, 0),
            given.start,
            given.count,
            given.bits,
            given.info,
        )
        .await?,
    ))
}

/// `SetDIBits` into a bitmap with a printer's context whose driver has no
/// `RC_DI_BITMAP` (`GDI.EXE` seg11 `094c`): a memory context made
/// compatible with the bitmap in it, and `dib_to_target` of the scans
/// given into the bitmap, its width the DIB's, placed at the DIB's height
/// less the first scan and the count. None where GDI does not draw for
/// the context.
#[allow(clippy::too_many_arguments)]
async fn set_dibits_fallback(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    bitmap: &mut Bitmap,
    start: i32,
    count: i32,
    bits: u32,
    info: u32,
    usage: u16,
) -> Result<Option<u16>, Stop> {
    if usage != 0 || !draws_dibs(&engine.system(), dc) || bitmap.pixels.depth != 1 {
        return Ok(None);
    }

    let (holder, holder_index) = memory_dc(engine, hdc).await?;
    let dib = dib_of(&engine.system(), info, bits);
    let answer = dib_to_target(
        engine,
        holder,
        Into::Bitmap(holder_index, bitmap),
        [0, dib.height - start - count, dib.width, count],
        (0, 0),
        start,
        count,
        bits,
        info,
    )
    .await?;

    release_dc(engine, holder).await?;
    Ok(Some(answer))
}

/// `GetDIBits` of a bitmap with a printer's context whose driver has no
/// `RC_DI_BITMAP` (`GDI.EXE` seg12 `0d92`): nought where the header's
/// height less the first scan leaves none; the count no more than that;
/// the rows copied by the driver into a monochrome bitmap of GDI's own
/// (`get_rows`); the colour table black, white and the rest nought; each
/// scan from the bottom, a pixel 0 or 1 at the header's bits a pixel, one
/// bit's rows copied a word at a time and padded with noughts, the others'
/// padding left as it was (`0f21`). The count. None where GDI does not
/// draw for the context, or for no bits.
#[allow(clippy::too_many_arguments)]
async fn get_dibits_fallback(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    bitmap: &Bitmap,
    start: i32,
    count: i32,
    bits: u32,
    info: u32,
    usage: u16,
) -> Result<Option<u16>, Stop> {
    let (size, width, height, bit_count) = {
        let system = engine.system();

        if usage != 0 || bits == 0 || !draws_dibs(&system, dc) || bitmap.pixels.depth != 1 {
            return Ok(None);
        }

        let head = system.read_far(info, 20);
        let word = |at: usize| u16::from_le_bytes([head[at], head[at + 1]]);

        if word(0) != 40 || word(16) != 0 || word(18) != 0 || ![1, 4, 8, 24].contains(&word(14)) {
            return Ok(None);
        }

        (
            u32::from(word(0)),
            i32::from(word(4)),
            i32::from(word(8) as i16),
            i32::from(word(14)),
        )
    };

    if height - start <= 0 {
        return Ok(Some(0));
    }

    let scans = count.min(height - start);
    let lines = get_rows(engine, hdc, bitmap, (width, height), start, scans).await?;
    let mut system = engine.system();
    let at_far = |far: u32, at: u32| (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff);

    if bit_count <= 8 {
        let table: Vec<u8> = (0..4u32 << bit_count)
            .map(|at| if (4..7).contains(&at) { 0xff } else { 0 })
            .collect();

        system.write_far(at_far(info, size), &table);
    }

    let row_bytes = ((width * bit_count + 31) >> 5) << 2;
    let words = (width + 15) >> 4;
    let data = (width * bit_count + 7) / 8;
    let mut at = 0;

    for scan in 0..scans {
        let line = &lines[(scans - 1 - scan) as usize];
        let pixel = |x: i32| line.get(x as usize).copied().unwrap_or(0);
        let mut bytes = Vec::new();

        if bit_count == 1 {
            for byte in 0..words * 2 {
                bytes.push(
                    (0..8).fold(0u8, |value, bit| value | pixel(byte * 8 + bit) << (7 - bit)),
                );
            }

            if row_bytes - data >= 2 {
                bytes.extend([0, 0]);
            }
        } else if bit_count == 24 {
            for &index in line {
                bytes.extend(if index != 0 { [0xff; 3] } else { [0; 3] });
            }
        } else {
            let per_byte = 8 / bit_count;

            for byte in 0..data {
                bytes.push((0..per_byte).fold(0u8, |value, slot| {
                    value | pixel(byte * per_byte + slot) << (8 - bit_count * (slot + 1))
                }));
            }
        }

        system.write_far(at_far(bits, at as u32), &bytes);
        at = if bit_count == 1 {
            at + bytes.len() as i32
        } else {
            at + row_bytes
        };
    }

    Ok(Some(scans as u16))
}

/// `StretchDIBits` on a printer's context whose driver has no
/// `RC_STRETCHDIB` or answers -1 (`GDI.EXE` seg11 `1253`): where the
/// driver takes `SetDIBitsToDevice` and the sizes are alike and `SRCCOPY`,
/// that; else a memory context made compatible, a bitmap compatible with
/// the printer's made of the DIB (`CreateDIBitmap`, `0a8a`: `SetDIBits` of
/// all its scans), and GDI's `StretchBlt` of it from its bottom row's
/// counting, the answer the source's height where it drew. None where GDI
/// does not draw for the context.
pub(super) async fn stretch_dibits_fallback(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    given: Stretched,
) -> Result<Option<u16>, Stop> {
    let (dib_size, direct) = {
        let system = engine.system();

        if given.usage != 0 || !draws_dibs(&system, dc) {
            return Ok(None);
        }

        let (x0, y0) = device_point(&system, dc, given.x, given.y);
        let (x1, y1) = device_point(&system, dc, given.x + given.width, given.y + given.height);
        let dib = dib_of(&system, given.info, given.bits);
        let id = driver_device(&system, dc).unwrap_or(0);
        let direct = device_caps(&system, id, DP_RASTER) & RC_DIBTODEV != 0
            && x1 - x0 == given.src_width
            && x1 != x0
            && y1 - y0 == given.src_height
            && y1 != y0
            && given.rop == SRCCOPY;

        ((dib.width, dib.height), direct)
    };

    if direct {
        let args = DibArgs {
            x: given.x,
            y: given.y,
            width: given.src_width,
            height: given.src_height,
            src_x: given.src_x,
            src_y: given.src_y,
            start: 0,
            count: dib_size.1,
            bits: given.bits,
            info: given.info,
            usage: given.usage,
        };

        return Ok(match driver_dib_to_device(engine, dc, args).await? {
            Some(answer) => Some(answer),
            None => dib_to_device_fallback(engine, hdc, dc, args).await?,
        });
    }

    let (memory, memory_index) = memory_dc(engine, hdc).await?;
    let mut bitmap = compatible_bitmap(&engine.system(), dc, dib_size.0, dib_size.1);

    set_dibits_fallback(
        engine,
        hdc,
        dc,
        &mut bitmap,
        0,
        dib_size.1,
        given.bits,
        given.info,
        given.usage,
    )
    .await?;

    let drawn = with_bitmap(engine, memory_index, &bitmap, || {
        super::printer_blits::stretch_on_context(
            engine,
            (dc, hdc),
            (memory_index, memory),
            [given.x, given.y, given.width, given.height],
            [
                given.src_x,
                dib_size.1 - given.src_y - given.src_height,
                given.src_width,
                given.src_height,
            ],
            given.rop,
        )
    })
    .await?;

    release_dc(engine, memory).await?;
    Ok(drawn.map(|drawn| {
        if drawn != 0 {
            given.src_height as u16
        } else {
            0
        }
    }))
}

/// A bitmap of GDI's own selected into a memory context of its own for
/// `body`, and the one before put back after.
async fn with_bitmap<T, F: Future<Output = Result<T, Stop>>>(
    engine: &Engine,
    memory: usize,
    bitmap: &Bitmap,
    body: impl FnOnce() -> F,
) -> Result<T, Stop> {
    let (kept, object) = {
        let mut system = engine.system();
        let object = system.gdi_object(GdiObject::Bitmap(Box::new(bitmap.clone())));
        let kept = system.gdi.dcs[memory].bitmap;

        system.gdi.dcs[memory].bitmap = super::dc::DcBitmap::Bitmap(object);
        (kept, object)
    };
    let answer = body().await;
    let mut system = engine.system();

    // GDI's objects are kept by their index, which is never given back.
    system.gdi.dcs[memory].bitmap = kept;
    let _ = object;
    answer
}

/// The context of a call's first handle, where it is a printer's or a
/// memory context made compatible with one; and the bitmap of its second,
/// by its object.
fn printer_and_bitmap(engine: &Engine, args: &Args) -> Option<(u16, usize, usize, Bitmap)> {
    let system = engine.system();
    let mut peek = *args;
    let hdc = peek.word(&system);
    let hbm = peek.word(&system);
    let dc = dc_index(&system, hdc).filter(|&dc| device_of(&system, dc).is_some())?;
    let Some(Object::Gdi(object)) = system.handles.resolve(hbm) else {
        return None;
    };
    let GdiObject::Bitmap(bitmap) = &system.gdi.objects[object] else {
        return None;
    };

    Some((hdc, dc, object, (**bitmap).clone()))
}

/// `SetDIBits` with a printer's context, which GDI sets itself through the
/// driver (`set_dibits_fallback`); any other as the rest of GDI answers.
pub(super) fn set_dibits_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some((hdc, dc, object, mut bitmap)) = printer_and_bitmap(engine, &args) else {
            return super::printer_output::otherwise(engine, "SetDIBits", args).await;
        };
        let (start, count, bits, info, usage) = {
            let system = engine.system();
            let mut peek = args;
            let _ = (peek.word(&system), peek.word(&system));

            (
                i32::from(peek.word(&system)),
                i32::from(peek.word(&system)),
                peek.dword(&system),
                peek.dword(&system),
                peek.word(&system),
            )
        };
        let answer = set_dibits_fallback(
            engine,
            hdc,
            dc,
            &mut bitmap,
            start,
            count,
            bits,
            info,
            usage,
        )
        .await?;
        let Some(answer) = answer else {
            return super::printer_output::otherwise(engine, "SetDIBits", args).await;
        };

        engine.system().gdi.objects[object] = GdiObject::Bitmap(Box::new(bitmap));
        Ok(Answer::Word(answer))
    })
}

/// `GetDIBits` with a printer's context, which GDI gets itself through the
/// driver (`get_dibits_fallback`); any other as the rest of GDI answers.
pub(super) fn get_dibits_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let Some((hdc, dc, _, bitmap)) = printer_and_bitmap(engine, &args) else {
            return super::printer_output::otherwise(engine, "GetDIBits", args).await;
        };
        let (start, count, bits, info, usage) = {
            let system = engine.system();
            let mut peek = args;
            let _ = (peek.word(&system), peek.word(&system));

            (
                i32::from(peek.word(&system)),
                i32::from(peek.word(&system)),
                peek.dword(&system),
                peek.dword(&system),
                peek.word(&system),
            )
        };
        let answer =
            get_dibits_fallback(engine, hdc, dc, &bitmap, start, count, bits, info, usage).await?;

        match answer {
            Some(answer) => Ok(Answer::Word(answer)),
            None => super::printer_output::otherwise(engine, "GetDIBits", args).await,
        }
    })
}

/// `CreateDIBitmap` with a printer's context and `CBM_INIT`: a bitmap
/// compatible with it and `SetDIBits` into it (`GDI.EXE` seg11 `0a8a`),
/// which GDI does itself through the driver; nought where that sets none.
/// Any other as the rest of GDI answers.
pub(super) fn create_dibitmap_call(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let given = {
            let system = engine.system();
            let mut peek = args;
            let hdc = peek.word(&system);
            let header = peek.dword(&system);
            let init = peek.dword(&system);
            let bits = peek.dword(&system);
            let info = peek.dword(&system);
            let usage = peek.word(&system);
            let dc = dc_index(&system, hdc).filter(|&dc| device_of(&system, dc).is_some());

            dc.filter(|_| header != 0 && init & 4 != 0)
                .map(|dc| (hdc, dc, header, bits, info, usage))
        };
        let Some((hdc, dc, header, bits, info, usage)) = given else {
            return super::printer_output::otherwise(engine, "CreateDIBitmap", args).await;
        };
        let (width, height) = {
            let system = engine.system();
            let head = system.read_far(header, 10);
            let word = |at: usize| u16::from_le_bytes([head[at], head[at + 1]]);
            let core = word(0) == 12;

            (
                i32::from(word(4) as i16),
                i32::from(word(if core { 6 } else { 8 }) as i16),
            )
        };
        let mut bitmap = compatible_bitmap(&engine.system(), dc, width, height);
        let answer = set_dibits_fallback(
            engine,
            hdc,
            dc,
            &mut bitmap,
            0,
            height & 0xffff,
            bits,
            info,
            usage,
        )
        .await?;

        match answer {
            None => super::printer_output::otherwise(engine, "CreateDIBitmap", args).await,
            Some(0) => Ok(Answer::Word(0)),
            Some(_) => {
                let mut system = engine.system();
                let index = system.gdi_object(GdiObject::Bitmap(Box::new(bitmap)));
                let handle = system
                    .handles
                    .allocate(crate::handles::Kind::Gdi, Object::Gdi(index))
                    .unwrap_or(0);

                Ok(Answer::Word(handle))
            }
        }
    })
}
