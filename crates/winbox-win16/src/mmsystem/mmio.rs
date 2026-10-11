//! MMSYSTEM's buffered file I/O, the `mmio` functions, as **read out** of
//! `MMSYSTEM.DLL` seg7 (`0`-`188f`), its handles seg4 `2e6`-`350` and
//! seg1 `1e8`, and **recorded** by the `mmio` probe.
//!
//! * A file open is a block of MMSYSTEM's local heap: an `MMIOINFO`, 42h
//!   bytes, past the header every handle of MMSYSTEM's has (`2e6`), its
//!   kind 5. The handle is the block's offset, and the structure an I/O
//!   procedure is handed is MMSYSTEM's data segment at it. Every call
//!   checks the handle's kind first (seg1 `1e8`).
//! * The procedure that does the I/O is found by a four-character code:
//!   the structure's `fccIOProc`, or the extension before a `+` in the
//!   name (`FOO.XYZ+inner` is `XYZ `), else `DOS ` (`bf`). It is looked
//!   for among those installed, the task's first and then the global ones
//!   (`0`). `DOS ` and `MEM ` are installed in MMSYSTEM's own data, global
//!   and not to be removed (`DS:26h`, `DS:34h`). A code found nowhere is
//!   the DOS procedure's (`117b`).
//! * The buffer is MMSYSTEM's own, `GlobalAlloc`'d moveable and locked,
//!   or the program's. `pchNext` is where the next byte is read or
//!   written, `pchEndRead` the end of what the buffer holds, `pchEndWrite`
//!   its end; `lBufOffset` is the file's offset of the buffer's start, and
//!   `lDiskOffset` the I/O procedure's own idea of where the file is.
//!   Reads and writes go through the buffer while they fit in it, else
//!   straight to the procedure (`4b4`, `62b`).
//! * A seek inside what the buffer holds moves `pchNext` only; any other
//!   flushes and empties it (`7e9`). `SEEK_END` asks the procedure where
//!   the end is and takes the offset back from it: the end less the
//!   offset, not plus.
//!
//! The handles' numbers are winbox.js's own: MMSYSTEM's are offsets of
//! blocks in its local heap, which winbox.js does not keep; it lays a
//! file's block at `8006h` and on, in steps of 50h, a freed one taken
//! again first. The DOS and memory procedures are winbox.js's, at ordinals
//! of MMSYSTEM's that Windows leaves empty, which `GetProcAddress` does not
//! answer.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::DS;
use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::modules::Export;
use crate::system::{STEP, System};

/// The `MMIOINFO`'s size, and its fields' offsets.
pub const INFO_SIZE: u16 = 0x42;
const FLAGS: u16 = 0x00;
const FCC: u16 = 0x04;
const PROC: u16 = 0x08;
const ERROR: u16 = 0x0c;
const TASK: u16 = 0x0e;
const CCH: u16 = 0x10;
const BUFFER: u16 = 0x14;
const NEXT: u16 = 0x18;
const END_READ: u16 = 0x1c;
const END_WRITE: u16 = 0x20;
const BUF_OFFSET: u16 = 0x24;
const DISK_OFFSET: u16 = 0x28;
const INFO0: u16 = 0x2c;
const HANDLE: u16 = 0x40;

/// An `MMCKINFO`'s size, and its fields' offsets.
const CK_SIZE: u32 = 0x14;
const CK_ID: u32 = 0x00;
const CK_LENGTH: u32 = 0x04;
const CK_TYPE: u32 = 0x08;
const CK_DATA: u32 = 0x0c;
const CK_FLAGS: u32 = 0x10;

pub const MMIO_WRITE: u32 = 0x0001;
pub const MMIO_CREATE: u32 = 0x1000;
pub const MMIO_PARSE: u32 = 0x0100;
pub const MMIO_DELETE: u32 = 0x0200;
pub const MMIO_EXIST: u32 = 0x4000;
pub const MMIO_ALLOCBUF: u32 = 0x0001_0000;
pub const MMIO_GETTEMP: u32 = 0x0002_0000;
pub const MMIO_DIRTY: u32 = 0x1000_0000;
/// `mmioFlush`'s and `mmioClose`'s flag; `mmioStringToFOURCC`'s and
/// `mmioDescend`'s share its bit.
pub const MMIO_EMPTYBUF: u16 = 0x10;
pub const MMIO_FHOPEN: u32 = 0x10;
pub const MMIO_TOUPPER: u16 = 0x10;
pub const MMIO_FINDCHUNK: u16 = 0x10;
pub const MMIO_FINDRIFF: u16 = 0x20;
pub const MMIO_FINDLIST: u16 = 0x40;
pub const MMIO_CREATERIFF: u16 = 0x20;
pub const MMIO_CREATELIST: u16 = 0x40;

pub const MMIO_INSTALLPROC: u32 = 0x0001_0000;
pub const MMIO_REMOVEPROC: u32 = 0x0002_0000;
pub const MMIO_FINDPROC: u32 = 0x0004_0000;
pub const MMIO_GLOBALPROC: u32 = 0x1000_0000;

pub const MMIOM_READ: u16 = 0;
pub const MMIOM_WRITE: u16 = 1;
pub const MMIOM_SEEK: u16 = 2;
pub const MMIOM_OPEN: u16 = 3;
pub const MMIOM_CLOSE: u16 = 4;
pub const MMIOM_WRITEFLUSH: u16 = 5;
pub const MMIOM_RENAME: u16 = 6;

pub const MMSYSERR_INVALHANDLE: u16 = 5;
pub const MMSYSERR_INVALFLAG: u16 = 10;
pub const MMSYSERR_INVALPARAM: u16 = 11;
pub const MMIOERR_FILENOTFOUND: u16 = 0x101;
pub const MMIOERR_OUTOFMEMORY: u16 = 0x102;
pub const MMIOERR_CANNOTCLOSE: u16 = 0x104;
pub const MMIOERR_CANNOTREAD: u16 = 0x105;
pub const MMIOERR_CANNOTWRITE: u16 = 0x106;
pub const MMIOERR_CANNOTSEEK: u16 = 0x107;
pub const MMIOERR_CANNOTEXPAND: u16 = 0x108;
pub const MMIOERR_CHUNKNOTFOUND: u16 = 0x109;
pub const MMIOERR_UNBUFFERED: u16 = 0x10a;

/// The four-character codes MMSYSTEM knows itself.
pub const FOURCC_DOS: u32 = u32::from_le_bytes(*b"DOS ");
pub const FOURCC_MEM: u32 = u32::from_le_bytes(*b"MEM ");
pub const FOURCC_RIFF: u32 = u32::from_le_bytes(*b"RIFF");
pub const FOURCC_LIST: u32 = u32::from_le_bytes(*b"LIST");

/// The buffer `MMIO_ALLOCBUF` makes where none is asked for (`37b`).
const DEFAULT_BUFFER: u32 = 0x2000;

/// A handle's kind in its header: a file's (`2a5`, `push 5`).
const KIND_FILE: u16 = 5;

/// Where winbox.js lays the files' blocks in MMSYSTEM's data segment, and
/// how far apart; and the nought `mmioAscend` writes to make a chunk even,
/// MMSYSTEM's `cs:1561`.
const BLOCK_FIRST: u16 = 0x8006;
const BLOCK_STEP: u16 = 0x50;
const PAD_BYTE: u16 = 0x8000;

/// Where the DOS procedure has `OpenFile` fill its `OFSTRUCT`: MMSYSTEM's
/// is in its frame (`bp-8Ch`), winbox.js's in its data.
const OFSTRUCT_AT: u16 = 0x7f00;

/// The ordinals of MMSYSTEM's that winbox.js puts its own procedures at:
/// none of Windows' is there (its exports run 1104 to 1210).
pub const DOS_ORDINAL: u16 = 1200;
pub const MEM_ORDINAL: u16 = 1201;

/// An I/O procedure installed: its code, its address, the task it is for
/// (nought for every task), and whether it may be removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Installed {
    fcc: u32,
    procedure: u32,
    task: u16,
    fixed: bool,
}

/// What MMSYSTEM keeps of its files: which blocks are open, and the I/O
/// procedures installed, the latest first.
#[derive(Debug, Default)]
pub struct Mmio {
    blocks: Vec<bool>,
    installed: Option<Vec<Installed>>,
}

impl Mmio {
    /// The procedures installed: to begin with, `DOS `'s and then `MEM `'s,
    /// global, in MMSYSTEM's data (`DS:26h` and `DS:34h`, the list's head
    /// at `DS:42h`), their flags 1, which `58` will not remove.
    fn installed(&mut self, own: (u32, u32)) -> &mut Vec<Installed> {
        self.installed.get_or_insert_with(|| {
            vec![
                Installed {
                    fcc: FOURCC_DOS,
                    procedure: own.0,
                    task: 0,
                    fixed: true,
                },
                Installed {
                    fcc: FOURCC_MEM,
                    procedure: own.1,
                    task: 0,
                    fixed: true,
                },
            ]
        })
    }

    /// Whether a number is a file's handle (seg1 `1e8`).
    fn is_open(&self, handle: u16) -> bool {
        handle
            .checked_sub(BLOCK_FIRST)
            .filter(|slot| slot % BLOCK_STEP == 0)
            .and_then(|slot| self.blocks.get(usize::from(slot / BLOCK_STEP)))
            .copied()
            .unwrap_or(false)
    }

    /// A block taken: its handle.
    fn take(&mut self) -> u16 {
        let slot = self
            .blocks
            .iter()
            .position(|open| !open)
            .unwrap_or_else(|| {
                self.blocks.push(false);
                self.blocks.len() - 1
            });

        self.blocks[slot] = true;
        BLOCK_FIRST + BLOCK_STEP * slot as u16
    }

    fn give_back(&mut self, handle: u16) {
        if let Some(slot) = handle.checked_sub(BLOCK_FIRST)
            && let Some(open) = self.blocks.get_mut(usize::from(slot / BLOCK_STEP))
        {
            *open = false;
        }
    }
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "mmioOpen" => mmio_open,
        "mmioClose" => mmio_close,
        "mmioRead" => mmio_read,
        "mmioWrite" => mmio_write,
        "mmioSeek" => mmio_seek,
        "mmioGetInfo" => mmio_get_info,
        "mmioSetInfo" => mmio_set_info,
        "mmioSetBuffer" => mmio_set_buffer,
        "mmioFlush" => mmio_flush,
        "mmioAdvance" => mmio_advance,
        "mmioStringToFOURCC" => mmio_string_to_fourcc,
        "mmioInstallIOProc" => mmio_install_io_proc,
        "mmioSendMessage" => mmio_send_message,
        "mmioDescend" => mmio_descend,
        "mmioAscend" => mmio_ascend,
        "mmioCreateChunk" => mmio_create_chunk,
        "mmioRename" => mmio_rename,
        "mmioDOSIOProc" => dos_proc_call,
        "mmioMEMIOProc" => mem_proc_call,
        _ => return None,
    }))
}

/// One of winbox.js's own procedures at an ordinal of MMSYSTEM's where
/// Windows exports nothing: its stub pops its arguments and its call is
/// answered here, but it is no export -- `GetProcAddress` does not find it,
/// and the export table has nothing there.
pub fn hidden(module: &str, ordinal: u16) -> Option<Export> {
    let name = match ordinal {
        DOS_ORDINAL => "mmioDOSIOProc",
        MEM_ORDINAL => "mmioMEMIOProc",
        _ => return None,
    };

    module.eq_ignore_ascii_case("MMSYSTEM").then_some(Export {
        name,
        pops: 14,
        returns: 4,
        stub: false,
    })
}

/// MMSYSTEM's data segment, as a far pointer's selector.
fn data(system: &System) -> u32 {
    system.kept_named("MMSYSTEM").map_or(0, |kept| {
        u32::from(segment_selector(system.kept[kept].data)) << 16
    })
}

/// The address of one of winbox.js's own procedures, by its ordinal.
fn own_address(system: &mut System, ordinal: u16) -> u32 {
    let Some(kept) = system.kept_named("MMSYSTEM") else {
        return 0;
    };
    let stubs = system.stubs(kept);

    u32::from(segment_selector(stubs)) << 16 | u32::from(STEP * (ordinal + 1))
}

fn dos_address(system: &mut System) -> u32 {
    own_address(system, DOS_ORDINAL)
}

fn mem_address(system: &mut System) -> u32 {
    own_address(system, MEM_ORDINAL)
}

/// The DOS procedure's address and the memory one's.
fn own_procs(system: &mut System) -> (u32, u32) {
    (dos_address(system), mem_address(system))
}

fn read16(system: &System, far: u32) -> u16 {
    let bytes = system.read_far(far, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn read32(system: &System, far: u32) -> u32 {
    let bytes = system.read_far(far, 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn write16(system: &mut System, far: u32, value: u16) {
    system.write_far(far, &value.to_le_bytes());
}

fn write32(system: &mut System, far: u32, value: u32) {
    system.write_far(far, &value.to_le_bytes());
}

/// A far pointer `offset` bytes on, within its segment.
fn at(far: u32, offset: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(offset) & 0xffff)
}

/// A file's block, as its fields are read and written.
#[derive(Clone, Copy)]
struct Block(u32);

impl Block {
    fn of(system: &System, handle: u16) -> Self {
        Self(data(system) | u32::from(handle))
    }

    fn get(self, system: &System, field: u16) -> u32 {
        read32(system, at(self.0, u32::from(field)))
    }

    fn set(self, system: &mut System, field: u16, value: u32) {
        write32(system, at(self.0, u32::from(field)), value);
    }

    fn word(self, system: &System, field: u16) -> u16 {
        read16(system, at(self.0, u32::from(field)))
    }

    fn set_word(self, system: &mut System, field: u16, value: u16) {
        write16(system, at(self.0, u32::from(field)), value);
    }

    fn signed(self, system: &System, field: u16) -> i32 {
        self.get(system, field) as i32
    }

    fn is_mem(self, system: &System) -> bool {
        self.get(system, FCC) == FOURCC_MEM
    }
}

/// `b - a` for two huge pointers, as seg4 `7fa` takes it: each selector's
/// index, its tile, the high word, and the offsets the low.
fn huge_difference(a: u32, b: u32) -> i32 {
    let tile = |far: u32| (far >> 16) >> 3;

    (tile(b).wrapping_sub(tile(a)) << 16)
        .wrapping_add(b & 0xffff)
        .wrapping_sub(a & 0xffff) as i32
}

/// A huge pointer moved on by `count` bytes, as MMSYSTEM moves one: the
/// offset's carry and the count's high word into the selector, eight to
/// a tile (`__AHSHIFT`).
fn huge_add(far: u32, count: u32) -> u32 {
    let sum = (far & 0xffff) + (count & 0xffff);
    let tiles = (count >> 16).wrapping_add(sum >> 16);
    let selector = ((far >> 16) as u16).wrapping_add((tiles << 3) as u16);

    u32::from(selector) << 16 | (sum & 0xffff)
}

/// Bytes copied from one huge pointer to another, as `hmemcpy` copies
/// them (`17bf`).
fn copy_huge(system: &mut System, to: u32, from: u32, count: u32) {
    let bytes = system.cpu.bus.read(system.linear(from), count as usize);
    let at = system.linear(to);

    system.cpu.bus.write(at, &bytes);
}

/// A KERNEL or KEYBOARD function called as MMSYSTEM calls it, through the
/// module's own entry: its answer, DX:AX.
async fn call(engine: &Engine, module: &str, name: &str, args: &[GuestArg]) -> Result<u32, Stop> {
    let procedure = {
        let mut system = engine.system();
        let Some(kept) = system.kept_named(module) else {
            return Err(Stop::Unsupported("a module MMSYSTEM calls"));
        };
        let handle = system.kept[kept].handle();

        crate::modules_kernel::proc_named(&mut system, handle, name)
    };

    Ok(Box::pin(engine.call_with(procedure, args, &[])).await?.0)
}

async fn kernel(engine: &Engine, name: &str, args: &[GuestArg]) -> Result<u32, Stop> {
    call(engine, "KERNEL", name, args).await
}

/// A message sent to a file's I/O procedure (`call far [bx+8]`): one of
/// winbox.js's own answered here; a program's called with MMSYSTEM's data
/// segment in DS, as MMSYSTEM calls it.
async fn send(
    engine: &Engine,
    handle: u16,
    message: u16,
    first: u32,
    second: u32,
) -> Result<u32, Stop> {
    let (procedure, dos, mem, info) = {
        let mut system = engine.system();
        let block = Block::of(&system, handle);

        (
            block.get(&system, PROC),
            dos_address(&mut system),
            mem_address(&mut system),
            block.0,
        )
    };

    if procedure == dos {
        return Box::pin(dos_proc(engine, handle, message, first, second)).await;
    }

    if procedure == mem {
        return Ok(mem_proc(&mut engine.system(), handle, message));
    }

    let ds = (info >> 16) as u16;
    let args = [
        GuestArg::Long(info),
        GuestArg::Word(message),
        GuestArg::Long(first),
        GuestArg::Long(second),
    ];

    Ok(
        Box::pin(engine.call_with(procedure, &args, &[Register::Segment(DS, ds)]))
            .await?
            .0,
    )
}

/// A read or a write handed to the procedure (`10a9`): first a seek to the
/// buffer's offset, where the procedure is not there.
async fn transfer(
    engine: &Engine,
    handle: u16,
    message: u16,
    buffer: u32,
    count: u32,
) -> Result<u32, Stop> {
    let (buf_offset, disk_offset) = {
        let system = engine.system();
        let block = Block::of(&system, handle);

        (
            block.get(&system, BUF_OFFSET),
            block.get(&system, DISK_OFFSET),
        )
    };

    if buf_offset != disk_offset
        && send(engine, handle, MMIOM_SEEK, buf_offset, 0).await? == 0xffff_ffff
    {
        return Ok(0xffff_ffff);
    }

    send(engine, handle, message, buffer, count).await
}

/// The DOS procedure (`117b`), on the file whose block is at `handle`:
/// KERNEL's file functions on the DOS handle in `adwInfo[0]`.
async fn dos_proc(
    engine: &Engine,
    handle: u16,
    message: u16,
    first: u32,
    second: u32,
) -> Result<u32, Stop> {
    let (block, file, flags) = {
        let system = engine.system();
        let block = Block::of(&system, handle);

        (block, block.word(&system, INFO0), block.get(&system, FLAGS))
    };

    match message {
        MMIOM_READ | MMIOM_WRITE | MMIOM_WRITEFLUSH => {
            let name = if message == MMIOM_READ {
                "_hread"
            } else {
                "_hwrite"
            };
            let done = kernel(
                engine,
                name,
                &[
                    GuestArg::Word(file),
                    GuestArg::Long(first),
                    GuestArg::Long(second),
                ],
            )
            .await?;

            if done != 0xffff_ffff {
                let mut system = engine.system();
                let disk = block.get(&system, DISK_OFFSET);

                block.set(&mut system, DISK_OFFSET, disk.wrapping_add(done));
            }

            Ok(done)
        }
        MMIOM_SEEK => {
            let to = kernel(
                engine,
                "_llseek",
                &[
                    GuestArg::Word(file),
                    GuestArg::Long(first),
                    GuestArg::Word(second as u16),
                ],
            )
            .await?;

            if to != 0xffff_ffff {
                block.set(&mut engine.system(), DISK_OFFSET, to);
            }

            Ok(to)
        }
        MMIOM_OPEN => dos_open(engine, block, first, flags).await,
        MMIOM_CLOSE => {
            if first & MMIO_FHOPEN != 0 {
                return Ok(0);
            }

            let closed = kernel(engine, "_lclose", &[GuestArg::Word(file)]).await?;

            Ok(if closed as u16 == 0xffff {
                u32::from(MMIOERR_CANNOTCLOSE)
            } else {
                0
            })
        }
        MMIOM_RENAME => {
            let mut system = engine.system();
            let from = system.read_string(first);
            let to = system.read_string(second);

            Ok(if system.rename_names(&from, &to).is_err() {
                u32::from(MMIOERR_FILENOTFOUND)
            } else {
                0
            })
        }
        _ => Ok(0),
    }
}

/// The DOS procedure's `MMIOM_OPEN` (`121b`): a temporary file's name
/// made, or the file opened -- or parsed, looked for or deleted -- by
/// `OpenFile` with the open's flags.
async fn dos_open(engine: &Engine, block: Block, name: u32, flags: u32) -> Result<u32, Stop> {
    if flags & MMIO_GETTEMP != 0 {
        let (drive, info0) = {
            let system = engine.system();

            if system.bad_huge(name, 4, false) {
                return Ok(u32::from(MMSYSERR_INVALPARAM));
            }

            (system.read_far(name, 1)[0], block.word(&system, INFO0))
        };
        let made = kernel(
            engine,
            "GetTempFileName",
            &[
                GuestArg::Word(u16::from(drive)),
                GuestArg::Long(at(name, 3)),
                GuestArg::Word(info0),
                GuestArg::Long(name),
            ],
        )
        .await?;

        return Ok(if made as u16 == 0 {
            u32::from(MMIOERR_FILENOTFOUND)
        } else {
            0
        });
    }

    let structure = data(&engine.system()) | u32::from(OFSTRUCT_AT);

    if name != 0 {
        let file = kernel(
            engine,
            "OpenFile",
            &[
                GuestArg::Long(name),
                GuestArg::Long(structure),
                GuestArg::Word(flags as u16),
            ],
        )
        .await?;

        block.set_word(&mut engine.system(), INFO0, file as u16);
    }

    let file = block.word(&engine.system(), INFO0);

    if file == 0xffff {
        return Ok(u32::from(if flags & MMIO_DELETE != 0 {
            MMIOERR_CANNOTWRITE
        } else {
            MMIOERR_FILENOTFOUND
        }));
    }

    if flags & MMIO_DELETE != 0 {
        return Ok(0);
    }

    if flags & (MMIO_PARSE | MMIO_EXIST) != 0 {
        // The path `OpenFile` made, from the structure, given back in the
        // name's place.
        call(
            engine,
            "KEYBOARD",
            "OemToAnsi",
            &[GuestArg::Long(at(structure, 8)), GuestArg::Long(name)],
        )
        .await?;
        return Ok(0);
    }

    let to = kernel(
        engine,
        "_llseek",
        &[GuestArg::Word(file), GuestArg::Long(0), GuestArg::Word(1)],
    )
    .await?;

    block.set(&mut engine.system(), DISK_OFFSET, to);
    Ok(0)
}

/// The memory procedure (`1301`): a file that is its buffer. Reading,
/// writing and seeking are refused, as MMSYSTEM does them in the buffer
/// itself; opening takes the read and write and sharing flags and
/// `MMIO_CREATE`, and the buffer is full but where the file is created.
fn mem_proc(system: &mut System, handle: u16, message: u16) -> u32 {
    let block = Block::of(system, handle);

    match message {
        MMIOM_READ | MMIOM_WRITE | MMIOM_SEEK | MMIOM_WRITEFLUSH => 0xffff_ffff,
        MMIOM_OPEN => {
            let flags = block.get(system, FLAGS);

            if flags & 0xef8c != 0 || (flags >> 16) & 0xfe != 0 {
                return u32::from(MMSYSERR_INVALFLAG);
            }

            if flags & MMIO_CREATE == 0 {
                let end = block.get(system, END_WRITE);

                block.set(system, END_READ, end);
            }

            0
        }
        _ => 0,
    }
}

/// The DOS procedure called by a program, at the address it was handed:
/// it works on MMSYSTEM's data at the structure's offset, as the real one
/// does with its own DS.
fn dos_proc_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (info, message, first, second) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            dos_proc(engine, info as u16, message, first, second).await?,
        ))
    })
}

fn mem_proc_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let mut system = engine.system();
        let info = args.dword(&system);
        let message = args.word(&system);

        Ok(Answer::Dword(mem_proc(&mut system, info as u16, message)))
    })
}

/// Whether a handle names a file open (seg1 `1e8`).
fn is_open(system: &System, handle: u16) -> bool {
    system.mmsystem.mmio.is_open(handle)
}

/// A block of MMSYSTEM's made for a file (seg4 `2e6`): its bytes noughts,
/// past a header of the next block, its kind and its task.
fn make_block(system: &mut System) -> u16 {
    let handle = system.mmsystem.mmio.take();
    let data = data(system);
    let task = system.task_handle;

    system.write_far(data | u32::from(handle - 6), &[0; 6]);
    write16(system, data | u32::from(handle - 4), KIND_FILE);
    write16(system, data | u32::from(handle - 2), task);
    system.write_far(data | u32::from(handle), &[0; INFO_SIZE as usize]);
    handle
}

/// A block given back (seg4 `31b`): its kind and its task cleared.
fn free_block(system: &mut System, handle: u16) {
    let data = data(system);

    write32(system, data | u32::from(handle - 4), 0);
    system.mmsystem.mmio.give_back(handle);
}

/// Whether a procedure's address is no code to call (`IsBadCodePtr`).
fn bad_code(system: &System, pointer: u32) -> bool {
    let selector = (pointer >> 16) as u16;
    let code = system
        .peek_descriptor(selector)
        .is_some_and(|descriptor| descriptor.segment && descriptor.executable);

    !code || !system.reaches(selector, pointer & 0xffff, false)
}

// ---------------------------------------------------------------------------
// Opening and closing

fn mmio_open(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (name, info, flags) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(open(engine, name, info, flags).await?))
    })
}

/// `mmioOpen` (`2a5`).
pub async fn open(engine: &Engine, name: u32, info: u32, flags: u32) -> Result<u16, Stop> {
    // A flag past `MMIO_GETTEMP`: the parameter logged, and no file.
    if flags & 0xfffc_0000 != 0 {
        return Ok(0);
    }

    let handle = {
        let mut system = engine.system();

        if info != 0 {
            if system.bad_huge(info, u32::from(INFO_SIZE), true) {
                return Ok(0);
            }

            write16(&mut system, at(info, u32::from(ERROR)), 0);

            let procedure = read32(&system, at(info, u32::from(PROC)));

            if procedure != 0 && bad_code(&system, procedure) {
                return Ok(0);
            }
        }

        let handle = make_block(&mut system);
        let block = Block::of(&system, handle);

        if info != 0 {
            let bytes = system.read_far(info, usize::from(INFO_SIZE));

            system.write_far(block.0, &bytes);
        }

        block.set(&mut system, FLAGS, flags);
        block.set_word(&mut system, HANDLE, handle);

        if flags & MMIO_ALLOCBUF != 0 {
            if block.get(&system, CCH) == 0 {
                block.set(&mut system, CCH, DEFAULT_BUFFER);
            }

            block.set(&mut system, FLAGS, flags & !MMIO_ALLOCBUF);
        }

        handle
    };

    resolve_proc(&mut engine.system(), handle, name);

    let (buffer, size) = {
        let mut system = engine.system();
        let block = Block::of(&system, handle);
        let buffer = block.get(&system, BUFFER);

        block.set(&mut system, BUFFER, 0);
        (buffer, block.get(&system, CCH))
    };
    let answer = set_buffer(engine, handle, buffer, size, 0).await?;
    let fail = |answer: u16| {
        let mut system = engine.system();

        if info != 0 {
            write16(&mut system, at(info, u32::from(ERROR)), answer);
        }

        free_block(&mut system, handle);
        Ok(0)
    };

    if answer != 0 {
        return fail(answer);
    }

    let opened = send(engine, handle, MMIOM_OPEN, name, 0).await? as u16;

    if opened != 0 {
        return fail(opened);
    }

    let flags = {
        let system = engine.system();

        Block::of(&system, handle).get(&system, FLAGS)
    };

    if flags & (MMIO_PARSE | MMIO_DELETE | MMIO_EXIST | MMIO_GETTEMP) != 0 {
        set_buffer(engine, handle, 0, 0, 0).await?;
        free_block(&mut engine.system(), handle);
        return Ok(1);
    }

    let mut system = engine.system();
    let block = Block::of(&system, handle);
    let disk = block.get(&system, DISK_OFFSET);

    block.set(&mut system, BUF_OFFSET, disk);
    Ok(handle)
}

/// The procedure a file opens with (`bf`): one given, or the one its code
/// names -- the code given, or the extension before a `+` in its name, or
/// `DOS ` -- among those installed for the task, and else the DOS one.
fn resolve_proc(system: &mut System, handle: u16, name: u32) {
    let block = Block::of(system, handle);

    if block.get(system, PROC) != 0 {
        return;
    }

    if block.get(system, FCC) == 0 && name != 0 {
        let text = system.read_string(name);

        // The last `+` (`178e`), and back from it to a `.`, `:` or `\`.
        if let Some(plus) = text.iter().rposition(|&byte| byte == b'+') {
            let mut at = plus;

            while at > 0 && !matches!(text[at], b'.' | b':' | b'\\') {
                at -= 1;
            }

            if text[at] == b'.' {
                let mut code = [0u8; 4];
                let mut from = at + 1;

                for byte in &mut code {
                    if text[from] == b'+' {
                        *byte = 0;
                    } else {
                        *byte = text[from];
                        from += 1;
                    }
                }

                block.set(system, FCC, fourcc(code, true));
            }
        }
    }

    if block.get(system, FCC) == 0 {
        block.set(system, FCC, FOURCC_DOS);
    }

    let task = match block.word(system, TASK) {
        0 => system.task_handle,
        task => task,
    };
    let fcc = block.get(system, FCC);
    let own = own_procs(system);
    let found = find_proc(system, fcc, task, own);
    let procedure = if found == 0 {
        dos_address(system)
    } else {
        found
    };

    block.set(system, PROC, procedure);
}

/// A procedure installed for a code (`0`): the task's, else a global one.
fn find_proc(system: &mut System, fcc: u32, task: u16, own: (u32, u32)) -> u32 {
    let installed = system.mmsystem.mmio.installed(own);

    installed
        .iter()
        .find(|each| each.fcc == fcc && each.task == task)
        .or_else(|| {
            installed
                .iter()
                .find(|each| each.task == 0 && each.fcc == fcc)
        })
        .map_or(0, |each| each.procedure)
}

/// A procedure removed (`58`): the one for the code and exactly this task,
/// unless it is MMSYSTEM's own.
fn remove_proc(system: &mut System, fcc: u32, task: u16, own: (u32, u32)) -> u32 {
    let installed = system.mmsystem.mmio.installed(own);
    let Some(at) = installed
        .iter()
        .position(|each| each.fcc == fcc && each.task == task)
    else {
        return 0;
    };

    if installed[at].fixed {
        return 0;
    }

    installed.remove(at).procedure
}

/// Four bytes made a code as `mmioStringToFOURCC` makes them (`ed3`): a
/// nought a space, the reading going on past it, and each other byte
/// capital with `MMIO_TOUPPER`, as `AnsiUpper` makes a character.
fn fourcc(bytes: [u8; 4], upper: bool) -> u32 {
    let mut code = [0u8; 4];

    for (each, byte) in code.iter_mut().zip(bytes) {
        *each = if byte == 0 {
            b' '
        } else if upper && byte < 0x80 {
            crate::user_misc::ansi_upper_byte(byte)
        } else {
            byte
        };
    }

    u32::from_le_bytes(code)
}

fn mmio_close(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, flags) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        Ok(Answer::Word(close(engine, handle, flags).await?))
    })
}

/// `mmioClose` (`457`): the buffer flushed -- a failure only marks it
/// clean -- and the procedure told; the block freed only if it agrees.
pub async fn close(engine: &Engine, handle: u16, flags: u16) -> Result<u16, Stop> {
    if !is_open(&engine.system(), handle) {
        return Ok(MMSYSERR_INVALHANDLE);
    }

    if flush(engine, handle, 0).await? != 0 {
        let mut system = engine.system();
        let block = Block::of(&system, handle);
        let flags = block.get(&system, FLAGS);

        block.set(&mut system, FLAGS, flags & !MMIO_DIRTY);
    }

    let answer = send(engine, handle, MMIOM_CLOSE, u32::from(flags), 0).await? as u16;

    if answer != 0 {
        return Ok(answer);
    }

    set_buffer(engine, handle, 0, 0, 0).await?;
    free_block(&mut engine.system(), handle);
    Ok(0)
}

// ---------------------------------------------------------------------------
// Reading, writing and seeking

fn mmio_read(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, buffer, count) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.dword(&system))
        };

        Ok(Answer::Dword(read(engine, handle, buffer, count).await?))
    })
}

/// `mmioRead` (`4b4`): what the buffer holds, then the buffer filled again
/// while what is left fits it; else what is left straight from the
/// procedure. How many bytes, or -1.
pub async fn read(engine: &Engine, handle: u16, mut to: u32, count: u32) -> Result<u32, Stop> {
    let mut left = count as i32;
    let mut total: i32 = 0;

    {
        let system = engine.system();

        if !is_open(&system, handle) || system.bad_huge(to, count, true) {
            return Ok(0xffff_ffff);
        }
    }

    loop {
        let (mem, size) = {
            let mut system = engine.system();
            let block = Block::of(&system, handle);
            let next = block.get(&system, NEXT);
            let mut n = huge_difference(next, block.get(&system, END_READ));

            if n > left {
                n = left;
            }

            if n > 0 {
                copy_huge(&mut system, to, next, n as u32);
                block.set(&mut system, NEXT, huge_add(next, n as u32));
                to = huge_add(to, n as u32);
                left -= n;
                total = total.wrapping_add(n);
            }

            (block.is_mem(&system), block.signed(&system, CCH))
        };

        if mem || left == 0 {
            return Ok(total as u32);
        }

        if size < left {
            break;
        }

        if advance(engine, handle, 0, 0).await? != 0 {
            return Ok(0xffff_ffff);
        }

        let system = engine.system();
        let block = Block::of(&system, handle);

        if block.get(&system, NEXT) == block.get(&system, END_READ) {
            return Ok(total as u32);
        }
    }

    if flush(engine, handle, MMIO_EMPTYBUF).await? != 0 {
        return Ok(0xffff_ffff);
    }

    let done = transfer(engine, handle, MMIOM_READ, to, left as u32).await?;

    reset_buf_offset(&mut engine.system(), handle);

    if done == 0xffff_ffff {
        return Ok(0xffff_ffff);
    }

    Ok((total as u32).wrapping_add(done))
}

/// `lBufOffset` made `lDiskOffset`, after the procedure has read or
/// written past the buffer.
fn reset_buf_offset(system: &mut System, handle: u16) {
    let block = Block::of(system, handle);
    let disk = block.get(system, DISK_OFFSET);

    block.set(system, BUF_OFFSET, disk);
}

fn mmio_write(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, buffer, count) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.dword(&system))
        };

        Ok(Answer::Dword(write(engine, handle, buffer, count).await?))
    })
}

/// `mmioWrite` (`62b`): into the buffer, marking it dirty, a memory file's
/// grown first where it is short; the buffer written out and emptied
/// while what is left fits it; else what is left straight to the
/// procedure. How many bytes, or -1.
pub async fn write(engine: &Engine, handle: u16, mut from: u32, count: u32) -> Result<u32, Stop> {
    let mut left = count as i32;
    let mut total: i32 = 0;

    {
        let system = engine.system();

        if !is_open(&system, handle) || system.bad_huge(from, count, false) {
            return Ok(0xffff_ffff);
        }
    }

    loop {
        let (room, mem) = {
            let system = engine.system();
            let block = Block::of(&system, handle);

            (
                huge_difference(block.get(&system, NEXT), block.get(&system, END_WRITE)),
                block.is_mem(&system),
            )
        };
        let mut n = room;

        if n < left && mem {
            if expand(engine, handle, (left - n) as u32).await? != 0 {
                return Ok(0xffff_ffff);
            }

            let system = engine.system();
            let block = Block::of(&system, handle);

            n = huge_difference(block.get(&system, NEXT), block.get(&system, END_WRITE));
        }

        let size = {
            let mut system = engine.system();
            let block = Block::of(&system, handle);

            if n > left {
                n = left;
            }

            if n > 0 {
                let next = block.get(&system, NEXT);

                copy_huge(&mut system, next, from, n as u32);

                let flags = block.get(&system, FLAGS);

                block.set(&mut system, FLAGS, flags | MMIO_DIRTY);
                block.set(&mut system, NEXT, huge_add(next, n as u32));
                from = huge_add(from, n as u32);
                left -= n;
                total = total.wrapping_add(n);
            }

            // What the buffer holds reaches as far as has been written.
            let next = block.get(&system, NEXT);

            if next > block.get(&system, END_READ) {
                block.set(&mut system, END_READ, next);
            }

            block.signed(&system, CCH)
        };

        if left == 0 {
            return Ok(total as u32);
        }

        if size < left {
            break;
        }

        if advance(engine, handle, 0, 1).await? != 0 {
            return Ok(0xffff_ffff);
        }
    }

    if flush(engine, handle, MMIO_EMPTYBUF).await? != 0 {
        return Ok(0xffff_ffff);
    }

    let done = transfer(engine, handle, MMIOM_WRITE, from, left as u32).await?;

    reset_buf_offset(&mut engine.system(), handle);

    if done == 0xffff_ffff {
        return Ok(0xffff_ffff);
    }

    Ok(done.wrapping_add(total as u32))
}

/// A memory file's buffer made larger (`10f6`): by `count`, or by
/// `adwInfo[0]` where that is more; refused where it is nought.
async fn expand(engine: &Engine, handle: u16, count: u32) -> Result<u16, Stop> {
    let (saved, size) = {
        let mut system = engine.system();
        let block = Block::of(&system, handle);
        let step = block.get(&system, INFO0);

        if step == 0 {
            return Ok(MMIOERR_CANNOTEXPAND);
        }

        let count = if (count as i32) < (step as i32) {
            step
        } else {
            count
        };
        let saved = block.get(&system, FLAGS);

        block.set(&mut system, FLAGS, saved | MMIO_ALLOCBUF);
        (saved, block.get(&system, CCH).wrapping_add(count))
    };
    let answer = set_buffer(engine, handle, 0, size, 0).await?;
    let mut system = engine.system();

    Block::of(&system, handle).set(&mut system, FLAGS, saved);
    Ok(answer)
}

fn mmio_seek(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, offset, origin) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Dword(seek(engine, handle, offset, origin).await?))
    })
}

/// `mmioSeek` (`7e9`): the new offset, or -1.
pub async fn seek(engine: &Engine, handle: u16, offset: u32, origin: u16) -> Result<u32, Stop> {
    let (current, end, mem) = {
        let system = engine.system();

        if !is_open(&system, handle) {
            return Ok(0xffff_ffff);
        }

        let block = Block::of(&system, handle);
        let buffer = block.get(&system, BUFFER);
        let buf_offset = block.get(&system, BUF_OFFSET);

        (
            (huge_difference(buffer, block.get(&system, NEXT)) as u32).wrapping_add(buf_offset),
            (huge_difference(buffer, block.get(&system, END_READ)) as u32).wrapping_add(buf_offset),
            block.is_mem(&system),
        )
    };
    let to = match origin {
        0 => offset,
        1 => current.wrapping_add(offset),
        2 => {
            let end = if mem {
                end
            } else {
                let end = send(engine, handle, MMIOM_SEEK, 0, 2).await?;

                if end == 0xffff_ffff {
                    return Ok(0xffff_ffff);
                }

                end
            };

            end.wrapping_sub(offset)
        }
        _ => return Ok(0xffff_ffff),
    };

    {
        let mut system = engine.system();
        let block = Block::of(&system, handle);
        let buf_offset = block.signed(&system, BUF_OFFSET);

        if buf_offset <= to as i32 && to as i32 <= end as i32 {
            let buffer = block.get(&system, BUFFER);

            block.set(
                &mut system,
                NEXT,
                huge_add(buffer, to.wrapping_sub(buf_offset as u32)),
            );
            return Ok(to);
        }

        if mem {
            return Ok(0xffff_ffff);
        }
    }

    if flush(engine, handle, 0).await? != 0 {
        return Ok(0xffff_ffff);
    }

    let mut system = engine.system();
    let block = Block::of(&system, handle);
    let buffer = block.get(&system, BUFFER);

    block.set(&mut system, BUF_OFFSET, to);
    block.set(&mut system, END_READ, buffer);
    block.set(&mut system, NEXT, buffer);
    Ok(to)
}

// ---------------------------------------------------------------------------
// The structure and the buffer

fn mmio_get_info(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let mut system = engine.system();
        let handle = args.word(&system);
        let info = args.dword(&system);
        let flags = args.word(&system);

        Ok(Answer::Word(get_info(&mut system, handle, info, flags)))
    })
}

/// `mmioGetInfo` (`929`): the block copied out.
fn get_info(system: &mut System, handle: u16, info: u32, flags: u16) -> u16 {
    if !is_open(system, handle) {
        return MMSYSERR_INVALHANDLE;
    }

    if system.bad_huge(info, u32::from(INFO_SIZE), true) {
        return MMSYSERR_INVALPARAM;
    }

    if flags != 0 {
        return MMSYSERR_INVALFLAG;
    }

    let block = Block::of(system, handle);
    let bytes = system.read_far(block.0, usize::from(INFO_SIZE));

    system.write_far(info, &bytes);
    0
}

fn mmio_set_info(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let mut system = engine.system();
        let handle = args.word(&system);
        let info = args.dword(&system);
        let flags = args.word(&system);

        Ok(Answer::Word(set_info(&mut system, handle, info, flags)))
    })
}

/// `mmioSetInfo` (`996`): the block copied in whole, and what the buffer
/// holds made to reach `pchNext`.
fn set_info(system: &mut System, handle: u16, info: u32, flags: u16) -> u16 {
    if !is_open(system, handle) {
        return MMSYSERR_INVALHANDLE;
    }

    if system.bad_huge(info, u32::from(INFO_SIZE), false) {
        return MMSYSERR_INVALPARAM;
    }

    let buffer = read32(system, at(info, u32::from(BUFFER)));

    if buffer != 0 && system.bad_huge(buffer, read32(system, at(info, u32::from(CCH))), true) {
        return MMSYSERR_INVALPARAM;
    }

    if bad_code(system, read32(system, at(info, u32::from(PROC)))) {
        return MMSYSERR_INVALPARAM;
    }

    if flags != 0 {
        return MMSYSERR_INVALFLAG;
    }

    let bytes = system.read_far(info, usize::from(INFO_SIZE));
    let block = Block::of(system, handle);

    system.write_far(block.0, &bytes);

    let next = block.get(system, NEXT);

    if next > block.get(system, END_READ) {
        block.set(system, END_READ, next);
    }

    0
}

fn mmio_set_buffer(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, buffer, size, flags) = {
            let system = engine.system();

            (
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
                args.word(&system),
            )
        };

        Ok(Answer::Word(
            set_buffer(engine, handle, buffer, size, flags).await?,
        ))
    })
}

/// `mmioSetBuffer` (`a68`). A buffer of MMSYSTEM's own, asked for again
/// with no pointer, is made the new size where it is, what it holds kept
/// as far as it fits (`aee`); else the old one is written out and let go
/// and the new one taken, MMSYSTEM's own made where no pointer is given
/// and a size is (`c11`).
pub async fn set_buffer(
    engine: &Engine,
    handle: u16,
    buffer: u32,
    size: u32,
    flags: u16,
) -> Result<u16, Stop> {
    let own = {
        let system = engine.system();

        if !is_open(&system, handle) {
            return Ok(MMSYSERR_INVALHANDLE);
        }

        if buffer != 0 && system.bad_huge(buffer, size, true) {
            return Ok(MMSYSERR_INVALPARAM);
        }

        if flags != 0 {
            return Ok(MMSYSERR_INVALFLAG);
        }

        Block::of(&system, handle).get(&system, FLAGS) & MMIO_ALLOCBUF != 0
    };

    if own && buffer == 0 && (size as i32) > 0 {
        return resize_buffer(engine, handle, size).await;
    }

    let answer = flush(engine, handle, MMIO_EMPTYBUF).await?;

    if answer != 0 {
        return Ok(answer);
    }

    if own {
        let selector = {
            let system = engine.system();

            Block::of(&system, handle).get(&system, BUFFER) >> 16
        };
        let global = kernel(engine, "GlobalHandle", &[GuestArg::Word(selector as u16)]).await?;

        kernel(engine, "GlobalUnlock", &[GuestArg::Word(global as u16)]).await?;

        let global = kernel(engine, "GlobalHandle", &[GuestArg::Word(selector as u16)]).await?;

        kernel(engine, "GlobalFree", &[GuestArg::Word(global as u16)]).await?;

        let mut system = engine.system();
        let block = Block::of(&system, handle);
        let flags = block.get(&system, FLAGS);

        block.set(&mut system, FLAGS, flags & !MMIO_ALLOCBUF);
    }

    let mut answer = 0;
    let mut buffer = buffer;
    let mut size = size;

    if buffer == 0 && (size as i32) > 0 {
        let global = kernel(
            engine,
            "GlobalAlloc",
            &[GuestArg::Word(2), GuestArg::Long(size)],
        )
        .await?;

        buffer = kernel(engine, "GlobalLock", &[GuestArg::Word(global as u16)]).await?;

        let mut system = engine.system();
        let block = Block::of(&system, handle);

        if buffer == 0 {
            answer = MMIOERR_OUTOFMEMORY;
            size = 0;
        } else {
            let flags = block.get(&system, FLAGS);

            block.set(&mut system, FLAGS, flags | MMIO_ALLOCBUF);
        }
    }

    let mut system = engine.system();
    let block = Block::of(&system, handle);

    block.set(&mut system, BUFFER, buffer);
    block.set(&mut system, CCH, size);
    block.set(&mut system, END_READ, buffer);
    block.set(&mut system, NEXT, buffer);
    block.set(&mut system, END_WRITE, huge_add(buffer, size));
    Ok(answer)
}

/// MMSYSTEM's own buffer made another size (`aee`): written out, emptied
/// while `pchNext` is past the new end, and reallocated in place.
async fn resize_buffer(engine: &Engine, handle: u16, size: u32) -> Result<u16, Stop> {
    let answer = flush(engine, handle, 0).await?;

    if answer != 0 {
        return Ok(answer);
    }

    let (next, end, selector) = loop {
        let (next, end, selector) = {
            let system = engine.system();
            let block = Block::of(&system, handle);
            let buffer = block.get(&system, BUFFER);

            (
                huge_difference(buffer, block.get(&system, NEXT)),
                huge_difference(buffer, block.get(&system, END_READ)),
                (buffer >> 16) as u16,
            )
        };

        if next <= size as i32 {
            break (next, end, selector);
        }

        let answer = flush(engine, handle, MMIO_EMPTYBUF).await?;

        if answer != 0 {
            return Ok(answer);
        }
    };

    let global = kernel(engine, "GlobalHandle", &[GuestArg::Word(selector)]).await?;

    kernel(engine, "GlobalUnlock", &[GuestArg::Word(global as u16)]).await?;

    let global = kernel(engine, "GlobalHandle", &[GuestArg::Word(selector)]).await?;
    let global = kernel(
        engine,
        "GlobalReAlloc",
        &[
            GuestArg::Word(global as u16),
            GuestArg::Long(size),
            GuestArg::Word(2),
        ],
    )
    .await?;
    let buffer = kernel(engine, "GlobalLock", &[GuestArg::Word(global as u16)]).await?;

    if buffer == 0 {
        return Ok(MMIOERR_OUTOFMEMORY);
    }

    let mut system = engine.system();
    let block = Block::of(&system, handle);
    let end_write = huge_add(buffer, size);

    block.set(&mut system, CCH, size);
    block.set(&mut system, BUFFER, buffer);
    block.set(&mut system, NEXT, huge_add(buffer, next as u32));
    block.set(&mut system, END_READ, huge_add(buffer, end as u32));
    block.set(&mut system, END_WRITE, end_write);

    if end > size as i32 {
        block.set(&mut system, END_READ, end_write);
    }

    Ok(0)
}

fn mmio_flush(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, flags) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        Ok(Answer::Word(flush(engine, handle, flags).await?))
    })
}

/// `mmioFlush` (`cd8`): a dirty buffer written whole, `pchBuffer` to
/// `pchEndRead`, with `MMIOM_WRITEFLUSH`; and with `MMIO_EMPTYBUF` the
/// buffer emptied, its offset moved on to `pchNext`. A memory file, or one
/// with no buffer, has nothing to do.
pub async fn flush(engine: &Engine, handle: u16, flags: u16) -> Result<u16, Stop> {
    let (dirty, buffer, count) = {
        let system = engine.system();

        if !is_open(&system, handle) {
            return Ok(MMSYSERR_INVALHANDLE);
        }

        if flags & !MMIO_EMPTYBUF != 0 {
            return Ok(MMSYSERR_INVALFLAG);
        }

        let block = Block::of(&system, handle);
        let buffer = block.get(&system, BUFFER);

        if block.is_mem(&system) || buffer == 0 {
            return Ok(0);
        }

        (
            block.get(&system, FLAGS) & MMIO_DIRTY != 0,
            buffer,
            huge_difference(buffer, block.get(&system, END_READ)) as u32,
        )
    };

    if dirty {
        let done = transfer(engine, handle, MMIOM_WRITEFLUSH, buffer, count).await?;

        if done != count {
            return Ok(MMIOERR_CANNOTWRITE);
        }

        let mut system = engine.system();
        let block = Block::of(&system, handle);
        let flags = block.get(&system, FLAGS);

        block.set(&mut system, FLAGS, flags & !MMIO_DIRTY);
    }

    if flags & MMIO_EMPTYBUF != 0 {
        let mut system = engine.system();
        let block = Block::of(&system, handle);
        let buffer = block.get(&system, BUFFER);
        let used = huge_difference(buffer, block.get(&system, NEXT)) as u32;
        let offset = block.get(&system, BUF_OFFSET);

        block.set(&mut system, BUF_OFFSET, offset.wrapping_add(used));
        block.set(&mut system, END_READ, buffer);
        block.set(&mut system, NEXT, buffer);
    }

    Ok(0)
}

fn mmio_advance(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, info, flags) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(advance(engine, handle, info, flags).await?))
    })
}

/// `mmioAdvance` (`da7`): the program's structure taken in, if one is
/// given; the buffer written out and emptied, and for reading filled again
/// from the file; the structure given back. A memory file is only grown,
/// for writing, where less is left than `adwInfo[0]`.
pub async fn advance(engine: &Engine, handle: u16, info: u32, flags: u16) -> Result<u16, Stop> {
    let mem = {
        let mut system = engine.system();

        if !is_open(&system, handle) {
            return Ok(MMSYSERR_INVALHANDLE);
        }

        if flags & !1 != 0 {
            return Ok(MMSYSERR_INVALFLAG);
        }

        let block = Block::of(&system, handle);

        if block.get(&system, BUFFER) == 0 {
            return Ok(MMIOERR_UNBUFFERED);
        }

        if info != 0 {
            if system.bad_huge(info, u32::from(INFO_SIZE), true) {
                return Ok(MMSYSERR_INVALPARAM);
            }

            set_info(&mut system, handle, info, 0);
        }

        block.is_mem(&system)
    };

    if mem {
        if flags & 1 == 0 {
            return Ok(0);
        }

        let short = {
            let system = engine.system();
            let block = Block::of(&system, handle);
            let room = huge_difference(block.get(&system, NEXT), block.get(&system, END_WRITE));

            (room as u32) < block.get(&system, INFO0)
        };

        if !short {
            return Ok(0);
        }

        let answer = expand(engine, handle, 1).await?;

        if answer != 0 {
            return Ok(answer);
        }
    } else {
        let answer = flush(engine, handle, MMIO_EMPTYBUF).await?;

        if answer != 0 {
            return Ok(answer);
        }

        if flags & 1 == 0 {
            let (buffer, size) = {
                let system = engine.system();
                let block = Block::of(&system, handle);

                (block.get(&system, BUFFER), block.get(&system, CCH))
            };
            let done = transfer(engine, handle, MMIOM_READ, buffer, size).await?;

            if done == 0xffff_ffff {
                return Ok(MMIOERR_CANNOTREAD);
            }

            let mut system = engine.system();
            let block = Block::of(&system, handle);
            let end = block.get(&system, END_READ);

            block.set(&mut system, END_READ, huge_add(end, done));
        }
    }

    if info != 0 {
        get_info(&mut engine.system(), handle, info, 0);
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// Codes, procedures and messages

fn mmio_string_to_fourcc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let system = engine.system();
        let text = args.dword(&system);
        let flags = args.word(&system);

        if crate::pointers::bad_string(&system, text, 0xffff) {
            return Ok(Answer::Dword(0));
        }

        if flags & !MMIO_TOUPPER != 0 {
            return Ok(Answer::Dword(0xffff_ffff));
        }

        // Four bytes read whatever they are: a nought is a space, and the
        // reading goes on past it.
        let bytes = system.read_far(text, 4);

        Ok(Answer::Dword(fourcc(
            [bytes[0], bytes[1], bytes[2], bytes[3]],
            flags & MMIO_TOUPPER != 0,
        )))
    })
}

fn mmio_install_io_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let mut system = engine.system();
        let fcc = args.dword(&system);
        let procedure = args.dword(&system);
        let flags = args.dword(&system);

        Ok(Answer::Dword(install_io_proc(
            &mut system,
            fcc,
            procedure,
            flags,
        )))
    })
}

/// `mmioInstallIOProc` (`f6e`): a procedure installed for the task, or for
/// every task with `MMIO_GLOBALPROC`; removed, the task's or else a global
/// one; or found. Removing and finding take no procedure.
fn install_io_proc(system: &mut System, fcc: u32, procedure: u32, flags: u32) -> u32 {
    if flags & 0xeff8_ffff != 0 || fcc == 0 {
        return 0;
    }

    let task = system.task_handle;
    let own = own_procs(system);

    if flags & MMIO_INSTALLPROC != 0 {
        if bad_code(system, procedure) {
            return 0;
        }

        let task = if flags & MMIO_GLOBALPROC != 0 {
            0
        } else {
            task
        };

        system.mmsystem.mmio.installed(own).insert(
            0,
            Installed {
                fcc,
                procedure,
                task,
                fixed: false,
            },
        );
        return procedure;
    }

    if procedure != 0 {
        return 0;
    }

    if flags & MMIO_REMOVEPROC != 0 {
        return match remove_proc(system, fcc, task, own) {
            0 => remove_proc(system, fcc, 0, own),
            found => found,
        };
    }

    if flags & MMIO_FINDPROC != 0 {
        return find_proc(system, fcc, task, own);
    }

    0
}

fn mmio_send_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, message, first, second) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        if !is_open(&engine.system(), handle) {
            return Ok(Answer::Dword(0));
        }

        Ok(Answer::Dword(
            send(engine, handle, message, first, second).await?,
        ))
    })
}

fn mmio_rename(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (from, to, info, flags) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(rename(engine, from, to, info, flags).await?))
    })
}

/// `mmioRename` (`1d2`): a block made for the while, the procedure found
/// for the old name as an open finds it, and sent `MMIOM_RENAME`.
async fn rename(engine: &Engine, from: u32, to: u32, info: u32, flags: u32) -> Result<u16, Stop> {
    if flags != 0 {
        return Ok(MMSYSERR_INVALFLAG);
    }

    let handle = {
        let mut system = engine.system();

        if info != 0 && system.bad_huge(info, u32::from(INFO_SIZE), false) {
            return Ok(MMSYSERR_INVALPARAM);
        }

        let handle = make_block(&mut system);

        if info != 0 {
            let procedure = read32(&system, at(info, u32::from(PROC)));

            if procedure != 0 && bad_code(&system, procedure) {
                return Ok(MMSYSERR_INVALPARAM);
            }

            let bytes = system.read_far(info, usize::from(INFO_SIZE));
            let block = Block::of(&system, handle);

            system.write_far(block.0, &bytes);
        }

        handle
    };

    resolve_proc(&mut engine.system(), handle, from);

    let answer = send(engine, handle, MMIOM_RENAME, from, to).await?;

    free_block(&mut engine.system(), handle);
    Ok(answer as u16)
}

// ---------------------------------------------------------------------------
// RIFF chunks

fn mmio_descend(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, chunk, parent, flags) = {
            let system = engine.system();

            (
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
                args.word(&system),
            )
        };

        Ok(Answer::Word(
            descend(engine, handle, chunk, parent, flags).await?,
        ))
    })
}

/// `mmioDescend` (`1360`): chunk headers read into the program's
/// structure one after another, each not wanted ascended out of, until
/// one is -- by its id, or as a `RIFF` or `LIST` of a type -- or one
/// would start past the parent's end, or the file ends.
pub async fn descend(
    engine: &Engine,
    handle: u16,
    chunk: u32,
    parent: u32,
    flags: u16,
) -> Result<u16, Stop> {
    let (want_id, want_type) = {
        let mut system = engine.system();

        if flags & !(MMIO_FINDCHUNK | MMIO_FINDRIFF | MMIO_FINDLIST) != 0 {
            return Ok(MMSYSERR_INVALFLAG);
        }

        if system.bad_huge(chunk, CK_SIZE, true)
            || (parent != 0 && system.bad_huge(parent, CK_SIZE, false))
        {
            return Ok(MMSYSERR_INVALPARAM);
        }

        let wanted = if flags & MMIO_FINDCHUNK != 0 {
            (read32(&system, at(chunk, CK_ID)), 0)
        } else if flags & MMIO_FINDRIFF != 0 {
            (FOURCC_RIFF, read32(&system, at(chunk, CK_TYPE)))
        } else if flags & MMIO_FINDLIST != 0 {
            (FOURCC_LIST, read32(&system, at(chunk, CK_TYPE)))
        } else {
            (0, 0)
        };

        write32(&mut system, at(chunk, CK_FLAGS), 0);
        wanted
    };

    loop {
        if read(engine, handle, chunk, 8).await? != 8 {
            return Ok(MMIOERR_CHUNKNOTFOUND);
        }

        let here = seek(engine, handle, 0, 1).await?;
        let data = {
            let mut system = engine.system();

            write32(&mut system, at(chunk, CK_DATA), here);
            here
        };

        if data == 0xffff_ffff {
            return Ok(MMIOERR_CANNOTSEEK);
        }

        let id = {
            let system = engine.system();

            if parent != 0 {
                let end = read32(&system, at(parent, CK_DATA))
                    .wrapping_add(read32(&system, at(parent, CK_LENGTH)));

                if end <= data.wrapping_sub(8) {
                    return Ok(MMIOERR_CHUNKNOTFOUND);
                }
            }

            read32(&system, at(chunk, CK_ID))
        };

        if id == FOURCC_RIFF || id == FOURCC_LIST {
            if read(engine, handle, at(chunk, CK_TYPE), 4).await? != 4 {
                return Ok(MMIOERR_CHUNKNOTFOUND);
            }
        } else {
            write32(&mut engine.system(), at(chunk, CK_TYPE), 0);
        }

        let (id, kind) = {
            let system = engine.system();

            (
                read32(&system, at(chunk, CK_ID)),
                read32(&system, at(chunk, CK_TYPE)),
            )
        };

        if (want_id == 0 || id == want_id) && (want_type == 0 || kind == want_type) {
            return Ok(0);
        }

        let answer = ascend(engine, handle, chunk, 0).await?;

        if answer != 0 {
            return Ok(answer);
        }
    }
}

fn mmio_ascend(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, chunk, flags) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(ascend(engine, handle, chunk, flags).await?))
    })
}

/// `mmioAscend` (`1562`): a chunk written to -- `MMIO_DIRTY` in its
/// structure -- made even with a nought and its size written back where
/// it has changed; then the file sought past its end and its pad byte.
pub async fn ascend(engine: &Engine, handle: u16, chunk: u32, flags: u16) -> Result<u16, Stop> {
    let dirty = {
        let system = engine.system();

        if flags != 0 {
            return Ok(MMSYSERR_INVALFLAG);
        }

        if system.bad_huge(chunk, CK_SIZE, true) {
            return Ok(MMSYSERR_INVALPARAM);
        }

        read32(&system, at(chunk, CK_FLAGS)) & MMIO_DIRTY != 0
    };

    if dirty {
        let here = seek(engine, handle, 0, 1).await?;

        if here == 0xffff_ffff {
            return Ok(MMIOERR_CANNOTSEEK);
        }

        let (size, data) = {
            let system = engine.system();
            let data = read32(&system, at(chunk, CK_DATA));

            (here.wrapping_sub(data) as i32, data)
        };

        if size < 0 {
            return Ok(MMIOERR_CANNOTWRITE);
        }

        if size & 1 != 0 {
            let pad = data_pad(engine);

            if write(engine, handle, pad, 1).await? != 1 {
                return Ok(MMIOERR_CANNOTWRITE);
            }
        }

        let known = read32(&engine.system(), at(chunk, CK_LENGTH));

        if known != size as u32 {
            write32(&mut engine.system(), at(chunk, CK_LENGTH), size as u32);

            if seek(engine, handle, data.wrapping_sub(4), 0).await? == 0xffff_ffff {
                return Ok(MMIOERR_CANNOTSEEK);
            }

            if write(engine, handle, at(chunk, CK_LENGTH), 4).await? != 4 {
                return Ok(MMIOERR_CANNOTWRITE);
            }
        }
    }

    let past = {
        let system = engine.system();
        let size = read32(&system, at(chunk, CK_LENGTH));

        (size & 1)
            .wrapping_add(size)
            .wrapping_add(read32(&system, at(chunk, CK_DATA)))
    };

    if seek(engine, handle, past, 0).await? == 0xffff_ffff {
        return Ok(MMIOERR_CANNOTSEEK);
    }

    Ok(0)
}

/// The nought `mmioAscend` writes, in MMSYSTEM's data.
fn data_pad(engine: &Engine) -> u32 {
    let mut system = engine.system();
    let far = data(&system) | u32::from(PAD_BYTE);

    system.write_far(far, &[0]);
    far
}

fn mmio_create_chunk(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, chunk, flags) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(
            create_chunk(engine, handle, chunk, flags).await?,
        ))
    })
}

/// `mmioCreateChunk` (`16a5`): the chunk's header written where the file
/// is -- its id, its size as the structure has it, and for a `RIFF` or a
/// `LIST` its type -- its data's offset kept, and the structure marked
/// dirty for `mmioAscend`.
pub async fn create_chunk(
    engine: &Engine,
    handle: u16,
    chunk: u32,
    flags: u16,
) -> Result<u16, Stop> {
    {
        let system = engine.system();

        if flags & !(MMIO_CREATERIFF | MMIO_CREATELIST) != 0 {
            return Ok(MMSYSERR_INVALFLAG);
        }

        if system.bad_huge(chunk, CK_SIZE, true) {
            return Ok(MMSYSERR_INVALPARAM);
        }
    }

    let here = seek(engine, handle, 0, 1).await?;

    if here == 0xffff_ffff {
        return Ok(MMIOERR_CANNOTSEEK);
    }

    let length = {
        let mut system = engine.system();

        write32(&mut system, at(chunk, CK_DATA), here.wrapping_add(8));

        if flags & MMIO_CREATERIFF != 0 {
            write32(&mut system, at(chunk, CK_ID), FOURCC_RIFF);
            12
        } else if flags & MMIO_CREATELIST != 0 {
            write32(&mut system, at(chunk, CK_ID), FOURCC_LIST);
            12
        } else {
            8
        }
    };

    if write(engine, handle, chunk, length).await? != length {
        return Ok(MMIOERR_CANNOTWRITE);
    }

    write32(&mut engine.system(), at(chunk, CK_FLAGS), MMIO_DIRTY);
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A huge pointer's difference counts tiles of 64 KB by the selectors'
    /// indexes, eight apart.
    #[test]
    fn huge_pointers_differ_by_tiles() {
        assert_eq!(huge_difference(0x0127_0010, 0x0127_0030), 0x20);
        assert_eq!(huge_difference(0x0127_fff0, 0x012f_0010), 0x20);
        assert_eq!(huge_difference(0x0127_0030, 0x0127_0010), -0x20);
    }

    /// Moving on past a segment's end steps the selector by eight.
    #[test]
    fn huge_pointers_move_across_tiles() {
        assert_eq!(huge_add(0x0127_fff0, 0x20), 0x012f_0010);
        assert_eq!(huge_add(0x0127_0000, 0x0002_0000), 0x0137_0000);
    }

    /// A nought is a space, and capitals are made only where asked.
    #[test]
    fn codes_are_made_of_four_bytes() {
        assert_eq!(fourcc(*b"wave", false), u32::from_le_bytes(*b"wave"));
        assert_eq!(fourcc(*b"wave", true), u32::from_le_bytes(*b"WAVE"));
        assert_eq!(fourcc(*b"ab\0c", false), u32::from_le_bytes(*b"ab c"));
    }
}
