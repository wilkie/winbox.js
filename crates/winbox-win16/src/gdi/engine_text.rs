//! GDI drawing a string of a TrueType font for a printer's driver:
//! `EngineExtTextOut` given a count of nought or more (`GDI.EXE` seg1
//! `669a`, into `6223`), through the cache of glyphs GDI keeps at a
//! `FONTINFO`'s 54h. The reading out of each piece is in
//! `kb/gdi/engineexttextout.md`.

use crate::call::{Answer, Stop, call_named};
use crate::engine::{Engine, GuestArg};
use crate::system::System;

use super::engine_glyphs::{context_glyph, set_context, sine_of, width_of, widths_of};
use super::printer_blits::{blit_rects, brush_far};
use super::printer_output::{call_driver, draw_mode, kernel, on_stack, proc};

/// `dfVersion` of the cache, a `FONTINFO` flagged 80h at 33h; 200h
/// otherwise (seg3 `2f2a`).
const VERSION_3: u16 = 0x300;
const VERSION_2: u16 = 0x200;
/// The character table's start and an entry's size, by version.
const TABLE_3: u16 = 0x94;
const ENTRY_3: u16 = 6;
const TABLE_2: u16 = 0x76;
const ENTRY_2: u16 = 4;
/// Where the `FONTINFO` sits in the file: after the version, size and
/// copyright.
const FONTINFO_AT: u16 = 0x42;
const SIZE_AT: u16 = 2;
const COPYRIGHT_AT: u16 = 6;
/// The copyright GDI writes in every cache font, with its nought (seg3
/// `2f86`, 35h bytes).
const ENGINE_COPYRIGHT: &[u8] = b"MicroSoft (c) 1990 - This is an awesome engine font!";
/// The `FONTINFO`'s bytes copied into the file, `dfType` to
/// `dfWidthBytes` (`3118`).
const FONTINFO_COPIED: u16 = 0x23;
const DF_PITCH: u16 = 0x18;
const DF_FACE: u16 = 0x27;
const DF_BITS_POINTER: u16 = 0x2b;
const DF_BITS_OFFSET: u16 = 0x2f;
/// The face's name is given room of 20h bytes after the two tables
/// (`2ff6`).
const NAME_ROOM: u16 = 0x20;
/// The first character's width, and its A and C spaces, as the block
/// starts (`3146`, `315c`).
const FIRST_WIDTH: u16 = 8;
const FIRST_SPACES: u16 = 0x0800;
/// The glyph area a new block is given, by the size in points (seg3
/// `2fbb`), at least 400h.
const GLYPH_AREA_BY_POINTS: [(u16, u32); 6] =
    [(20, 20), (35, 15), (60, 10), (90, 5), (150, 3), (0xffff, 1)];
const LEAST_GLYPH_AREA: u32 = 0x400;
/// `GlobalAlloc`'s flags for the block: moveable, zeroed, shared.
const CACHE_ALLOC: u16 = 0x2042;

/// What GDI keeps of the block in the `FONTINFO` (`30ae`-`30e3`).
const FI_BLOCK: u16 = 0x54;
const FI_SCRATCH: u16 = 0x56;
const FI_SCRATCH_SIZE: u16 = 0x58;
const FI_WIDTHS: u16 = 0x5a;
const FI_SPACES: u16 = 0x5c;
const FI_SIZE: u16 = 0x5e;
const FI_GROWTH: u16 = 0x62;
const FI_NEXT: u16 = 0x66;
const FI_FREE: u16 = 0x6a;
const FI_FLAGS: u16 = 0x33;

const FLAG_TURNED: u8 = 0x10;
const FLAG_OUTLINE: u8 = 0x20;
const FLAG_FAILED: u8 = 0x40;
const FLAG_BIG: u8 = 0x80;

/// A turned glyph's header in the block, before its rows (seg1 `752d`).
const TURNED_HEADER: u16 = 12;

const DP_TEXT: usize = 0x22;
const DP_RASTER: usize = 0x26;
const RC_GDI20_OUTPUT: u16 = 0x10;
/// `PATCOPY`, the raster operation GDI fills a background with.
const PATCOPY: u32 = 0x00f0_0021;
const PS_NULL: u16 = 5;
const RC_OP_DX_OUTPUT: u16 = 0x4000;
const TC_EA_DOUBLE: u16 = 0x200;
const TEXTXFORM_ACCELERATOR: usize = 0x0f;
const OPAQUE: u16 = 2;
const TRANSPARENT: u8 = 1;
const ETO_OPAQUE: u16 = 2;
const ETO_CLIPPED: u16 = 4;

const BIT_BLT: u16 = 1;
const STR_BLT: u16 = 11;
const EXT_TEXT_OUT: u16 = 14;

/// The raster operation a turned glyph is drawn with, by the context's
/// `ROP2` less one (seg8 `020b`).
const GLYPH_ROPS: [u32; 16] = [
    0x0022_0326,
    0x00c8_06c9,
    0x002a_0c49,
    0x002e_064a,
    0x0062_0786,
    0x0066_0046,
    0x006a_01e9,
    0x006e_1e28,
    0x00a2_0e09,
    0x00a6_0706,
    0x00aa_0029,
    0x00ae_0b06,
    0x00e2_0746,
    0x00e6_1ce8,
    0x00ea_02e9,
    0x00ee_0086,
];

fn at(far: u32, offset: u16) -> u32 {
    (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(offset))
}

fn read8(system: &System, far: u32, offset: u16) -> u8 {
    system.read_far(at(far, offset), 1)[0]
}

fn read16(system: &System, far: u32, offset: u16) -> u16 {
    let bytes = system.read_far(at(far, offset), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn read32(system: &System, far: u32, offset: u16) -> u32 {
    u32::from(read16(system, far, offset)) | u32::from(read16(system, far, offset + 2)) << 16
}

fn write8(system: &mut System, far: u32, offset: u16, value: u8) {
    system.write_far(at(far, offset), &[value]);
}

fn write16(system: &mut System, far: u32, offset: u16, value: u16) {
    system.write_far(at(far, offset), &value.to_le_bytes());
}

fn write32(system: &mut System, far: u32, offset: u16, value: u32) {
    system.write_far(at(far, offset), &value.to_le_bytes());
}

/// The cache's layout for a `FONTINFO` (seg3 `2f2a`).
struct Layout {
    version: u16,
    table: u16,
    entry: u16,
    first: u8,
    last: u8,
}

fn layout_of(system: &System, font: u32) -> Layout {
    let big = read8(system, font, FI_FLAGS) & FLAG_BIG != 0;

    Layout {
        version: if big { VERSION_3 } else { VERSION_2 },
        table: if big { TABLE_3 } else { TABLE_2 },
        entry: if big { ENTRY_3 } else { ENTRY_2 },
        first: read8(system, font, 0x1d),
        last: read8(system, font, 0x1e),
    }
}

/// The cache block made for a `FONTINFO` (seg3 `2f5e`, into `2fd3`), as
/// `makeBlock`: its handle, locked, and its segment; nought where it
/// cannot be made.
async fn make_block(engine: &Engine, font: u32) -> Result<(u16, u16), Stop> {
    let (size, bits, scratch, scratch_size, widths, spaces, name, area, layout) = {
        let mut system = engine.system();
        let layout = layout_of(&system, font);
        let flags = read8(&system, font, FI_FLAGS) & !3;

        write8(&mut system, font, FI_FLAGS, flags);

        let count = u16::from(layout.last.wrapping_sub(layout.first)) + 1;
        let widths = (count + 1) * layout.entry + layout.table;
        let spaces = widths + count * 2;
        let name = spaces + count * 2;
        let scratch = name + NAME_ROOM;
        let cell = u32::from(read16(&system, font, 0x16));
        let mut scratch_size = 0;
        let mut area = LEAST_GLYPH_AREA;

        if flags & FLAG_OUTLINE == 0 {
            if flags & FLAG_TURNED == 0 {
                scratch_size =
                    (((u32::from(read16(&system, font, 0x1b)) + 0x3f) >> 3) & 0xfc) * cell;
            }

            let glyph = ((u32::from(read16(&system, font, 0x19)) + 7) >> 3) * cell;
            let points = read16(&system, font, 2);
            let times = GLYPH_AREA_BY_POINTS
                .iter()
                .find(|(below, _)| points < *below)
                .map_or(1, |(_, times)| *times);

            area = (glyph * times).max(LEAST_GLYPH_AREA);
        }

        let bits = u32::from(scratch) + scratch_size;
        let mut size = area + bits;

        if size > 0xffff && layout.version < VERSION_3 {
            size = 0xffff;
        }

        write32(&mut system, font, FI_NEXT, bits);
        write32(&mut system, font, FI_FREE, size - bits);
        (
            size,
            bits,
            scratch,
            scratch_size,
            widths,
            spaces,
            name,
            area,
            layout,
        )
    };
    let handle = kernel(
        engine,
        "GlobalAlloc",
        &[GuestArg::Word(CACHE_ALLOC), GuestArg::Long(size)],
    )
    .await? as u16;

    if handle == 0 {
        return Ok((0, 0));
    }

    let file = kernel(engine, "GlobalLock", &[GuestArg::Word(handle)]).await? & 0xffff_0000;
    let mut system = engine.system();

    write16(&mut system, font, FI_BLOCK, handle);
    write16(&mut system, font, FI_SCRATCH, scratch);
    write16(&mut system, font, FI_SCRATCH_SIZE, scratch_size as u16);
    write16(&mut system, font, FI_WIDTHS, widths);
    write16(&mut system, font, FI_SPACES, spaces);
    write32(&mut system, font, FI_SIZE, size);
    write32(&mut system, font, FI_GROWTH, area);
    write16(&mut system, file, 0, layout.version);
    write32(&mut system, file, SIZE_AT, size);

    let mut copyright = ENGINE_COPYRIGHT.to_vec();

    copyright.push(0);
    system.write_far(at(file, COPYRIGHT_AT), &copyright);

    let header = system.read_far(font, usize::from(FONTINFO_COPIED));

    system.write_far(at(file, FONTINFO_AT), &header);

    let pitch = read8(&system, file, FONTINFO_AT + DF_PITCH) | 1;

    write8(&mut system, file, FONTINFO_AT + DF_PITCH, pitch);
    write16(&mut system, file, FONTINFO_AT + DF_FACE, name);

    let face = read16(&system, font, DF_FACE);
    let segment = font & 0xffff_0000;

    for index in 0.. {
        let code = read8(&system, segment, face.wrapping_add(index));

        write8(&mut system, file, name + index, code);

        if code == 0 {
            break;
        }
    }

    write16(&mut system, file, FONTINFO_AT + DF_BITS_OFFSET, bits as u16);
    write16(&mut system, file, widths, FIRST_WIDTH);
    write16(&mut system, file, widths - layout.entry, FIRST_WIDTH);
    write16(&mut system, file, widths - layout.entry + 2, scratch);
    write16(&mut system, file, layout.table, FIRST_WIDTH);
    write16(&mut system, file, layout.table + 2, scratch);
    write16(&mut system, file, spaces, FIRST_SPACES);
    Ok((handle, (file >> 16) as u16))
}

/// The block made where it was never made (seg1 `6748`): its handle, or
/// nought.
async fn ready_block(engine: &Engine, font: u32) -> Result<u16, Stop> {
    let handle = read16(&engine.system(), font, FI_BLOCK);

    if handle != 0 {
        return Ok(handle);
    }

    let (made, _) = make_block(engine, font).await?;

    if made != 0 {
        kernel(engine, "GlobalUnlock", &[GuestArg::Word(made)]).await?;
    }

    Ok(made)
}

/// The block grown by its glyph area (seg1 `71a6`): its segment, or
/// nought.
async fn grow(engine: &Engine, font: u32) -> Result<u16, Stop> {
    let (handle, growth, size, big) = {
        let system = engine.system();

        (
            read16(&system, font, FI_BLOCK),
            read32(&system, font, FI_GROWTH),
            read32(&system, font, FI_SIZE),
            read8(&system, font, FI_FLAGS) & FLAG_BIG != 0,
        )
    };

    kernel(engine, "GlobalUnlock", &[GuestArg::Word(handle)]).await?;

    let size = size + growth;

    if size > 0xffff && !big {
        kernel(engine, "GlobalLock", &[GuestArg::Word(handle)]).await?;
        return Ok(0);
    }

    let moved = kernel(
        engine,
        "GlobalReAlloc",
        &[
            GuestArg::Word(handle),
            GuestArg::Long(size),
            GuestArg::Word(CACHE_ALLOC),
        ],
    )
    .await? as u16;

    if moved == 0 {
        kernel(engine, "GlobalLock", &[GuestArg::Word(handle)]).await?;
        return Ok(0);
    }

    {
        let mut system = engine.system();
        let free = read32(&system, font, FI_FREE) + growth;

        write16(&mut system, font, FI_BLOCK, moved);
        write32(&mut system, font, FI_SIZE, size);
        write32(&mut system, font, FI_FREE, free);
    }

    Ok((kernel(engine, "GlobalLock", &[GuestArg::Word(moved)]).await? >> 16) as u16)
}

/// What making a glyph came to.
enum Made {
    Segment(u16),
    NoRoom,
    Failed,
}

/// A character's glyph made into the cache (seg1 `7222`), as `makeGlyph`.
#[allow(clippy::too_many_lines)]
async fn make_glyph(
    engine: &Engine,
    font: u32,
    mut segment: u16,
    index: u16,
    code: u8,
    angle: u16,
) -> Result<Made, Stop> {
    let (glyph, turned, cell) = {
        let system = engine.system();

        (
            context_glyph(&system, code, angle)?,
            read8(&system, font, FI_FLAGS) & FLAG_TURNED != 0,
            read16(&system, font, 0x16),
        )
    };
    let Some(glyph) = glyph else {
        return Ok(Made::Failed);
    };
    let columns = if turned {
        ((glyph.width + 0x1f) & !0x1f) >> 3
    } else {
        (glyph.width.max(1) + 7) >> 3
    } as u16;
    let size = if turned {
        u32::from(columns) * glyph.height as u32 + u32::from(TURNED_HEADER)
    } else {
        u32::from(columns) * u32::from(cell)
    };

    while read32(&engine.system(), font, FI_FREE) < size {
        segment = grow(engine, font).await?;

        if segment == 0 {
            return Ok(Made::NoRoom);
        }
    }

    let mut system = engine.system();
    let layout = layout_of(&system, font);
    let file = u32::from(segment) << 16;
    let entry = layout.table + index * layout.entry;
    let place = read16(&system, font, FI_NEXT);
    let free = read32(&system, font, FI_FREE) - size;
    let next = read32(&system, font, FI_NEXT) + size;

    write32(&mut system, font, FI_FREE, free);
    write32(&mut system, font, FI_NEXT, next);
    write16(
        &mut system,
        file,
        entry,
        if turned {
            glyph.width as u16
        } else {
            glyph.width.max(1) as u16
        },
    );
    write16(&mut system, file, entry + 2, place);

    if layout.entry == ENTRY_3 {
        write16(&mut system, file, entry + 4, 0);
    }

    let byte_of = |row: i64, column: i64| -> u8 {
        (0..8).fold(0u8, |value, step| {
            let bit = usize::try_from(row)
                .ok()
                .and_then(|row| glyph.rows.get(row))
                .and_then(|bits| bits.get((column * 8 + step) as usize))
                .copied()
                .unwrap_or(0);

            (value << 1) | bit
        })
    };

    if turned {
        let header = [
            glyph.width as u16,
            glyph.height as u16,
            glyph.origin_x as u16,
            glyph.origin_y as u16,
            0,
            0,
        ];

        for (step, value) in header.iter().enumerate() {
            write16(&mut system, file, place + step as u16 * 2, *value);
        }

        let bytes: Vec<u8> = (0..glyph.height)
            .flat_map(|row| (0..i64::from(columns)).map(move |column| (row, column)))
            .map(|(row, column)| byte_of(row, column))
            .collect();

        system.write_far(at(file, place + TURNED_HEADER), &bytes);
        return Ok(Made::Segment(segment));
    }

    let widths = read16(&system, font, FI_WIDTHS) + index * 2;
    let spaces = read16(&system, font, FI_SPACES) + index * 2;

    write16(&mut system, file, widths, glyph.advance_x as u16);
    write8(&mut system, file, spaces, glyph.origin_x as u8);
    write8(
        &mut system,
        file,
        spaces + 1,
        (glyph.advance_x - glyph.origin_x - glyph.width) as u8,
    );

    let top = i64::from(read16(&system, font, 8) as i16) - glyph.origin_y;
    let bytes: Vec<u8> = (0..i64::from(columns))
        .flat_map(|column| (0..i64::from(cell)).map(move |line| (column, line)))
        .map(|(column, line)| {
            let row = line - top;

            if row >= 0 { byte_of(row, column) } else { 0 }
        })
        .collect();

    system.write_far(at(file, place), &bytes);
    Ok(Made::Segment(segment))
}

/// The string's glyphs made ready in the cache (seg1 `7010`), as
/// `readyGlyphs`: the cache's font, or nought.
#[allow(clippy::too_many_lines)]
async fn ready_glyphs(engine: &Engine, font: u32, string: u32, count: i16) -> Result<u32, Stop> {
    if read8(&engine.system(), font, FI_FLAGS) & FLAG_FAILED != 0 {
        return Ok(0);
    }

    let block = read16(&engine.system(), font, FI_BLOCK);
    let mut segment = (kernel(engine, "GlobalLock", &[GuestArg::Word(block)]).await? >> 16) as u16;

    if segment == 0 {
        return Ok(0);
    }

    let (angle, layout) = {
        let system = engine.system();

        (read16(&system, font, 0x48), layout_of(&system, font))
    };
    let span = layout.last.wrapping_sub(layout.first);
    let entry_of = |index: u16| layout.table + index * layout.entry;
    let has = |system: &System, segment: u16, index: u16| {
        let file = u32::from(segment) << 16;

        read16(system, file, entry_of(index) + 2) != 0
            || (layout.entry == ENTRY_3 && read16(system, file, entry_of(index) + 4) != 0)
    };
    let mut context_set = false;
    let mut remade = false;
    let mut step = 0;

    while step < count.max(0) {
        let code = read8(&engine.system(), string, step as u16);
        let mut index = u16::from(code.wrapping_sub(layout.first));
        let mut character = code;

        if index > u16::from(span) {
            index = 1;
            character = 0;
        }

        if has(&engine.system(), segment, index) {
            step += 1;
            continue;
        }

        let mut made = if !context_set && {
            context_set = true;
            set_context(&mut engine.system(), font, angle) == 0xffff_ffff
        } {
            Made::Failed
        } else {
            make_glyph(engine, font, segment, index, character, angle).await?
        };

        if let Made::NoRoom = made {
            if remade {
                break;
            }

            // The block thrown away and made again (`71fd`).
            remade = true;

            let old = read16(&engine.system(), font, FI_BLOCK);

            kernel(engine, "GlobalUnlock", &[GuestArg::Word(old)]).await?;
            kernel(engine, "GlobalFree", &[GuestArg::Word(old)]).await?;
            write16(&mut engine.system(), font, FI_BLOCK, 0);

            let (handle, again) = make_block(engine, font).await?;

            if handle == 0 {
                return Ok(0);
            }

            segment = again;
            continue;
        }

        if let Made::Failed = made {
            if engine.system().fonts().true_type_off {
                let block = read16(&engine.system(), font, FI_BLOCK);

                kernel(engine, "GlobalUnlock", &[GuestArg::Word(block)]).await?;
                return Ok(0);
            }

            // The default's glyph, made where it has none, copied to this
            // one.
            let fallback = u16::from(read8(
                &engine.system(),
                u32::from(segment) << 16,
                FONTINFO_AT + 0x1f,
            ));

            if !has(&engine.system(), segment, fallback) {
                made = make_glyph(engine, font, segment, fallback, 0, angle).await?;

                match made {
                    Made::Segment(moved) => segment = moved,
                    _ => break,
                }
            }

            let mut system = engine.system();
            let file = u32::from(segment) << 16;

            for offset in (0..layout.entry).step_by(2) {
                let value = read16(&system, file, entry_of(fallback) + offset);

                write16(&mut system, file, entry_of(index) + offset, value);
            }

            let spaces = read16(&system, font, FI_SPACES);
            let widths = read16(&system, font, FI_WIDTHS);
            let space = read16(&system, file, spaces + fallback * 2);
            let width = read16(&system, file, widths + fallback * 2);

            write16(&mut system, file, spaces + index * 2, space);
            write16(&mut system, file, widths + index * 2, width);
            step += 1;
            continue;
        }

        if let Made::Segment(moved) = made {
            segment = moved;
        }

        step += 1;
    }

    let mut system = engine.system();
    let file = u32::from(segment) << 16;
    let bits = read16(&system, file, FONTINFO_AT + DF_BITS_OFFSET);

    write16(&mut system, file, FONTINFO_AT + DF_BITS_POINTER, bits);
    write16(
        &mut system,
        file,
        FONTINFO_AT + DF_BITS_POINTER + 2,
        segment,
    );
    Ok(file | u32::from(FONTINFO_AT))
}

/// The context's `DRAWMODE` fields `text_widths` reads.
struct Justification {
    break_extra: i32,
    break_err: i32,
    break_rem: u16,
    break_count: i32,
    total_break: u16,
    char_extra: i32,
}

/// What `text_widths` answers: each width, and the first and last A
/// spaces.
struct Spaced {
    widths: Vec<u16>,
    first_space: i32,
    last_space: i32,
}

/// Each character's width as GDI spaces a string (seg1 `6874`), as
/// `textWidths`.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn text_widths(
    system: &System,
    font: u32,
    file: u32,
    string: u32,
    count: u16,
    turned: bool,
    given: u32,
    justification: &mut Justification,
    bold: i32,
    width_of: &dyn Fn(u16) -> i32,
) -> Spaced {
    let pitch = read16(system, font, 0x14);
    let first = read8(system, font, 0x1d);
    let span = read8(system, font, 0x1e).wrapping_sub(first);
    let fallback = u16::from(read8(system, font, 0x1f));
    let break_index = u16::from(read8(system, font, 0x20));
    let index_of = |code: u8| {
        let index = code.wrapping_sub(first);

        if index > span {
            fallback
        } else {
            u16::from(index)
        }
    };
    let codes: Vec<u8> = (0..count).map(|step| read8(system, string, step)).collect();
    let given_width = |step: u16| i32::from(read16(system, given, step * 2) as i16);
    let extra = justification.char_extra + bold;
    let mut flags = if given >> 16 != 0 { 0x20 } else { 0 };

    if justification.total_break != 0 {
        flags |= if justification.break_extra != 0 {
            0x08
        } else {
            0
        };
        flags |= if justification.break_rem != 0 {
            0x04
        } else {
            0
        };
    }

    if (justification.total_break | justification.char_extra as u16) & 0x8000 != 0 {
        flags |= 0x10;
    }

    flags |= if justification.char_extra != 0 {
        0x02
    } else {
        0
    };
    flags |= if pitch != 0 { 0x40 } else { 0 };

    let mut widths: Vec<i32> = if (flags ^ 0x40) & 0x7e == 0 {
        codes.iter().map(|_| i32::from(pitch)).collect()
    } else if flags & 0x3e == 0x20 {
        (0..count).map(given_width).collect()
    } else if flags & 0x3c == 0 {
        codes
            .iter()
            .map(|&code| width_of(index_of(code)) + extra)
            .collect()
    } else {
        let mut err = i32::from(justification.break_err as i16);
        let rem = i32::from(justification.break_rem as i16);
        let widths = codes
            .iter()
            .enumerate()
            .map(|(step, &code)| {
                let index = index_of(code);
                let width = width_of(index);
                let mut more = extra;

                if index == break_index && flags & 0x0c != 0 {
                    more += justification.break_extra;

                    if flags & 0x04 != 0 {
                        if rem >= 0 {
                            err -= rem;

                            if err <= 0 {
                                err += justification.break_count;
                                more += 1;
                            }
                        } else {
                            err += rem;

                            if err <= 0 {
                                err += justification.break_count;
                                more -= 1;
                            }
                        }
                    }
                }

                if flags & 0x20 != 0 {
                    more += given_width(step as u16) - width;
                }

                if more < 0 && step + 1 < usize::from(count) {
                    more = more.max(-width);
                }

                width + more
            })
            .collect();

        justification.break_err = err;
        widths
    };
    let mut first_space = 0;
    let mut last_space = 0;

    if !turned && count != 0 {
        let spaces = read16(system, font, FI_SPACES);
        let space = |code: u8| i32::from(read8(system, file, spaces + index_of(code) * 2) as i8);
        let mut before = space(codes[0]);

        first_space = before;

        for step in 1..codes.len() {
            let next = space(codes[step]);

            widths[step - 1] = widths[step - 1] - before + next;
            before = next;
            last_space = next;
        }
    }

    Spaced {
        widths: widths.into_iter().map(|width| width as u16).collect(),
        first_space,
        last_space,
    }
}

/// What `draw_engine_text` is given: `EngineExtTextOut`'s arguments.
#[derive(Debug, Clone, Copy)]
pub struct EngineTextArgs {
    pub hdc: u16,
    pub device: u32,
    pub x: i16,
    pub y: i16,
    pub clip: u32,
    pub string: u32,
    pub count: i16,
    pub font: u32,
    pub draw_mode: u32,
    pub xform: u32,
    pub widths: u32,
    pub opaque: u32,
    pub options: u16,
    /// The context itself, where GDI draws for it without the driver.
    pub dc: Option<usize>,
    /// The stack pointer as GDI's drawing reaches its stack's measure (seg1
    /// `62a5`), where it is known: `EngineExtTextOut`'s.
    pub stack: Option<u16>,
}

/// The room GDI keeps on the stack below the string's (seg1 `62ac`).
const STACK_KEPT: u16 = 0x400;

/// The count cut to what the stack holds (seg1 `62a5`-`62c0`), as
/// `stackCut`: the stack pointer less the task's stack limit at 0Ah of the
/// stack's segment, as unsigned words; under 400h nothing is drawn (`None`);
/// else that less 400h, shifted right two with its sign, the most
/// characters, compared unsigned.
pub fn stack_cut(system: &System, stack: u16, count: i16) -> Option<i16> {
    let base = system.cpu.segments[winbox_cpu::SS].base;
    let limit = system.cpu.bus.read16(base + 0x0a);
    let room = stack.wrapping_sub(limit);

    if room < STACK_KEPT {
        return None;
    }

    let most = ((room - STACK_KEPT) as i16 >> 2) as u16;

    Some(if most < count as u16 {
        most as i16
    } else {
        count
    })
}

/// The string drawn (seg1 `669a`, `6223`), as `drawEngineText`: the
/// context's device answered, as it was.
///
/// # Errors
///
/// What the driver's code stops with.
pub async fn draw_engine_text(engine: &Engine, args: EngineTextArgs) -> Result<Answer, Stop> {
    let dc = args
        .dc
        .or_else(|| super::printer_driver::driver_dc_of(&engine.system(), args.hdc));
    let answer = dc.map_or(0, |dc| proc(&engine.system(), dc, EXT_TEXT_OUT).1);

    if ready_block(engine, args.font).await? == 0 {
        return Ok(Answer::Dword(0));
    }

    let Some(dc) = dc else {
        return Ok(Answer::Dword(answer));
    };
    let kept = super::printer_driver::kept_device_font(&mut engine.system(), dc)
        .and_then(|(_, _, kept)| kept);
    let font = kept.as_ref().map_or(args.font, |kept| kept.far);

    if engine.system().fonts().true_type_off {
        return Ok(Answer::Dword(answer));
    }

    let flags = read8(&engine.system(), font, FI_FLAGS);

    if flags & FLAG_FAILED != 0 {
        return Ok(Answer::Dword(answer));
    }

    let (mut raster, dp_text) = {
        let system = engine.system();
        let info = super::printer_driver::device_info(&system, dc).unwrap_or(&[]);
        let word = |offset: usize| {
            info.get(offset..offset + 2)
                .map_or(0, |bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
        };

        (word(DP_RASTER), word(DP_TEXT))
    };
    let turned = flags & FLAG_TURNED != 0;
    let outline = flags & FLAG_OUTLINE != 0;

    if outline {
        raster &= !(RC_GDI20_OUTPUT | RC_OP_DX_OUTPUT);
    }

    // A font GDI draws as an outline itself (seg8 `01a4`, into `042a`),
    // which no font WinBox realizes is.
    if outline {
        return Ok(Answer::Dword(answer));
    }

    let mut args = args;

    if let Some(stack) = args.stack {
        let Some(cut) = stack_cut(&engine.system(), stack, args.count) else {
            return Ok(Answer::Dword(answer));
        };

        args.count = cut;
    }

    let cache_font = ready_glyphs(engine, font, args.string, args.count).await?;
    let handle = read16(&engine.system(), font, FI_BLOCK);

    if cache_font == 0 {
        return Ok(Answer::Dword(answer));
    }

    let accelerator = kept.as_ref().map_or(0, |kept| {
        kept.xform
            .get(TEXTXFORM_ACCELERATOR..TEXTXFORM_ACCELERATOR + 2)
            .map_or(0, |bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
    });
    let bold = i32::from(accelerator & TC_EA_DOUBLE != 0 && dp_text & TC_EA_DOUBLE != 0);
    let drawn = draw_string(
        engine,
        dc,
        args,
        font,
        cache_font,
        raster,
        turned && !outline,
        turned || engine.system().printing.drivers.mgxwmf.contains(&dc),
        bold,
    )
    .await;

    kernel(engine, "GlobalUnlock", &[GuestArg::Word(handle)]).await?;
    drawn?;
    Ok(Answer::Dword(answer))
}

/// What `draw_string` lays below the stack for each call back.
struct Call {
    flags: u8,
    x: i16,
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn draw_string(
    engine: &Engine,
    dc: usize,
    args: EngineTextArgs,
    font: u32,
    cache_font: u32,
    raster: u16,
    turned: bool,
    advances_alone: bool,
    bold: i32,
) -> Result<(), Stop> {
    let file = cache_font & 0xffff_0000;
    let count = args.count;
    let (spaced, mode_bytes, cell) = {
        let mut system = engine.system();
        let mode = draw_mode(&mut system, dc);
        let mut justification = Justification {
            break_extra: i32::from(read16(&system, mode, 0x0e) as i16),
            break_err: i32::from(read16(&system, mode, 0x10) as i16),
            break_rem: read16(&system, mode, 0x12),
            break_count: i32::from(read16(&system, mode, 0x14) as i16),
            total_break: read16(&system, mode, 0x0c),
            char_extra: i32::from(read16(&system, mode, 0x16) as i16),
        };
        let filled = if turned {
            widths_of(&mut system, font)
        } else {
            None
        };
        let first_code = u16::from(read8(&system, font, 0x1d));
        let table = read16(&system, font, FI_WIDTHS);
        let spaced = if count != 0 {
            let width = |index: u16| -> i32 {
                if turned {
                    filled.as_ref().map_or(0, |(engine_font, info)| {
                        width_of(engine_font, info, first_code + index).map_or(0, i32::from)
                    })
                } else {
                    i32::from(read16(&system, file, table + index * 2))
                }
            };

            text_widths(
                &system,
                font,
                file,
                args.string,
                count as u16,
                advances_alone,
                args.widths,
                &mut justification,
                bold,
                &width,
            )
        } else {
            Spaced {
                widths: Vec::new(),
                first_space: 0,
                last_space: 0,
            }
        };

        if count != 0
            && let Some(justified) = system.gdi.dcs[dc].state.justification.as_mut()
        {
            justified.err = i32::from(justification.break_err as i16);
        }

        // GDI's copy of the `DRAWMODE`: its first 12 bytes, its
        // justification and character extra nought, its logical colours
        // (`6342`).
        let given = system.read_far(args.draw_mode, 0x20);
        let mode_bytes: Vec<u8> = given
            .iter()
            .enumerate()
            .map(|(offset, &byte)| {
                if (0x0c..0x18).contains(&offset) {
                    0
                } else {
                    byte
                }
            })
            .collect();

        (spaced, mode_bytes, read16(&system, font, 0x16))
    };
    let bk_mode = u16::from_le_bytes([mode_bytes[2], mode_bytes[3]]);
    let x = args.x;
    let y = args.y;
    let mut options = args.options;
    let mut opaque_is_box = false;
    let mut boxed: Option<[i32; 4]> = None;
    let mut state: u8 = 2;
    let shift = if count == 0 {
        0
    } else {
        spaced.first_space as i16
    };
    let mut calls: Vec<Call> = Vec::new();
    let mut transparent = false;
    let mut ground = false;

    if count == 0 {
        calls.push(Call {
            flags: 0xc2,
            x: x.wrapping_add(shift),
        });
    } else if bk_mode == OPAQUE {
        if !turned && raster & RC_OP_DX_OUTPUT != 0 && options & (ETO_OPAQUE | ETO_CLIPPED) != 0 {
            calls.push(Call {
                flags: 0xca,
                x: x.wrapping_add(shift),
            });
        } else if !turned {
            state = 1;

            let mut extent = spaced.first_space - spaced.last_space;

            for &width in &spaced.widths {
                extent += i32::from(width as i16);
            }

            let x32 = i32::from(x);

            if extent > 0x7fff || extent + x32 > 0x7fff {
                extent = 0x7fff - x32;
            }

            let mut rect = [
                x32,
                i32::from(y),
                x32 + extent,
                i32::from(y) + i32::from(cell),
            ];

            if raster & RC_OP_DX_OUTPUT != 0 {
                opaque_is_box = true;
                options = ETO_OPAQUE;
                boxed = Some(rect);
                calls.push(Call {
                    flags: 0xca,
                    x: x.wrapping_add(shift),
                });
            } else {
                let given = if args.opaque >> 16 != 0 {
                    let system = engine.system();
                    let word = |offset: u16| i32::from(read16(&system, args.opaque, offset) as i16);

                    Some([word(0), word(2), word(4), word(6)])
                } else {
                    None
                };

                if options & ETO_OPAQUE != 0
                    && let Some([l, t, r, b]) = given
                {
                    if l <= rect[0] && t <= rect[1] && r >= rect[2] && b >= rect[3] {
                        state = 0;
                    }

                    calls.push(Call {
                        flags: state | 0x80,
                        x,
                    });
                }

                if state & 1 != 0 {
                    let mut empty = false;

                    if options & ETO_CLIPPED != 0
                        && let Some([l, t, r, b]) = given
                    {
                        let cut = [
                            rect[0].max(l),
                            rect[1].max(t),
                            rect[2].min(r),
                            rect[3].min(b),
                        ];

                        empty = cut[0] >= cut[2] || cut[1] >= cut[3];

                        if !empty {
                            rect = cut;
                        }
                    }

                    if !empty {
                        calls.push(Call { flags: state, x });
                    }
                }

                boxed = Some(rect);
                transparent = true;
            }
        } else {
            transparent = true;
            ground = true;
        }
    } else {
        transparent = true;
    }

    if ground {
        turned_ground(engine, dc, args, font, &spaced, options).await?;
    }

    // A driver without `RC_GDI20_OUTPUT` has each call made through its
    // `StrBlt` (`62e1`-`62f2`), as `drawString`.
    if raster & RC_GDI20_OUTPUT == 0 {
        let strings = Strings {
            cache_font,
            mode: mode_bytes.clone(),
            widths: spaced.widths.clone(),
            font,
            options,
        };

        for call in &calls {
            by_str_blt(engine, dc, args, &strings, call.flags, boxed, call.x).await?;
        }

        if transparent && turned {
            return turned_glyphs(engine, dc, args, font, file, &spaced.widths, &mode_bytes).await;
        }

        if transparent {
            let mut strings = strings;

            strings.mode[2] = TRANSPARENT;
            strings.mode[3] = 0;
            by_str_blt(
                engine,
                dc,
                args,
                &strings,
                state | 0xf8,
                boxed,
                x.wrapping_add(shift),
            )
            .await?;
        }

        return Ok(());
    }

    let procedure = proc(&engine.system(), dc, EXT_TEXT_OUT).0;
    let width_bytes: Vec<u8> = spaced
        .widths
        .iter()
        .flat_map(|width| width.to_le_bytes())
        .collect();
    let call_back = |flags: u8, x_at: i16, mode: Vec<u8>| {
        let local = boxed.unwrap_or([0; 4]);
        let mut stack = mode;

        stack.extend_from_slice(&width_bytes);
        stack.extend(local.iter().flat_map(|value| (*value as u16).to_le_bytes()));

        let widths_length = width_bytes.len() as u16;

        async move {
            if procedure == 0 {
                return Ok(());
            }

            on_stack(engine, &stack, |far| async move {
                let widths_far = at(far, 0x20);
                let box_far = at(far, 0x20 + widths_length);
                let opaque = if flags & 0x80 != 0 && !opaque_is_box {
                    args.opaque
                } else {
                    box_far
                };
                let options_arg = if flags & 0x02 != 0 {
                    options
                } else if flags & 0x10 != 0 {
                    options & !ETO_OPAQUE
                } else {
                    6
                };

                call_driver(
                    engine,
                    procedure,
                    &[
                        GuestArg::Long(args.device),
                        GuestArg::Word(x_at as u16),
                        GuestArg::Word(y as u16),
                        GuestArg::Long(args.clip),
                        GuestArg::Long(args.string),
                        GuestArg::Word(if flags & 0x40 != 0 { count as u16 } else { 0 }),
                        GuestArg::Long(cache_font),
                        GuestArg::Long(far),
                        GuestArg::Long(args.xform),
                        GuestArg::Long(if flags & 0x08 != 0 && widths_length != 0 {
                            widths_far
                        } else {
                            0
                        }),
                        GuestArg::Long(opaque),
                        GuestArg::Word(options_arg),
                    ],
                )
                .await
            })
            .await
            .map(|_| ())
        }
    };

    for call in &calls {
        call_back(call.flags, call.x, mode_bytes.clone()).await?;
    }

    if !transparent {
        return Ok(());
    }

    if turned {
        return turned_glyphs(engine, dc, args, font, file, &spaced.widths, &mode_bytes).await;
    }

    let mut mode = mode_bytes;

    mode[2] = TRANSPARENT;
    mode[3] = 0;
    call_back(state | 0xf8, x.wrapping_add(shift), mode).await
}

/// A GDI call of the engine's, answering its value.
async fn gdi(engine: &Engine, name: &'static str, args: Vec<GuestArg>) -> Result<u32, Stop> {
    call_named(engine, "GDI", name, &args)
        .await
        .map(|(answer, _)| answer.value().unwrap_or(0))
}

/// A brush of the background colour selected, and with `pen` a null pen
/// (seg8 `0023`, `0004`), as `withGround`; what to put back after.
async fn ground_selected(engine: &Engine, hdc: u16, pen: bool) -> Result<[u32; 4], Stop> {
    let colour = gdi(engine, "GetBkColor", vec![GuestArg::Word(hdc)]).await?;
    let brush = gdi(engine, "CreateSolidBrush", vec![GuestArg::Long(colour)]).await?;
    let old_brush = gdi(
        engine,
        "SelectObject",
        vec![GuestArg::Word(hdc), GuestArg::Word(brush as u16)],
    )
    .await?;
    let (null_pen, old_pen) = if pen {
        let null_pen = gdi(
            engine,
            "CreatePen",
            vec![
                GuestArg::Word(PS_NULL),
                GuestArg::Word(0),
                GuestArg::Long(0),
            ],
        )
        .await?;
        let old_pen = gdi(
            engine,
            "SelectObject",
            vec![GuestArg::Word(hdc), GuestArg::Word(null_pen as u16)],
        )
        .await?;

        (null_pen, old_pen)
    } else {
        (0, 0)
    };

    Ok([brush, old_brush, null_pen, old_pen])
}

/// The brush and pen `ground_selected` chose put back and deleted (seg1
/// `6585`).
async fn ground_restored(engine: &Engine, hdc: u16, kept: [u32; 4]) -> Result<(), Stop> {
    let [brush, old_brush, null_pen, old_pen] = kept;

    gdi(
        engine,
        "SelectObject",
        vec![GuestArg::Word(hdc), GuestArg::Word(old_brush as u16)],
    )
    .await?;
    gdi(engine, "DeleteObject", vec![GuestArg::Word(brush as u16)]).await?;

    if null_pen != 0 {
        gdi(
            engine,
            "SelectObject",
            vec![GuestArg::Word(hdc), GuestArg::Word(old_pen as u16)],
        )
        .await?;
        gdi(
            engine,
            "DeleteObject",
            vec![GuestArg::Word(null_pen as u16)],
        )
        .await?;
    }

    Ok(())
}

/// The driver's `BitBlt` filling each rectangle with `PATCOPY`, as
/// `fillRects`.
async fn fill_rects(
    engine: &Engine,
    dc: usize,
    device: u32,
    rects: &[[i32; 4]],
) -> Result<(), Stop> {
    let procedure = proc(&engine.system(), dc, BIT_BLT).0;

    if procedure == 0 {
        return Ok(());
    }

    for rect in rects {
        let (brush, mode) = {
            let mut system = engine.system();

            (brush_far(&system, dc), draw_mode(&mut system, dc))
        };

        call_driver(
            engine,
            procedure,
            &[
                GuestArg::Long(device),
                GuestArg::Word(rect[0] as u16),
                GuestArg::Word(rect[1] as u16),
                GuestArg::Long(0),
                GuestArg::Word(0),
                GuestArg::Word(0),
                GuestArg::Word((rect[2] - rect[0]) as u16),
                GuestArg::Word((rect[3] - rect[1]) as u16),
                GuestArg::Long(PATCOPY),
                GuestArg::Long(brush),
                GuestArg::Long(mode),
            ],
        )
        .await?;
    }

    Ok(())
}

/// A turned string's opaque background (seg1 `63ea`-`64be`), as
/// `turnedGround`: the turned box a polygon filled `WINDING` in the
/// device's terms with a brush of the background colour and a null pen;
/// then, with options and an opaque rectangle, the rectangle filled.
async fn turned_ground(
    engine: &Engine,
    dc: usize,
    args: EngineTextArgs,
    font: u32,
    spaced: &Spaced,
    options: u16,
) -> Result<(), Stop> {
    let (res_y, res_x, angle, cell, given) = {
        let system = engine.system();
        let given = (args.opaque >> 16 != 0).then(|| {
            let word = |offset: u16| i32::from(read16(&system, args.opaque, offset) as i16);

            [word(0), word(2), word(4), word(6)]
        });

        (
            u32::from(read16(&system, font, 4)),
            u32::from(read16(&system, font, 6)),
            i32::from(read16(&system, font, 0x48)),
            i32::from(read16(&system, font, 0x16) as i16),
            given,
        )
    };
    let across = ((0x100 * res_x + (res_y >> 1)) / res_y.max(1)) & 0xffff;
    let down = ((0x100 * res_y + (res_x >> 1)) / res_x.max(1)) & 0xffff;
    let scaled = |value: i32, ratio: u32| {
        i32::from(((i32::from(value as i16) * ratio as i32).div_euclid(0x100)) as u16 as i16)
    };
    let x = i32::from(args.x);
    let y = i32::from(args.y);
    let mut extent = spaced.first_space - spaced.last_space;

    for &width in &spaced.widths {
        extent += i32::from(width as i16);
    }

    if extent > 0x7fff || extent + x > 0x7fff {
        extent = 0x7fff - x;
    }

    let along_x = x + sine_of(extent, angle, true);
    let along_y = y - sine_of(scaled(extent, down), angle, false);
    let across_x = sine_of(scaled(cell, across), angle, false);
    let across_y = sine_of(cell, angle, true);
    let kept = ground_selected(engine, args.hdc, true).await?;
    let filled = async {
        super::printer_output::driver_polygon(
            engine,
            dc,
            &[
                (x, y),
                (along_x, along_y),
                (along_x + across_x, along_y + across_y),
                (x + across_x, y + across_y),
            ],
            Some(true),
        )
        .await?;

        if options != 0
            && let Some(rect) = given
        {
            let rects = blit_rects(&mut engine.system(), dc, rect, true, true);

            fill_rects(engine, dc, args.device, &rects).await?;
        }

        Ok::<(), Stop>(())
    }
    .await;

    ground_restored(engine, args.hdc, kept).await?;
    filled
}

/// What `by_str_blt` draws with, as `Strings`.
struct Strings {
    cache_font: u32,
    mode: Vec<u8>,
    widths: Vec<u16>,
    font: u32,
    options: u16,
}

/// One of the calls `draw_string` plans, for a driver without
/// `RC_GDI20_OUTPUT` (seg8 `00e4`-`020a`), as `byStrBlt`.
#[allow(clippy::too_many_lines)]
async fn by_str_blt(
    engine: &Engine,
    dc: usize,
    args: EngineTextArgs,
    strings: &Strings,
    call: u8,
    boxed: Option<[i32; 4]>,
    x_at: i16,
) -> Result<(), Stop> {
    let rect_of = |system: &System, far: u32| {
        let word = |offset: u16| i32::from(read16(system, far, offset) as i16);

        [word(0), word(2), word(4), word(6)]
    };
    let (clip, given) = {
        let system = engine.system();
        let clip = if args.clip >> 16 != 0 {
            rect_of(&system, args.clip)
        } else {
            [-0x8000, -0x8000, 0x7fff, 0x7fff]
        };
        let given = (args.opaque >> 16 != 0).then(|| rect_of(&system, args.opaque));

        (clip, given)
    };
    let cut = |a: [i32; 4], b: [i32; 4]| {
        let r = [
            a[0].max(b[0]),
            a[1].max(b[1]),
            a[2].min(b[2]),
            a[3].min(b[3]),
        ];

        (r[0] < r[2] && r[1] < r[3]).then_some(r)
    };
    let fill = |rect: Option<[i32; 4]>| async move {
        if let Some(within) = rect.and_then(|rect| cut(rect, clip)) {
            let kept = ground_selected(engine, args.hdc, false).await?;
            let filled = fill_rects(engine, dc, args.device, &[within]).await;

            ground_restored(engine, args.hdc, kept).await?;
            filled?;
        }

        Ok::<(), Stop>(())
    };
    let given_here = if call & 0x80 != 0 { given } else { None };

    if call & 0x78 != 0x78 {
        return fill(if call & 0x80 != 0 { given_here } else { boxed }).await;
    }

    if strings.options & ETO_OPAQUE != 0 {
        fill(given_here).await?;
    }

    let bounds = if strings.options & ETO_CLIPPED != 0
        && let Some(rect) = given
    {
        cut(clip, rect)
    } else {
        Some(clip)
    };
    let procedure = proc(&engine.system(), dc, STR_BLT).0;
    let Some(bounds) = bounds else {
        return Ok(());
    };

    if procedure == 0 {
        return Ok(());
    }

    let (res_y, res_x, angle, ascent) = {
        let system = engine.system();

        (
            u32::from(read16(&system, strings.font, 4)),
            u32::from(read16(&system, strings.font, 6)),
            i32::from(read16(&system, strings.font, 0x48)),
            read16(&system, strings.font, 8),
        )
    };
    let across = ((0x100 * res_x + (res_y >> 1)) / res_y.max(1)) & 0xffff;
    let down = ((0x100 * res_y + (res_x >> 1)) / res_x.max(1)) & 0xffff;
    let scaled =
        |value: u16, ratio: u32| i32::from(((u32::from(value) * ratio) >> 8) as u16 as i16);
    let x0 = i32::from((sine_of(scaled(ascent, across), angle, false) + i32::from(x_at)) as i16);
    let y0 = i32::from(
        (i32::from(args.y) - (i32::from(ascent) - sine_of(i32::from(ascent), angle, true))) as i16,
    );
    let mut stack = strings.mode.clone();

    stack.extend(
        bounds
            .iter()
            .flat_map(|value| (*value as u16).to_le_bytes()),
    );

    on_stack(engine, &stack, |far| async move {
        let mut before: u16 = 0;

        for (step, &width) in strings.widths.iter().enumerate() {
            let along = before;

            before = before.wrapping_add(width);

            let sx = sine_of(i32::from(along as i16), angle, true) + x0;
            let sy = -sine_of(scaled(along, down), angle, false) + y0;

            call_driver(
                engine,
                procedure,
                &[
                    GuestArg::Long(args.device),
                    GuestArg::Word(sx as u16),
                    GuestArg::Word(sy as u16),
                    GuestArg::Long(at(far, 0x20)),
                    GuestArg::Long(at(args.string, step as u16)),
                    GuestArg::Word(1),
                    GuestArg::Long(strings.cache_font),
                    GuestArg::Long(far),
                    GuestArg::Long(args.xform),
                ],
            )
            .await?;
        }

        Ok(())
    })
    .await
    .map(|_| ())
}

/// A turned string, glyph by glyph (seg1 `6693`, seg8 `024b`), as
/// `turnedGlyphs`.
#[allow(clippy::too_many_lines)]
async fn turned_glyphs(
    engine: &Engine,
    dc: usize,
    args: EngineTextArgs,
    font: u32,
    file: u32,
    widths: &[u16],
    mode: &[u8],
) -> Result<(), Stop> {
    let rop2 = u16::from_le_bytes([mode[0], mode[1]]);
    let rop = GLYPH_ROPS[usize::from(rop2.wrapping_sub(1) & 0x0f)];
    let (res_y, res_x, angle, ascent, layout, fallback) = {
        let system = engine.system();

        (
            u32::from(read16(&system, font, 4)),
            u32::from(read16(&system, font, 6)),
            i32::from(read16(&system, font, 0x48)),
            i32::from(read16(&system, font, 8) as i16),
            layout_of(&system, font),
            read8(&system, font, 0x1f),
        )
    };
    let across = ((0x100 * res_x + (res_y >> 1)) / res_y.max(1)) & 0xffff;
    let down = ((0x100 * res_y + (res_x >> 1)) / res_x.max(1)) & 0xffff;
    let gdi = |name: &'static str, args: Vec<GuestArg>| async move {
        call_named(engine, "GDI", name, &args)
            .await
            .map(|(answer, _)| answer.value().unwrap_or(0))
    };
    let hdc = args.hdc;
    let text = gdi("GetTextColor", vec![GuestArg::Word(hdc)]).await?;
    let brush = gdi("CreateSolidBrush", vec![GuestArg::Long(text)]).await? as u16;
    let old_brush = gdi(
        "SelectObject",
        vec![GuestArg::Word(hdc), GuestArg::Word(brush)],
    )
    .await?;
    let old_text = gdi(
        "SetTextColor",
        vec![GuestArg::Word(hdc), GuestArg::Long(0x00ff_ffff)],
    )
    .await?;
    let old_bk = gdi("SetBkColor", vec![GuestArg::Word(hdc), GuestArg::Long(0)]).await?;
    let scaled = |value: i32, ratio: u32| ((u32::from(value as u16) * ratio) >> 8) as u16 as i16;
    let x0 = i32::from(args.x) + sine_of(i32::from(scaled(ascent, across)), angle, false);
    let y0 = i32::from(args.y) + sine_of(ascent, angle, true);
    let mut position: u16 = 0;
    let mut drawn = Ok(());

    for (step, &width) in widths.iter().enumerate() {
        let along = position as i16;

        position = position.wrapping_add(width);

        let (glyph, glyph_width, height, corner_x, corner_y) = {
            let system = engine.system();
            let mut code = read8(&system, args.string, step as u16);

            if code < layout.first || code > layout.last {
                code = layout.first.wrapping_add(fallback);
            }

            let entry = layout.table + u16::from(code - layout.first) * layout.entry;
            let place = read16(&system, file, entry + 2);

            if place == 0 && !(layout.entry == ENTRY_3 && read16(&system, file, entry + 4) != 0) {
                continue;
            }

            let glyph = file | u32::from(place);

            (
                glyph,
                read16(&system, glyph, 0),
                read16(&system, glyph, 2),
                i32::from(read16(&system, glyph, 4) as i16),
                i32::from(read16(&system, glyph, 6) as i16),
            )
        };

        if ((glyph_width + 0x1f) & !0x1f) >> 3 == 0 {
            continue;
        }

        let along = i32::from(along);
        let gx = sine_of(along, angle, true) + x0 + corner_x;
        let gy = -sine_of(i32::from(scaled(along, down)), angle, false) + y0 - corner_y;

        drawn = blit_glyph(
            engine,
            dc,
            args.device,
            gx,
            gy,
            glyph,
            glyph_width,
            height,
            rop,
        )
        .await;

        if drawn.is_err() {
            break;
        }
    }

    gdi(
        "SetTextColor",
        vec![GuestArg::Word(hdc), GuestArg::Long(old_text)],
    )
    .await?;
    gdi(
        "SetBkColor",
        vec![GuestArg::Word(hdc), GuestArg::Long(old_bk)],
    )
    .await?;
    gdi(
        "SelectObject",
        vec![GuestArg::Word(hdc), GuestArg::Word(old_brush as u16)],
    )
    .await?;
    gdi("DeleteObject", vec![GuestArg::Word(brush)]).await?;
    drawn
}

/// A glyph drawn through the driver's `BitBlt` (seg1 `2ed4`, `2ef2`), as
/// `blitGlyph`.
#[allow(clippy::too_many_arguments)]
async fn blit_glyph(
    engine: &Engine,
    dc: usize,
    device: u32,
    gx: i32,
    gy: i32,
    glyph: u32,
    width: u16,
    height: u16,
    rop: u32,
) -> Result<(), Stop> {
    let (procedure, lp_pdevice) = proc(&engine.system(), dc, BIT_BLT);
    let row_bytes = ((width + 0x1f) & !0x1f) >> 3;
    let within = [gx, gy, gx + i32::from(width), gy + i32::from(height)];
    let rects = blit_rects(&mut engine.system(), dc, within, true, true);

    if procedure == 0 || rects.is_empty() {
        return Ok(());
    }

    let bits = at(glyph, TURNED_HEADER);
    let plane = u32::from(row_bytes) * u32::from(height);
    let mut bitmap = Vec::with_capacity(0x1a);

    for value in [0, (width + 0x1f) & !0x1f, height, row_bytes] {
        bitmap.extend_from_slice(&value.to_le_bytes());
    }

    bitmap.extend_from_slice(&[1, 1]);
    bitmap.extend_from_slice(&bits.to_le_bytes());
    bitmap.extend_from_slice(&plane.to_le_bytes());
    bitmap.extend_from_slice(&lp_pdevice.to_le_bytes());
    bitmap.extend_from_slice(&0u16.to_le_bytes());
    bitmap.extend_from_slice(&0xffffu16.to_le_bytes());

    on_stack(engine, &bitmap, |far| async move {
        for rect in rects {
            let (brush, mode) = {
                let mut system = engine.system();

                (brush_far(&system, dc), draw_mode(&mut system, dc))
            };

            call_driver(
                engine,
                procedure,
                &[
                    GuestArg::Long(device),
                    GuestArg::Word(rect[0] as u16),
                    GuestArg::Word(rect[1] as u16),
                    GuestArg::Long(far),
                    GuestArg::Word((rect[0] - gx) as u16),
                    GuestArg::Word((rect[1] - gy) as u16),
                    GuestArg::Word((rect[2] - rect[0]) as u16),
                    GuestArg::Word((rect[3] - rect[1]) as u16),
                    GuestArg::Long(rop),
                    GuestArg::Long(brush),
                    GuestArg::Long(mode),
                ],
            )
            .await?;
        }

        Ok(())
    })
    .await
    .map(|_| ())
}
