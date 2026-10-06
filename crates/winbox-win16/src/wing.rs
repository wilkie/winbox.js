//! WinG, Microsoft's 1994 library for drawing fast into device-independent
//! bitmaps, given away for Windows 3.1: a program draws into a bitmap's
//! bits itself and blits them to its window. Answered here for `WING.DLL`,
//! with no file of it on the disk, as winbox.js's `wing.ts` answers it.
//!
//! **Recorded** by `wingapi` and `wingprof` on the 256-colour display with
//! WinG installed (`install-wing.mjs`):
//!
//! * `WinGRecommendedDIBFormat` answers 1 and an 8-bit header, 1 by 1 and
//!   bottom-up (a height of 1), uncompressed.
//! * `WinGCreateDC` makes a device context of WinG's own DIB driver: its
//!   `GetDeviceCaps` answer 24 bits a pixel, one plane, `NUMCOLORS` 16 and
//!   `RASTERCAPS` `ee99`, and its first bitmap is 1 by 1.
//! * `WinGCreateBitmap` makes a bitmap of the header's size, 8 bits a
//!   pixel, and answers a pointer to its bits, rows a whole number of double
//!   words, the bottom row first where the height is above nought. The bits
//!   are the picture: plain memory, which the program writes and GDI draws
//!   on alike. `GetPixel` answers the colour table's own colour for each
//!   index, and black past the table's end. `WinGGetDIBPointer` answers the
//!   same pointer and the header.
//! * `WinGSetDIBColorTable` and `WinGGetDIBColorTable`, of the bitmap
//!   selected into a WinG device context, answer how many entries they took.
//! * `WinGBitBlt` and `WinGStretchBlt` copy, the colours as any bitmap's
//!   become the screen's: with no palette realized, the nearest static
//!   colour.
//! * `WinGCreateHalftonePalette` makes a palette of 256: the static colours
//!   at either end, and between them WinG's own, each `PC_NOCOLLAPSE`.
//!
//! Not followed: `WinGCreateHalftoneBrush`, whose dither is recorded but not
//! worked out; it makes no brush.
//!
//! The TypeScript engine's bitmap is a view of the memory itself. Here the
//! pixels are a bitmap's own, made to agree with the memory around every
//! call -- read from it before, where the program changed it, and written
//! back after, where the call drew -- which no program can tell apart.

// Every call answers as `Implementation::Sync` takes one, whether or not
// it can stop.
#![allow(clippy::unnecessary_wraps)]

use std::cell::RefCell;
use std::rc::Rc;

use winbox_machine::{handle_for, index_for, segment_selector};
use winbox_raster::{DeviceBitmap, DevicePalette};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::gdi::GdiObject;
use crate::gdi::dc::{DcBitmap, dc_of};
use crate::gdi::objects::Palette;
use crate::handles::Object;
use crate::system::System;

/// What `GetDeviceCaps` answers of a WinG device context in place of the
/// display's: `BITSPIXEL`, `PLANES`, `NUMCOLORS` and `RASTERCAPS`.
pub const WING_CAPS: (i32, i32, i32, i32) = (24, 1, 16, 0xee99);

const SRCCOPY: u32 = 0x00cc_0020;

/// A bitmap of WinG's: its object, its header as `WinGGetDIBPointer`
/// answers it, its bits' block and their pointer, and how the rows lie in
/// it -- with what the memory held when last made to agree.
#[derive(Debug, Clone)]
pub struct WinGBitmap {
    pub object: usize,
    pub header: [u32; 7],
    pub bits: u16,
    pub pointer: u32,
    width: usize,
    rows: usize,
    stride: usize,
    bottom_up: bool,
    shadow: Vec<u8>,
}

impl WinGBitmap {
    /// Where row `y`, counted from the top, starts in the bits.
    fn row(&self, y: usize) -> usize {
        if self.bottom_up {
            (self.rows - 1 - y) * self.stride
        } else {
            y * self.stride
        }
    }

    /// The linear address of the bits, where their block is now.
    fn linear(&self) -> u32 {
        (index_for(self.bits) as u32) << 16
    }
}

impl System {
    fn read32(&self, far: u32, at: u32) -> u32 {
        let bytes = self.read_far(far.wrapping_add(at), 4);

        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    }

    /// A `BITMAPINFOHEADER` written: size, width, height, planes and bits,
    /// compression, and colours used; the rest noughts.
    fn write_header(&mut self, far: u32, fields: [u32; 7]) {
        let [size, width, height, planes, bits, compression, used] = fields;
        let mut header = [0u8; 40];

        header[0..4].copy_from_slice(&size.to_le_bytes());
        header[4..8].copy_from_slice(&width.to_le_bytes());
        header[8..12].copy_from_slice(&height.to_le_bytes());
        header[12] = planes as u8;
        header[14] = bits as u8;
        header[16..20].copy_from_slice(&compression.to_le_bytes());
        header[32..36].copy_from_slice(&used.to_le_bytes());
        self.write_far(far, &header);
    }

    /// The WinG bitmap selected into a device context, if it is one.
    fn wing_selected(&self, hdc: u16) -> Option<usize> {
        let dc = dc_of(self, hdc)?;
        let DcBitmap::Bitmap(object) = self.gdi.dcs[dc].bitmap else {
            return None;
        };

        self.wing_bitmaps
            .iter()
            .position(|wing| wing.object == object)
    }

    fn wing_pixels(&self, at: usize) -> Option<DeviceBitmap> {
        match &self.gdi.objects[self.wing_bitmaps[at].object] {
            GdiObject::Bitmap(bitmap) => Some(bitmap.pixels.clone()),
            _ => None,
        }
    }

    fn wing_live(&self, at: usize) -> bool {
        self.handles
            .lookup(Object::Gdi(self.wing_bitmaps[at].object))
            .is_some()
    }

    /// Before a call: each WinG bitmap's pixels read from its bits, where
    /// the program changed them since.
    pub(crate) fn wing_before_call(&mut self) {
        for at in 0..self.wing_bitmaps.len() {
            if !self.wing_live(at) {
                continue;
            }

            let wing = &self.wing_bitmaps[at];
            let bytes = self.cpu.bus.read(wing.linear(), wing.shadow.len());

            if same_bytes(&bytes, &wing.shadow) {
                continue;
            }

            if let Some(pixels) = self.wing_pixels(at) {
                let wing = &self.wing_bitmaps[at];
                let mut indices = pixels.indices.borrow_mut();

                for y in 0..wing.rows {
                    let from = wing.row(y);

                    indices[y * wing.width..(y + 1) * wing.width]
                        .copy_from_slice(&bytes[from..from + wing.width]);
                }
            }

            self.wing_bitmaps[at].shadow = bytes;
        }
    }

    /// After a call: each WinG bitmap's bits written from its pixels, where
    /// the call drew on them.
    pub(crate) fn wing_after_call(&mut self) {
        for at in 0..self.wing_bitmaps.len() {
            if !self.wing_live(at) {
                continue;
            }

            let Some(pixels) = self.wing_pixels(at) else {
                continue;
            };
            let wing = &self.wing_bitmaps[at];
            let indices = pixels.indices.borrow();
            let row_of = |y: usize| &indices[y * wing.width..(y + 1) * wing.width];
            // Only where a row is not as its shadow has it did the call draw.
            let drawn = (0..wing.rows).any(|y| {
                let to = wing.row(y);

                !same_bytes(&wing.shadow[to..to + wing.width], row_of(y))
            });

            if drawn {
                let mut bytes = wing.shadow.clone();

                for y in 0..wing.rows {
                    let to = wing.row(y);

                    bytes[to..to + wing.width].copy_from_slice(row_of(y));
                }

                let linear = wing.linear();

                drop(indices);
                self.cpu.bus.write(linear, &bytes);
                self.wing_bitmaps[at].shadow = bytes;
            }
        }
    }
}

/// Whether two runs of bytes are the same: a WinG bitmap's bits are set
/// beside their shadow at every call. WebAssembly's own comparison of
/// memory goes a byte at a time, so there they are set side by side eight
/// at a time, some fivefold faster; a native host's own comparison is
/// faster still. Either way the answer is the same.
fn same_bytes(a: &[u8], b: &[u8]) -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        if a.len() != b.len() {
            return false;
        }

        let (words, others) = (a.chunks_exact(8), b.chunks_exact(8));
        let (rest, other_rest) = (words.remainder(), others.remainder());
        let word = |bytes: &[u8]| {
            let mut word = [0; 8];

            word.copy_from_slice(bytes);
            u64::from_ne_bytes(word)
        };

        words.zip(others).all(|(one, two)| word(one) == word(two)) && rest == other_rest
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        a == b
    }
}

fn wing_create_dc(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let hdc = crate::gdi::dc::create_compatible_dc(system, 0);

    if let Some(dc) = dc_of(system, hdc) {
        system.gdi.dcs[dc].wing = true;
    }

    Ok(Answer::Word(hdc))
}

fn wing_recommended_dib_format(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    system.write_header(far, [40, 1, 1, 1, 8, 0, 0]);
    Ok(Answer::Word(1))
}

fn wing_create_bitmap(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _hdc = args.word(system);
    let header = args.dword(system);
    let bits_far = args.dword(system);

    if header == 0 {
        return Ok(Answer::Word(0));
    }

    let width = system.read32(header, 4) as i32;
    let height = system.read32(header, 8) as i32;
    let bit_count = system.read_far(header.wrapping_add(14), 1)[0];
    let declared = system.read32(header, 32);
    let used = if declared == 0 { 256 } else { declared };

    if width <= 0 || height == 0 || bit_count != 8 {
        return Ok(Answer::Word(0));
    }

    let rows = height.unsigned_abs() as usize;
    let width = width as usize;
    let stride = (width + 3) & !3;
    let size = stride * rows;

    // Its colours, the table's, black past its end.
    let table = system.read_far(header.wrapping_add(40), 256 * 4);
    let colours = (0..256)
        .map(|index| {
            if (index as u32) < used {
                [table[index * 4 + 2], table[index * 4 + 1], table[index * 4]]
            } else {
                [0, 0, 0]
            }
        })
        .collect();
    let Some(block) = system.global.allocate(
        &mut system.cpu.bus,
        &mut system.descriptors,
        size as u32,
        0x0002,
    ) else {
        return Ok(Answer::Word(0));
    };
    let bits = handle_for(block);
    let linear = (index_for(bits) as u32) << 16;

    // Nought, as a new bitmap is.
    system.cpu.bus.write(linear, &vec![0; size]);

    let pixels = DeviceBitmap::new(
        width as i32,
        rows as i32,
        8,
        Some(Rc::new(RefCell::new(vec![0; width * rows]))),
        Some(Rc::new(RefCell::new(DevicePalette::table(
            colours,
            used.min(256) as usize,
        )))),
    );
    let handle = system.gdi_allocate(GdiObject::Bitmap(Box::new(crate::gdi::ddb::Bitmap {
        pixels,
        padding: None,
        dimension: None,
    })));
    let Some(Object::Gdi(object)) = system.handles.resolve(handle) else {
        return Ok(Answer::Word(0));
    };
    let pointer = u32::from(segment_selector(index_for(bits))) << 16;

    system.wing_bitmaps.push(WinGBitmap {
        object,
        header: [40, width as u32, height as u32, 1, 8, 0, declared],
        bits,
        pointer,
        width,
        rows,
        stride,
        bottom_up: height > 0,
        shadow: vec![0; size],
    });

    if bits_far != 0 {
        system.write_far(bits_far, &pointer.to_le_bytes());
    }

    Ok(Answer::Word(handle))
}

fn wing_get_dib_pointer(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let header = args.dword(system);
    let Some(Object::Gdi(object)) = system.handles.resolve(handle) else {
        return Ok(Answer::Dword(0));
    };
    let Some(wing) = system
        .wing_bitmaps
        .iter()
        .find(|wing| wing.object == object)
        .cloned()
    else {
        return Ok(Answer::Dword(0));
    };

    if header != 0 {
        system.write_header(header, wing.header);
    }

    Ok(Answer::Dword(wing.pointer))
}

fn wing_get_dib_color_table(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let start = usize::from(args.word(system));
    let count = usize::from(args.word(system));
    let far = args.dword(system);
    let Some(at) = system.wing_selected(hdc) else {
        return Ok(Answer::Word(0));
    };
    let Some(pixels) = system.wing_pixels(at) else {
        return Ok(Answer::Word(0));
    };
    let colours = pixels.device_palette.borrow().colours.clone();
    let taken = count.min(colours.len().saturating_sub(start));
    let bytes: Vec<u8> = colours[start..start + taken]
        .iter()
        .flat_map(|&[red, green, blue]| [blue, green, red, 0])
        .collect();

    system.write_far(far, &bytes);
    Ok(Answer::Word(taken as u16))
}

fn wing_set_dib_color_table(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let start = usize::from(args.word(system));
    let count = usize::from(args.word(system));
    let far = args.dword(system);
    let Some(at) = system.wing_selected(hdc) else {
        return Ok(Answer::Word(0));
    };
    let Some(pixels) = system.wing_pixels(at) else {
        return Ok(Answer::Word(0));
    };
    let size = pixels.device_palette.borrow().size();
    let taken = count.min(size.saturating_sub(start));
    let table = system.read_far(far, taken * 4);
    let mut palette = pixels.device_palette.borrow_mut();

    for k in 0..taken {
        palette.recolour(
            start + k,
            [table[k * 4 + 2], table[k * 4 + 1], table[k * 4]],
        );
    }

    Ok(Answer::Word(taken as u16))
}

/// WinG's halftone palette, as `wingapi` reads it back: the static
/// colours at either end, `PC_NOCOLLAPSE` between.
fn wing_create_halftone_palette(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let entries = HALFTONE
        .iter()
        .enumerate()
        .map(|(index, &rgb)| {
            [
                (rgb >> 16) as u8,
                (rgb >> 8) as u8,
                rgb as u8,
                if (10..246).contains(&index) { 0x04 } else { 0 },
            ]
        })
        .collect();

    Ok(Answer::Word(system.gdi_allocate(GdiObject::Palette(
        Palette {
            entries: Some(entries),
            slots: None,
            taken: None,
        },
    ))))
}

fn wing_create_halftone_brush(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _hdc = args.word(system);
    let _colour = args.dword(system);
    let _kind = args.signed(system);

    Ok(Answer::Word(0))
}

fn wing_bit_blt(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let rect = [(); 4].map(|()| i32::from(args.signed(system)));
    let source = args.word(system);
    let sx = i32::from(args.signed(system));
    let sy = i32::from(args.signed(system));

    Ok(Answer::Word(crate::gdi::draw::bit_blt(
        system, hdc, rect, source, sx, sy, SRCCOPY,
    )))
}

fn wing_stretch_blt(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let to = [(); 4].map(|()| i32::from(args.signed(system)));
    let source = args.word(system);
    let from = [(); 4].map(|()| i32::from(args.signed(system)));

    Ok(Answer::Word(crate::gdi::draw::stretch_blt(
        system, hdc, to, source, from, SRCCOPY,
    )))
}

/// WING's calls, by name.
pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "WinGCreateDC" => wing_create_dc,
        "WinGRecommendedDIBFormat" => wing_recommended_dib_format,
        "WinGCreateBitmap" => wing_create_bitmap,
        "WinGGetDIBPointer" => wing_get_dib_pointer,
        "WinGGetDIBColorTable" => wing_get_dib_color_table,
        "WinGSetDIBColorTable" => wing_set_dib_color_table,
        "WinGCreateHalftonePalette" => wing_create_halftone_palette,
        "WinGCreateHalftoneBrush" => wing_create_halftone_brush,
        "WinGStretchBlt" => wing_stretch_blt,
        "WinGBitBlt" => wing_bit_blt,
        _ => return None,
    }))
}

/// WinG's halftone palette, `0xRRGGBB` each, as `WinGCreateHalftonePalette`
/// makes it (`wingapi`).
#[rustfmt::skip]
#[allow(clippy::unreadable_literal)]
const HALFTONE: [u32; 256] = [
    0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0xc0dcc0,
    0xa6caf0, 0x040404, 0x080808, 0x0c0c0c, 0x111111, 0x161616, 0x1c1c1c, 0x222222, 0x292929,
    0x555555, 0x4d4d4d, 0x424242, 0x393939, 0x818181, 0x810000, 0x008100, 0x818100, 0x000081,
    0x810081, 0x008181, 0x330000, 0x660000, 0x990000, 0xcc0000, 0x003300, 0x333300, 0x663300,
    0x993300, 0xcc3300, 0xff3300, 0x006600, 0x336600, 0x666600, 0x996600, 0xcc6600, 0xff6600,
    0x009900, 0x339900, 0x669900, 0x999900, 0xcc9900, 0xff9900, 0x00cc00, 0x33cc00, 0x66cc00,
    0x99cc00, 0xcccc00, 0xffcc00, 0x66ff00, 0x99ff00, 0xccff00, 0x000033, 0x330033, 0x660033,
    0x990033, 0xcc0033, 0xff0033, 0x003333, 0x333333, 0x663333, 0x993333, 0xcc3333, 0xff3333,
    0x006633, 0x336633, 0x666633, 0x996633, 0xcc6633, 0xff6633, 0x009933, 0x339933, 0x669933,
    0x999933, 0xcc9933, 0xff9933, 0x00cc33, 0x33cc33, 0x66cc33, 0x99cc33, 0xcccc33, 0xffcc33,
    0x33ff33, 0x66ff33, 0x99ff33, 0xccff33, 0xffff33, 0x000066, 0x330066, 0x660066, 0x990066,
    0xcc0066, 0xff0066, 0x003366, 0x333366, 0x663366, 0x993366, 0xcc3366, 0xff3366, 0x006666,
    0x336666, 0x666666, 0x996666, 0xcc6666, 0x009966, 0x339966, 0x669966, 0x999966, 0xcc9966,
    0xff9966, 0x00cc66, 0x33cc66, 0x99cc66, 0xcccc66, 0xffcc66, 0x00ff66, 0x33ff66, 0x99ff66,
    0xccff66, 0xff00cc, 0xcc00ff, 0x009999, 0x993399, 0x990099, 0xcc0099, 0x000099, 0x333399,
    0x660099, 0xcc3399, 0xff0099, 0x006699, 0x336699, 0x663399, 0x996699, 0xcc6699, 0xff3399,
    0x339999, 0x669999, 0x999999, 0xcc9999, 0xff9999, 0x00cc99, 0x33cc99, 0x66cc66, 0x99cc99,
    0xcccc99, 0xffcc99, 0x00ff99, 0x33ff99, 0x66cc99, 0x99ff99, 0xccff99, 0xffff99, 0x0000cc,
    0x330099, 0x6600cc, 0x9900cc, 0xcc00cc, 0x003399, 0x3333cc, 0x6633cc, 0x9933cc, 0xcc33cc,
    0xff33cc, 0x0066cc, 0x3366cc, 0x666699, 0x9966cc, 0xcc66cc, 0xff6699, 0x0099cc, 0x3399cc,
    0x6699cc, 0x9999cc, 0xcc99cc, 0xff99cc, 0x00cccc, 0x33cccc, 0x66cccc, 0x99cccc, 0xcccccc,
    0xffcccc, 0x00ffcc, 0x33ffcc, 0x66ff99, 0x99ffcc, 0xccffcc, 0xffffcc, 0x3300cc, 0x6600ff,
    0x9900ff, 0x0033cc, 0x3333ff, 0x6633ff, 0x9933ff, 0xcc33ff, 0xff33ff, 0x0066ff, 0x3366ff,
    0x6666cc, 0x9966ff, 0xcc66ff, 0xff66cc, 0x0099ff, 0x3399ff, 0x6699ff, 0x9999ff, 0xcc99ff,
    0xff99ff, 0x00ccff, 0x33ccff, 0x66ccff, 0x99ccff, 0xccccff, 0xffccff, 0x33ffff, 0x66ffcc,
    0x99ffff, 0xccffff, 0xff6666, 0x66ff66, 0xffff66, 0x6666ff, 0xff66ff, 0x66ffff, 0xc1c1c1,
    0x5f5f5f, 0x777777, 0x868686, 0x969696, 0xcbcbcb, 0xb2b2b2, 0xd7d7d7, 0xdddddd, 0xe3e3e3,
    0xeaeaea, 0xf1f1f1, 0xf8f8f8, 0xfffbf0, 0xa0a0a4, 0x808080, 0xff0000, 0x00ff00, 0xffff00,
    0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_halftone_palette_keeps_the_static_colours_at_either_end() {
        assert_eq!(HALFTONE.len(), 256);
        assert_eq!(HALFTONE[0], 0);
        assert_eq!(HALFTONE[9], 0x00a6_caf0);
        assert_eq!(HALFTONE[246], 0x00ff_fbf0);
        assert_eq!(HALFTONE[255], 0x00ff_ffff);
    }
}
