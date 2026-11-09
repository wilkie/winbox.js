//! What USER's resource handlers make of an icon or cursor resource: the
//! resource, read into its block by KERNEL's own handler, made USER's own
//! block in place (`icons.rs`'s layout). **Read out of `USER.EXE`** seg12
//! and **recorded** by `iconhand` on the VGA and the 256-colour display.
//!
//! The work is done in the block, as USER does it: what it writes lands at
//! the offsets it writes them, and every byte it does not write is the
//! resource's still -- so a colour cursor, which USER lays out as a
//! monochrome one before it adds its picture, keeps 128 bytes of its
//! resource between its mask and its picture (`iconhand`'s cursor 7).

use winbox_raster::DevicePalette;
use winbox_raster::icon::decode_icon;
use winbox_raster::stretch::{Axis, mono_stretch_rows, stretch_columns, stretch_map, stretch_rows};

// The block's header.
const HOTSPOT_X: usize = 0;
const HOTSPOT_Y: usize = 2;
const WIDTH: usize = 4;
const HEIGHT: usize = 6;
const ROW: usize = 8;
const PLANES: usize = 10;
const BITS: usize = 11;
/// The header's size: the mask follows it.
pub const HEADER: usize = 12;

/// A device-independent bitmap's old header's size.
const CORE_HEADER: usize = 12;
/// The colour table of the new header, wherever its size says it ends:
/// USER takes it at 28h (seg12 `11e0`).
const INFO_TABLE: usize = 0x28;
/// A resource of so many bits a pixel has no table (seg12 `121f`, `119b`).
const TRUE_COLOUR: u16 = 24;
/// The stretch mode USER sets to stretch an icon (seg12 `08d3`).
const COLORONCOLOR: u16 = 3;

/// A row of so many pixels of a bit, in whole words.
pub fn word_row(pixels: usize) -> usize {
    pixels.div_ceil(16) * 2
}

/// The sizes USER makes icons and cursors: `SM_CXICON` and the rest.
#[derive(Debug, Clone, Copy)]
pub struct IconMetrics {
    pub cx_icon: u16,
    pub cy_icon: u16,
    pub cx_cursor: u16,
    pub cy_cursor: u16,
}

/// What a conversion leaves: the block's bytes and the size to give it.
#[derive(Debug, Clone)]
pub struct Converted {
    pub bytes: Vec<u8>,
    pub size: usize,
}

fn word(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([
        bytes.get(at).copied().unwrap_or(0),
        bytes.get(at + 1).copied().unwrap_or(0),
    ])
}

fn put_word(bytes: &mut [u8], at: usize, value: u16) {
    if at + 1 < bytes.len() {
        bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }
}

/// Whether two colours of a table are black and white, in either order
/// (seg12 `05ed`-`066f`): four bytes each in the new header, their fourth
/// nought too; three each in the old.
fn black_and_white(bytes: &[u8], at: usize, quads: bool) -> bool {
    let size = if quads { 4 } else { 3 };
    let is = |entry: usize, value: u8| {
        (0..3).all(|i| bytes.get(at + entry * size + i) == Some(&value))
            && (!quads || bytes.get(at + entry * size + 3) == Some(&0))
    };

    (is(0, 0) && is(1, 0xff)) || (is(0, 0xff) && is(1, 0))
}

/// Whether a resource is made the system's size (seg12 `124d`-`12ac`):
/// only for an icon or cursor size above 32, and a resource no larger -- its
/// height counted as the bitmap's, twice the icon's -- does it keep its own.
fn stretches(width: u16, height: u16, icon: bool, metrics: IconMetrics, strict: bool) -> bool {
    let (cx, cy) = if icon {
        (metrics.cx_icon, metrics.cy_icon)
    } else {
        (metrics.cx_cursor, metrics.cy_cursor)
    };
    let fits = |size: u16, system: u16| {
        system as i16 > 32
            && if strict {
                size as i16 <= system as i16
            } else {
                size <= system
            }
    };

    !(fits(width, cx) && fits(height, cy))
}

/// The size a block needs (seg12 `15ff`-`165e`): the header, the mask, and
/// the picture -- the mask's size again for one plane of a bit -- at the
/// system's size where it is stretched, else its own.
fn needed(
    icon: bool,
    bits: usize,
    planes: usize,
    stretch: bool,
    (width, height): (usize, usize),
    metrics: IconMetrics,
) -> usize {
    let (w, h) = match (stretch, icon) {
        (true, true) => (usize::from(metrics.cx_icon), usize::from(metrics.cy_icon)),
        (true, false) => (
            usize::from(metrics.cx_cursor),
            usize::from(metrics.cy_cursor),
        ),
        (false, _) => (width, height),
    };
    let picture = word_row(bits * w) * h * planes;

    HEADER
        + if planes == 1 && bits == 1 {
            picture * 2
        } else {
            picture + word_row(w) * h
        }
}

/// Rows of a bit a pixel made another size (seg12 `0bd1`-`0de8`): an
/// icon's hotspot its middle, a cursor's
/// moved with its picture; halved across (seg5 `050f`), reduced down (seg5
/// `056e`), or stretched by GDI's monochrome stretcher in `COLORONCOLOR`
/// (`087a`). Its end: where a colour picture goes.
#[allow(clippy::fn_params_excessive_bools)]
fn fit_rows(
    block: &mut [u8],
    icon: bool,
    scale: bool,
    colour: bool,
    stretch: bool,
    metrics: IconMetrics,
) -> usize {
    let width = word(block, WIDTH);
    let height = word(block, HEIGHT);
    let (w_to, h_to) = match (stretch, icon) {
        (true, true) => (metrics.cx_icon, metrics.cy_icon),
        (true, false) => (metrics.cx_cursor, metrics.cy_cursor),
        (false, _) => (width, height),
    };

    if icon {
        put_word(block, HOTSPOT_X, ((w_to as i16) >> 1) as u16);
        put_word(block, HOTSPOT_Y, ((h_to as i16) >> 1) as u16);
    }

    // An icon's colour mask is rows of its own; anything else has its
    // picture's rows below the mask's (`0c28`-`0c4a`).
    let both = !(icon && colour);
    let mut rows = usize::from(height) * if both { 2 } else { 1 };
    let goal = usize::from(h_to) * if both { 2 } else { 1 };
    let row = word_row(usize::from(w_to));
    let size = (row * goal) & 0xffff;

    if !scale || (width == w_to && height == h_to) {
        return size + HEADER;
    }

    if !icon {
        let x = i32::from(word(block, HOTSPOT_X) as i16) * i32::from(w_to) / i32::from(width);
        let y = i32::from(word(block, HOTSPOT_Y) as i16) * i32::from(h_to) / i32::from(height);

        put_word(block, HOTSPOT_X, x as u16);
        put_word(block, HOTSPOT_Y, y as u16);
    }

    let mut general = false;

    if width != w_to {
        if width.is_multiple_of(w_to) && width / w_to == 2 {
            halve_across(block, rows, usize::from(word(block, ROW)));
            put_word(block, WIDTH, w_to);
            put_word(block, ROW, row as u16);
        } else {
            general = true;
        }
    }

    if height != h_to {
        if height.is_multiple_of(h_to) {
            reduce_down(
                block,
                usize::from(height / h_to),
                rows,
                usize::from(word(block, ROW)),
            );
            put_word(block, HEIGHT, h_to);
            rows = goal;
        } else {
            general = true;
        }
    }

    if general {
        let from = word(block, WIDTH);
        let stride = usize::from(word(block, ROW));
        let source: Vec<u8> = (0..stride * rows)
            .map(|at| block.get(HEADER + at).copied().unwrap_or(0))
            .collect();
        let pixel = |x: i32, y: i32| {
            let (x, y) = (x as usize, y as usize);

            (source.get(y * stride + (x >> 3)).copied().unwrap_or(0) >> (7 - (x & 7))) & 1
        };
        let stretched = mono_stretch_rows(
            pixel,
            (0, 0, i32::from(from), rows as i32),
            i32::from(w_to),
            goal as i32,
            COLORONCOLOR,
            0,
            goal as i32 - 1,
        );
        let mut out = vec![0u8; row * goal];

        for (y, bits) in stretched.iter().enumerate() {
            for (x, &bit) in bits.iter().enumerate() {
                out[y * row + (x >> 3)] |= bit << (7 - (x & 7));
            }
        }

        let room = block.len().saturating_sub(HEADER).min(out.len());

        block[HEADER..HEADER + room].copy_from_slice(&out[..room]);
        put_word(block, WIDTH, w_to);
        put_word(block, HEIGHT, h_to);
        put_word(block, ROW, row as u16);
    }

    size + HEADER
}

/// Rows halved across, in place (seg5 `050f`-`056b`): each word of a row
/// made a byte, each of its pixels the and of a pair; a row's bytes, where
/// they are odd, followed by a byte left as it was.
fn halve_across(block: &mut [u8], rows: usize, row_bytes: usize) {
    let words = row_bytes >> 1;
    let pad = words & 1;
    let mut from = HEADER;
    let mut to = HEADER - pad;

    for _ in 0..rows {
        to += pad;

        for _ in 0..words {
            let value = word(block, from);
            let paired = value & value.rotate_left(1);
            let [low, high] = paired.to_le_bytes();
            let mut out = 0u8;

            for half in [low, high] {
                for bit in [7, 5, 3, 1] {
                    out = (out << 1) | ((half >> bit) & 1);
                }
            }

            if let Some(slot) = block.get_mut(to) {
                *slot = out;
            }

            to += 1;
            from += 2;
        }
    }
}

/// Rows reduced down by a whole number, in place (seg5 `056e`-`05db`): each
/// group of so many rows anded, a word at a time.
fn reduce_down(block: &mut [u8], factor: usize, rows: usize, row_bytes: usize) {
    if factor <= 1 {
        return;
    }

    let mut to = HEADER;

    for r in 0..rows / factor {
        for w in 0..row_bytes >> 1 {
            let at = HEADER + r * factor * row_bytes + w * 2;
            let mut value = word(block, at);

            for n in 1..factor {
                value &= word(block, at + n * row_bytes);
            }

            put_word(block, to, value);
            to += 2;
        }
    }
}

/// A picture of the display's colours another size, as `StretchBlt` makes
/// one between bitmaps of the display's in `COLORONCOLOR` (seg12 `087a`).
fn stretch_picture(
    indices: &[u8],
    (width, height): (usize, usize),
    (w_to, h_to): (usize, usize),
    mono: bool,
) -> Vec<u8> {
    let mut out = vec![0u8; w_to * h_to];
    let within = width.abs_diff(w_to) <= 1 && height.abs_diff(h_to) <= 1;

    if within || mono {
        let across = stretch_map(
            width as i32,
            w_to as i32,
            height as i32,
            h_to as i32,
            Axis::Columns,
            mono,
        );
        let down = stretch_map(
            height as i32,
            h_to as i32,
            width as i32,
            w_to as i32,
            Axis::Rows,
            mono,
        );

        for y in 0..h_to {
            for x in 0..w_to {
                out[y * w_to + x] = indices[down[y] as usize * width + across[x] as usize];
            }
        }

        return out;
    }

    let across = stretch_columns(width as i32, w_to as i32, false);
    let down = stretch_rows(height as i32, h_to as i32, false);

    for y in 0..h_to {
        let source = down
            .get(y)
            .and_then(|group| group.first())
            .copied()
            .unwrap_or(0) as usize;

        for x in 0..w_to {
            let column = across[x].last().copied().unwrap_or(0) as usize;

            out[y * w_to + x] = indices[source * width + column];
        }
    }

    out
}

/// A picture's bytes as the display's bitmaps hold them: each row, its
/// planes in turn.
fn picture_bytes(indices: &[u8], (width, height): (usize, usize), planes: u8, bits: u8) -> Vec<u8> {
    let (planes, bits) = (usize::from(planes), usize::from(bits));
    let row = word_row(width * bits);
    let mut out = vec![0u8; row * planes * height];

    for y in 0..height {
        for x in 0..width {
            let index = usize::from(indices[y * width + x]);

            for plane in 0..planes {
                let value = ((index >> (plane * bits)) & ((1 << bits) - 1)) as u8;
                let bit = x * bits;

                out[(y * planes + plane) * row + (bit >> 3)] |= value << (8 - bits - (bit & 7));
            }
        }
    }

    out
}

/// A device-independent bitmap in the new header, for `decode_icon`: the
/// old one's made so.
fn as_info(dib: &[u8], core: bool, colours: usize) -> Vec<u8> {
    if !core {
        return dib.to_vec();
    }

    let width = word(dib, 4);
    let height = word(dib, 6);
    let bits = word(dib, 10);
    let rest = dib.get(CORE_HEADER + colours * 3..).unwrap_or(&[]);
    let mut out = vec![0u8; 40 + colours * 4];

    out[0..4].copy_from_slice(&40u32.to_le_bytes());
    out[4..8].copy_from_slice(&i32::from(width).to_le_bytes());
    out[8..12].copy_from_slice(&i32::from(height).to_le_bytes());
    out[12..14].copy_from_slice(&1u16.to_le_bytes());
    out[14..16].copy_from_slice(&bits.to_le_bytes());
    out[32..36].copy_from_slice(&(colours as u32).to_le_bytes());

    for i in 0..colours {
        for c in 0..3 {
            out[40 + i * 4 + c] = dib.get(CORE_HEADER + i * 3 + c).copied().unwrap_or(0);
        }
    }

    out.extend_from_slice(rest);
    out
}

/// The display's format and colours, as a bitmap compatible with it has
/// them.
#[derive(Debug)]
pub struct DisplayFormat<'a> {
    pub planes: u8,
    pub bits: u8,
    pub palette: &'a mut DevicePalette,
}

/// A Windows 3 module's icon or cursor, a device-independent bitmap -- a
/// cursor's after its hotspot's two words -- made USER's block in place
/// (seg12 `1138`-`15c6`). `bytes` is
/// the block as KERNEL's own handler left it, `length` the resource's size.
#[allow(clippy::too_many_lines)]
pub fn convert_dib(
    bytes: &[u8],
    length: usize,
    icon: bool,
    metrics: IconMetrics,
    display: &mut DisplayFormat<'_>,
) -> Option<Converted> {
    let at = if icon { 0 } else { 4 };
    let core = usize::from(word(bytes, at)) == CORE_HEADER;
    let width = word(bytes, at + 4);
    let full_height = if core {
        word(bytes, at + 6)
    } else {
        word(bytes, at + 8)
    };
    let bits = if core {
        word(bytes, at + 10)
    } else {
        word(bytes, at + 14)
    };
    let used = if core {
        0
    } else {
        u32::from(word(bytes, at + 32)) | u32::from(word(bytes, at + 34)) << 16
    };
    let table_at = at + if core { CORE_HEADER } else { INFO_TABLE };
    let mut colours = 0usize;
    let mut mono = false;

    if used != 0 {
        colours = used as usize;
        mono = used == 2 && black_and_white(bytes, table_at, !core);
    } else if bits != TRUE_COLOUR {
        colours = 1usize << bits.min(16);
        mono = bits == 1 && black_and_white(bytes, table_at, !core);
    }

    let bits_at = table_at + colours * if core { 3 } else { 4 };
    let stretch = stretches(width, full_height, icon, metrics, false);
    let height = full_height >> 1;
    let (w, h) = (usize::from(width), usize::from(height));
    let mut block = bytes.to_vec();
    let mut size = length;

    if block.len() < length {
        block.resize(length, 0);
    }

    // Made larger where it needs to be, its bytes kept (`14e7`-`155e`).
    let grow = |block: &mut Vec<u8>, size: &mut usize, wanted: usize| {
        if wanted > *size {
            if block.len() < wanted {
                block.resize(wanted, 0);
            }

            *size = wanted;
        }
    };

    if icon {
        put_word(&mut block, HOTSPOT_X, 0);
        put_word(&mut block, HOTSPOT_Y, 0);
    }

    if mono {
        // The bitmap whole, its colour table's white a set bit.
        let stride = w.div_ceil(32) * 4;
        let row = word_row(w);
        let entry = if core { 3 } else { 4 };
        let white = |index: usize| bytes.get(table_at + index * entry) == Some(&0xff);
        let all = usize::from(full_height);
        let mut rows = vec![0u8; row * all];

        for y in 0..all {
            let from = bits_at + (all - 1 - y) * stride;

            for x in 0..w {
                let index = (bytes.get(from + (x >> 3)).copied().unwrap_or(0) >> (7 - (x & 7))) & 1;

                if white(usize::from(index)) {
                    rows[y * row + (x >> 3)] |= 0x80 >> (x & 7);
                }
            }
        }

        grow(
            &mut block,
            &mut size,
            needed(icon, 1, 1, stretch, (w, h), metrics),
        );
        put_word(&mut block, WIDTH, width);
        put_word(&mut block, HEIGHT, height);
        put_word(&mut block, ROW, row as u16);
        block[PLANES] = 1;
        block[BITS] = 1;

        let room = block.len().saturating_sub(HEADER).min(rows.len());

        block[HEADER..HEADER + room].copy_from_slice(&rows[..room]);

        let end = fit_rows(&mut block, icon, true, false, stretch, metrics);

        return Some(finish(block, size, end));
    }

    let info = as_info(bytes.get(at..).unwrap_or(&[]), core, colours);
    let decoded = decode_icon(&info, display.palette);
    let row = word_row(w);
    let mut mask = vec![0u8; row * h];

    for y in 0..h {
        for x in 0..w {
            if decoded.and.get(y * w + x).copied().unwrap_or(0) != 0 {
                mask[y * row + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }
    }

    put_word(&mut block, WIDTH, width);
    put_word(&mut block, HEIGHT, height);
    put_word(&mut block, ROW, row as u16);
    block[PLANES] = 1;
    block[BITS] = 1;

    let room = block.len().saturating_sub(HEADER).min(mask.len());

    block[HEADER..HEADER + room].copy_from_slice(&mask[..room]);
    grow(
        &mut block,
        &mut size,
        needed(
            icon,
            usize::from(display.bits),
            usize::from(display.planes),
            stretch,
            (w, h),
            metrics,
        ),
    );

    let end = fit_rows(&mut block, icon, true, true, stretch, metrics);

    // The picture at the icon's size (`1029`-`10cb`): an icon's at once
    // after its mask, a cursor's where a monochrome picture would be.
    let (cx, cy) = (usize::from(metrics.cx_icon), usize::from(metrics.cy_icon));
    let (picture, size_to) = if stretch && (w != cx || h != cy) {
        let mono_display = display.planes * display.bits == 1;

        (
            stretch_picture(&decoded.xor, (w, h), (cx, cy), mono_display),
            (cx, cy),
        )
    } else {
        (decoded.xor.clone(), (w, h))
    };
    let laid = picture_bytes(&picture, size_to, display.planes, display.bits);

    block[PLANES] = display.planes;
    block[BITS] = display.bits;

    if block.len() < end + laid.len() {
        block.resize(end + laid.len(), 0);
    }

    block[end..end + laid.len()].copy_from_slice(&laid);

    Some(finish(block, size, end + laid.len()))
}

/// The block made the size of what it holds where that is less (`15a7`):
/// never larger, so a colour cursor's picture, which runs past its block
/// in Windows, is cut at the block's end here.
fn finish(mut block: Vec<u8>, size: usize, end: usize) -> Converted {
    let kept = if size > end { end } else { size };

    block.truncate(kept);
    Converted {
        bytes: block,
        size: kept,
    }
}

/// A Windows 2 module's icon or cursor, made USER's block in place (seg12
/// `0e4c`-`0fee`).
pub fn convert_old(bytes: &[u8], length: usize, metrics: IconMetrics) -> Converted {
    let icon = bytes.first() == Some(&1);
    let independent = bytes.get(1).is_some_and(|&byte| byte != 0);
    let mut block = bytes.to_vec();

    if block.len() < length.max(HEADER) {
        block.resize(length.max(HEADER), 0);
    }

    if length >= 2 {
        block.copy_within(2..length, 0);
    }

    let scale = !(!independent
        && word(&block, WIDTH) == metrics.cx_icon
        && word(&block, HEIGHT) == metrics.cy_icon);

    block[BITS] = 1;
    block[PLANES] = 1;

    if !stretches(
        word(&block, WIDTH),
        word(&block, HEIGHT),
        icon,
        metrics,
        true,
    ) {
        block.truncate(length);
        return Converted {
            bytes: block,
            size: length,
        };
    }

    let mut size = length;
    let wanted = needed(icon, 1, 1, true, (0, 0), metrics);

    if scale && wanted > size {
        if block.len() < wanted {
            block.resize(wanted, 0);
        }

        size = wanted;
    }

    let end = fit_rows(&mut block, icon, scale, false, true, metrics);

    finish(block, size, end)
}
