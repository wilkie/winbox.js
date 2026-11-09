//! A run-length encoded DIB, `BI_RLE8` or `BI_RLE4`, set into a bitmap of
//! the display's or drawn on the screen as the display driver's routine of
//! run lengths does it (`rle_runs`): GDI hands the driver the DIB as it is.
//! **Recorded** by `rledib` on the VGA and the 256-colour display.
//!
//! * `SetDIBits`: the driver's `DeviceBitmapBits`, with the bitmap's
//!   rectangle to clip to, so nothing is clipped. On the VGA (`VGA.DRV`
//!   seg9 `0d1e`, export 501) the first line is the bitmap's row
//!   `height - 1 - start`, and a run past the right edge goes on into the
//!   next plane's row, the last plane's into the next row's first; on the
//!   256-colour display (seg9 `0000`, `15ac`) the first line is the DIB's
//!   height less one whatever the start, a line past the top ends the
//!   walk, and a run past the right edge goes on into the next row. The
//!   count is not read; the answer is 1, and nought for a monochrome bitmap
//!   on the 256-colour display. What the stream leaves is left as it was.
//! * `SetDIBitsToDevice`: the driver's, at GDI's place for the DIB -- its
//!   bottom line at `yDest + ySrc + cy - 1`, its left at `xDest - xSrc` --
//!   clipped to the destination rectangle only where the DIB's rectangle
//!   does not lie inside it (`VGA.DRV` `1325`-`134a`; `SVGA256.DRV`
//!   `179f`-`17de`): inside it, lines past the DIB's top and runs past its
//!   right edge are drawn beyond. The VGA's DIB rectangle is the one GDI
//!   gives, its first line `start` higher (`0f02`-`0f1c`); the 256-colour
//!   driver's place moves down by the DIB's height less the start and the
//!   count (`0dc4`-`0dd7`). The answer is 1.

use std::rc::Rc;

use winbox_raster::dib::{Dib, dib_to_device};
use winbox_raster::{DeviceBitmap, SharedPalette};

use super::bitmaps::display_kind;
use super::driver_hercules::is_hercules;
use super::driver_vga256::is_vga256;
use super::rle_runs::{RleWalk, huge_byte, odd_at, walk_rle};
use crate::system::System;

const BI_RLE8: u32 = 1;
const BI_RLE4: u32 = 2;

/// A compressed DIB's header as the drivers read it.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RleHeader {
    pub width: i32,
    pub height: i32,
    pub eight: bool,
}

fn dword(system: &System, far: u32, at: u32) -> u32 {
    let word = |offset: u32| {
        let bytes = system.read_far((far & 0xffff_0000) | (far.wrapping_add(offset) & 0xffff), 2);

        u32::from(u16::from_le_bytes([bytes[0], bytes[1]]))
    };

    word(at) | word(at + 2) << 16
}

fn byte(system: &System, far: u32, at: u32) -> u8 {
    system.read_far((far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff), 1)[0]
}

/// The header of a compressed DIB, or `None` for any other.
pub(crate) fn rle_header(system: &System, info: u32) -> Option<RleHeader> {
    if info == 0 || dword(system, info, 0) == 12 {
        return None;
    }

    let compression = dword(system, info, 16);

    if compression != BI_RLE8 && compression != BI_RLE4 {
        return None;
    }

    Some(RleHeader {
        width: dword(system, info, 4) as i32,
        height: (dword(system, info, 8) as i32).wrapping_abs(),
        eight: compression == BI_RLE8,
    })
}

/// Which driver's routine: the VGA's or the 256-colour display's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Vga,
    Vga256,
}

/// The driver's routine, or `None` where WinBox has none (the Hercules's).
fn family_of(system: &System) -> Option<Family> {
    if is_vga256(system) {
        Some(Family::Vga256)
    } else if is_hercules(system) {
        None
    } else {
        Some(Family::Vga)
    }
}

/// The DIB's colour table, red, green and blue: `biClrUsed` entries, 256
/// at most, or as many as its bits give. With `DIB_PAL_COLORS`, words
/// that index the palette selected where it is drawn, an index past its
/// end its first, as `dib_drawn` reads them (`paldib`).
fn colours_from(
    system: &System,
    info: u32,
    usage: u16,
    entries: Option<&[[u8; 4]]>,
) -> Vec<[u8; 3]> {
    let size = dword(system, info, 0);
    let bit_count = dword(system, info, 14) & 0xffff;
    let used = dword(system, info, 32);
    let count = if used == 0 {
        1 << bit_count.min(8)
    } else {
        used
    }
    .min(256);

    (0..count)
        .map(|index| {
            if let (1, Some(entries)) = (usage, entries) {
                let slot = usize::from(byte(system, info, size + index * 2))
                    | usize::from(byte(system, info, size + index * 2 + 1)) << 8;
                let [red, green, blue, _] = entries
                    .get(slot)
                    .or_else(|| entries.first())
                    .copied()
                    .unwrap_or_default();

                return [red, green, blue];
            }

            let at = size + index * 4;

            [
                byte(system, info, at + 2),
                byte(system, info, at + 1),
                byte(system, info, at),
            ]
        })
        .collect()
}

/// The DIB's colour table as the destination's indices, and on the
/// 256-colour display whether they are other than the indices in order
/// (`SVGA256.DRV` `176f`-`179e`).
pub(crate) struct RleColours {
    table: Vec<u8>,
    translated: bool,
}

/// `RleColours` for a destination of a depth and palette, matched as GDI
/// and the driver match any DIB's (`dib_to_device`), through a realized
/// palette where there is one.
pub(crate) fn colours_of(
    system: &System,
    info: u32,
    usage: u16,
    depth: u8,
    palette: SharedPalette,
    entries: Option<&[[u8; 4]]>,
    realized: Option<&dyn Fn(u8, u8, u8) -> usize>,
) -> RleColours {
    let colours = colours_from(system, info, usage, entries);
    let dib = Dib {
        width: colours.len() as i32,
        height: 1,
        bit_count: 8,
        pixels: (0..colours.len()).map(|index| index as u8).collect(),
        colours,
        rgb: Vec::new(),
    };
    let matched = dib_to_device(
        &dib,
        depth,
        Some(palette),
        Some(display_kind(system)),
        realized,
    );
    let table = matched.indices.borrow().clone();
    let sum = table
        .iter()
        .enumerate()
        .fold(0u16, |total, (entry, &index)| {
            total.wrapping_add(u16::from(index.wrapping_sub(entry as u8)))
        });

    RleColours {
        table,
        translated: sum != 0,
    }
}

/// An index through the table, as the driver takes it (`rle_index`).
fn index_of(family: Family, colours: &RleColours, eight: bool, index: u8) -> u8 {
    if family == Family::Vga256 && eight && !colours.translated {
        return index;
    }

    colours.table.get(usize::from(index)).copied().unwrap_or(0)
}

/// A pixel put where the driver's bitmap has it, in a bitmap of WinBox's:
/// on the VGA a plane's row after another's, each row word-aligned
/// (`VGA.DRV` seg9 `1ad8`); on the 256-colour display a byte a pixel
/// (`SVGA256.DRV` `1738`). What lands past the last row, or before the
/// first -- the VGA's lines past the top -- is beyond the bitmap.
fn put_into(family: Family, target: &DeviceBitmap, x: i32, y: i32, index: u8) {
    if x < 0 || y < 0 {
        return;
    }

    let (width, height) = (target.width(), target.height());
    let mut indices = target.indices.borrow_mut();
    let mut set = |column: i32, row: i32, change: &dyn Fn(u8) -> u8| {
        if let Some(pixel) = usize::try_from(target.context.address(column, row))
            .ok()
            .and_then(|at| indices.get_mut(at))
        {
            *pixel = change(*pixel);
        }
    };

    if family == Family::Vga256 {
        let width_bytes = (width + 1) & !1;
        let at = y * width_bytes + x;
        let (row, column) = (at / width_bytes, at % width_bytes);

        if row < height && column < width {
            set(column, row, &|_| index);
        }

        return;
    }

    let planes = if target.depth == 1 { 1 } else { 4 };
    let width_bytes = ((width + 15) >> 4) * 2;

    for plane in 0..planes {
        let at = y * width_bytes * planes + plane * width_bytes + (x >> 3);
        let row = at / (width_bytes * planes);
        let into = (at % (width_bytes * planes)) / width_bytes;
        let column = (at % width_bytes) * 8 + (x & 7);

        if row < height && column < width {
            let bit = 1u8 << into;
            let on = (index >> plane) & 1 != 0;

            set(column, row, &|pixel| {
                if on { pixel | bit } else { pixel & !bit }
            });
        }
    }
}

/// `SetDIBits` of a compressed DIB into a bitmap of the display's: the
/// answer, or `None` where WinBox has no driver's routine for it (the
/// Hercules's), which leaves it to the DIB's own reading.
pub(crate) fn set_rle_dibits(
    system: &System,
    target: &DeviceBitmap,
    start: u16,
    bits: u32,
    info: u32,
) -> Option<u16> {
    let header = rle_header(system, info)?;
    let family = family_of(system)?;

    // A monochrome bitmap the 256-colour driver refuses (`16d9`).
    if family == Family::Vga256 && target.depth == 1 {
        return Some(0);
    }

    let colours = colours_of(
        system,
        info,
        0,
        target.depth,
        Rc::clone(&target.device_palette),
        None,
        None,
    );
    let walk = RleWalk {
        eight: header.eight,
        x: 0,
        y: if family == Family::Vga256 {
            header.height - 1
        } else {
            target.height() - 1 - i32::from(start)
        },
        top: (family == Family::Vga256).then_some(0),
    };

    walk_rle(
        &walk,
        &mut |at| huge_byte(system, bits, at),
        &|at| odd_at(bits, at),
        &mut |x, y, index| {
            put_into(
                family,
                target,
                x,
                y,
                index_of(family, &colours, header.eight, index),
            );
        },
    );

    target
        .context
        .mark_rect(0, 0, target.width(), target.height());

    Some(1)
}

/// What `SetDIBitsToDevice` is handed, in the device's units.
pub(crate) struct ToDevice {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub src_x: i32,
    pub src_y: i32,
    pub start: i32,
    pub count: i32,
    pub bits: u32,
}

/// `SetDIBitsToDevice` of a compressed DIB on the screen, drawn into
/// `bitmap`, the device context's canvas, its colours `colours`: the
/// answer, or `None` where WinBox has no driver's routine for it.
pub(crate) fn rle_to_device(
    system: &System,
    header: RleHeader,
    bitmap: &DeviceBitmap,
    colours: &RleColours,
    args: &ToDevice,
) -> Option<i16> {
    let family = family_of(system)?;
    let height = header.height;

    // GDI's place for the DIB, and its clip: the destination's rectangle,
    // within what the device context reaches.
    let left = args.x - args.src_x;
    let mut top = args.y - (height - args.src_y - args.height);
    let reach = bitmap.context.reach;
    let clip = (
        args.x.max(reach.left),
        args.y.max(reach.top),
        (args.x + args.width).min(reach.right),
        (args.y + args.height).min(reach.bottom),
    );
    let first = if family == Family::Vga256 {
        top += height - args.start - args.count;
        top + height - 1
    } else {
        top + height - 1 - args.start
    };
    let inside =
        left >= clip.0 && left + header.width <= clip.2 && top >= clip.1 && top + height <= clip.3;
    let mut drawn: Option<(i32, i32, i32, i32)> = None;
    let walk = RleWalk {
        eight: header.eight,
        x: left,
        y: first,
        top: (family == Family::Vga256).then_some(clip.1),
    };

    walk_rle(
        &walk,
        &mut |at| huge_byte(system, args.bits, at),
        &|at| odd_at(args.bits, at),
        &mut |x, y, index| {
            if !inside && (x < clip.0 || x >= clip.2 || y < clip.1 || y >= clip.3) {
                return;
            }

            bitmap.put(x, y, index_of(family, colours, header.eight, index));
            drawn = Some(match drawn {
                Some((l, t, r, b)) => (l.min(x), t.min(y), r.max(x + 1), b.max(y + 1)),
                None => (x, y, x + 1, y + 1),
            });
        },
    );

    if let Some((l, t, r, b)) = drawn {
        bitmap.context.mark_rect(l, t, r, b);
    }

    Some(1)
}
