//! GDI's device-independent helpers for drivers, ordinals 201 to 220, and
//! GDI's `ScanLR`. The twin of `src/win16/gdi/driver-helpers.ts`, where
//! the read-outs are told: `GDI.EXE` seg13, each `DM` routine a jump to
//! `Brute` (seg13 `0171`), which calls the display driver's routine of the
//! same offset for a memory bitmap and answers nought and the
//! offset for any other device; `VGA.DRV`'s `ColorInfo`, `Pixel`,
//! `ScanLR` and `EnumObj` for a memory bitmap here, and its drawing in
//! `driver_bitmap.rs`, on the VGA, the Super VGA and the EGA; on the
//! Hercules and the 256-colour display, nought.
//!
//! **Recorded** by `gdidm`, `gdidmdrw`, `gdiint` and `scanscr`.

use winbox_cpu::{AX, DS, ES, SS};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::system::System;

use super::calls::enum_objects::enumerated_objects;
use super::dc::{DcBitmap, dc_of};
use super::driver_bitmap::{self, MONO_WHITE, family_of, flags_of, matched_of, physical_of};
use super::objects::GdiObject;

/// The word at 8 of a bitmap of the display's four planes of a bit each.
const FOUR_PLANES: u16 = 0x0104;

/// What `Pixel` answers for a pixel of a monochrome bitmap (seg7 `01fe`).
const MONO_BLACK: u32 = 0x2000_0000;
const MONO_WHITE_PHYSICAL: u32 = 0x3fff_ffff;

/// What `Pixel` and `ScanLR` answer for a point off the bitmap.
const OFF_PIXEL: u32 = 0x8000_0000;
const OFF_SCAN: u16 = 0x8000;

/// The display driver's routines `Brute` reaches, by their offset in its
/// table.
const BIT_BLT: u16 = 0x00;
const COLOR_INFO: u16 = 0x04;
const ENUM_OBJ: u16 = 0x18;
const OUTPUT: u16 = 0x1c;
const PIXEL: u16 = 0x20;
const REALIZE_OBJECT: u16 = 0x24;
const SCAN_LR: u16 = 0x2c;
const EXT_TEXT_OUT: u16 = 0x34;
const GET_CHAR_WIDTH: u16 = 0x38;
const DEVICE_BITMAP_BITS: u16 = 0x48;
const DIB_TO_DEVICE: u16 = 0x50;
const STRETCH_BLT: u16 = 0x68;
const STRETCH_DIBITS: u16 = 0x6c;

/// Where `VGA.DRV`'s `EnumObj` lays each object, up the stack from the
/// procedure's entry (seg5 `01d2`).
const PEN_AT: u16 = 0x16;
const SOLID_AT: u16 = 0x14;
const HATCHED_AT: u16 = 0x16;

/// A memory bitmap as a driver is handed it.
struct DriverBitmap {
    width: u16,
    height: u16,
    width_bytes: u16,
    format: u16,
    bits: u32,
    segment_index: u16,
    scan_segment: u16,
}

fn offset_by(far: u32, at: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff)
}

fn read16(system: &System, far: u32, at: u32) -> u16 {
    let bytes = system.read_far(offset_by(far, at), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn read8(system: &System, far: u32, at: u32) -> u8 {
    system.read_far(offset_by(far, at), 1)[0]
}

fn write8(system: &mut System, far: u32, at: u32, value: u8) {
    system.write_far(offset_by(far, at), &[value]);
}

fn read_bitmap(system: &System, far: u32) -> DriverBitmap {
    DriverBitmap {
        width: read16(system, far, 2),
        height: read16(system, far, 4),
        width_bytes: read16(system, far, 6),
        format: read16(system, far, 8),
        bits: u32::from(read16(system, far, 0x0c)) << 16 | u32::from(read16(system, far, 0x0a)),
        segment_index: read16(system, far, 0x16),
        scan_segment: read16(system, far, 0x18),
    }
}

/// Whether WinBox has the display driver's routines: the VGA's.
fn vga(system: &System) -> bool {
    family_of(system).is_some()
}

impl DriverBitmap {
    fn planes(&self) -> u32 {
        if self.format == FOUR_PLANES { 4 } else { 1 }
    }

    /// Where a row starts (`VGA.DRV` seg7 `00e2`-`011a`).
    fn row(&self, y: u16) -> u32 {
        let mut segment = self.bits >> 16;
        let mut row = u32::from(y);

        if self.segment_index != 0 && self.scan_segment != 0 {
            let segments = row / u32::from(self.scan_segment);

            segment = (segment + segments * u32::from(self.segment_index)) & 0xffff;
            row -= segments * u32::from(self.scan_segment);
        }

        let offset = (self.bits & 0xffff) + row * self.planes() * u32::from(self.width_bytes);

        segment << 16 | (offset & 0xffff)
    }

    /// The bits of a pixel, one a plane.
    fn pixel(&self, system: &System, x: u16, y: u16) -> u8 {
        let row = self.row(y);
        let mask = 0x80 >> (x & 7);

        (0..self.planes()).fold(0, |value, plane| {
            let at = plane * u32::from(self.width_bytes) + u32::from(x >> 3);

            if read8(system, row, at) & mask != 0 {
                value | 1 << plane
            } else {
                value
            }
        })
    }

    /// What a physical colour is as a pixel's bits.
    fn bits_of(&self, physical: u32) -> u8 {
        let top = (physical >> 24) as u8;

        if self.format == FOUR_PLANES {
            top & 0xf
        } else {
            u8::from(top & MONO_WHITE != 0)
        }
    }
}

/// `ColorInfo` (`VGA.DRV` seg1 `18f8`).
fn color_info(system: &mut System, device: u32, colour: u32, buffer: u32) -> u32 {
    let mut physical = colour;

    if buffer != 0 {
        physical = physical_of(system, matched_of(system, colour));
        system.write_far(buffer, &physical.to_le_bytes());
    }

    if read16(system, device, 8) == FOUR_PLANES {
        physical & 0x00ff_ffff
    } else if (physical >> 24) as u8 & MONO_WHITE != 0 {
        0x00ff_ffff
    } else {
        0
    }
}

/// `Pixel` on a memory bitmap (`VGA.DRV` seg7 `0088`).
fn pixel(system: &mut System, device: u32, x: u16, y: u16, physical: u32, draw_mode: u32) -> u32 {
    let bitmap = read_bitmap(system, device);

    if x >= bitmap.width || y >= bitmap.height {
        return OFF_PIXEL;
    }

    if draw_mode == 0 {
        let value = bitmap.pixel(system, x, y);

        return if bitmap.format == FOUR_PLANES {
            physical_of(system, value)
        } else if value != 0 {
            MONO_WHITE_PHYSICAL
        } else {
            MONO_BLACK
        };
    }

    let rop = read16(system, draw_mode, 0).wrapping_sub(1) & 0xf;
    let pen = bitmap.bits_of(physical);
    let row = bitmap.row(y);
    let mask = 0x80 >> (x & 7);

    for plane in 0..bitmap.planes() {
        let at = plane * u32::from(bitmap.width_bytes) + u32::from(x >> 3);
        let byte = read8(system, row, at);
        let there = u16::from(byte & mask != 0);
        let bit = rop >> ((u16::from((pen >> plane) & 1) << 1) | there) & 1;

        write8(
            system,
            row,
            at,
            if bit != 0 { byte | mask } else { byte & !mask },
        );
    }

    0
}

/// `ScanLR` along a row of pixels: from `x`, to the right or with style
/// bit 1 to the left, the first that is not the colour or with style bit 0
/// that is; -1 where the row ends first.
fn scan(width: u16, x: u16, style: u16, mut matches: impl FnMut(u16) -> bool) -> u16 {
    let equal = style & 1 != 0;
    let mut at = i32::from(x);

    while at >= 0 && at < i32::from(width) {
        if matches(at as u16) == equal {
            return at as u16;
        }

        at += if style & 2 != 0 { -1 } else { 1 };
    }

    0xffff
}

/// `ScanLR` on a memory bitmap (`VGA.DRV` seg5 `02aa`).
fn scan_bitmap(system: &System, device: u32, x: u16, y: u16, physical: u32, style: u16) -> u16 {
    let bitmap = read_bitmap(system, device);

    if y >= bitmap.height || x >= bitmap.width {
        return OFF_SCAN;
    }

    let colour = bitmap.bits_of(physical);

    scan(bitmap.width, x, style, |at| {
        bitmap.pixel(system, at, y) == colour
    })
}

/// What `Brute` answers for a device that is not a memory bitmap (seg13
/// `0218`-`0224`): AX nought, as the device's check left it, and the
/// routine's offset in DX. **Recorded** by `gdidm` (DX) and `ugaps` (AX).
fn not_bitmap(_system: &mut System, offset: u16) -> u32 {
    u32::from(offset) << 16
}

/// `Brute`'s choice (seg13 `0171`): `None` for a memory bitmap, where the
/// display driver's routine answers; else its answer for any other device.
fn brute(system: &mut System, device: u32, offset: u16) -> Option<u32> {
    if read16(system, device, 0) != 0 {
        Some(not_bitmap(system, offset))
    } else {
        None
    }
}

/// A helper whose display driver's routine WinBox has not: nought for a
/// memory bitmap, `Brute`'s answer for anything else. Its arguments are
/// taken off as the table says.
fn unfollowed(system: &mut System, args: &mut Args, offset: u16, dword: bool) -> Answer {
    let device = args.dword(system);
    let answer = brute(system, device, offset).unwrap_or(0);

    if dword {
        Answer::Dword(answer)
    } else {
        Answer::Word(answer as u16)
    }
}

fn dm_bit_blt(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let x = args.word(system);
    let y = args.word(system);
    let source = args.dword(system);
    let sx = args.word(system);
    let sy = args.word(system);
    let width = args.word(system);
    let height = args.word(system);
    let rop = args.dword(system);
    let brush = args.dword(system);
    let draw_mode = args.dword(system);
    let answer = match brute(system, device, BIT_BLT) {
        Some(answer) => answer,
        None if vga(system) => driver_bitmap::bit_blt(
            system, device, x, y, source, sx, sy, width, height, rop, brush, draw_mode,
        ),
        None => 0,
    };

    Ok(Answer::Word(answer as u16))
}

fn dm_output(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let style = args.word(system);
    let count = args.word(system);
    let points = args.dword(system);
    let pen = args.dword(system);
    let brush = args.dword(system);
    let draw_mode = args.dword(system);
    let clip = args.dword(system);
    let answer = match brute(system, device, OUTPUT) {
        Some(answer) => answer,
        None if vga(system) => driver_bitmap::output(
            system, device, style, count, points, pen, brush, draw_mode, clip,
        ),
        None => 0,
    };

    Ok(Answer::Word(answer as u16))
}

fn dm_realize_object(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let style = args.word(system);
    let input = args.dword(system);
    let out = args.dword(system);
    let xform = args.dword(system);
    let answer = match brute(system, device, REALIZE_OBJECT) {
        Some(answer) => answer,
        None if vga(system) => driver_bitmap::realize_object(system, style, input, out, xform),
        None => 0,
    };

    Ok(Answer::Dword(answer))
}

/// `DMExtTextOut` and `DMStrBlt`'s common part: the display driver's
/// `ExtTextOut` on a memory bitmap, the last three arguments nought for
/// `StrBlt`.
fn text_out(system: &mut System, args: &mut Args, extended: bool) -> Answer {
    let device = args.dword(system);
    let x = args.word(system);
    let y = args.word(system);
    let clip = args.dword(system);
    let string = args.dword(system);
    let count = args.word(system);
    let font = args.dword(system);
    let draw_mode = args.dword(system);
    let xform = args.dword(system);
    let (widths, opaque, options) = if extended {
        (args.dword(system), args.dword(system), args.word(system))
    } else {
        (0, 0, 0)
    };
    let answer = match brute(system, device, EXT_TEXT_OUT) {
        Some(answer) => answer,
        None if vga(system) => driver_bitmap::ext_text_out(
            system, device, x, y, clip, string, count, font, draw_mode, xform, widths, opaque,
            options,
        ),
        None => 0,
    };

    Answer::Dword(answer)
}

fn dm_ext_text_out(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(text_out(system, args, true))
}

/// `DMStrBlt` (seg13 `00df`): `DMExtTextOut` with five words of nought
/// after its own arguments.
fn dm_str_blt(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(text_out(system, args, false))
}

fn dm_get_char_width(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let buffer = args.dword(system);
    let first = args.word(system);
    let last = args.word(system);
    let font = args.dword(system);
    let _draw_mode = args.dword(system);
    let xform = args.dword(system);
    let answer = match brute(system, device, GET_CHAR_WIDTH) {
        Some(answer) => answer,
        None if vga(system) => {
            driver_bitmap::get_char_width(system, buffer, first, last, font, xform)
        }
        None => 0,
    };

    Ok(Answer::Word(answer as u16))
}

fn dm_stretch_blt(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(unfollowed(system, args, STRETCH_BLT, false))
}

fn dm_dib_bits(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let get = args.word(system);
    let start = args.word(system);
    let scans = args.word(system);
    let bits = args.dword(system);
    let info = args.dword(system);
    let _draw_mode = args.dword(system);
    let _translate = args.dword(system);
    let answer = match brute(system, device, DEVICE_BITMAP_BITS) {
        Some(answer) => answer,
        None if vga(system) => {
            driver_bitmap::device_bitmap_bits(system, device, get, start, scans, bits, info)
        }
        None => 0,
    };

    Ok(Answer::Word(answer as u16))
}

fn dm_stretch_dibits(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(unfollowed(system, args, STRETCH_DIBITS, false))
}

fn dm_set_dib_to_dev(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let answer = match brute(system, device, DIB_TO_DEVICE) {
        Some(answer) => answer,
        None if vga(system) => driver_bitmap::dib_to_device(),
        None => 0,
    };

    Ok(Answer::Word(answer as u16))
}

fn dm_color_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let colour = args.dword(system);
    let buffer = args.dword(system);
    let answer = match brute(system, device, COLOR_INFO) {
        Some(answer) => answer,
        None if vga(system) => color_info(system, device, colour, buffer),
        None => 0,
    };

    Ok(Answer::Dword(answer))
}

fn dm_pixel(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let x = args.word(system);
    let y = args.word(system);
    let physical = args.dword(system);
    let draw_mode = args.dword(system);
    let answer = match brute(system, device, PIXEL) {
        Some(answer) => answer,
        None if vga(system) => pixel(system, device, x, y, physical, draw_mode),
        None => 0,
    };

    Ok(Answer::Dword(answer))
}

fn dm_scan_lr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let device = args.dword(system);
    let x = args.word(system);
    let y = args.word(system);
    let physical = args.dword(system);
    let style = args.word(system);
    let answer = match brute(system, device, SCAN_LR) {
        Some(answer) => answer as u16,
        None if vga(system) => scan_bitmap(system, device, x, y, physical, style),
        None => 0,
    };

    Ok(Answer::Word(answer))
}

/// `DMEnumObj`: `VGA.DRV`'s `EnumObj` (seg5 `01d2`) for a memory bitmap.
fn dm_enum_obj(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (objects, procedure, data) = {
            let mut system = engine.system();
            let device = args.dword(&system);
            let style = args.signed(&system);
            let procedure = args.dword(&system);
            let data = args.dword(&system);

            match brute(&mut system, device, ENUM_OBJ) {
                Some(answer) => return Ok(Answer::Word(answer as u16)),
                None if !vga(&system) => return Ok(Answer::Word(0)),
                None => {}
            }

            let (pens, brushes) = enumerated_objects(&system, style);
            let objects: Vec<(Vec<u8>, u16)> = pens
                .into_iter()
                .map(|pen| (pen.bytes(), PEN_AT))
                .chain(brushes.into_iter().map(|brush| {
                    let at = if brush.style == 0 {
                        SOLID_AT
                    } else {
                        HATCHED_AT
                    };

                    (brush.bytes(), at)
                }))
                .collect();

            (objects, procedure, data)
        };

        if objects.is_empty() {
            return Ok(Answer::Word(1));
        }

        let mut answer = 0;

        for (bytes, at) in objects {
            let registers = {
                let system = engine.system();
                let stack = system.cpu.segments[SS].selector;

                [
                    Register::Word(AX, stack),
                    Register::Segment(DS, stack),
                    Register::Segment(ES, stack),
                ]
            };
            let (result, _) = engine
                .call_with(
                    procedure,
                    &[GuestArg::Placed(bytes, at), GuestArg::Long(data)],
                    &registers,
                )
                .await?;

            answer = result as u16;

            if answer == 0 {
                return Ok(Answer::Word(0));
            }
        }

        Ok(Answer::Word(answer))
    })
}

/// `DMTranspose` (seg13 `024d`): eight rows of a monochrome bitmap turned
/// into columns, a stride apart, from the eighth row up for a stride below
/// nought; one column for a stride of nought.
fn dm_transpose(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let from = args.dword(system);
    let to = args.dword(system);
    let stride = i32::from(args.signed(system));
    let columns = stride.unsigned_abs();
    let start = if stride < 0 { 7 * columns } else { 0 };
    let mut written = 0;

    for column in 0..columns.max(1) {
        let rows: Vec<u8> = (0..8)
            .map(|row| {
                let at = (start + column) as i32 + row * stride;

                read8(system, from, at as u32)
            })
            .collect();

        for bit in (0..8).rev() {
            let byte = rows.iter().enumerate().fold(0u8, |byte, (row, value)| {
                byte | ((value >> bit) & 1) << (7 - row)
            });

            write8(system, to, written, byte);
            written += 1;
        }
    }

    Ok(Answer::Nothing)
}

/// GDI's `ScanLR` (seg15 `087f`): -1 for a context of nought, nought for
/// anything WinBox does not follow; the VGA's and the EGA's driver's scan
/// (`family_of`), read from WinBox's own pixels:
///
/// * A memory context's bitmap of the display's format or of one plane.
/// * A window's context or the screen's: the screen's own `ScanLR`, the
///   point moved by the context's origin on the screen and the answer the
///   screen's x. The whole row of the screen is scanned, whatever windows
///   are over it or the context's region (**recorded** by `scanscr`).
fn scan_lr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let x = i32::from(args.signed(system));
    let y = i32::from(args.signed(system));
    let colour = args.dword(system);
    let style = args.word(system);

    if hdc == 0 {
        return Ok(Answer::Word(0xffff));
    }

    let Some(dc) = dc_of(system, hdc) else {
        return Ok(Answer::Word(0));
    };

    if !vga(system) {
        return Ok(Answer::Word(0));
    }

    let (x, y) = match super::draw::mapped(system, dc) {
        Some(mapping) => super::draw::device_point(&mapping, x, y),
        None => (x, y),
    };
    let index = matched_of(system, colour);
    let (pixels, x, y) = match system.gdi.dcs[dc].bitmap {
        DcBitmap::Bitmap(object) => {
            let GdiObject::Bitmap(bitmap) = &system.gdi.objects[object] else {
                return Ok(Answer::Word(0));
            };

            (bitmap.pixels.clone(), x, y)
        }
        DcBitmap::Screen | DcBitmap::Window(_) | DcBitmap::Whole(_) => {
            let (left, top) = super::dc::origin_of(system, dc);

            (system.screen_bitmap(), x + left, y + top)
        }
    };
    let colour = match pixels.depth {
        1 => u8::from(flags_of(system, index) & MONO_WHITE != 0),
        4 => index,
        _ => return Ok(Answer::Word(0)),
    };
    let (width, height) = (pixels.width() as u16, pixels.height() as u16);

    if y as u16 >= height || x as u16 >= width {
        return Ok(Answer::Word(OFF_SCAN));
    }

    Ok(Answer::Word(scan(width, x as u16, style, |at| {
        pixels.index_at(i32::from(at), y) == Some(colour)
    })))
}

/// The words `Brute` moves that are not the arguments: the return address
/// and its own two (seg13 `0174`-`0187`).
const BRUTE_OWN_WORDS: u16 = 4;

/// `Brute` called as a helper jumps to it (seg13 `0171`): CH the routine's
/// offset in the display driver's table, CL the words it moves, the
/// arguments among them. The routine chosen as each helper chooses it, and
/// the arguments taken off the stack as the routine's own return takes
/// them. **Recorded** by `ugaps`.
fn brute_call(engine: &Engine, _args: Args) -> Later<'_> {
    Box::pin(async move {
        let (offset, bytes, stack, sp) = {
            let system = engine.system();
            let cx = system.cpu.regs[winbox_cpu::CX];
            let bytes = u32::from((cx & 0xff).saturating_sub(BRUTE_OWN_WORDS)) * 2;

            (
                cx >> 8,
                bytes,
                system.cpu.segments[SS].base,
                system.cpu.regs[winbox_cpu::SP],
            )
        };
        let mut args = Args::on_stack(stack, u32::from(sp) + 4, bytes);
        let answer = if offset == ENUM_OBJ {
            dm_enum_obj(engine, args).await?
        } else {
            let mut system = engine.system();

            match offset {
                COLOR_INFO => dm_color_info(&mut system, &mut args)?,
                PIXEL => dm_pixel(&mut system, &mut args)?,
                SCAN_LR => dm_scan_lr(&mut system, &mut args)?,
                _ => {
                    let device = if bytes >= 4 {
                        args.above(&system, bytes - 4)
                    } else {
                        0
                    };

                    Answer::Dword(brute(&mut system, device, offset).unwrap_or(0))
                }
            }
        };

        // The arguments taken off, the return address moved above them.
        let mut system = engine.system();
        let at = |offset: u16| stack + u32::from(offset);
        let ip = system.cpu.bus.read16(at(sp));
        let cs = system.cpu.bus.read16(at(sp.wrapping_add(2)));
        let top = sp.wrapping_add(bytes as u16);

        system.cpu.bus.write16(at(top), ip);
        system.cpu.bus.write16(at(top.wrapping_add(2)), cs);
        system.cpu.regs[winbox_cpu::SP] = top;

        Ok(Answer::Dword(answer.value().unwrap_or(0)))
    })
}

pub fn implementation(name: &str) -> Option<Implementation> {
    if name == "DMEnumObj" {
        return Some(Implementation::Async(dm_enum_obj));
    }

    if name == "Brute" {
        return Some(Implementation::Async(brute_call));
    }

    Some(Implementation::Sync(match name {
        "DMBitBlt" => dm_bit_blt,
        "DMColorInfo" => dm_color_info,
        "DMOutput" => dm_output,
        "DMPixel" => dm_pixel,
        "DMRealizeObject" => dm_realize_object,
        "DMStrBlt" => dm_str_blt,
        "DMScanLR" => dm_scan_lr,
        "DMExtTextOut" => dm_ext_text_out,
        "DMGetCharWidth" => dm_get_char_width,
        "DMStretchBlt" => dm_stretch_blt,
        "DMDibBits" => dm_dib_bits,
        "DMStretchDIBits" => dm_stretch_dibits,
        "DMSetDibToDev" => dm_set_dib_to_dev,
        "DMTranspose" => dm_transpose,
        "ScanLR" => scan_lr,
        _ => return None,
    }))
}
