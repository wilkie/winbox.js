//! `LZEXPAND`, the expansion of files `COMPRESS` made, as WinBox's own:
//! each routine of `LZEXPAND.DLL` followed as it is read out (`kb/lzexpand`,
//! `kb/topics/compressed-files.md`). As `src/win16/lzexpand/`.
//!
//! The library keeps its state in its data segment: a table of sixteen LZ
//! handles, each a global block of the file's own buffers, and the
//! "current" buffers and places the decoder works with, which each call
//! takes from a handle's block and gives back (seg5). Here that state is
//! `State`, one for the system, and the blocks are global memory as the
//! library allocates them, laid out as it lays them out. Files are read and
//! written through KERNEL's `_lread`, `_lwrite` and `_llseek`, as the
//! library calls them.
//!
//! It is kept as `COMMDLG` is (`own_modules.rs`): with `LZEXPAND.DLL` on
//! the drive, a program that imports it gets the file's library, each
//! import of an export answered here linked to WinBox's stub; with none,
//! WinBox's stubs throughout.

use winbox_cpu::{AX, BX, CX, DX};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::commdlg::api::{self, Arg};
use crate::engine::Engine;

/// The module's name, and its file's.
pub const NAME: &str = "LZEXPAND";

/// LZ handles are 400h on; below, DOS's handles, passed through.
pub const BASE: i16 = 0x400;
pub const SLOTS: usize = 16;

pub const LZERROR_BADINHANDLE: i32 = -1;
pub const LZERROR_BADOUTHANDLE: i32 = -2;
pub const LZERROR_READ: i32 = -3;
pub const LZERROR_WRITE: i32 = -4;
pub const LZERROR_GLOBALLOC: i32 = -5;
pub const LZERROR_GLOBLOCK: i32 = -6;
pub const LZERROR_BADVALUE: i32 = -7;
pub const LZERROR_UNKNOWNALG: i32 = -8;

/// What the decoder's reading of its input answers at the file's end.
const END: i32 = 0x1f4;

/// The ring's length, and the places at its end left out of its spaces.
const RING: u16 = 0x1000;
const KEPT: u16 = 0x10;

/// A handle's block (seg2 `00a6`, 18A5h bytes, `GMEM_MOVEABLE | GMEM_ZEROINIT`).
const BLOCK_SIZE: u32 = 0x18a5;
const BLOCK_INPUT: u16 = 0x11;
const BLOCK_RING: u16 = 0x413;
const BLOCK_OUTPUT: u16 = 0x1493;
/// Where a handle's state is kept between calls (seg5 `0052`).
const BLOCK_SAVED: u16 = 0x1893;
/// The window of output kept: its size, and its first byte's place in the file.
const BLOCK_WINDOW_SIZE: u16 = BLOCK_SAVED + 0xc;
const BLOCK_WINDOW_START: u16 = BLOCK_SAVED + 0xe;

/// The header's signature, at `[0060h]`.
const SIGNATURE: [u8; 8] = [0x53, 0x5a, 0x44, 0x44, 0x88, 0xf0, 0x27, 0x33];

/// The copying buffers `LZStart` made, kept while others are current
/// (`[34h]`-`[42h]`).
#[derive(Debug, Default, Clone, Copy)]
pub struct Buffers {
    pub ring: u32,
    pub input: u32,
    pub output: u32,
    pub in_size: u16,
    pub out_size: u16,
}

/// `LZEXPAND`'s data, as its data segment holds it: nought as it loads.
#[derive(Debug, Default, Clone)]
pub struct State {
    /// The slot the next LZ handle is looked for from (`[30h]`).
    pub next: usize,
    /// Each slot's block, a global handle, or nought (`[10h]`).
    pub slots: [u16; SLOTS],
    /// How many `LZStart`s want the copying buffers (`[32h]`).
    pub starts: u16,
    pub saved: Buffers,
    /// The current buffers: far pointers, and the sizes (`[44h]`, `[48h]`,
    /// `[54h]`, `[27Ch]`, `[276h]`).
    pub current: Buffers,
    /// The input's end and the next byte, offsets in its segment (`[4Ch]`, `[50h]`).
    pub in_end: u16,
    pub in_at: u16,
    /// Whether the byte before the input's first is to be read again (`[27Eh]`).
    pub unread: u16,
    /// The output's end and the next place, offsets (`[58h]`, `[5Ch]`).
    pub out_end: u16,
    pub out_at: u16,
    /// Bytes made so far (`[280h]`).
    pub total: i32,
    /// The ring's next place, and the flags byte being read, shifted (`[278h]`, `[27Ah]`).
    pub ring_at: u16,
    pub flags: u16,
    /// The compressed file's size (`[272h]`).
    pub file_size: i32,
    /// The ring's places left out of its spaces (`[270h]`).
    pub kept: u16,
}

/// The function that answers an export WinBox has made its own.
pub(crate) fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "LZCopy" | "CopyLZFile" => Implementation::Async(lz_copy_export),
        "LZOpenFile" => Implementation::Async(lz_open_file_export),
        "LZInit" => Implementation::Async(lz_init_export),
        "LZSeek" => Implementation::Async(lz_seek_export),
        "LZRead" => Implementation::Async(lz_read_export),
        "LZClose" => Implementation::Async(lz_close_export),
        "LZStart" => Implementation::Async(lz_start_export),
        "LZDone" => Implementation::Async(lz_done_export),
        "GetExpandedName" => Implementation::Async(get_expanded_name_export),
        "WEP" => Implementation::Sync(wep),
        "___EXPORTEDSTUB" => Implementation::Sync(exported_stub),
        _ => return None,
    })
}

const fn sel(far: u32) -> u16 {
    (far >> 16) as u16
}

const fn off(far: u32) -> u16 {
    far as u16
}

const fn far(selector: u16, offset: u16) -> u32 {
    (selector as u32) << 16 | offset as u32
}

const fn plus(at: u32, n: u16) -> u32 {
    far(sel(at), off(at).wrapping_add(n))
}

fn rd8(engine: &Engine, at: u32) -> u8 {
    engine.system().read_far(at, 1)[0]
}

fn wr8(engine: &Engine, at: u32, value: u8) {
    engine.system().write_far(at, &[value]);
}

fn rd16(engine: &Engine, at: u32) -> u16 {
    u16::from(rd8(engine, at)) | u16::from(rd8(engine, plus(at, 1))) << 8
}

fn wr16(engine: &Engine, at: u32, value: u16) {
    wr8(engine, at, value as u8);
    wr8(engine, plus(at, 1), (value >> 8) as u8);
}

fn rd32(engine: &Engine, at: u32) -> i32 {
    (u32::from(rd16(engine, at)) | u32::from(rd16(engine, plus(at, 2))) << 16) as i32
}

fn wr32(engine: &Engine, at: u32, value: i32) {
    wr16(engine, at, value as u16);
    wr16(engine, plus(at, 2), (value as u32 >> 16) as u16);
}

/// KERNEL's `_llseek`, as the library calls it.
async fn llseek(engine: &Engine, handle: u16, offset: i32, origin: u16) -> Result<i32, Stop> {
    Ok(api::api(
        engine,
        "KERNEL",
        "_llseek",
        &[Arg::W(handle), Arg::D(offset as u32), Arg::W(origin)],
    )
    .await?
    .value as i32)
}

/// `_lread`'s answer, the word as it is: `FFFFh` for an error.
async fn lread(engine: &Engine, handle: u16, to: u32, count: u16) -> Result<u16, Stop> {
    api::word(
        engine,
        "KERNEL",
        "_lread",
        &[Arg::W(handle), Arg::D(to), Arg::W(count)],
    )
    .await
}

/// `_lwrite`'s answer, the word as it is: `FFFFh` for an error.
async fn lwrite(engine: &Engine, handle: u16, from: u32, count: u16) -> Result<u16, Stop> {
    api::word(
        engine,
        "KERNEL",
        "_lwrite",
        &[Arg::W(handle), Arg::D(from), Arg::W(count)],
    )
    .await
}

async fn lclose(engine: &Engine, handle: u16) -> Result<(), Stop> {
    api::api(engine, "KERNEL", "_lclose", &[Arg::W(handle)]).await?;
    Ok(())
}

pub(crate) async fn global_alloc(engine: &Engine, flags: u16, size: u32) -> Result<u16, Stop> {
    api::word(
        engine,
        "KERNEL",
        "GlobalAlloc",
        &[Arg::W(flags), Arg::D(size)],
    )
    .await
}

pub(crate) async fn global_lock(engine: &Engine, handle: u16) -> Result<u32, Stop> {
    Ok(api::api(engine, "KERNEL", "GlobalLock", &[Arg::W(handle)])
        .await?
        .value)
}

pub(crate) async fn global_unlock(engine: &Engine, handle: u16) -> Result<(), Stop> {
    api::api(engine, "KERNEL", "GlobalUnlock", &[Arg::W(handle)]).await?;
    Ok(())
}

pub(crate) async fn global_free(engine: &Engine, handle: u16) -> Result<(), Stop> {
    api::api(engine, "KERNEL", "GlobalFree", &[Arg::W(handle)]).await?;
    Ok(())
}

/// A file's 14-byte header, as seg8 `00aa` reads it.
#[derive(Debug, Clone)]
struct Header {
    magic: [u8; 8],
    algorithm: u8,
    last: u8,
    size: i32,
    file_size: i32,
}

/// A file's header (seg8 `00aa`): the file's size kept in the state
/// (`[272h]`), then 14 bytes from its start. 1; -1 where it cannot be
/// sought or read; -3 where it is shorter.
async fn read_header(engine: &Engine, handle: u16) -> Result<(i32, Option<Header>), Stop> {
    let size = llseek(engine, handle, 0, 2).await?;

    engine.system().lzexpand.file_size = size;

    if size < 0 || llseek(engine, handle, 0, 0).await? != 0 {
        return Ok((LZERROR_BADINHANDLE, None));
    }

    let read = api::api(
        engine,
        "KERNEL",
        "_lread",
        &[Arg::W(handle), api::buffer(14), Arg::W(14)],
    )
    .await?;
    let count = read.word();

    if count != 14 {
        return Ok((
            if count == 0xffff {
                LZERROR_BADINHANDLE
            } else {
                LZERROR_READ
            },
            None,
        ));
    }

    let bytes = &read.buffers[0];
    let mut magic = [0; 8];

    magic.copy_from_slice(&bytes[..8]);

    Ok((
        1,
        Some(Header {
            magic,
            algorithm: bytes[8],
            last: bytes[9],
            size: i32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]),
            file_size: size,
        }),
    ))
}

/// Whether a header's signature is COMPRESS's, by USER's `lstrcmp` (seg8 `01a2`).
async fn compressed(engine: &Engine, header: Option<&Header>) -> Result<bool, Stop> {
    let magic = header.map_or([0; 8], |header| header.magic);
    let answer = api::word(
        engine,
        "USER",
        "lstrcmp",
        &[api::text(&magic), api::text(&SIGNATURE)],
    )
    .await?;

    Ok(answer == 0)
}

/// Whether a header's reading failed on a file of a header's length or
/// more: -1 is answered (seg2 `0027`).
fn unreadable(engine: &Engine, result: i32) -> bool {
    result != 1 && engine.system().lzexpand.file_size >= 14
}

/// A block's buffers made current (seg5 `0000`).
fn bind(engine: &Engine, block: u32) {
    let lz = &mut engine.system().lzexpand;

    lz.current.input = plus(block, BLOCK_INPUT);
    lz.current.output = plus(block, BLOCK_OUTPUT);
    lz.current.ring = plus(block, BLOCK_RING);
    lz.current.in_size = 0x400;
    lz.current.out_size = 0x400;
}

/// The current state kept in a block (seg5 `0052`).
fn save(engine: &Engine, block: u32) {
    let lz = engine.system().lzexpand.clone();
    let at = plus(block, BLOCK_SAVED);
    let fill = lz.out_at.wrapping_sub(off(lz.current.output));

    wr16(engine, at, lz.flags);
    wr16(engine, plus(at, 2), lz.ring_at);
    wr16(
        engine,
        plus(at, 4),
        lz.in_at.wrapping_sub(off(lz.current.input)),
    );
    wr16(
        engine,
        plus(at, 6),
        lz.in_end.wrapping_sub(off(lz.current.input)),
    );
    wr16(engine, plus(at, 8), lz.unread);
    wr16(engine, plus(at, 0xa), fill);
    wr16(
        engine,
        plus(at, 0xc),
        lz.out_end.wrapping_sub(off(lz.current.output)),
    );
    wr32(
        engine,
        plus(at, 0xe),
        lz.total.wrapping_sub(i32::from(fill)),
    );
}

/// A block's state made current (seg5 `00d0`).
fn restore(engine: &Engine, block: u32) {
    let at = plus(block, BLOCK_SAVED);

    bind(engine, block);

    let in_at = rd16(engine, plus(at, 4));
    let in_end = rd16(engine, plus(at, 6));
    let unread = rd16(engine, plus(at, 8));
    let fill = rd16(engine, plus(at, 0xa));
    let out_end = rd16(engine, plus(at, 0xc));
    let file_size = rd32(engine, plus(block, 9));
    let start = rd32(engine, plus(block, BLOCK_WINDOW_START));
    let flags = rd16(engine, at);
    let ring_at = rd16(engine, plus(at, 2));
    let lz = &mut engine.system().lzexpand;

    lz.in_at = off(lz.current.input).wrapping_add(in_at);
    lz.in_end = off(lz.current.input).wrapping_add(in_end);
    lz.unread = unread;
    lz.out_at = off(lz.current.output).wrapping_add(fill);
    lz.out_end = off(lz.current.output).wrapping_add(out_end);
    lz.file_size = file_size;
    lz.total = start.wrapping_add(i32::from(fill as i16));
    lz.flags = flags;
    lz.ring_at = ring_at;
    lz.kept = KEPT;
}

/// The input's buffer filled again (seg6 `0000`): the byte before its end
/// kept before its first, and as many as fit read after it. The first
/// byte answered, or the one kept where a byte was to be read again. 1; -1
/// where the read fails; 1F4h at the file's end.
async fn refill(engine: &Engine, handle: u16) -> Result<(i32, u8), Stop> {
    let lz = engine.system().lzexpand.clone();
    let input = lz.current.input;
    let before = rd8(engine, far(sel(input), lz.in_end.wrapping_sub(1)));

    wr8(engine, input, before);

    let count = lread(engine, handle, plus(input, 1), lz.current.in_size).await?;

    if count != lz.current.in_size {
        if count == 0xffff {
            return Ok((LZERROR_BADINHANDLE, 0));
        }

        if count == 0 {
            return Ok((END, 0));
        }

        engine.system().lzexpand.in_end = off(input).wrapping_add(count).wrapping_add(1);
    }

    let in_at = off(input).wrapping_add(1);

    engine.system().lzexpand.in_at = in_at;

    if engine.system().lzexpand.unread != 0 {
        engine.system().lzexpand.unread = 0;

        return Ok((1, rd8(engine, input)));
    }

    let byte = rd8(engine, far(sel(input), in_at));

    engine.system().lzexpand.in_at = in_at.wrapping_add(1);

    Ok((1, byte))
}

/// The next byte of input: from the buffer, or by `refill`.
async fn next(engine: &Engine, handle: u16) -> Result<(i32, u8), Stop> {
    let lz = engine.system().lzexpand.clone();

    if lz.in_end > lz.in_at {
        let byte = rd8(engine, far(sel(lz.current.input), lz.in_at));

        engine.system().lzexpand.in_at = lz.in_at.wrapping_add(1);

        return Ok((1, byte));
    }

    refill(engine, handle).await
}

/// The output's buffer written out, full, and a byte put at its start
/// (seg6 `00a4`). Into `handle`, or nowhere for -2, where the buffer is a
/// window of what was made last. 1; -2 where `_lwrite` fails; -4 where it
/// writes less.
async fn flush(engine: &Engine, byte: u8, handle: u16) -> Result<i32, Stop> {
    let lz = engine.system().lzexpand.clone();
    let output = lz.current.output;
    let count = lz.out_at.wrapping_sub(off(output));

    engine.system().lzexpand.out_at = off(output);

    if handle != 0xfffe {
        let written = lwrite(engine, handle, output, count).await?;

        if written != count {
            return Ok(if written == 0xffff {
                LZERROR_BADOUTHANDLE
            } else {
                LZERROR_WRITE
            });
        }
    }

    wr8(engine, output, byte);
    engine.system().lzexpand.out_at = off(output).wrapping_add(1);

    Ok(1)
}

/// A byte made: put out, and into the ring.
async fn emit(engine: &Engine, byte: u8, handle: u16) -> Result<i32, Stop> {
    let lz = engine.system().lzexpand.clone();
    let result = if lz.out_at >= lz.out_end {
        engine.system().lzexpand.total = lz.total.wrapping_add(1);
        flush(engine, byte, handle).await?
    } else {
        wr8(engine, far(sel(lz.current.output), lz.out_at), byte);

        let state = &mut engine.system().lzexpand;

        state.out_at = lz.out_at.wrapping_add(1);
        state.total = lz.total.wrapping_add(1);
        1
    };

    if result != 1 {
        return Ok(result);
    }

    let lz = engine.system().lzexpand.clone();

    wr8(
        engine,
        far(
            sel(lz.current.ring),
            off(lz.current.ring).wrapping_add(lz.ring_at),
        ),
        byte,
    );
    engine.system().lzexpand.ring_at = lz.ring_at.wrapping_add(1) & 0xfff;

    Ok(1)
}

/// The decoder (seg9 `0000`): the stream from `input` expanded into
/// `output`, until more than `limit` bytes are made or the input ends.
/// Begun again, `restart`, from the 14th byte, the ring all spaces but its
/// last 16 bytes. 1; an error of the reading or writing.
async fn decode(
    engine: &Engine,
    input: u16,
    output: u16,
    limit: i32,
    restart: bool,
) -> Result<i32, Stop> {
    engine.system().lzexpand.kept = KEPT;

    if restart {
        if llseek(engine, input, 14, 0).await? != 14 {
            return Ok(LZERROR_BADINHANDLE);
        }

        if output != 0xfffe && llseek(engine, output, 0, 0).await? != 0 {
            return Ok(LZERROR_BADOUTHANDLE);
        }

        let ring = {
            let lz = &mut engine.system().lzexpand;

            lz.in_end = off(lz.current.input)
                .wrapping_add(lz.current.in_size)
                .wrapping_add(1);
            lz.in_at = lz.in_end;
            lz.out_end = off(lz.current.output).wrapping_add(lz.current.out_size);
            lz.out_at = off(lz.current.output);
            lz.total = 0;
            lz.unread = 0;
            lz.current.ring
        };
        let spaces = vec![0x20; usize::from(RING - KEPT)];

        engine.system().write_far(ring, &spaces);

        let lz = &mut engine.system().lzexpand;

        lz.flags = 0;
        lz.ring_at = RING - KEPT;
    }

    let (mut result, mut byte) = next(engine, input).await?;

    if result != 1 && result != END {
        return Ok(result);
    }

    loop {
        if result == END {
            return Ok(1);
        }

        if engine.system().lzexpand.total > limit {
            // One too many read: read it again next time.
            let lz = &mut engine.system().lzexpand;

            if lz.in_at == off(lz.current.input).wrapping_add(1) {
                lz.unread = 1;
            } else {
                lz.in_at = lz.in_at.wrapping_sub(1);
            }

            return Ok(1);
        }

        let flags = engine.system().lzexpand.flags >> 1;

        engine.system().lzexpand.flags = flags;

        if flags & 0x100 == 0 {
            engine.system().lzexpand.flags = 0xff00 | u16::from(byte);
            (result, byte) = next(engine, input).await?;

            if result != 1 {
                return Ok(LZERROR_READ);
            }
        }

        if engine.system().lzexpand.flags & 1 != 0 {
            result = emit(engine, byte, output).await?;

            if result != 1 {
                return Ok(result);
            }
        } else {
            let (read, high) = next(engine, input).await?;

            if read != 1 {
                return Ok(LZERROR_READ);
            }

            let place = u16::from(high & 0xf0) << 4 | u16::from(byte);
            let count = u16::from(high & 0x0f) + 3;

            for i in 0..count {
                let ring = engine.system().lzexpand.current.ring;
                let copied = rd8(
                    engine,
                    far(
                        sel(ring),
                        off(ring).wrapping_add(place.wrapping_add(i) & 0xfff),
                    ),
                );

                result = emit(engine, copied, output).await?;

                if result != 1 {
                    return Ok(result);
                }
            }
        }

        (result, byte) = next(engine, input).await?;

        if result != 1 && result != END {
            return Ok(result);
        }
    }
}

/// A plain file copied whole (seg7 `0000`), through the input's buffer. 1;
/// -1 where it cannot be sought or read; -2 or -4 where it cannot be
/// written.
async fn plain_copy(engine: &Engine, input: u16, output: u16) -> Result<i32, Stop> {
    if llseek(engine, input, 0, 0).await? != 0 {
        return Ok(LZERROR_BADINHANDLE);
    }

    if output != 0xfffe && llseek(engine, output, 0, 0).await? != 0 {
        return Ok(LZERROR_BADOUTHANDLE);
    }

    let buffers = {
        let lz = &mut engine.system().lzexpand;

        lz.in_end = off(lz.current.input)
            .wrapping_add(lz.current.in_size)
            .wrapping_add(1);
        lz.in_at = lz.in_end;
        lz.unread = 0;
        lz.out_end = off(lz.current.output).wrapping_add(lz.current.out_size);
        lz.out_at = off(lz.current.output);
        lz.total = 0;
        lz.current
    };

    loop {
        let count = lread(engine, input, buffers.input, buffers.in_size).await?;

        if count == 0 || count == 0xffff {
            return Ok(if count == 0xffff {
                LZERROR_BADINHANDLE
            } else {
                1
            });
        }

        let written = lwrite(engine, output, buffers.input, count).await?;

        if written != count {
            return Ok(if written == 0xffff {
                LZERROR_BADOUTHANDLE
            } else {
                LZERROR_WRITE
            });
        }

        let lz = &mut engine.system().lzexpand;

        lz.total = lz.total.wrapping_add(i32::from(written));

        if count != buffers.in_size {
            return Ok(1);
        }
    }
}

/// A DOS call, AX and CX as given, BX the handle: the carry, CX and DX after.
async fn dos(
    engine: &Engine,
    ax: u16,
    bx: u16,
    cx: u16,
    dx: u16,
) -> Result<(bool, u16, u16), Stop> {
    let saved = {
        let mut system = engine.system();
        let cpu = &mut system.cpu;
        let saved = (
            cpu.regs[AX],
            cpu.regs[BX],
            cpu.regs[CX],
            cpu.regs[DX],
            cpu.flags,
        );

        cpu.regs[AX] = ax;
        cpu.regs[BX] = bx;
        cpu.regs[CX] = cx;
        cpu.regs[DX] = dx;
        saved
    };

    api::api(engine, "KERNEL", "Dos3Call", &[]).await?;

    let mut system = engine.system();
    let cpu = &mut system.cpu;
    let after = (cpu.flags & 1 != 0, cpu.regs[CX], cpu.regs[DX]);

    (cpu.regs[AX], cpu.regs[BX], cpu.regs[CX], cpu.regs[DX]) = (saved.0, saved.1, saved.2, saved.3);
    cpu.flags = saved.4;

    Ok(after)
}

/// The source's time and date given to what was made (seg10 `02a8`): DOS
/// 5700h, then 5701h. 1; -1 where the first fails, -2 the second.
async fn copy_stamp(engine: &Engine, input: u16, output: u16) -> Result<i32, Stop> {
    let (carry, time, date) = dos(engine, 0x5700, input, 0, 0).await?;

    if carry {
        return Ok(LZERROR_BADINHANDLE);
    }

    let (carry, _, _) = dos(engine, 0x5701, output, time, date).await?;

    Ok(if carry { LZERROR_BADOUTHANDLE } else { 1 })
}

/// A file copied, expanded where it is compressed (seg7 `00f4`): the
/// copying `LZCopy` does once it has DOS's handle.
async fn copy_file(engine: &Engine, input: u16, output: u16) -> Result<i32, Stop> {
    let (read, header) = read_header(engine, input).await?;

    if unreadable(engine, read) {
        return Ok(LZERROR_BADINHANDLE);
    }

    let packed = compressed(engine, header.as_ref()).await?;
    let mut result = match &header {
        Some(header) if packed => {
            if header.algorithm == 0x41 {
                decode(engine, input, output, header.size.wrapping_sub(1), true).await?
            } else {
                LZERROR_UNKNOWNALG
            }
        }
        _ => plain_copy(engine, input, output).await?,
    };

    if result != 1 {
        return Ok(result);
    }

    let flushed = flush(engine, 0x46, output).await?;

    if flushed != 1 {
        return Ok(flushed);
    }

    result = copy_stamp(engine, input, output).await?;

    if result != 1 {
        return Ok(result);
    }

    if let Some(header) = header.filter(|_| packed)
        && engine.system().lzexpand.total != header.size
    {
        return Ok(LZERROR_READ);
    }

    Ok(result)
}

/// The copying buffers allocated (seg1 `0000`): 1, or nought where they
/// cannot be.
async fn allocate(engine: &Engine) -> Result<i32, Stop> {
    if engine.system().lzexpand.current.ring != 0 {
        return Ok(1);
    }

    let ring = global_alloc(engine, 0x2040, 0x1080).await?;

    engine.system().lzexpand.current.ring = far(ring, 0);

    if ring == 0 {
        return Ok(0);
    }

    {
        let lz = &mut engine.system().lzexpand;

        lz.current.in_size = 0x8000;
        lz.current.out_size = 0x8000;
    }

    while engine.system().lzexpand.current.out_size != 0 {
        let sizes = engine.system().lzexpand.current;
        let input = global_alloc(engine, 0x2040, u32::from(sizes.in_size) + 1).await?;

        engine.system().lzexpand.current.input = far(input, 0);

        if input != 0 {
            let output = global_alloc(engine, 0x2040, u32::from(sizes.out_size)).await?;

            engine.system().lzexpand.current.output = far(output, 0);

            if output != 0 {
                return Ok(1);
            }

            global_free(engine, input).await?;
        }

        let lz = &mut engine.system().lzexpand;

        lz.current.out_size = lz.current.out_size.wrapping_sub(0x400);
        lz.current.in_size = lz.current.in_size.wrapping_sub(0x400);
    }

    global_free(engine, ring).await?;

    Ok(0)
}

/// The copying buffers let go (seg1 `00b2`).
async fn release(engine: &Engine) -> Result<(), Stop> {
    let picks: [fn(&mut Buffers) -> &mut u32; 3] = [
        |b: &mut Buffers| &mut b.ring,
        |b: &mut Buffers| &mut b.input,
        |b: &mut Buffers| &mut b.output,
    ];

    for pick in picks {
        let at = *pick(&mut engine.system().lzexpand.current);

        if at != 0 {
            global_free(engine, sel(at)).await?;
            *pick(&mut engine.system().lzexpand.current) = 0;
        }
    }

    Ok(())
}

/// `LZStart` (seg4 `0000`): the copying buffers made, the first time. 1, or -5.
pub(crate) async fn lz_start(engine: &Engine) -> Result<i32, Stop> {
    {
        let lz = &mut engine.system().lzexpand;

        lz.current = lz.saved;
    }

    if engine.system().lzexpand.starts == 0 {
        if allocate(engine).await? != 1 {
            return Ok(LZERROR_GLOBALLOC);
        }

        let lz = &mut engine.system().lzexpand;

        lz.saved = lz.current;
    }

    let lz = &mut engine.system().lzexpand;

    lz.starts = lz.starts.saturating_add(1);

    Ok(1)
}

/// `LZDone` (seg4 `00a6`): the copying buffers let go with the last start.
pub(crate) async fn lz_done(engine: &Engine) -> Result<(), Stop> {
    if engine.system().lzexpand.starts == 0 {
        return Ok(());
    }

    engine.system().lzexpand.starts -= 1;

    if engine.system().lzexpand.starts == 0 {
        {
            let lz = &mut engine.system().lzexpand;

            lz.current = lz.saved;
        }

        release(engine).await?;

        let lz = &mut engine.system().lzexpand;

        lz.saved = lz.current;
    }

    Ok(())
}

/// `LZCopy` (seg4 `015c`): a file copied into another, expanded where it
/// is compressed. A handle past the sixteenth LZ handle reads past
/// LZEXPAND's table (seg4 `0185`), which is not followed: it is answered as
/// an empty slot is.
pub(crate) async fn lz_copy(engine: &Engine, source: u16, dest: u16) -> Result<i32, Stop> {
    let started = lz_start(engine).await?;

    if started != 1 {
        return Ok(started);
    }

    let mut input = source;

    if source as i16 >= BASE {
        let slot = usize::from(source) - BASE as usize;
        let block = engine
            .system()
            .lzexpand
            .slots
            .get(slot)
            .copied()
            .unwrap_or(0);

        if block == 0 {
            lz_done(engine).await?;

            return Ok(LZERROR_BADINHANDLE);
        }

        let at = global_lock(engine, block).await?;

        if at == 0 {
            lz_done(engine).await?;

            return Ok(LZERROR_GLOBLOCK);
        }

        input = rd16(engine, at);
        global_unlock(engine, block).await?;
    }

    let copied = copy_file(engine, input, dest).await?;
    let result = if copied == 1 {
        engine.system().lzexpand.total
    } else {
        copied
    };

    lz_done(engine).await?;

    Ok(result)
}

/// `LZInit` (seg2 `0000`): a DOS handle of a file COMPRESS made given an LZ
/// handle, its block made; another file's handle answered as it is, back at
/// its start.
pub(crate) async fn lz_init(engine: &Engine, handle: u16) -> Result<i32, Stop> {
    let (read, header) = read_header(engine, handle).await?;

    if unreadable(engine, read) {
        return Ok(LZERROR_BADINHANDLE);
    }

    let header = match header {
        Some(header) if read == 1 && compressed(engine, Some(&header)).await? => header,
        _ => {
            if llseek(engine, handle, 0, 0).await? != 0 {
                return Ok(LZERROR_BADINHANDLE);
            }

            return Ok(i32::from(handle as i16));
        }
    };

    if header.algorithm != 0x41 {
        return Ok(LZERROR_UNKNOWNALG);
    }

    {
        let lz = &mut engine.system().lzexpand;
        let first = lz.next;

        while lz.slots[lz.next] != 0 {
            lz.next = if lz.next + 1 >= SLOTS { 0 } else { lz.next + 1 };

            if lz.next == first {
                return Ok(LZERROR_GLOBALLOC);
            }
        }
    }

    let slot = engine.system().lzexpand.next;
    let block = global_alloc(engine, 0x42, BLOCK_SIZE).await?;

    if block == 0 {
        return Ok(LZERROR_GLOBALLOC);
    }

    let at = global_lock(engine, block).await?;

    if at == 0 {
        global_free(engine, block).await?;

        return Ok(LZERROR_GLOBLOCK);
    }

    wr16(engine, at, handle);
    wr8(engine, plus(at, 2), header.algorithm);
    wr16(engine, plus(at, 3), 0);
    wr32(engine, plus(at, 5), header.size);
    wr32(engine, plus(at, 9), header.file_size);
    wr32(engine, plus(at, 0xd), 0);
    engine.system().lzexpand.slots[slot] = block;
    bind(engine, at);

    {
        let lz = &mut engine.system().lzexpand;

        lz.in_end = off(lz.current.input)
            .wrapping_add(lz.current.in_size)
            .wrapping_add(1);
        lz.in_at = lz.in_end;
        lz.unread = 0;
        lz.out_end = off(lz.current.output).wrapping_add(lz.current.out_size);
        lz.out_at = off(lz.current.output);
        lz.total = 0;
    }

    save(engine, at);
    global_unlock(engine, block).await?;

    let lz = &mut engine.system().lzexpand;

    lz.next = if lz.next + 1 >= SLOTS { 0 } else { lz.next + 1 };

    Ok(i32::from(slot as i16 + BASE))
}

/// A handle out of range: negative, or past the sixteenth LZ handle.
fn out_of_range(handle: i16) -> bool {
    handle < 0 || handle >= BASE + SLOTS as i16
}

/// An LZ handle's block, by its slot.
fn block_of(engine: &Engine, handle: i16) -> u16 {
    engine.system().lzexpand.slots[(handle - BASE) as usize]
}

/// `LZSeek` (seg2 `02ee`): an LZ handle's place in the expanded file set.
pub(crate) async fn lz_seek(
    engine: &Engine,
    handle: u16,
    offset: i32,
    origin: u16,
) -> Result<i32, Stop> {
    let h = handle as i16;

    if out_of_range(h) {
        return Ok(LZERROR_BADINHANDLE);
    }

    if h < BASE {
        return llseek(engine, handle, offset, origin).await;
    }

    let block = block_of(engine, h);
    let at = global_lock(engine, block).await?;

    if at == 0 {
        return Ok(LZERROR_GLOBLOCK);
    }

    let base = match origin as i16 {
        0 => 0,
        1 => rd32(engine, plus(at, 0xd)),
        2 => rd32(engine, plus(at, 5)),
        _ => {
            global_unlock(engine, block).await?;

            return Ok(LZERROR_BADVALUE);
        }
    };
    let to = base.wrapping_add(offset);

    if to < 0 {
        global_unlock(engine, block).await?;

        return Ok(LZERROR_BADVALUE);
    }

    wr32(engine, plus(at, 0xd), to);
    global_unlock(engine, block).await?;

    Ok(to)
}

/// `LZRead` (seg2 `03d6`): bytes of the expanded file, from an LZ handle's
/// place.
#[allow(clippy::too_many_lines)]
pub(crate) async fn lz_read(
    engine: &Engine,
    handle: u16,
    buffer: u32,
    count: u16,
) -> Result<i32, Stop> {
    let h = handle as i16;
    let mut wanted = count as i16;
    let mut done: i32 = 0;

    if out_of_range(h) {
        return Ok(LZERROR_BADINHANDLE);
    }

    if wanted < 0 {
        return Ok(LZERROR_BADVALUE);
    }

    if h < BASE {
        return Ok(i32::from(
            lread(engine, handle, buffer, count).await? as i16,
        ));
    }

    let block = block_of(engine, h);
    let at = global_lock(engine, block).await?;

    if at == 0 {
        return Ok(LZERROR_GLOBLOCK);
    }

    let position = |engine: &Engine| rd32(engine, plus(at, 0xd));
    let size = |engine: &Engine| rd32(engine, plus(at, 5));
    let window_start = |engine: &Engine| rd32(engine, plus(at, BLOCK_WINDOW_START));
    let mut restart = if rd8(engine, plus(at, 3)) & 1 == 0 {
        let flags = rd8(engine, plus(at, 3));

        wr8(engine, plus(at, 3), flags | 1);
        true
    } else {
        position(engine) < window_start(engine)
    };

    restore(engine, at);

    let mut to = buffer;

    while wanted > 0 && position(engine) < size(engine) {
        let filled = {
            let lz = &engine.system().lzexpand;

            lz.out_at.wrapping_sub(off(lz.current.output)) as i16
        };
        let from = position(engine).wrapping_sub(window_start(engine));
        let window = rd16(engine, plus(at, BLOCK_WINDOW_SIZE)) as i16;
        let mut index = if from < i32::from(window) {
            from as u16 as i16
        } else {
            -1
        };

        if index >= 0 {
            let mut copied: i16 = 0;

            while filled > index && wanted > 0 {
                let byte = rd8(engine, plus(at, BLOCK_OUTPUT.wrapping_add(index as u16)));

                wr8(engine, to, byte);
                to = plus(to, 1);
                copied += 1;
                wanted -= 1;
                index += 1;
            }

            wr32(
                engine,
                plus(at, 0xd),
                position(engine).wrapping_add(i32::from(copied)),
            );
            done += i32::from(copied);
        }

        if wanted <= 0 || position(engine) >= size(engine) {
            break;
        }

        let kept = i32::from(engine.system().lzexpand.kept as i16);
        let target = if restart {
            position(engine).wrapping_sub(kept).max(0)
        } else {
            i32::from(window)
                .wrapping_add(window_start(engine))
                .wrapping_sub(kept)
                .wrapping_add(i32::from(filled))
        };
        let mut end = position(engine).wrapping_add(i32::from(wanted));

        if end > size(engine).wrapping_sub(1) {
            end = size(engine).wrapping_sub(1);
        }

        if end > target {
            end = target;
        }

        {
            let lz = &mut engine.system().lzexpand;

            lz.out_at = off(lz.current.output);
        }

        let result = if rd8(engine, plus(at, 2)) == 0x41 {
            let input = rd16(engine, at);

            decode(engine, input, 0xfffe, end, restart).await?
        } else {
            LZERROR_UNKNOWNALG
        };

        if result != 1 {
            global_unlock(engine, block).await?;

            return Ok(result);
        }

        let (made, total) = {
            let lz = &engine.system().lzexpand;

            (
                lz.out_at.wrapping_sub(off(lz.current.output)) as i16,
                lz.total,
            )
        };

        if made <= 0 {
            global_unlock(engine, block).await?;

            return Ok(LZERROR_READ);
        }

        wr32(
            engine,
            plus(at, BLOCK_WINDOW_START),
            total.wrapping_sub(i32::from(made)),
        );

        if total < end {
            global_unlock(engine, block).await?;

            return Ok(LZERROR_READ);
        }

        restart = false;
    }

    save(engine, at);
    global_unlock(engine, block).await?;

    Ok(done)
}

/// `LZClose` (seg2 `06f0`): a handle let go, its file closed.
pub(crate) async fn lz_close(engine: &Engine, handle: u16) -> Result<(), Stop> {
    let h = handle as i16;

    if out_of_range(h) {
        return Ok(());
    }

    if h < BASE {
        return lclose(engine, handle).await;
    }

    let block = block_of(engine, h);

    engine.system().lzexpand.slots[(h - BASE) as usize] = 0;

    let at = global_lock(engine, block).await?;

    if at == 0 {
        return Ok(());
    }

    let file = rd16(engine, at);

    lclose(engine, file).await?;
    global_unlock(engine, block).await?;
    global_free(engine, block).await
}

/// Where a path's last part begins, after its last `\`, `/` or `:` (seg10 `0000`).
fn last_part(name: &[u8]) -> usize {
    let mut at = 0;

    for (i, &byte) in name.iter().enumerate() {
        if byte == 0 {
            break;
        }

        if byte == b'/' || byte == b'\\' || byte == b':' {
            at = i + 1;
        }
    }

    at
}

fn byte_at(name: &[u8], at: usize) -> u8 {
    name.get(at).copied().unwrap_or(0)
}

/// Where a name's extension begins, after its period; none for none (seg10 `004e`).
pub(crate) fn extension_at(name: &[u8]) -> Option<usize> {
    let mut at = last_part(name);

    if byte_at(name, at) != 0 {
        while byte_at(name, at) != 0 && byte_at(name, at) != b'.' {
            at += 1;
        }
    }

    (byte_at(name, at) == b'.').then_some(at + 1)
}

fn strlen(name: &[u8], at: usize) -> usize {
    name[at.min(name.len())..]
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(name.len().saturating_sub(at))
}

/// A name as COMPRESS names what it makes (seg10 `0124`): its extension's
/// last character an underscore, one added to an extension shorter than
/// three, `._` to a name with none.
pub(crate) fn compressed_name(name: &[u8]) -> Vec<u8> {
    let end = strlen(name, 0);
    let mut out = name[..end].to_vec();

    match extension_at(name) {
        Some(ext) => {
            let length = strlen(name, ext);

            if length >= 3 {
                out[ext + length - 1] = b'_';
            } else {
                out.push(b'_');
            }
        }
        None => out.extend_from_slice(b"._"),
    }

    out
}

/// An expanded file's name (seg10 `01b6`): the underscore ending its
/// extension the header's last character, in the case of the name's first
/// letter; a period left alone at its end taken off.
async fn expanded_name(engine: &Engine, name: &[u8], last: u8) -> Result<Vec<u8>, Stop> {
    let Some(ext) = extension_at(name) else {
        return Ok(name.to_vec());
    };
    let mut c = last;

    if c.is_ascii_alphabetic() {
        // The first ASCII letter of the whole path, bytes past 7Fh skipped.
        let letter = name
            .iter()
            .take_while(|&&b| b != 0)
            .find(|b| b.is_ascii_alphabetic())
            .copied()
            .unwrap_or(0);

        if api::word(engine, "USER", "IsCharLower", &[Arg::W(u16::from(letter))]).await? != 0 {
            if c.is_ascii_uppercase() {
                c += 0x20;
            }
        } else if api::word(engine, "USER", "IsCharUpper", &[Arg::W(u16::from(letter))]).await? != 0
            && c.is_ascii_lowercase()
        {
            c -= 0x20;
        }
    }

    let mut out = name.to_vec();
    let length = strlen(&out, ext);

    if length > 0 && out[ext + length - 1] == b'_' {
        out[ext + length - 1] = c;
    }

    if byte_at(&out, ext) == 0 && out[ext - 1] == b'.' {
        out[ext - 1] = 0;
    }

    Ok(out)
}

/// A string at a far pointer, without its nought.
fn string_at(engine: &Engine, at: u32) -> Vec<u8> {
    engine.system().read_string(at)
}

/// `GetExpandedName` (seg2 `01bc`): the name a compressed file had.
pub(crate) async fn get_expanded_name(
    engine: &Engine,
    source: u32,
    buffer: u32,
) -> Result<i32, Stop> {
    let name = string_at(engine, source);
    let handle = api::word(
        engine,
        "KERNEL",
        "OpenFile",
        &[api::text(&name), api::buffer(136), Arg::W(0)],
    )
    .await?;

    if handle == 0xffff {
        return Ok(LZERROR_BADINHANDLE);
    }

    let (read, header) = read_header(engine, handle).await?;

    if unreadable(engine, read) {
        return Ok(LZERROR_BADINHANDLE);
    }

    lclose(engine, handle).await?;

    let mut out = name.clone();

    out.push(0);

    if let Some(header) = header
        && read == 1
        && compressed(engine, Some(&header)).await?
    {
        out = expanded_name(engine, &out, header.last).await?;
    }

    let length = strlen(&out, 0);
    let mut bytes = out[..length].to_vec();

    bytes.push(0);
    engine.system().write_far(buffer, &bytes);

    Ok(1)
}

/// `LZOpenFile` (seg2 `0262`): a file opened by `OpenFile`, or its
/// compressed name's where it is not there, and given to `LZInit` where it
/// is opened only to be read.
pub(crate) async fn lz_open_file(
    engine: &Engine,
    file: u32,
    of: u32,
    style: u16,
) -> Result<i32, Stop> {
    // Copied into the library's own 128 bytes (`[1E0h]`).
    let mut name = string_at(engine, file);
    let mut handle = api::word(
        engine,
        "KERNEL",
        "OpenFile",
        &[api::text(&name), Arg::D(of), Arg::W(style)],
    )
    .await?;

    if handle == 0xffff && rd16(engine, plus(of, 2)) == 2 {
        name = compressed_name(&name);
        handle = api::word(
            engine,
            "KERNEL",
            "OpenFile",
            &[api::text(&name), Arg::D(of), Arg::W(style)],
        )
        .await?;
    }

    if handle == 0xffff || style & 0xff0f != 0 {
        return Ok(i32::from(handle as i16));
    }

    let result = lz_init(engine, handle).await?;

    if result < 0 {
        lclose(engine, handle).await?;
    }

    Ok(result)
}

fn lz_copy_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (source, dest) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        Ok(Answer::Dword(lz_copy(engine, source, dest).await? as u32))
    })
}

fn lz_open_file_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (file, of, style) = {
            let system = engine.system();

            (args.dword(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(
            lz_open_file(engine, file, of, style).await? as u16,
        ))
    })
}

fn lz_init_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let handle = args.word(&engine.system());

        Ok(Answer::Word(lz_init(engine, handle).await? as u16))
    })
}

fn lz_seek_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, offset, origin) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Dword(
            lz_seek(engine, handle, offset as i32, origin).await? as u32,
        ))
    })
}

fn lz_read_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, buffer, count) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(
            lz_read(engine, handle, buffer, count).await? as u16,
        ))
    })
}

fn lz_close_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let handle = args.word(&engine.system());

        lz_close(engine, handle).await?;
        Ok(Answer::Nothing)
    })
}

fn lz_start_export(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move { Ok(Answer::Word(lz_start(engine).await? as u16)) })
}

fn lz_done_export(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        lz_done(engine).await?;
        Ok(Answer::Nothing)
    })
}

fn get_expanded_name_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (source, buffer) = {
            let system = engine.system();

            (args.dword(&system), args.dword(&system))
        };

        Ok(Answer::Word(
            get_expanded_name(engine, source, buffer).await? as u16,
        ))
    })
}

/// `LZEXPAND`'s exit procedure (seg3 `0000`): it does nothing.
#[allow(clippy::unnecessary_wraps)]
fn wep(_: &mut crate::system::System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Nothing)
}

/// `___EXPORTEDSTUB` (seg11 `035e`): nought.
#[allow(clippy::unnecessary_wraps)]
fn exported_stub(_: &mut crate::system::System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::Kept;

    /// Each export WinBox answers here is one the TypeScript engine
    /// answers, and no other: its table is `kept.rs`'s.
    #[test]
    fn ours_agree() {
        let kept = Kept::named(NAME).expect("LZEXPAND kept");

        for export in kept.exports.iter().flatten() {
            assert_eq!(
                implementation(export.name).is_some(),
                !export.stub,
                "{} answered by one engine only",
                export.name
            );
        }
    }

    #[test]
    fn names_as_compress_makes_them() {
        assert_eq!(compressed_name(b"C:\\A\\FOO.EXE"), b"C:\\A\\FOO.EX_");
        assert_eq!(compressed_name(b"FOO.C"), b"FOO.C_");
        assert_eq!(compressed_name(b"FOO"), b"FOO._");
        assert_eq!(compressed_name(b"A.B\\FOO"), b"A.B\\FOO._");
    }
}
