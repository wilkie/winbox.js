//! GDI's spooler: the jobs a printer's driver opens and writes its output
//! through -- `OpenJob`, `StartSpoolPage`, `EndSpoolPage`, `WriteSpool`,
//! `WriteDialog`, `CloseJob`, `DeleteJob` -- and `QueryAbort`, which asks
//! a device context's abort procedure. The twin of
//! `src/win16/gdi/spooler.ts`.
//!
//! **Read out** of `GDI.EXE` seg28, with seg29 (WIN.INI and the ports),
//! seg30 (the communications driver's ports) and seg7 `052d`
//! (`QueryAbort`). A job is a block of 148h bytes, `GlobalAlloc(3042h)`,
//! and its handle is answered shifted right a bit; each call takes it back
//! and refuses one below 148h bytes with -3. An answer from -5 to -1 given
//! as a job is answered again as it is (`05b1`). The job's words, as GDI
//! keeps them:
//!
//! * 0: its state, the low byte (bit 0 a spooled job closed), and how it
//!   prints, the high: 40h straight to its port, 20h through Print
//!   Manager, 80h through the communications driver, 01h through the
//!   network.
//! * 2: the page; 4: the pages there is room for, 7; 6: the queue, by its
//!   number in `[PrinterPorts]`, or -1; 8: the device context.
//! * 0Ah: the bytes in its buffer, 10h: the buffer, 100h bytes.
//! * 110h: the bytes spooled; 118h: the program's PSP; 11Ah: the port's
//!   name, or the document's for Print Manager, 20h bytes.
//! * 13Ah on: each page's block. A job straight to its port has one, at
//!   13Ch: its file, a block of C2h bytes whose word 0 is the file's
//!   handle and 6 the bytes written, and whose `OFSTRUCT` is at 0Ah. The
//!   communications driver's job has there a block of 8 bytes with the
//!   port's id at 2.
//!
//! Not followed: Print Manager's side (a job to a port of `[PrinterPorts]`
//! with the spooler on, once Print Manager has its window), the network's
//! jobs, `FILE`'s "Print To File" box, DOS's devices, and the PSP GDI makes
//! current around each file call, which this DOS has not got.

use std::future::Future;

use winbox_cpu::{AX, DS, ES, SP, SS};

use crate::call::{Answer, Args, Implementation, Later, Stop, call_named};
use crate::engine::{Engine, GuestArg, Register};
use crate::system::System;

const JOB_SIZE: u32 = 0x148;
const PORT_SIZE: u32 = 0xc2;

const SP_ERROR: i16 = -1;
const SP_APPABORT: i16 = -2;
const SP_USERABORT: i16 = -3;
const SP_OUTOFMEMORY: i16 = -5;

const DIRECT: u8 = 0x40;
const SPOOLED: u8 = 0x20;
const COMM: u8 = 0x80;
const NETWORK: u8 = 0x01;

const HWND_BROADCAST: u16 = 0xffff;
/// What GDI broadcasts as a job opens and closes (seg28 `057e`, `13c9`).
const JOB_MESSAGE: u16 = 0x40;

const OF_WRITE: u16 = 0x0001;
const OF_CREATE: u16 = 0x1000;
/// `OF_REOPEN | OF_PROMPT | OF_CANCEL | OF_WRITE` (seg28 `0bdc`).
const REOPEN: u16 = 0xa801;

const IDRETRY: u32 = 4;

const WN_SUCCESS: u16 = 0;
const WN_NOT_SUPPORTED: u16 = 1;

/// A port of `[PrinterPorts]`, as GDI keeps it (seg29 `0000`).
#[derive(Debug, Clone)]
pub struct Queue {
    pub port: Vec<u8>,
    pub device: Vec<u8>,
}

/// What GDI reads of WIN.INI as the first job opens (seg29 `00d7`).
#[derive(Debug, Clone, Default)]
pub struct Spooling {
    /// `[windows]` `spooler` not `no` (`[0910h]`).
    pub on: bool,
    /// `[windows]` `DosPrint` `yes` (`[0A5Ch]`).
    pub dos_print: bool,
    /// `[spooler]` `netspool` `yes` (`[0916h]`).
    pub net_spool: bool,
    pub queues: Vec<Queue>,
    /// `[windows]` `DeviceNotSelectedTimeout` and
    /// `TransmissionRetryTimeout`, in milliseconds (`[0922h]`, `[0908h]`).
    pub select_timeout: u32,
    pub retry_timeout: u32,
    /// What `GetCommError` last gave a write (`[0A4Ah]`).
    pub comm_error: u16,
}

/// The answer of `lstrcmpi` (`KERNEL.87`): the same, by capitals.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// A port's name as GDI takes it from a string (seg29 `044d`): spaces
/// before it left off, to a comma or a space, a colon at its end left off.
pub fn port_name(text: &[u8]) -> Vec<u8> {
    let start = text
        .iter()
        .position(|&byte| byte != b' ')
        .unwrap_or(text.len());
    let rest = &text[start..];
    let end = rest
        .iter()
        .position(|&byte| byte == b',' || byte == b' ')
        .unwrap_or(rest.len());
    let name = &rest[..end];

    name.strip_suffix(b":").unwrap_or(name).to_vec()
}

/// What GDI reads as the first job opens (seg29 `00d7`): the spooler's
/// switches, the two timeouts (`0393`), and every port of every printer of
/// `[PrinterPorts]`, each value a driver and then, after each comma, a port
/// and its two timeouts (`0000`).
fn readied(system: &mut System) -> Spooling {
    if let Some(kept) = &system.printing.spooling {
        return kept.clone();
    }

    let profile = system.read_profile(b"WIN.INI");
    let value = |section: &[u8], key: &[u8]| profile.get(section, key, true).unwrap_or_default();
    let mut queues = Vec::new();

    for device in profile.entries(b"PrinterPorts") {
        let text = value(b"PrinterPorts", &device);
        let Some(comma) = text.iter().position(|&byte| byte == b',') else {
            continue;
        };
        let rest = &text[comma + 1..];

        if rest.is_empty() {
            continue;
        }

        // After the driver: a port, then its two timeouts, then perhaps
        // another port and its timeouts.
        for field in rest.split(|&byte| byte == b',').step_by(3) {
            if queues.len() < 20 {
                queues.push(Queue {
                    port: port_name(field),
                    device: device.clone(),
                });
            }
        }
    }

    let (on, dos_print, net_spool) = (
        !same(&value(b"windows", b"spooler"), b"no"),
        same(&value(b"windows", b"DosPrint"), b"yes"),
        same(&value(b"spooler", b"netspool"), b"yes"),
    );
    // `GetProfileInt`, in seconds, made milliseconds (seg29 `0393`).
    let mut seconds = |key: &[u8], fallback: u16| {
        u32::from(crate::profiles_kernel::profile_int(
            system, b"windows", key, fallback,
        )) * 1000
    };
    let spooling = Spooling {
        on,
        dos_print,
        net_spool,
        queues,
        select_timeout: seconds(b"DeviceNotSelectedTimeout", 15),
        retry_timeout: seconds(b"TransmissionRetryTimeout", 45),
        comm_error: 0,
    };

    system.printing.spooling = Some(spooling.clone());
    spooling
}

/// A port's queue, by its number (seg28 `17bb`): the one for the port and
/// the device, else the first for the port, else -1.
fn queue_of(spooling: &Spooling, port: &[u8], device: &[u8]) -> i16 {
    let both = spooling
        .queues
        .iter()
        .position(|queue| same(&queue.port, port) && same(&queue.device, device));
    let either = || {
        spooling
            .queues
            .iter()
            .position(|queue| same(&queue.port, port))
    };

    both.or_else(either).map_or(-1, |at| at as i16)
}

fn offset_by(far: u32, at: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff)
}

fn read16(system: &System, far: u32, at: u32) -> u16 {
    let bytes = system.read_far(offset_by(far, at), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn write16(system: &mut System, far: u32, at: u32, value: u16) {
    system.write_far(offset_by(far, at), &value.to_le_bytes());
}

fn read8(system: &System, far: u32, at: u32) -> u8 {
    system.read_far(offset_by(far, at), 1)[0]
}

fn write8(system: &mut System, far: u32, at: u32, value: u8) {
    system.write_far(offset_by(far, at), &[value]);
}

fn string_at(system: &System, far: u32, at: u32) -> Vec<u8> {
    if far == 0 {
        return Vec::new();
    }

    let mut text = system.read_string(offset_by(far, at));

    text.truncate(0x100);
    text
}

/// A string copied as GDI copies one (seg28 `1933`): no more than 1Fh
/// bytes and a nought.
fn copy_name(system: &mut System, far: u32, at: u32, text: &[u8]) {
    let mut bytes = text[..text.len().min(0x1f)].to_vec();

    bytes.push(0);
    system.write_far(offset_by(far, at), &bytes);
}

fn with_nought(text: &[u8]) -> Vec<u8> {
    let mut bytes = text.to_vec();

    bytes.push(0);
    bytes
}

/// A call of KERNEL's or USER's, its answer.
async fn call(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    args: &[GuestArg],
) -> Result<u32, Stop> {
    let (answer, _) = call_named(engine, module, name, args).await?;

    Ok(answer.value().unwrap_or(0))
}

async fn global_alloc(engine: &Engine, flags: u16, size: u32) -> Result<u16, Stop> {
    let answer = call(
        engine,
        "KERNEL",
        "GlobalAlloc",
        &[GuestArg::Word(flags), GuestArg::Long(size)],
    )
    .await?;

    Ok(answer as u16)
}

async fn global_lock(engine: &Engine, handle: u16) -> Result<u32, Stop> {
    call(engine, "KERNEL", "GlobalLock", &[GuestArg::Word(handle)]).await
}

async fn global_unlock(engine: &Engine, handle: u16) -> Result<(), Stop> {
    call(engine, "KERNEL", "GlobalUnlock", &[GuestArg::Word(handle)]).await?;
    Ok(())
}

async fn global_free(engine: &Engine, handle: u16) -> Result<(), Stop> {
    call(engine, "KERNEL", "GlobalFree", &[GuestArg::Word(handle)]).await?;
    Ok(())
}

async fn global_size(engine: &Engine, handle: u16) -> Result<u32, Stop> {
    call(engine, "KERNEL", "GlobalSize", &[GuestArg::Word(handle)]).await
}

async fn lclose(engine: &Engine, file: u16) -> Result<(), Stop> {
    call(engine, "KERNEL", "_lclose", &[GuestArg::Word(file)]).await?;
    Ok(())
}

/// A job's handle as GDI takes it back, or the answer it passes on.
async fn job_of(engine: &Engine, job: u16) -> Result<Result<u16, i16>, Stop> {
    let given = job as i16;

    if (-5..=-1).contains(&given) {
        return Ok(Err(given));
    }

    let handle = job << 1;

    Ok(if global_size(engine, handle).await? < JOB_SIZE {
        Err(SP_USERABORT)
    } else {
        Ok(handle)
    })
}

async fn broadcast(engine: &Engine, wparam: u16, lparam: u32) -> Result<(), Stop> {
    call(
        engine,
        "USER",
        "SendMessage",
        &[
            GuestArg::Word(HWND_BROADCAST),
            GuestArg::Word(JOB_MESSAGE),
            GuestArg::Word(wparam),
            GuestArg::Long(lparam),
        ],
    )
    .await?;
    Ok(())
}

/// Print Manager, started where the spooler is on and it is not running
/// (seg28 `1967`): `PrintMan` from Windows' directory, else the system's,
/// shown minimized. The answer is its window, which it gives GDI with
/// `GetSpoolJob` (`[058Eh]`); nought with the spooler off.
async fn print_manager(engine: &Engine, spooling: &Spooling) -> Result<u16, Stop> {
    if !spooling.on {
        return Ok(0);
    }

    let running = call(
        engine,
        "KERNEL",
        "GetModuleHandle",
        &[GuestArg::Struct(with_nought(b"PrintMan"))],
    )
    .await?;

    if running as u16 == 0 {
        let started = call(
            engine,
            "KERNEL",
            "WinExec",
            &[
                GuestArg::Struct(with_nought(b"C:\\WINDOWS\\PrintMan")),
                GuestArg::Word(7),
            ],
        )
        .await?;

        if (started as u16) < 32 {
            call(
                engine,
                "KERNEL",
                "WinExec",
                &[
                    GuestArg::Struct(with_nought(b"C:\\WINDOWS\\SYSTEM\\PrintMan")),
                    GuestArg::Word(7),
                ],
            )
            .await?;
        }
    }

    Ok(engine.system().printing.spooler.window)
}

/// A port of the communications driver's opened for a job (`GDI.EXE`
/// seg30 `00ea`): `OpenComm` with queues of 10h and 400h bytes, or 30h for
/// the second where 400h is too much (-4); an id, or -1 and 2 to 5
/// refused, -10 to -12 too; its state read, and set again from WIN.INI's
/// `[ports]` where that names the port's settings (`01a9`). The id, or
/// -1.
async fn comm_port(engine: &Engine, port: &[u8]) -> Result<i16, Stop> {
    let open = |queue: u16| {
        [
            GuestArg::Struct(with_nought(port)),
            GuestArg::Word(0x10),
            GuestArg::Word(queue),
        ]
    };
    let mut cid = call(engine, "USER", "OpenComm", &open(0x400)).await? as i16;

    if cid == -4 {
        cid = call(engine, "USER", "OpenComm", &open(0x30)).await? as i16;
    }

    if (-12..=-10).contains(&cid) || (-5..=-2).contains(&cid) {
        return Ok(-1);
    }

    let settings = port_settings(&mut engine.system(), port);
    let given = settings.clone();
    let ((), dcb) = on_stack(engine, &[0; 0x1a], |far| async move {
        call(
            engine,
            "USER",
            "GetCommState",
            &[GuestArg::Word(cid as u16), GuestArg::Long(far)],
        )
        .await?;

        if let Some(settings) = &given {
            write_settings(&mut engine.system(), far, settings);
        }

        Ok(())
    })
    .await?;

    if settings.is_some() {
        let failed = call(engine, "USER", "SetCommState", &[GuestArg::Struct(dcb)]).await? as u16;

        if failed != 0 {
            return Ok(-1);
        }
    }

    Ok(cid)
}

/// WIN.INI's `[ports]` for a port, by its name and a colon; none for none.
fn port_settings(system: &mut System, port: &[u8]) -> Option<Vec<u8>> {
    let mut key = port.to_vec();

    key.push(b':');

    let mut text = system
        .read_profile(b"WIN.INI")
        .get(b"ports", &key, true)
        .unwrap_or_default();

    text.truncate(0x3b);
    (!text.is_empty()).then_some(text)
}

/// A `DCB` set from a port's settings (seg30 `01a9`): the characters for
/// XON and XOFF 11h and 13h; then each field after a comma: the baud rate,
/// the parity (`n`, `o`, or anything else even), the byte's bits, the stop
/// bits (`1` one, anything else two), and a fifth, whatever it says, the
/// XON/XOFF handshake.
fn write_settings(system: &mut System, far: u32, text: &[u8]) {
    let number = |field: &[u8]| {
        field
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .fold(0u16, |value, &digit| {
                value.wrapping_mul(10).wrapping_add(u16::from(digit - b'0'))
            })
    };

    write8(system, far, 0x0e, 0x11);
    write8(system, far, 0x0f, 0x13);

    let flags = read8(system, far, 0x0d) | 1;

    write8(system, far, 0x0d, flags);

    for (index, field) in text.split(|&byte| byte == b',').enumerate() {
        if field.is_empty() {
            continue;
        }

        match index {
            0 => {
                let baud = number(field);

                if baud != 0 {
                    write16(system, far, 1, baud);
                }
            }
            1 => {
                let parity = match field[0] {
                    b'n' | b'N' => 0,
                    b'o' | b'O' => 1,
                    _ => 2,
                };

                write8(system, far, 4, parity);
            }
            2 => {
                let bits = number(field);

                if bits != 0 {
                    write8(system, far, 3, bits as u8);
                }
            }
            3 => write8(system, far, 5, if field[0] == b'1' { 0 } else { 2 }),
            4 => {
                write16(system, far, 8, 0);
                write16(system, far, 0x0a, 0);

                let handshake = read8(system, far, 0x0c) | 0x18;

                write8(system, far, 0x0c, handshake);
            }
            _ => {}
        }
    }
}

/// Bytes laid below the stack for a call, as GDI lays its own on its
/// stack: given to `body` as a far pointer; its answer, and the bytes as
/// they were left.
async fn on_stack<T, F: Future<Output = Result<T, Stop>>>(
    engine: &Engine,
    bytes: &[u8],
    body: impl FnOnce(u32) -> F,
) -> Result<(T, Vec<u8>), Stop> {
    let (saved, far) = {
        let mut system = engine.system();
        let saved = system.cpu.regs[SP];
        let sp = saved.wrapping_sub(((bytes.len() + 1) & !1) as u16);
        let far = u32::from(system.cpu.segments[SS].selector) << 16 | u32::from(sp);

        system.write_far(far, bytes);
        system.cpu.regs[SP] = sp.wrapping_sub(4);
        (saved, far)
    };
    let answer = body(far).await;
    let mut system = engine.system();
    let left = system.read_far(far, bytes.len());

    system.cpu.regs[SP] = saved;
    Ok((answer?, left))
}

/// GDI's own clock for the timeouts: USER's `GetCurrentTime`.
async fn now(engine: &Engine) -> Result<u32, Stop> {
    call(engine, "USER", "GetCurrentTime", &[]).await
}

/// Bytes written through the communications driver (seg30 `0000`):
/// `WriteComm`'s count. With none written, or a part, the error
/// `GetCommError` gives is kept; a queue with bytes in it flushed. Out of
/// paper is a failure at once, as are 400h, 200h and 10h; not selected
/// (800h) or timed out (100h) a failure once `DeviceNotSelectedTimeout` or
/// `TransmissionRetryTimeout` has passed since the first, else nothing
/// written. A failure answers with 8000h added. GDI goes round its loop the
/// while, nothing else running; on a virtual clock the time it takes is
/// charged to the clock, as instructions run.
async fn comm_write(engine: &Engine, kept: u16, data: u32, count: u16) -> Result<u16, Stop> {
    let at = global_lock(engine, kept).await?;
    let cid = read16(&engine.system(), at, 2);
    let answer = comm_written(engine, at, cid, data, count).await;

    global_unlock(engine, kept).await?;
    answer
}

async fn comm_written(
    engine: &Engine,
    at: u32,
    cid: u16,
    data: u32,
    count: u16,
) -> Result<u16, Stop> {
    let reset = |engine: &Engine| {
        let mut system = engine.system();

        write16(&mut system, at, 4, 0);
        write16(&mut system, at, 6, 0);
    };
    let wrote = call(
        engine,
        "USER",
        "WriteComm",
        &[
            GuestArg::Word(cid),
            GuestArg::Long(data),
            GuestArg::Word(count),
        ],
    )
    .await? as i16;

    if wrote > 0 {
        reset(engine);
        return Ok(wrote as u16);
    }

    let wrote = wrote.wrapping_neg() as u16;

    if wrote != 0 {
        reset(engine);
    }

    let error = call(
        engine,
        "USER",
        "GetCommError",
        &[GuestArg::Word(cid), GuestArg::Struct(vec![0; 10])],
    )
    .await? as u16;

    if let Some(spooling) = engine.system().printing.spooling.as_mut() {
        spooling.comm_error = error;
    }

    if error & 0x0f != 0 {
        call(
            engine,
            "USER",
            "FlushComm",
            &[GuestArg::Word(cid), GuestArg::Word(1)],
        )
        .await?;
    }

    let (select, retry) = {
        let system = engine.system();
        let spooling = system.printing.spooling.clone().unwrap_or_default();

        (spooling.select_timeout, spooling.retry_timeout)
    };
    let limit = if error & 0x1000 != 0 {
        return Ok(wrote | 0x8000);
    } else if error & 0x100 != 0 {
        retry
    } else if error & 0x800 != 0 {
        select
    } else {
        return Ok(if error & 0x610 != 0 {
            wrote | 0x8000
        } else {
            wrote
        });
    };
    let time = now(engine).await?;
    let mut system = engine.system();
    let since = u32::from(read16(&system, at, 4)) | u32::from(read16(&system, at, 6)) << 16;

    // GDI goes round again, nothing else running, until the time is out:
    // on a virtual clock the time those rounds take passes.
    let rate = system.clock.rate().unwrap_or(0.0);

    if since == 0 {
        write16(&mut system, at, 4, time as u16);
        write16(&mut system, at, 6, (time >> 16) as u16);
        system.clock.charge(f64::from(limit) * rate);
        return Ok(wrote);
    }

    if time.wrapping_sub(since) < limit {
        system
            .clock
            .charge(f64::from(limit - time.wrapping_sub(since)) * rate);
        return Ok(wrote);
    }

    write16(&mut system, at, 4, 0);
    write16(&mut system, at, 6, 0);
    Ok(wrote | 0x8000)
}

/// The box a write that fails puts up (seg28 `002c`): GDI's message for
/// the code given, or for the error -- out of paper, not responding, not
/// selected, or the port's settings -- with the job's name as its title,
/// Retry and Cancel, system-modal. Its answer.
async fn write_failed(engine: &Engine, far: u32, error: u16, code: u16) -> Result<u32, Stop> {
    let high = (error >> 8) as u8;
    let id = if code != 0 {
        code
    } else if high & 0x10 != 0 {
        0x65
    } else if high & 0x01 != 0 {
        0x67
    } else if high & 0x08 != 0 {
        0x66
    } else {
        0x64
    };
    let text = super::strings::string(id).unwrap_or("").as_bytes();
    let title = string_at(&engine.system(), far, 0x11a);

    call(
        engine,
        "USER",
        "MessageBox",
        &[
            GuestArg::Word(0),
            GuestArg::Struct(with_nought(text)),
            GuestArg::Struct(with_nought(&title)),
            GuestArg::Word(0x1035),
        ],
    )
    .await
}

/// `OpenJob` (seg28 `01c3`): a job for the port named, the document's
/// name, and the device context it prints. -1 for no port; -5 with no
/// memory. A port in `[PrinterPorts]`, not `FILE`, is asked of the network
/// first (`WNetOpenJob`, which with no network answers that it has not got
/// one), then with the spooler on goes to Print Manager, started if it is
/// not running. Else, with `DosPrint` not `yes`, a port the communications
/// driver opens goes through it. Any other job is straight to its port: a
/// file made empty at once (`OpenFile` with `OF_CREATE`, closed), or for
/// `FILE`, the name USER's box asks for (`GetFilePortName`, not followed:
/// refused as a box cancelled). Each job opened is broadcast, 40h with 2
/// and the job's handle in the high word, 1 in the low.
// One path after another, as GDI takes them.
#[allow(clippy::too_many_lines)]
pub async fn open_job(engine: &Engine, output: u32, title: u32, hdc: u16) -> Result<i16, Stop> {
    let (given, device) = {
        let system = engine.system();
        let device = super::printer_driver::driver_dc_of(&system, hdc)
            .and_then(|dc| super::printer_driver::device_name(&system, dc))
            .unwrap_or_default();

        (string_at(&system, output, 0), device)
    };

    if given.is_empty() {
        return Ok(SP_ERROR);
    }

    let spooling = readied(&mut engine.system());
    let port = port_name(&given);
    let queue = queue_of(&spooling, &port, &device);
    let to_file = same(&port, b"file");
    let job = global_alloc(engine, 0x3042, JOB_SIZE).await?;

    if job == 0 {
        return Ok(SP_OUTOFMEMORY);
    }

    let far = global_lock(engine, job).await?;

    {
        let mut system = engine.system();

        write16(&mut system, far, 0x118, 0);
        write16(&mut system, far, 0, 0);
        write16(&mut system, far, 4, 7);
        write16(&mut system, far, 8, hdc);
        write16(&mut system, far, 6, queue as u16);
        copy_name(&mut system, far, 0x11a, &port);
    }

    if !to_file && queue != -1 {
        if !spooling.net_spool || !spooling.on {
            // `WNetOpenJob`, with no network (`USER.EXE` seg22 `0a68`).
            let net = WN_NOT_SUPPORTED;

            if net == WN_SUCCESS || net == 0x45 {
                // A job of the network's: not followed.
            } else if net != 0x43 && net != WN_NOT_SUPPORTED && net != 0x30 {
                global_unlock(engine, job).await?;
                global_free(engine, job).await?;
                return Ok(SP_ERROR);
            }
        }

        if print_manager(engine, &spooling).await? != 0 {
            // Print Manager's job: the document's name kept (`042e`). Not
            // followed further.
            {
                let mut system = engine.system();
                let mut name = string_at(&system, title, 0);

                if name.is_empty() {
                    name = b"Untitled".to_vec();
                }

                copy_name(&mut system, far, 0x11a, &name);
                add_flags(
                    &mut system,
                    far,
                    SPOOLED | if spooling.dos_print { 2 } else { 0 },
                );
            }

            return opened(engine, job).await;
        }

        // Through the communications driver, where `DosPrint` is not `yes`
        // and the driver opens the port (`03ea`): its id kept in a block of
        // GDI's, 8 bytes, at 13Ch.
        if !spooling.dos_print {
            let cid = comm_port(engine, &port).await?;

            if cid != -1 {
                let kept = global_alloc(engine, 0x40, 8).await?;

                if kept == 0 {
                    global_unlock(engine, job).await?;
                    global_free(engine, job).await?;
                    return Ok(SP_OUTOFMEMORY);
                }

                let at = global_lock(engine, kept).await?;

                {
                    let mut system = engine.system();

                    write16(&mut system, at, 2, cid as u16);
                    write16(&mut system, at, 4, 0);
                    write16(&mut system, at, 6, 0);
                }

                global_unlock(engine, kept).await?;

                {
                    let mut system = engine.system();

                    write16(&mut system, far, 0x13c, kept);
                    add_flags(&mut system, far, COMM);
                }

                return opened(engine, job).await;
            }
        }
    }

    let block = global_alloc(engine, 0x42, PORT_SIZE).await?;

    if block == 0 {
        global_unlock(engine, job).await?;
        global_free(engine, job).await?;
        return Ok(SP_OUTOFMEMORY);
    }

    let port_far = global_lock(engine, block).await?;

    {
        let mut system = engine.system();

        write16(&mut system, port_far, 4, 1);
        write16(&mut system, port_far, 2, 8);
        write16(&mut system, port_far, 0x96, 0);
        write16(&mut system, port_far, 8, 0);
        write16(&mut system, port_far, 6, 0);
        write16(&mut system, port_far, 0, 0xffff);
    }

    if to_file {
        // USER's "Print To File" box (`GetFilePortName`, `[0A54h]`): not
        // followed, and the job refused as a box cancelled.
        global_unlock(engine, block).await?;
        global_free(engine, block).await?;
        global_unlock(engine, job).await?;
        global_free(engine, job).await?;
        return Ok(SP_USERABORT);
    }

    let file = call(
        engine,
        "KERNEL",
        "OpenFile",
        &[
            GuestArg::Long(offset_by(far, 0x11a)),
            GuestArg::Long(offset_by(port_far, 0x0a)),
            GuestArg::Word(OF_CREATE | OF_WRITE),
        ],
    )
    .await? as u16;

    if file != 0xffff {
        lclose(engine, file).await?;
    }

    global_unlock(engine, block).await?;

    {
        let mut system = engine.system();

        add_flags(&mut system, far, DIRECT);
        write16(&mut system, far, 2, 1);
        write16(&mut system, far, 0x13c, block);
    }

    opened(engine, job).await
}

/// How a job prints, marked in the high byte of its first word.
fn add_flags(system: &mut System, far: u32, flags: u8) {
    let flags = read8(system, far, 1) | flags;

    write8(system, far, 1, flags);
}

/// A job opened: broadcast, and its handle answered shifted (`0576`).
async fn opened(engine: &Engine, job: u16) -> Result<i16, Stop> {
    global_unlock(engine, job).await?;
    broadcast(engine, 2, u32::from(job) << 16 | 1).await?;
    Ok((job >> 1) as i16)
}

/// `StartSpoolPage` (seg28 `06a1`): 1. With Print Manager's window there,
/// a job straight to its port notes the bytes written so far; Print
/// Manager's job starts a page in a file of its own, not followed.
pub async fn start_spool_page(engine: &Engine, job: u16) -> Result<i16, Stop> {
    let handle = match job_of(engine, job).await? {
        Ok(handle) => handle,
        Err(answer) => return Ok(answer),
    };

    if engine.system().printing.spooler.window == 0 {
        return Ok(1);
    }

    let far = global_lock(engine, handle).await?;

    if read8(&engine.system(), far, 1) & DIRECT != 0 {
        let block = {
            let system = engine.system();
            let page = u32::from(read16(&system, far, 2));

            read16(&system, far, 0x13a + 2 * page)
        };
        let port = global_lock(engine, block).await?;

        {
            let mut system = engine.system();
            let (low, high) = (read16(&system, port, 6), read16(&system, port, 8));

            write16(&mut system, far, 0x114, low);
            write16(&mut system, far, 0x116, high);
        }

        global_unlock(engine, block).await?;
    }

    global_unlock(engine, handle).await?;
    Ok(1)
}

/// `EndSpoolPage` (seg28 `1112`): 1 for a job straight to its port or
/// through the communications driver. Print Manager's page is ended and
/// handed to it: not followed.
pub async fn end_spool_page(engine: &Engine, job: u16) -> Result<i16, Stop> {
    Ok(match job_of(engine, job).await? {
        Ok(_) => 1,
        Err(answer) => answer,
    })
}

/// The file of a job straight to its port, open (seg28 `0b9a`): kept open
/// where `OpenFile` found it on a fixed disk; else, and the first time,
/// opened again from its structure, at the bytes written so far. Its
/// handle, or -1.
async fn open_port(engine: &Engine, port: u32) -> Result<u16, Stop> {
    let (handle, fixed) = {
        let system = engine.system();

        (read16(&system, port, 0), read8(&system, port, 0x0b))
    };

    if fixed != 0 && handle != 0xffff {
        return Ok(handle);
    }

    let file = call(
        engine,
        "KERNEL",
        "OpenFile",
        &[
            GuestArg::Long(0),
            GuestArg::Long(offset_by(port, 0x0a)),
            GuestArg::Word(REOPEN),
        ],
    )
    .await? as u16;

    if file == 0xffff {
        return Ok(file);
    }

    let at = {
        let mut system = engine.system();

        write16(&mut system, port, 0, file);
        u32::from(read16(&system, port, 6)) | u32::from(read16(&system, port, 8)) << 16
    };

    call(
        engine,
        "KERNEL",
        "_llseek",
        &[GuestArg::Word(file), GuestArg::Long(at), GuestArg::Word(0)],
    )
    .await?;
    Ok(file)
}

/// What GDI writes of a job's buffer (seg28 `0a60`): before each write the
/// abort procedure is asked, and nought from it gives -2; then the bytes
/// written with `_lwrite`. A write that fails to a file puts up the box
/// that the disk may be full (68h); to a device, a box once
/// `TransmissionRetryTimeout` has passed since the first failure. Retry
/// tries again; Cancel gives -3. This DOS has no devices, only files.
async fn written(engine: &Engine, far: u32, file: u16, data: u32, count: u16) -> Result<i16, Stop> {
    let mut left = count;
    let mut from = data;

    while left != 0 {
        let hdc = read16(&engine.system(), far, 8);

        if hdc != 0 && query_abort(engine, hdc, 0).await? == 0 {
            return Ok(SP_APPABORT);
        }

        let wrote = call(
            engine,
            "KERNEL",
            "_lwrite",
            &[
                GuestArg::Word(file),
                GuestArg::Long(from),
                GuestArg::Word(left),
            ],
        )
        .await? as u16;

        if wrote > 0 && wrote != 0xffff {
            left -= wrote.min(left);
            from = offset_by(from, u32::from(wrote));
            continue;
        }

        if write_failed(engine, far, 0x100, 0x68).await? != IDRETRY {
            return Ok(SP_USERABORT);
        }
    }

    Ok(count as i16)
}

/// The block of a job's page, by its number at 2.
fn page_block(system: &System, far: u32) -> u16 {
    let page = u32::from(read16(system, far, 2));

    read16(system, far, 0x13a + 2 * page)
}

fn add_written(system: &mut System, port: u32, count: u16) {
    let total = (u32::from(read16(system, port, 6)) | u32::from(read16(system, port, 8)) << 16)
        .wrapping_add(u32::from(count));

    write16(system, port, 6, total as u16);
    write16(system, port, 8, (total >> 16) as u16);
}

/// A job's buffer written to its file and emptied (seg28 `0d63`).
async fn flushed(engine: &Engine, far: u32) -> Result<(), Stop> {
    let block = page_block(&engine.system(), far);
    let port = global_lock(engine, block).await?;
    let count = read16(&engine.system(), far, 0x0a);

    if count != 0 {
        let file = open_port(engine, port).await?;

        if file != 0xffff {
            let answer = written(engine, far, file, offset_by(far, 0x10), count).await?;
            let fixed = {
                let mut system = engine.system();

                if answer > 0 {
                    add_written(&mut system, port, answer as u16);
                }

                write16(&mut system, far, 0x0a, 0);
                read8(&system, port, 0x0b)
            };

            if fixed == 0 {
                lclose(engine, file).await?;
            }
        }
    }

    global_unlock(engine, block).await
}

/// `WriteSpool` (seg28 `08eb`): the bytes given added to the job. A job
/// straight to its port keeps them in its buffer and writes the buffer each
/// time it fills (`0c99`), so the abort procedure is asked once for each
/// 100h bytes; the answer is the bytes taken, or the write's error. -1 for
/// a job with no page. Through the communications driver (`0946`): the
/// abort procedure asked before each write; a write that fails puts up its
/// box, whose Cancel gives -3. Print Manager's job and the network's: not
/// followed, -1.
pub async fn write_spool(engine: &Engine, job: u16, data: u32, count: u16) -> Result<i16, Stop> {
    let handle = match job_of(engine, job).await? {
        Ok(handle) => handle,
        Err(answer) => return Ok(answer),
    };
    let far = global_lock(engine, handle).await?;
    let flags = read8(&engine.system(), far, 1);

    if flags & COMM != 0 && flags & (DIRECT | SPOOLED) == 0 {
        let kept = read16(&engine.system(), far, 0x13c);
        let mut left = count;
        let mut from = data;
        let mut answer = count as i16;

        while left != 0 {
            let hdc = read16(&engine.system(), far, 8);

            if hdc != 0 && query_abort(engine, hdc, 0).await? == 0 {
                answer = SP_APPABORT;
                break;
            }

            let mut wrote = comm_write(engine, kept, from, left).await?;

            if wrote & 0x8000 != 0 {
                wrote &= 0x7fff;

                let error = engine
                    .system()
                    .printing
                    .spooling
                    .as_ref()
                    .map_or(0, |spooling| spooling.comm_error);

                if write_failed(engine, far, error, 0).await? != IDRETRY {
                    answer = SP_USERABORT;
                    break;
                }
            }

            left -= wrote.min(left);
            from = offset_by(from, u32::from(wrote));
        }

        global_unlock(engine, handle).await?;
        return Ok(answer);
    }

    if flags & DIRECT == 0 || flags & (NETWORK | SPOOLED) != 0 {
        global_unlock(engine, handle).await?;
        return Ok(SP_ERROR);
    }

    let block = page_block(&engine.system(), far);

    if block == 0 {
        global_unlock(engine, handle).await?;
        return Ok(SP_ERROR);
    }

    let port = global_lock(engine, block).await?;
    let file = open_port(engine, port).await?;
    let mut answer: i16 = 0;

    if file == 0xffff {
        answer = SP_ERROR;
    } else {
        let mut left = count;
        let mut from = data;

        while left > 0 {
            let used = read16(&engine.system(), far, 0x0a);
            let step = (0x100 - used).min(left);

            {
                let mut system = engine.system();
                let bytes = system.read_far(from, usize::from(step));

                system.write_far(offset_by(far, 0x10 + u32::from(used)), &bytes);
                write16(&mut system, far, 0x0a, used + step);
            }

            answer = answer.wrapping_add(step as i16);
            left -= step;
            from = offset_by(from, u32::from(step));

            if used + step == 0x100 {
                let wrote = written(engine, far, file, offset_by(far, 0x10), 0x100).await?;

                if wrote < 0 {
                    answer = wrote;
                    break;
                }

                let mut system = engine.system();

                write16(&mut system, far, 0x0a, 0);
                add_written(&mut system, port, wrote as u16);
            }
        }

        if read8(&engine.system(), port, 0x0b) == 0 {
            lclose(engine, file).await?;
        }
    }

    global_unlock(engine, block).await?;
    global_unlock(engine, handle).await?;
    Ok(answer)
}

/// `WriteDialog` (seg28 `0e82`): for a job straight to its port, its
/// buffer written, and nought answered; the communications driver's shows
/// the message in a box of its own, OK only, with the job's name as its
/// title (`0fc1`); Print Manager's keeps the message for its own box, not
/// followed. The count, but for the first.
pub async fn write_dialog(
    engine: &Engine,
    job: u16,
    message: u32,
    count: u16,
) -> Result<i16, Stop> {
    let handle = match job_of(engine, job).await? {
        Ok(handle) => handle,
        Err(answer) => return Ok(answer),
    };
    let far = global_lock(engine, handle).await?;
    let flags = read8(&engine.system(), far, 1);
    let mut answer = count as i16;

    if flags & DIRECT != 0 {
        flushed(engine, far).await?;
        answer = 0;
    } else if flags & SPOOLED == 0 && flags & COMM != 0 {
        let (text, title) = {
            let system = engine.system();

            (
                string_at(&system, message, 0),
                string_at(&system, far, 0x11a),
            )
        };

        call(
            engine,
            "USER",
            "MessageBox",
            &[
                GuestArg::Word(0),
                GuestArg::Struct(with_nought(&text)),
                GuestArg::Struct(with_nought(&title)),
                GuestArg::Word(0x1030),
            ],
        )
        .await?;
    }

    global_unlock(engine, handle).await?;
    Ok(answer)
}

/// The communications driver's port of a job closed, its block freed
/// (seg30 `015d`).
async fn close_comm_port(engine: &Engine, kept: u16) -> Result<(), Stop> {
    if kept == 0 || kept == 0xffff {
        return Ok(());
    }

    let at = global_lock(engine, kept).await?;
    let cid = read16(&engine.system(), at, 2);

    call(engine, "USER", "CloseComm", &[GuestArg::Word(cid)]).await?;
    global_unlock(engine, kept).await?;
    global_free(engine, kept).await
}

/// `CloseJob` (seg28 `1292`): a job straight to its port has its buffer
/// written, its file closed and its blocks freed; the communications
/// driver's has its port closed; the closing broadcast, 40h with 2 and the
/// job's handle in the high word, 2 in the low. 1. Print Manager's job is
/// marked done and left to it: not followed.
pub async fn close_job(engine: &Engine, job: u16) -> Result<i16, Stop> {
    let handle = match job_of(engine, job).await? {
        Ok(handle) => handle,
        Err(answer) => return Ok(answer),
    };
    let far = global_lock(engine, handle).await?;

    if far == 0 {
        return Ok(SP_ERROR);
    }

    let flags = read8(&engine.system(), far, 1);

    if flags & COMM != 0 {
        let kept = read16(&engine.system(), far, 0x13c);

        close_comm_port(engine, kept).await?;
    }

    // Print Manager's job is marked done and left to it (`138f`).
    if flags & (DIRECT | COMM) == 0 {
        {
            let mut system = engine.system();
            let state = read8(&system, far, 0) | 1;

            write8(&mut system, far, 0, state);
        }

        global_unlock(engine, handle).await?;
        broadcast(engine, 2, u32::from(handle) << 16 | 2).await?;
        return Ok(1);
    }

    if flags & DIRECT != 0 {
        let block = page_block(&engine.system(), far);

        if block != 0 {
            flushed(engine, far).await?;

            let port = global_lock(engine, block).await?;
            let file = read16(&engine.system(), port, 0);

            if file != 0xffff {
                lclose(engine, file).await?;
            }

            write16(&mut engine.system(), port, 0, 0xffff);
            global_unlock(engine, block).await?;
            global_free(engine, block).await?;

            let mut system = engine.system();
            let page = u32::from(read16(&system, far, 2));

            write16(&mut system, far, 0x13a + 2 * page, 0);
        }
    }

    global_unlock(engine, handle).await?;
    global_free(engine, handle).await?;
    broadcast(engine, 2, u32::from(handle) << 16 | 2).await?;
    Ok(1)
}

/// `DeleteJob` (seg28 `13e0`): a job straight to its port has its file
/// closed and deleted, unwritten, and its blocks freed; the communications
/// driver's port is flushed, reset and closed (seg30 `018a`). 1. No
/// broadcast.
pub async fn delete_job(engine: &Engine, job: u16) -> Result<i16, Stop> {
    let handle = match job_of(engine, job).await? {
        Ok(handle) => handle,
        Err(answer) => return Ok(answer),
    };
    let far = global_lock(engine, handle).await?;

    if far == 0 {
        return Ok(SP_ERROR);
    }

    let flags = read8(&engine.system(), far, 1);

    if flags & COMM != 0 {
        let kept = read16(&engine.system(), far, 0x13c);
        let at = global_lock(engine, kept).await?;
        let cid = read16(&engine.system(), at, 2);

        global_unlock(engine, kept).await?;
        call(
            engine,
            "USER",
            "FlushComm",
            &[GuestArg::Word(cid), GuestArg::Word(0)],
        )
        .await?;
        call(
            engine,
            "USER",
            "EscapeCommFunction",
            &[GuestArg::Word(cid), GuestArg::Word(7)],
        )
        .await?;
        close_comm_port(engine, kept).await?;
    }

    if flags & DIRECT != 0 {
        let block = page_block(&engine.system(), far);

        if block != 0 {
            let port = global_lock(engine, block).await?;
            let file = read16(&engine.system(), port, 0);

            if file != 0xffff {
                lclose(engine, file).await?;
            }

            // `DeletePathname` of the structure's path (`14ac`): DOS's
            // delete, told to `FileCdr`'s procedure.
            let path = string_at(&engine.system(), port, 0x12);

            if !path.is_empty() {
                let text: String = path.iter().map(|&byte| char::from(byte)).collect();
                let deleted = {
                    let mut system = engine.system();
                    let deleted = system.delete_path(&text).is_ok();

                    if deleted {
                        system.note_file_change(0x4100, &path, None);
                    }

                    deleted
                };

                if deleted {
                    engine.tell_file_changes().await?;
                }
            }

            global_unlock(engine, block).await?;
            global_free(engine, block).await?;
        }
    }

    global_unlock(engine, handle).await?;
    global_free(engine, handle).await?;
    Ok(1)
}

/// `QueryAbort` (seg7 `052d`): nought for no device context; else the
/// answer of the abort procedure `SETABORTPROC` gave it, called with the
/// device context and the code; 1 with none.
pub async fn query_abort(engine: &Engine, hdc: u16, code: u16) -> Result<u16, Stop> {
    if hdc == 0 {
        return Ok(0);
    }

    let (procedure, stack) = {
        let system = engine.system();
        let procedure = super::printer_driver::driver_dc_of(&system, hdc)
            .and_then(|dc| system.printing.drivers.abort.get(&dc).copied())
            .or_else(|| {
                crate::printer::printer_of(&system, hdc)
                    .and_then(|dc| system.printing.printers.get(&dc))
                    .map(|printer| printer.abort_proc)
            })
            .unwrap_or(0);

        (procedure, system.cpu.segments[SS].selector)
    };

    if procedure == 0 {
        return Ok(1);
    }

    let (answer, _) = engine
        .call_with(
            procedure,
            &[GuestArg::Word(hdc), GuestArg::Word(code)],
            &[
                Register::Word(AX, stack),
                Register::Segment(DS, stack),
                Register::Segment(ES, stack),
            ],
        )
        .await?;

    Ok(answer as u16)
}

fn open_job_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (output, title, hdc) = {
            let system = engine.system();

            (args.dword(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(
            open_job(engine, output, title, hdc).await? as u16,
        ))
    })
}

fn start_spool_page_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let job = args.word(&engine.system());

        Ok(Answer::Word(start_spool_page(engine, job).await? as u16))
    })
}

fn end_spool_page_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let job = args.word(&engine.system());

        Ok(Answer::Word(end_spool_page(engine, job).await? as u16))
    })
}

fn close_job_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let job = args.word(&engine.system());

        Ok(Answer::Word(close_job(engine, job).await? as u16))
    })
}

fn delete_job_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let job = args.word(&engine.system());

        Ok(Answer::Word(delete_job(engine, job).await? as u16))
    })
}

fn write_spool_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (job, data, count) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(
            write_spool(engine, job, data, count).await? as u16,
        ))
    })
}

fn write_dialog_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (job, message, count) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(
            write_dialog(engine, job, message, count).await? as u16,
        ))
    })
}

fn query_abort_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, code) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        Ok(Answer::Word(query_abort(engine, hdc, code).await?))
    })
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "OpenJob" => open_job_call,
        "StartSpoolPage" => start_spool_page_call,
        "EndSpoolPage" => end_spool_page_call,
        "WriteSpool" => write_spool_call,
        "WriteDialog" => write_dialog_call,
        "CloseJob" => close_job_call,
        "DeleteJob" => delete_job_call,
        "QueryAbort" => query_abort_call,
        _ => return None,
    }))
}
