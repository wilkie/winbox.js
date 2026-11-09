//! MMSYSTEM's tasks of their own: `mmTaskCreate`, which starts
//! `MMTASK.TSK` to call a procedure on a task of its own, and WinBox's own
//! `MMTASK`, started where the drive has no `MMTASK.TSK`. **Recorded** by
//! `mmtaskc`.

use crate::call::{Answer, Args, Later, Stop};
use crate::commdlg::api::{Arg, api};
use crate::engine::{Engine, GuestArg, Register};
use crate::system::System;

/// The module MMSYSTEM starts, its string 7D0h (seg4 `0614`).
pub const MMTASK_FILE: &str = "mmtask.tsk";

/// How `LoadModule` is told to show it: 4 (seg4 `064b`).
const SHOW: u16 = 4;

/// The command tail's length (seg4 `0622`).
const TAIL_LENGTH: usize = 13;

/// Where `MMTASK`'s data keeps the procedure, the double word, and
/// `MAIN`'s far address.
pub const PROC: u16 = 0x10;
pub const INSTANCE: u16 = 0x14;
pub const MAIN_SLOT: u16 = 0x1c;
const DATA_SIZE: usize = 0x20;

/// MMSYSTEM's ordinal for `MAIN`, where it exports nothing.
pub const MAIN_ORDINAL: u16 = 1204;

const NAME: &[u8] = b"MMTASK";
const DESCRIPTION: &[u8] = b"WinBox multimedia task";
pub const MMTASK_PATH: &str = "C:\\WINDOWS\\SYSTEM\\MMTASK.TSK";

const CODE: [u8; 0x17] = [
    0x9a, 0xff, 0xff, 0x00, 0x00, // 00 call far KERNEL.InitTask
    0x0b, 0xc0, // 05 or ax, ax
    0x74, 0x09, // 07 jz 12
    0x57, // 09 push di       hInstance
    0xff, 0x1e, 0x1c, 0x00, // 0A call far [MAIN_SLOT]
    0xb4, 0x4c, // 0E mov ah, 4Ch
    0xcd, 0x21, // 10 int 21h
    0xb8, 0xff, 0x4c, // 12 mov ax, 4CFFh
    0xcd, 0x21, // 15 int 21h
];

const IMPORTS: [(u16, u16, u16); 1] = [
    // KERNEL.InitTask
    (0x01, 1, 91),
];

const NE: usize = 0x40;
const SHIFT: u16 = 4;

fn put16(bytes: &mut [u8], at: usize, value: u16) {
    bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

fn counted(bytes: &mut Vec<u8>, text: &[u8]) {
    bytes.push(text.len() as u8);
    bytes.extend_from_slice(text);
}

fn align(bytes: &mut Vec<u8>) {
    let unit = 1usize << SHIFT;

    bytes.resize(bytes.len().div_ceil(unit) * unit, 0);
}

/// The executable's bytes.
#[must_use]
pub fn image() -> Vec<u8> {
    let mut bytes = vec![0u8; NE + 0x40];

    bytes[0..2].copy_from_slice(b"MZ");
    put16(&mut bytes, 0x02, 0x40);
    put16(&mut bytes, 0x04, 1);
    put16(&mut bytes, 0x08, 4);
    put16(&mut bytes, 0x18, 0x40);
    put16(&mut bytes, 0x3c, NE as u16);

    let segment_table = bytes.len();

    bytes.extend_from_slice(&[0; 16]);

    let resident = bytes.len();

    counted(&mut bytes, NAME);
    bytes.extend_from_slice(&[0, 0, 0]);

    let references = bytes.len();

    bytes.extend_from_slice(&[1, 0]);

    let imported = bytes.len();

    bytes.push(0);
    counted(&mut bytes, b"KERNEL");

    let entries = bytes.len();

    bytes.extend_from_slice(&[0, 0]);

    let nonresident = bytes.len();

    counted(&mut bytes, DESCRIPTION);
    bytes.extend_from_slice(&[0, 0, 0]);

    let nonresident_size = bytes.len() - nonresident;

    align(&mut bytes);

    let code = bytes.len();

    bytes.extend_from_slice(&CODE);
    bytes.extend_from_slice(&(IMPORTS.len() as u16).to_le_bytes());

    for (offset, module, ordinal) in IMPORTS {
        bytes.extend_from_slice(&[3, 1]);
        bytes.extend_from_slice(&offset.to_le_bytes());
        bytes.extend_from_slice(&module.to_le_bytes());
        bytes.extend_from_slice(&ordinal.to_le_bytes());
    }

    align(&mut bytes);

    let data = bytes.len();

    bytes.resize(data + DATA_SIZE, 0);

    let relative = |at: usize| (at - NE) as u16;
    // `MMTASK.TSK`'s header's values: linker 5.20, flags 030Ah, no local
    // heap, a stack of 1000h, Windows 3.10 with proportional fonts.
    let header: [(usize, u16); 25] = [
        (0x00, 0x454e),
        (0x02, 0x1405),
        (0x04, relative(entries)),
        (0x06, 2),
        (0x0c, 0x030a),
        (0x0e, 2),
        (0x10, 0),
        (0x12, 0x1000),
        (0x14, 0),
        (0x16, 1),
        (0x18, 0),
        (0x1a, 2),
        (0x1c, 2),
        (0x1e, 1),
        (0x20, nonresident_size as u16),
        (0x22, relative(segment_table)),
        (0x24, relative(resident)),
        (0x26, relative(resident)),
        (0x28, relative(references)),
        (0x2a, relative(imported)),
        (0x2c, nonresident as u16),
        (0x2e, 0),
        (0x32, SHIFT),
        (0x36, 0x0802),
        (0x3e, 0x030a),
    ];

    for (at, value) in header {
        put16(&mut bytes, NE + at, value);
    }

    let sector = |at: usize| (at >> SHIFT) as u16;
    let table = [
        sector(code),
        CODE.len() as u16,
        0x1d50,
        CODE.len() as u16,
        sector(data),
        DATA_SIZE as u16,
        0x0c51,
        DATA_SIZE as u16,
    ];

    for (index, value) in table.into_iter().enumerate() {
        put16(&mut bytes, segment_table + 2 * index, value);
    }

    bytes
}

/// Whether a module's file named is `MMTASK.TSK`.
pub(crate) fn wanted(path: &str) -> bool {
    path.rsplit(['\\', ':', '/'])
        .next()
        .is_some_and(|file| file.eq_ignore_ascii_case(MMTASK_FILE))
}

/// A procedure called on a task of its own (seg4 `05fa`-`0686`): nought
/// for a task started, its task written where `lphTask` points; 2 for an
/// answer of nought, 1 for any other.
pub fn mm_task_create(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (procedure, place, instance) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };
        let words = [
            procedure as u16,
            (procedure >> 16) as u16,
            instance as u16,
            (instance >> 16) as u16,
            0,
            0,
        ];
        let mut tail: String = words
            .iter()
            .flat_map(|word| word.to_le_bytes())
            .take(TAIL_LENGTH - 1)
            .map(char::from)
            .collect();

        tail.push('\r');

        let answer = engine
            .start_named(&MMTASK_FILE.to_ascii_uppercase(), &tail, SHOW, None)
            .await?;
        let started = answer as u16;
        let task = if started >= 32 {
            (answer >> 16) as u16
        } else {
            started
        };
        let code = if task > 0x20 {
            0
        } else if task != 0 {
            1
        } else {
            2
        };

        if place != 0 {
            engine
                .system()
                .write_far(place, &(if code == 0 { task } else { 0 }).to_le_bytes());
        }

        Ok(Answer::Word(code))
    })
}

impl Engine {
    /// WinBox's own `MMTASK` started as `LoadModule` starts a program: its
    /// image loaded, `MAIN`'s far address written into its data. Its
    /// instance and its task.
    pub(crate) async fn start_mmtask(
        &self,
        command_line: &str,
        show: u16,
        strings: Option<Vec<u8>>,
    ) -> Result<(u16, u16), Stop> {
        let child = {
            let mut system = self.system();
            let strings = strings.or_else(|| system.environment_block());
            let executable = winbox_ne::Executable::parse(image())
                .map_err(|_| Stop::Unsupported("MMTASK's image"))?;
            let child = match system.add_executable(
                executable,
                MMTASK_PATH,
                command_line,
                show,
                strings,
                true,
            )? {
                Ok(child) => child,
                Err(error) => return Ok((error, 0)),
            };
            let program = system.scheduler.slots[child].program;
            let main = super::mmio::own_address(&mut system, MAIN_ORDINAL);

            if let Some(data) = system.modules[program].data() {
                let at = (data as u32) << 16 | u32::from(MAIN_SLOT);

                system.cpu.bus.write(at, &main.to_le_bytes());
            }

            child
        };

        self.run_started(child).await
    }
}

fn word(system: &System, selector: u16, at: u16) -> u16 {
    let bytes = system.read_far(u32::from(selector) << 16 | u32::from(at), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// What `MMTASK` does once started (`MMTASK.TSK` seg1 `0000`-`007a`).
pub fn mm_task_main(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let instance = args.word(&engine.system());
        let data = instance | 1;

        {
            let mut system = engine.system();
            let psp = system
                .task
                .as_ref()
                .map(|task| winbox_machine::segment_selector(task.program_segment));

            if let Some(psp) = psp {
                let length = system.read_far(u32::from(psp) << 16 | 0x80, 1)[0];

                if length >> 1 == 6 {
                    let bytes = system.read_far(u32::from(psp) << 16 | 0x81, 12);

                    system.write_far(u32::from(data) << 16 | u32::from(PROC), &bytes);
                }

                system.write_far(u32::from(psp) << 16 | 0x80, &[0, 0]);
            }
        }

        api(engine, "USER", "InitApp", &[Arg::W(instance)]).await?;

        if api(engine, "USER", "SetMessageQueue", &[Arg::W(0x40)])
            .await?
            .word()
            == 0
        {
            return Ok(Answer::Word(0));
        }

        api(engine, "KERNEL", "WaitEvent", &[Arg::W(0)]).await?;

        let (procedure, low, high) = {
            let system = engine.system();

            (
                u32::from(word(&system, data, PROC + 2)) << 16
                    | u32::from(word(&system, data, PROC)),
                word(&system, data, INSTANCE),
                word(&system, data, INSTANCE + 2),
            )
        };

        if procedure >> 16 != 0 {
            api(engine, "KERNEL", "OldYield", &[]).await?;
            engine
                .call_with(
                    procedure,
                    &[GuestArg::Long(u32::from(high) << 16 | u32::from(low))],
                    &[
                        Register::Word(winbox_cpu::AX, low),
                        Register::Word(winbox_cpu::DX, high),
                        Register::Segment(winbox_cpu::DS, data),
                    ],
                )
                .await?;
        }

        for _ in 0..3 {
            api(engine, "KERNEL", "OldYield", &[]).await?;
        }

        Ok(Answer::Word(0))
    })
}
