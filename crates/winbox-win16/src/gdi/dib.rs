//! Device-independent bitmaps as GDI's bitmaps: one made of a DIB
//! (`CreateDIBitmap`), a DIB's scan lines set into one (`SetDIBits`), and
//! one's pixels read back as a DIB (`GetDIBits`). Drawing a DIB straight to
//! a device context comes with drawing.

use std::rc::Rc;

use winbox_raster::colour_match::{DisplayKind, matched_index};
use winbox_raster::{
    DeviceBitmap, DevicePalette, SharedPalette, decode_dib, dib_to_device, palette_for_display,
};

use crate::call::{Answer, Args, Stop};
use crate::system::System;

use super::bitmaps::display_kind;
use super::dc::{DcBitmap, dc_of};
use super::objects::GdiObject;

const CBM_INIT: u32 = 0x4;

/// Bytes of a huge pointer's memory: `count` bytes on from `far`, stepping
/// to the next selector, eight on (`__AHINCR`), at each 64 KiB, as a block
/// `GlobalAlloc` gives of more than a segment is tiled. GDI reads a DIB's
/// bits so: SimTower's title, 640 by 480 at a byte a pixel, is 300 KB.
fn huge_read(system: &System, far: u32, count: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(count);

    while bytes.len() < count {
        let offset = u64::from(far & 0xffff) + bytes.len() as u64;
        let selector = (u64::from(far >> 16) + (offset >> 16) * 8) & 0xffff;
        let within = offset & 0xffff;
        let run = ((0x10000 - within) as usize).min(count - bytes.len());
        let at = system.linear((selector << 16 | within) as u32);

        bytes.extend(system.cpu.bus.read(at, run));
    }

    bytes
}

/// A byte written through a huge pointer: `linear` bytes on from the
/// selector, a selector eight on for each 64 KiB.
fn huge_write(system: &mut System, selector: u32, linear: u32, byte: u8) {
    let selector = selector.wrapping_add((linear >> 16) * 8) & 0xffff;

    system.write_far(selector << 16 | (linear & 0xffff), &[byte]);
}

/// A word of a structure, its offset within its segment.
fn word(system: &System, far: u32, at: u32) -> u16 {
    let bytes = system.read_far((far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn dword(system: &System, far: u32, at: u32) -> u32 {
    u32::from(word(system, far, at)) | u32::from(word(system, far, at + 2)) << 16
}

/// What a DIB's header says of it, as GDI reads one from a program.
struct Header {
    size: u32,
    core: bool,
    width: i32,
    /// Its height, however its rows run.
    height: i32,
    bit_count: u16,
    compression: u32,
    colours: u32,
}

impl Header {
    fn read(system: &System, far: u32) -> Self {
        let size = dword(system, far, 0);
        let core = size == 12;
        let width = if core {
            i32::from(word(system, far, 4))
        } else {
            dword(system, far, 4) as i32
        };
        let height = if core {
            i32::from(word(system, far, 6) as i16)
        } else {
            dword(system, far, 8) as i32
        }
        .wrapping_abs();
        let bit_count = word(system, far, if core { 10 } else { 14 });
        let compression = if core { 0 } else { dword(system, far, 16) };
        let used = if core { 0 } else { dword(system, far, 32) };
        let colours = if bit_count <= 8 {
            if used == 0 { 1 << bit_count } else { used }
        } else {
            0
        };

        Self {
            size,
            core,
            width,
            height,
            bit_count,
            compression,
            colours,
        }
    }

    /// The bytes of its header and colour table.
    fn table_size(&self) -> usize {
        let entry = if self.core { 3 } else { 4 };

        (u64::from(self.size) + u64::from(self.colours) * entry) as usize
    }

    /// The bytes a row of its pixels takes, to a doubleword.
    fn stride(&self, width: i32) -> i64 {
        i64::from(
            (width
                .wrapping_mul(i32::from(self.bit_count))
                .wrapping_add(31)
                >> 5)
                << 2,
        )
    }
}

/// The kind of bitmap a device context makes: a memory context's selected
/// bitmap's depth and palette, else the display's.
fn kind_for(system: &System, hdc: u16) -> (u8, SharedPalette) {
    let selected = dc_of(system, hdc).and_then(|dc| match system.gdi.dcs[dc].bitmap {
        DcBitmap::Bitmap(index) => match &system.gdi.objects[index] {
            GdiObject::Bitmap(bitmap) => Some((
                bitmap.pixels.depth,
                Rc::clone(&bitmap.pixels.device_palette),
            )),
            _ => None,
        },
        DcBitmap::Screen | DcBitmap::Window(_) => None,
    });
    let display = display_kind(system);

    selected.unwrap_or_else(|| {
        let depth = display.depth();

        (depth, palette_for_display(display, Some(depth)))
    })
}

/// A device-dependent bitmap made of a device-independent one: the size
/// the header gives, at the depth of the device context -- the display's
/// for the screen, the selected bitmap's for a memory context, as
/// `CreateCompatibleBitmap` does -- and, with `CBM_INIT`, its pixels from
/// the bits and colour table given, each colour matched to the device's
/// palette. Nought for no device context or header, and for a DIB that
/// cannot be read.
///
/// `COMMDLG.DLL`'s File Open dialog makes its folder and drive pictures
/// with it. Not measured: `DIB_PAL_COLORS`, whose colour table is palette
/// indices, taken here as colours; and the colours a matched pixel gets,
/// which follow `LoadBitmap`'s.
pub fn create_dibitmap(
    system: &mut System,
    hdc: u16,
    header: u32,
    init: u32,
    bits: u32,
    info: u32,
) -> u16 {
    if hdc == 0 || system.handles.resolve(hdc).is_none() || header == 0 {
        return 0;
    }

    let made = Header::read(system, header);
    let (depth, palette) = kind_for(system, hdc);

    if init & CBM_INIT == 0 || bits == 0 || info == 0 {
        return system.bitmap_handle(DeviceBitmap::new(
            made.width,
            made.height,
            depth,
            None,
            Some(palette),
        ));
    }

    // The header and colour table from `info`, then the bits, laid out as
    // a resource holds a DIB. Compressed, the bits are as many bytes as the
    // header says, not a stride a row: StarMerc's run-length bitmaps are
    // shorter, and reading a stride a row ran past their block.
    let given = Header::read(system, info);
    let size = if given.compression == 0 {
        given.stride(made.width) * i64::from(made.height)
    } else {
        i64::from(dword(system, info, 20))
    };
    let mut bytes = huge_read(system, info, given.table_size());

    bytes.extend(huge_read(system, bits, usize::try_from(size).unwrap_or(0)));

    let Ok(dib) = decode_dib(&bytes) else {
        return 0;
    };
    let display = display_kind(system);
    let pixels = dib_to_device(&dib, depth, Some(palette), Some(display), None);

    system.bitmap_handle(pixels)
}

pub(crate) fn create_dibitmap_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let header = args.dword(system);
    let init = args.dword(system);
    let bits = args.dword(system);
    let info = args.dword(system);
    let _usage = args.word(system);

    Ok(Answer::Word(create_dibitmap(
        system, hdc, header, init, bits, info,
    )))
}

/// A DIB in the program's memory as a bitmap of a depth and palette: `rows`
/// of its scan lines from the bits, with the header and colour table from
/// `info`, and how many rows that is. `None` when it cannot be read.
///
/// The TypeScript engine's `dibAt`, as `SetDIBits` uses it: with no
/// palette of the program's selected, so its colour table is colours, and
/// matched by the display driver's rule (`dibmap`).
fn dib_at(
    system: &System,
    info: u32,
    bits: u32,
    rows: i64,
    depth: u8,
    palette: SharedPalette,
) -> Option<(DeviceBitmap, i64)> {
    if info == 0 || bits == 0 {
        return None;
    }

    let header = Header::read(system, info);
    let lines = if header.compression == 0 {
        rows
    } else {
        i64::from(header.height)
    };
    let mut bytes = huge_read(system, info, header.table_size());

    // The scan lines handed over are all the DIB there is, as far as they
    // go.
    if lines != i64::from(header.height) {
        let [low, high, ..] = (lines as u32).to_le_bytes();
        let at = if header.core { 6 } else { 8 };

        for (offset, byte) in [low, high, 0, 0]
            .into_iter()
            .take(if header.core { 2 } else { 4 })
            .enumerate()
        {
            if let Some(slot) = bytes.get_mut(at + offset) {
                *slot = byte;
            }
        }
    }

    let size = if header.compression == 0 {
        header.stride(header.width) * lines
    } else {
        i64::from(dword(system, info, 20))
    };

    bytes.extend(huge_read(system, bits, usize::try_from(size).ok()?));

    let dib = decode_dib(&bytes).ok()?;
    let display = display_kind(system);

    Some((
        dib_to_device(&dib, depth, Some(palette), Some(display), None),
        lines,
    ))
}

/// Some of a DIB's scan lines set into a bitmap, counted from the bottom
/// from `start`: how many rows were set. The device context is not looked
/// at. Each colour is matched to the bitmap's palette as `CreateDIBitmap`
/// matches; the DIB's rows are set from the left, as far as the narrower of
/// the two goes. Not recorded.
pub fn set_dibits(
    system: &mut System,
    handle: u16,
    start: u16,
    lines: u16,
    bits: u32,
    info: u32,
) -> u16 {
    let Some(target) = system.bitmap_of(handle) else {
        return 0;
    };

    if bits == 0 || info == 0 {
        return 0;
    }

    let target = target.pixels.clone();
    let Some((source, found)) = dib_at(
        system,
        info,
        bits,
        i64::from(lines),
        target.depth,
        Rc::clone(&target.device_palette),
    ) else {
        return 0;
    };
    let full = Header::read(system, info).height;
    let width = source.width().min(target.width());
    let mut set = 0;

    {
        let mut indices = target.indices.borrow_mut();

        for row in 0..found {
            // The source's top row is the last scan line given.
            let scan = i64::from(start) + found - 1 - row;
            let y = i64::from(full) - 1 - scan;

            if y < 0 || y >= i64::from(target.height()) {
                continue;
            }

            for x in 0..width {
                let at = target.context.address(x, y as i32);

                if let Some(pixel) = usize::try_from(at).ok().and_then(|at| indices.get_mut(at)) {
                    *pixel = source.index_at(x, row as i32).unwrap_or(0);
                }
            }

            set += 1;
        }
    }

    target
        .context
        .mark_rect(0, 0, target.width(), target.height());
    set
}

pub(crate) fn set_dibits_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _hdc = args.word(system);
    let handle = args.word(system);
    let start = args.word(system);
    let lines = args.word(system);
    let bits = args.dword(system);
    let info = args.dword(system);
    let _usage = args.word(system);

    Ok(Answer::Word(set_dibits(
        system, handle, start, lines, bits, info,
    )))
}

/// The DIB's sixteen colours, as a 4-bit DIB of a 16-colour bitmap lists
/// them.
const DIB_COLOURS: [[u8; 3]; 16] = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [128, 128, 128],
    [192, 192, 192],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
];

/// A device index's entry in a DIB's colour table.
type EntryOf = Box<dyn Fn(u8) -> u8>;

/// The colour table `GetDIBits` writes at a bit count, and each device
/// index's entry in it, for a bitmap of `colours`.
fn colour_table(
    count: u16,
    mono: bool,
    colours: Vec<[u8; 3]>,
    display: DisplayKind,
) -> (Vec<[u8; 3]>, EntryOf) {
    let entries: usize = if count == 24 { 0 } else { 1 << count };
    let colour_of = move |index: u8| {
        colours
            .get(usize::from(index))
            .copied()
            .unwrap_or([0, 0, 0])
    };

    if count == 1 {
        let table = vec![[0, 0, 0], [255, 255, 255]];

        if mono {
            return (table, Box::new(|index| index));
        }

        return (
            table,
            Box::new(move |index| {
                let [red, green, blue] = colour_of(index);

                matched_index(display, &mut DevicePalette::mono(), red, green, blue) as u8
            }),
        );
    }

    if mono {
        let table = (0..entries)
            .map(|n| {
                if n == entries - 1 {
                    [255, 255, 255]
                } else {
                    [0, 0, 0]
                }
            })
            .collect();
        let last = entries.wrapping_sub(1) as u8;

        return (
            table,
            Box::new(move |index| if index == 0 { 0 } else { last }),
        );
    }

    let table = (0..entries)
        .map(|n| DIB_COLOURS.get(n).copied().unwrap_or([0, 0, 0]))
        .collect();

    (
        table,
        Box::new(move |index| {
            let colour = colour_of(index);

            DIB_COLOURS
                .iter()
                .position(|&entry| entry == colour)
                .unwrap_or(0) as u8
        }),
    )
}

/// A device-dependent bitmap's pixels read back as a DIB, as the header at
/// `info` asks for them. **Recorded** by `getdib`, a colour bitmap and a
/// monochrome one on the VGA:
///
/// * A bit count of 1, 4, 8 or 24 is read; any other, 0 among them,
///   answers nought and leaves the header as it was.
/// * The header's image size is filled in, the stride times the bitmap's
///   height, however many lines are asked for; the colour table follows
///   it, and with no buffer for the bits that is all, answering the lines
///   asked.
/// * A colour bitmap's table is the sixteen colours in the DIB's own order
///   -- light and dark grey the other way round from the device's -- and at
///   8 bits nought after them; at 1 bit black and white, a pixel white
///   where the driver makes its colour white on a monochrome bitmap. At 24
///   bits there is no table, and each pixel is its colour, blue first.
/// * A monochrome bitmap's table at 4 bits is black but for its last entry,
///   white, which its white pixels are.
/// * The lines are counted from the bottom, from `start`; the answer is
///   how many were read. The bytes after a line's pixels, to its four-byte
///   end, are left as they were.
///
/// Not recorded: a monochrome bitmap at 8 bits, which is taken as at 4, its
/// white the last entry; `DIB_PAL_COLORS`, which is read as
/// `DIB_RGB_COLORS`. The device context is not looked at.
pub fn get_dibits(
    system: &mut System,
    handle: u16,
    start: u16,
    asked: u16,
    bits: u32,
    info: u32,
) -> u16 {
    let Some(bitmap) = system.bitmap_of(handle) else {
        return 0;
    };

    if info == 0 {
        return 0;
    }

    let size = u32::from(word(system, info, 0));
    let count = word(system, info, 14);

    if ![1, 4, 8, 24].contains(&count) {
        return 0;
    }

    let pixels = bitmap.pixels.clone();
    let colours = pixels.device_palette.borrow().colours.clone();
    let (width, height) = (pixels.width(), pixels.height());
    let stride = ((width.wrapping_mul(i32::from(count)).wrapping_add(31)) >> 5) << 2;
    let at = |n: u32| (info & 0xffff_0000) | (info.wrapping_add(n) & 0xffff);

    system.write_far(at(4), &(width as u32).to_le_bytes());
    system.write_far(at(8), &(height as u32).to_le_bytes());
    system.write_far(at(12), &1u16.to_le_bytes());
    system.write_far(at(20), &(stride.wrapping_mul(height) as u32).to_le_bytes());

    let mono = pixels.depth == 1;
    let colour_of = |index: u8| {
        colours
            .get(usize::from(index))
            .copied()
            .unwrap_or([0, 0, 0])
    };
    let (table, entry_of) = colour_table(count, mono, colours.clone(), display_kind(system));

    for (n, [red, green, blue]) in table.into_iter().enumerate() {
        system.write_far(at(size + n as u32 * 4), &[blue, green, red, 0]);
    }

    let lines = i32::from(asked).min(height - i32::from(start)).max(0);

    if bits == 0 {
        return lines as u16;
    }

    let (selector, offset) = (bits >> 16, bits & 0xffff);
    let used = ((width * i32::from(count) + 7) >> 3).max(0) as usize;

    for line in 0..lines {
        let y = height - 1 - (i32::from(start) + line);
        let mut row = vec![0u8; usize::try_from(stride).unwrap_or(0)];

        for x in 0..width {
            let index = pixels.index_at(x, y).unwrap_or(0);
            let x = x as usize;

            match count {
                24 => {
                    let [red, green, blue] = if mono {
                        if index == 0 {
                            [0, 0, 0]
                        } else {
                            [255, 255, 255]
                        }
                    } else {
                        colour_of(index)
                    };

                    row[x * 3..x * 3 + 3].copy_from_slice(&[blue, green, red]);
                }
                8 => row[x] = entry_of(index),
                4 => row[x >> 1] |= entry_of(index) << if x & 1 == 1 { 0 } else { 4 },
                _ => row[x >> 3] |= entry_of(index) << (7 - (x & 7)),
            }
        }

        // Through the selector's steps, as a huge pointer is; only the
        // bytes the pixels take, the padding after them left as it was.
        for (n, &byte) in row.iter().enumerate().take(used) {
            let linear = offset + (line as u32).wrapping_mul(stride as u32) + n as u32;

            huge_write(system, selector, linear, byte);
        }
    }

    lines as u16
}

pub(crate) fn get_dibits_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _hdc = args.word(system);
    let handle = args.word(system);
    let start = args.word(system);
    let lines = args.word(system);
    let bits = args.dword(system);
    let info = args.dword(system);
    let _usage = args.word(system);

    Ok(Answer::Word(get_dibits(
        system, handle, start, lines, bits, info,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gdi::bitmaps::{create_bitmap, create_compatible_bitmap};
    use crate::gdi::dc::create_dc;

    /// The probe's `PALETTE`: the device's sixteen colours by its own
    /// indices.
    const PALETTE: [[u8; 3]; 16] = [
        [0, 0, 0],
        [128, 0, 0],
        [0, 128, 0],
        [128, 128, 0],
        [0, 0, 128],
        [128, 0, 128],
        [0, 128, 128],
        [192, 192, 192],
        [128, 128, 128],
        [255, 0, 0],
        [0, 255, 0],
        [255, 255, 0],
        [0, 0, 255],
        [255, 0, 255],
        [0, 255, 255],
        [255, 255, 255],
    ];

    fn hex(bytes: &[u8], group: usize) -> String {
        bytes
            .chunks(group)
            .map(|chunk| {
                chunk
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<Vec<_>>()
                    .concat()
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// `getdib`'s two bitmaps, sixteen by four: a colour one whose pixel
    /// `(x, y)` is the probe's colour `(x + 4y) % 16`, and a monochrome one
    /// in a checkerboard.
    fn bitmaps(system: &mut System) -> (u16, u16) {
        let screen = create_dc(system, b"DISPLAY").unwrap();
        let colour = create_compatible_bitmap(system, screen, 16, 4);
        let mono = create_bitmap(system, 16, 4, 1, 1, 0);
        let pixels = &system.bitmap_of(colour).unwrap().pixels;

        for y in 0..4 {
            for x in 0..16 {
                let [red, green, blue] = PALETTE[((x + 4 * y) % 16) as usize];
                let index = pixels.device_palette.borrow_mut().index(red, green, blue);

                pixels.put(x, y, index as u8);
            }
        }

        let pixels = &system.bitmap_of(mono).unwrap().pixels;

        for y in 0..4 {
            for x in 0..16 {
                pixels.put(x, y, ((x + y) & 1) as u8);
            }
        }

        (colour, mono)
    }

    /// The probe's `ask`: the header and buffers filled with `EEh`, the
    /// answer, the header's fields, the table's entries as blue, green, red
    /// with any reserved byte in brackets, and the bits.
    fn ask(
        system: &mut System,
        bitmap: u16,
        count: u16,
        start: u16,
        lines: u16,
        with_bits: bool,
    ) -> [String; 4] {
        let info = system.string_block(&" ".repeat(40 + 256 * 4));
        let bits = system.string_block(&" ".repeat(256));

        system.write_far(info, &[0xee; 40 + 256 * 4]);
        system.write_far(bits, &[0xee; 256]);

        let mut header = Vec::new();

        header.extend(40u32.to_le_bytes());
        header.extend(16i32.to_le_bytes());
        header.extend(4i32.to_le_bytes());
        header.extend(1u16.to_le_bytes());
        header.extend(count.to_le_bytes());
        header.extend([0; 24]);
        system.write_far(info, &header);

        let answer = get_dibits(
            system,
            bitmap,
            start,
            lines,
            if with_bits { bits } else { 0 },
            info,
        );
        let read = system.read_far(info, 40 + 18 * 4);
        let long = |at: usize| i32::from_le_bytes(read[at..at + 4].try_into().unwrap());
        let short = |at: usize| u16::from_le_bytes([read[at], read[at + 1]]);
        let fields = format!(
            "{} {} {} {} {} {} {} {} {} {}",
            long(4),
            long(8),
            short(12),
            short(14),
            long(16),
            long(20),
            long(24),
            long(28),
            long(32),
            long(36)
        );
        let entries = match count {
            4 => 16,
            8 => 18,
            _ => 2,
        };
        let table = (0..entries)
            .map(|n| {
                let entry = &read[40 + n * 4..44 + n * 4];
                let reserved = if entry[3] == 0 {
                    String::new()
                } else {
                    format!("[{:02x}]", entry[3])
                };

                format!("{:02x}{:02x}{:02x}{reserved}", entry[0], entry[1], entry[2])
            })
            .collect::<Vec<_>>()
            .join(" ");
        let stride = (16 * usize::from(count.max(1))).div_ceil(32) * 4;
        let bits = hex(&system.read_far(bits, stride * 4 + 4), stride);

        [answer.to_string(), fields, table, bits]
    }

    /// Every record of `getdib`, as Windows wrote it.
    fn recorded() -> Vec<[String; 3]> {
        let text = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../oracle/fixtures/getdib.json"),
        )
        .unwrap();
        let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();

        fixture["records"]
            .as_array()
            .unwrap()
            .iter()
            .map(|record| {
                ["function", "args", "result"].map(|key| record[key].as_str().unwrap().to_string())
            })
            .collect()
    }

    #[test]
    fn reads_a_bitmap_back_as_windows_did() {
        let mut system = System::new();
        let (colour, mono) = bitmaps(&mut system);
        let asks = [
            ("colour-0-nobits", colour, 0, 0, 4, false),
            ("colour-4-nobits", colour, 4, 0, 4, false),
            ("colour-1", colour, 1, 0, 4, true),
            ("colour-4", colour, 4, 0, 4, true),
            ("colour-8", colour, 8, 0, 4, true),
            ("colour-24", colour, 24, 0, 4, true),
            ("colour-4-scans-1-2", colour, 4, 1, 2, true),
            ("mono-1", mono, 1, 0, 4, true),
            ("mono-4", mono, 4, 0, 4, true),
        ];
        let records = recorded();
        let mut checked = 0;

        for (name, bitmap, count, start, lines, with_bits) in asks {
            let [answer, header, table, bits] =
                ask(&mut system, bitmap, count, start, lines, with_bits);

            for [function, args, result] in &records {
                if args != name {
                    continue;
                }

                let ours = match function.as_str() {
                    "answer" => &answer,
                    "header" => &header,
                    "table" => &table,
                    _ => &bits,
                };

                assert_eq!(ours, result, "{function} {name}");
                checked += 1;
            }
        }

        assert_eq!(checked, records.len());
    }

    #[test]
    fn sets_scan_lines_from_the_bottom() {
        let mut system = System::new();
        let bitmap = create_bitmap(&mut system, 8, 4, 1, 1, 0);
        let info = system.string_block(&" ".repeat(48));
        let bits = system.string_block(&" ".repeat(16));
        let mut header = Vec::new();

        header.extend(40u32.to_le_bytes());
        header.extend(8i32.to_le_bytes());
        header.extend(4i32.to_le_bytes());
        header.extend(1u16.to_le_bytes());
        header.extend(1u16.to_le_bytes());
        header.extend([0; 24]);
        header.extend([0, 0, 0, 0, 0xff, 0xff, 0xff, 0]);
        system.write_far(info, &header);
        // Two scan lines, the second and third from the bottom.
        system.write_far(bits, &[0xf0, 0, 0, 0, 0x0f, 0, 0, 0]);

        assert_eq!(set_dibits(&mut system, bitmap, 1, 2, bits, info), 2);

        let pixels = &system.bitmap_of(bitmap).unwrap().pixels;

        assert_eq!(pixels.index_at(0, 2), Some(1));
        assert_eq!(pixels.index_at(7, 2), Some(0));
        assert_eq!(pixels.index_at(7, 1), Some(1));
        assert_eq!(pixels.index_at(0, 0), Some(0));
        assert_eq!(set_dibits(&mut system, 0x1234, 1, 2, bits, info), 0);
        assert_eq!(set_dibits(&mut system, bitmap, 1, 2, 0, info), 0);
    }

    #[test]
    fn makes_a_bitmap_of_the_context_kind() {
        let mut system = System::new();
        let screen = create_dc(&mut system, b"DISPLAY").unwrap();
        let info = system.string_block(&" ".repeat(48));
        let bits = system.string_block(&" ".repeat(16));
        let mut header = Vec::new();

        header.extend(40u32.to_le_bytes());
        header.extend(2i32.to_le_bytes());
        header.extend((-1i32).to_le_bytes());
        header.extend(1u16.to_le_bytes());
        header.extend(1u16.to_le_bytes());
        header.extend([0; 24]);
        header.extend([0, 0, 0xff, 0, 0, 0xff, 0, 0]);
        system.write_far(info, &header);
        system.write_far(bits, &[0x40, 0, 0, 0]);

        let blank = create_dibitmap(&mut system, screen, info, 0, bits, info);
        let made = create_dibitmap(&mut system, screen, info, CBM_INIT, bits, info);
        let pixels = &system.bitmap_of(made).unwrap().pixels;

        assert_eq!(system.bitmap_of(blank).unwrap().pixels.height(), 1);
        assert_eq!((pixels.depth, pixels.width(), pixels.height()), (4, 2, 1));
        // Red, then green, as the display's own.
        let palette = pixels.device_palette.borrow();

        assert_eq!(
            palette.colours[usize::from(pixels.index_at(0, 0).unwrap())],
            [255, 0, 0]
        );
        assert_eq!(
            palette.colours[usize::from(pixels.index_at(1, 0).unwrap())],
            [0, 255, 0]
        );
        drop(palette);
        assert_eq!(create_dibitmap(&mut system, 0, info, 0, 0, 0), 0);
        assert_eq!(create_dibitmap(&mut system, screen, 0, 0, 0, 0), 0);
    }
}
