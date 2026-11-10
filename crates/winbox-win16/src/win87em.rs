//! WIN87EM, the coprocessor and emulator library, as winbox.js keeps it:
//! `__FPMATH` and its saving and restoring, over the processor's own unit.
//! **Read out** of `WIN87EM.DLL` (seg1 `2a`-`220`).

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{AX, BX, CS, DS, DX, ES, Exit, SS, X87, from_extended, round_even, to_extended};

use crate::call::{Answer, Args, Stop};
use crate::engine::{Engine, Register};
use crate::system::System;

/// The size of the area `__WIN87EMSAVE` fills: the coprocessor's 94 bytes
/// and the rest.
const SAVE_SIZE: u16 = 0x1cd;
const FSAVE_SIZE: u32 = 0x5e;
const CARRY: u16 = 0x0001;

/// WIN87EM's state beside the unit's: the program's control word, the
/// exceptions gathered, how many programs have started it, and whether the
/// coprocessor's stack may spill.
#[derive(Debug, Clone, Copy)]
pub struct FloatingState {
    pub control: u16,
    pub status: u16,
    pub uses: u16,
    pub spill: u16,
}

impl Default for FloatingState {
    fn default() -> Self {
        Self {
            control: 0x1332,
            status: 0,
            uses: 0,
            spill: 1,
        }
    }
}

fn unit(system: &mut System) -> Result<&mut X87, Stop> {
    system
        .cpu
        .fpu
        .as_mut()
        .ok_or(Stop::Unsupported("no floating-point unit"))
}

/// The control word set: the invalid and denormal exceptions left unmasked
/// on the unit; the unit's answered.
fn set_control(system: &mut System, word: u16) -> Result<u16, Stop> {
    let effective = word & 0xff3c;

    system.floating.control = word;
    unit(system)?.control = effective;
    Ok(effective)
}

/// The unit made empty, the control word 1332h, the exceptions cleared, as
/// `__FPMATH` 1 resets it (seg1 `b3`).
fn reset(system: &mut System) -> Result<(), Stop> {
    unit(system)?.reset();
    set_control(system, 0x1332)?;
    unit(system)?.status &= 0x3800;
    system.floating.status = 0;
    Ok(())
}

/// A value rounded as a control word's bits 10 and 11 say.
fn rounded(control: u16, value: f64) -> f64 {
    match (control >> 10) & 3 {
        1 => value.floor(),
        2 => value.ceil(),
        3 => value.trunc(),
        _ => round_even(value),
    }
}

/// `__FPMATH`, BX the function, its arguments and answers in registers:
/// 0 starts it for a program, 1 resets, 2 stops it; 3 makes DX:AX the
/// procedure exceptions go to; 4 sets the control word, 5 answers it; 6
/// rounds ST(0), 7 pops it as a long in DX:AX; 8 answers the exceptions, 9
/// clears them; 10 answers the values on the stack; 11 whether there is a
/// coprocessor; 12 keeps AX; past 12, `FFFFh` in AX and DX.
pub fn fpmath(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let coprocessor = system.coprocessor;

    match system.cpu.regs[BX] {
        0 => {
            system.floating.uses += 1;
            reset(system)?;
            system.cpu.regs[AX] = 0;
            system.cpu.flags &= !CARRY;
        }
        1 => {
            reset(system)?;
            system.cpu.regs[AX] = 0;
        }
        2 => {
            reset(system)?;
            system.floating.uses = system.floating.uses.saturating_sub(1);
            system.cpu.regs[AX] = 0;
        }
        3 => {
            let (offset, segment) = (system.cpu.regs[AX], system.cpu.regs[DX]);
            let at = (0xffd << 16) + 0x3e * 4;

            system.cpu.bus.write16(at, offset);
            system.cpu.bus.write16(at + 2, segment);
            system.cpu.regs[AX] = 0x253e;
        }
        4 => {
            let word = system.cpu.regs[AX];

            system.cpu.regs[AX] = set_control(system, word)?;
        }
        5 => system.cpu.regs[AX] = system.floating.control,
        6 => {
            let rounding = system.cpu.regs[AX];
            let fpu = unit(system)?;
            let value = fpu.st(0);
            let at = ((fpu.status >> 11) & 7) as usize;

            fpu.registers[at] = rounded(rounding, value);
            fpu.empty[at] = false;
        }
        7 => {
            let rounding = system.cpu.regs[AX];
            let fpu = unit(system)?;
            let value = rounded(rounding, fpu.st(0));
            let fits = value.is_finite() && value >= -(2f64.powi(31)) && value < 2f64.powi(31);
            let long = if fits {
                value as i64 as u32
            } else {
                0x8000_0000
            };
            let top = ((fpu.status >> 11) & 7) as usize;

            fpu.empty[top] = true;
            fpu.status = (fpu.status & !0x3800) | (((top as u16 + 1) & 7) << 11);

            if !fits {
                system.floating.status |= 0x01;
            }

            system.cpu.regs[AX] = long as u16;
            system.cpu.regs[DX] = (long >> 16) as u16;
        }
        8 => {
            let unit_status = if coprocessor {
                unit(system)?.status & 0x3f
            } else {
                0
            };

            system.floating.status = (system.floating.status | unit_status) & 0x1fff;
            system.cpu.regs[AX] = system.floating.status;
        }
        9 => {
            unit(system)?.status &= 0x3800;
            system.floating.status = 0;
            system.cpu.regs[AX] = 0;
        }
        10 => {
            let in_use = unit(system)?.empty.iter().filter(|&&empty| !empty).count() as u16;

            system.cpu.regs[DX] = if coprocessor { in_use } else { 0 };
            system.cpu.regs[AX] = in_use;
        }
        11 => system.cpu.regs[AX] = u16::from(coprocessor),
        12 => system.floating.spill = system.cpu.regs[AX],
        _ => {
            system.cpu.regs[AX] = 0xffff;
            system.cpu.regs[DX] = 0xffff;
        }
    }

    Ok(Answer::Nothing)
}

pub fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// What WIN87EM is: its version, 600h; the size `__WIN87EMSAVE` needs; its
/// data and code segments; whether there is a coprocessor. Nought, or -1
/// for a size under 12.
pub fn info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let size = args.word(system);

    if size < 12 {
        return Ok(Answer::Word(0xffff));
    }

    let kept = system
        .kept_named("WIN87EM")
        .ok_or(Stop::Unsupported("WIN87EM"))?;
    let code = system.stubs(kept) as u16;
    let words = [
        0x0600,
        SAVE_SIZE,
        0,
        code << 3,
        u16::from(system.coprocessor),
        0,
    ];
    let bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();

    system.write_far(far, &bytes);
    Ok(Answer::Word(0))
}

/// The unit as `FNSAVE` writes it -- the environment, then ST(0) to ST(7)
/// as ten bytes each -- and then reset, as `FNINIT` leaves it.
pub(crate) fn save_unit(system: &mut System, far: u32) -> Result<(), Stop> {
    let fpu = unit(system)?.clone();
    let mut bytes = Vec::with_capacity(FSAVE_SIZE as usize);

    for word in [fpu.control, fpu.status, fpu.tag_word(), 0, 0, 0, 0] {
        bytes.extend_from_slice(&word.to_le_bytes());
    }

    let top = usize::from((fpu.status >> 11) & 7);

    for i in 0..8 {
        let (mantissa, sign_exponent) = to_extended(fpu.registers[(top + i) & 7]);

        bytes.extend_from_slice(&mantissa.to_le_bytes());
        bytes.extend_from_slice(&sign_exponent.to_le_bytes());
    }

    system.write_far(far, &bytes);
    unit(system)?.reset();
    Ok(())
}

/// The unit as `FRSTOR` reads it back.
pub(crate) fn restore_unit(system: &mut System, far: u32) -> Result<(), Stop> {
    let bytes = system.read_far(far, FSAVE_SIZE as usize);
    let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let fpu = unit(system)?;
    let tags = word(4);

    fpu.control = word(0);
    fpu.status = word(2);

    for at in 0..8 {
        fpu.empty[at] = (tags >> (2 * at)) & 3 == 3;
    }

    let top = usize::from((fpu.status >> 11) & 7);

    for i in 0..8 {
        let at = 14 + 10 * i;
        let mantissa = u64::from_le_bytes(bytes[at..at + 8].try_into().expect("eight bytes"));

        fpu.registers[(top + i) & 7] = from_extended(mantissa, word(at + 8));
    }

    Ok(())
}

/// The floating-point state saved for a program: the unit as `FNSAVE`
/// writes it, then WIN87EM's own. Nought, or -1 for a size under 1CDh.
pub fn save(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let size = args.word(system);

    if size < SAVE_SIZE {
        return Ok(Answer::Word(0xffff));
    }

    save_unit(system, far)?;

    let state = system.floating;
    let bytes: Vec<u8> = [state.control, state.status, state.uses, state.spill]
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .collect();
    let at = (far & 0xffff_0000) | (far.wrapping_add(FSAVE_SIZE) & 0xffff);

    system.write_far(at, &bytes);
    Ok(Answer::Word(0))
}

/// What `__WIN87EMSAVE` saved, put back.
pub fn restore(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let size = args.word(system);

    if size < SAVE_SIZE {
        return Ok(Answer::Word(0xffff));
    }

    let at = (far & 0xffff_0000) | (far.wrapping_add(FSAVE_SIZE) & 0xffff);
    let bytes = system.read_far(at, 8);
    let word = |i: usize| u16::from_le_bytes([bytes[2 * i], bytes[2 * i + 1]]);

    system.floating = FloatingState {
        control: word(0),
        status: word(1),
        uses: word(2),
        spill: word(3),
    };
    restore_unit(system, far)?;
    Ok(Answer::Word(0))
}

// The emulator: WIN87EM's handlers of `INT 34h` to `3Ch`, which the OS
// fixups make of a program's floating-point instructions where there is
// no coprocessor (`linker.rs`). Read out of `WIN87EM.DLL` seg1: the
// handlers set at `ff` (`d0a` for 34h-3Bh, `cca` for 3Ch, `cc0` for 3Dh,
// each a byte on in enhanced mode, past its `STI`), the decoding at
// `cca`-`e81`, the instructions' tables at `960`-`9d7`, and the end of
// each at `ec0`, which reports at `67c`.

/// What an instruction raised, in the word WIN87EM gathers each one's in
/// (its `[16h]`): the unit's exceptions in the low byte, then these.
/// An operand in memory, set before each such instruction (`dc0`), never
/// reported (`edb`).
const IN_MEMORY: u16 = 0x2000;
/// An instruction the emulator does not carry out (`ffd`).
const UNEMULATED: u16 = 0x0040;
/// The square root of a negative number (`22f3`), with the invalid
/// operation.
const SQUARE_ROOT_NEGATIVE: u16 = 0x0080;
const INVALID: u16 = 0x0001;
/// The stack's faults, with the invalid operation (`260`, `270`, `e77`).
const STACK_OVERFLOW: u16 = 0x0200;
const STACK_UNDERFLOW: u16 = 0x0400;

/// The unit's own bits, as `winbox-cpu` records them.
const UNIT_INVALID: u16 = 0x0001;
const UNIT_STACK_FAULT: u16 = 0x0040;
const UNIT_C1: u16 = 0x0200;
const TOP: u16 = 0x3800;

/// The exceptions the program's control word masks, as the end of each
/// instruction reads them (`ecd`-`ed9`): its six masks, a denormal's
/// always set; the unemulated and the square root's never.
const ALWAYS_MASKED: u16 = 0x00c2;
const MASKS: u16 = 0x003f;

/// What the emulator does with an instruction (seg1 `d2a`-`e81`, the
/// tables at `970`, `980`, `9a0`-`9d7`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Carried {
    /// Run on the unit as this opcode and ModR/M byte, then popped where
    /// `pop` says.
    As {
        opcode: u8,
        modrm: u8,
        pop: bool,
    },
    /// `FFREE ST(i)`, and the other register forms it answers as it: the
    /// register taken out of the stack, the stack closed up over it
    /// (`2115`).
    Free(usize),
    /// `FLDCW`: the program's control word and the unit's the same
    /// (`1f84`).
    LoadControl,
    /// `FNSTCW`: the program's control word (`1f8d`).
    StoreControl,
    /// `FNSTSW` to memory: the emulator's status word (`1f94`), which
    /// keeps no TOP.
    StoreStatus,
    /// `FNSTSW AX` (`f8c`).
    StatusToAx,
    /// `FNCLEX` and the forms beside it: the status word made nought
    /// (`f85`).
    ClearStatus,
    Unemulated,
}

/// The ESC opcodes, `D8h` on.
const D8: u8 = 0xd8;
const D9: u8 = 0xd9;
const DA: u8 = 0xda;
const DB: u8 = 0xdb;
const DC: u8 = 0xdc;
const DD: u8 = 0xdd;
const DE: u8 = 0xde;
const DF: u8 = 0xdf;

/// What WIN87EM's emulator does with an ESC opcode and its ModR/M byte.
fn carried(opcode: u8, modrm: u8) -> Carried {
    let reg = (modrm >> 3) & 7;
    let rm = modrm & 7;
    let as_is = Carried::As {
        opcode,
        modrm,
        pop: false,
    };
    let as_d9 = |modrm| Carried::As {
        opcode: D9,
        modrm,
        pop: false,
    };

    // A memory operand: the even opcodes' arithmetic and comparisons on a
    // value loaded (`de2`, `990`); the odd opcodes' by `reg` (`970`), the
    // fifth and seventh by the opcode as well (`9a0`, `9a8`).
    if modrm >> 6 != 3 {
        return match (opcode, reg) {
            (D8 | DA | DC | DE, _) | (_, 0 | 2 | 3) | (DB | DF, 5 | 7) => as_is,
            (D9, 5) => Carried::LoadControl,
            (D9, 7) => Carried::StoreControl,
            (DD, 7) => Carried::StoreStatus,
            _ => Carried::Unemulated,
        };
    }

    match (opcode, reg) {
        // The even opcodes' register forms (`e32`-`e72`): `DA`'s as
        // `D8`'s, and `DA`'s and `DE`'s popped after; `DE`'s comparisons
        // as `D8`'s, popped. The odd opcodes' by `reg` (`980`): `FLD`,
        // `FXCH` and `FSTP` as they are, the rest of the first `FFREE`,
        // of the third `FST`; the constants and the functions whichever
        // of them.
        (D8 | DC, _) | (DE, 0 | 1 | 4..=7) | (D9, 0 | 1) | (DD, 3) => as_is,
        (D9, 4) if matches!(rm, 0 | 1 | 4 | 5) => as_is,
        (DA | DE, _) => Carried::As {
            opcode: D8,
            modrm,
            pop: true,
        },
        (_, 0) => Carried::Free(usize::from(rm)),
        (DB | DD | DF, 2) => Carried::As {
            opcode: DD,
            modrm,
            pop: false,
        },
        (DF, 4) if rm == 0 => Carried::StatusToAx,
        (DB | DF, 4) if rm & 1 == 0 => Carried::ClearStatus,
        (_, 5) if rm != 7 => as_d9(0xe8 | rm),
        (_, 6) if rm < 4 => as_d9(0xf0 | rm),
        (_, 7) if matches!(rm, 0 | 1 | 2 | 4 | 5) => as_d9(0xf8 | rm),
        _ => Carried::Unemulated,
    }
}

/// Whether a register form names `ST(i)` and the emulator looks for it on
/// the stack first (`e81`, from `e32`, `2115`, `2139`, `215b`, `2182`):
/// every form of the even opcodes, and of the odd ones the loads, the
/// exchange, the stores and `FFREE`.
fn names_register(opcode: u8, modrm: u8) -> bool {
    modrm >> 6 == 3 && (opcode & 1 == 0 || (modrm >> 3) & 7 < 4 && modrm != 0xc8)
}

/// The bytes a ModR/M byte's displacement takes, sixteen-bit addressing.
fn displacement(modrm: u8) -> u16 {
    match modrm >> 6 {
        0 if modrm & 7 == 6 => 2,
        1 => 1,
        2 => 2,
        _ => 0,
    }
}

/// The code `INT 3Eh`'s procedure is given for what an instruction raised
/// and its control word left unmasked (`67c`-`6bb`).
fn report_code(unmasked: u16) -> u16 {
    [
        (STACK_UNDERFLOW, 0x8b),
        (STACK_OVERFLOW, 0x8a),
        (SQUARE_ROOT_NEGATIVE, 0x88),
        (0x0100, 0x89),
        (INVALID, 0x81),
        (0x0004, 0x83),
        (0x0008, 0x84),
        (0x0010, 0x85),
        (0x0020, 0x86),
    ]
    .iter()
    .find(|(bit, _)| unmasked & bit != 0)
    .map_or(0x87, |&(_, code)| code)
}

/// Whether `ST(i)` holds a value.
fn holds(fpu: &X87, i: usize) -> bool {
    let top = usize::from((fpu.status & TOP) >> 11);

    !fpu.empty[(top + i) & 7]
}

/// `ST(i)` taken out of the stack, those above it moved down over it.
fn free(fpu: &mut X87, i: usize) {
    let top = usize::from((fpu.status & TOP) >> 11);
    let at = |k: usize| (top + k) & 7;

    for k in (1..=i).rev() {
        fpu.registers[at(k)] = fpu.registers[at(k - 1)];
        fpu.empty[at(k)] = fpu.empty[at(k - 1)];
    }

    fpu.empty[at(0)] = true;
    fpu.status = (fpu.status & !TOP) | ((((top + 1) & 7) as u16) << 11);
}

/// The instruction after an `INT 34h` to `3Ch`, IP at the interrupt,
/// carried out as WIN87EM's emulator carries it out, and IP left past it:
/// the code to report to `INT 3Eh`'s procedure, if any.
///
/// The ESC opcode is `D8h` and on by the interrupt's number, or for
/// `INT 3Ch` the byte after it with its top two bits made ones, those bits
/// naming the segment of its operand: DS, SS, CS or ES (`cca`-`d05`, the
/// table at `cc2`). The emulator never writes the instruction back.
pub(crate) fn emulate(system: &mut System, vector: u8) -> Result<Option<u16>, Exit> {
    let code = system.cpu.segments[CS].base;
    let start = system.cpu.ip;
    let byte = |system: &System, at: u16| system.cpu.bus.read8(code.wrapping_add(u32::from(at)));
    let (opcode, segment, at) = if vector == 0x3c {
        let named = byte(system, start.wrapping_add(2));

        (
            0xc0 | named,
            Some([DS, SS, CS, ES][usize::from(named >> 6)]),
            start.wrapping_add(3),
        )
    } else {
        (D8 + (vector - 0x34), None, start.wrapping_add(2))
    };
    let modrm = byte(system, at);
    let memory = modrm >> 6 != 3;
    let carried = carried(opcode, modrm);

    system.cpu.ip = at.wrapping_add(1);

    let fpu_status = |system: &System| system.cpu.fpu.as_ref().map_or(0, |fpu| fpu.status);
    let mut word = if memory { IN_MEMORY } else { 0 };

    match carried {
        Carried::Unemulated => {
            system.cpu.ip = system.cpu.ip.wrapping_add(displacement(modrm));
            word |= UNEMULATED;
        }
        Carried::ClearStatus => {
            if let Some(fpu) = system.cpu.fpu.as_mut() {
                fpu.status &= TOP;
            }

            return Ok(None);
        }
        Carried::StatusToAx => {
            system.cpu.regs[AX] = fpu_status(system) & !TOP;
        }
        _ if names_register(opcode, modrm)
            && !system
                .cpu
                .fpu
                .as_ref()
                .is_some_and(|fpu| holds(fpu, usize::from(modrm & 7))) =>
        {
            word |= INVALID | STACK_UNDERFLOW;
        }
        Carried::Free(i) => {
            if let Some(fpu) = system.cpu.fpu.as_mut() {
                free(fpu, i);
            }
        }
        Carried::LoadControl => {
            system.cpu.escape(D9, modrm, segment)?;
            system.floating.control = unit_control(system);
        }
        Carried::StoreControl => {
            let unit = unit_control(system);

            set_unit_control(system, system.floating.control);
            let done = system.cpu.escape(D9, modrm, segment);

            set_unit_control(system, unit);
            done?;
        }
        Carried::StoreStatus => {
            let status = fpu_status(system);

            set_unit_status(system, status & !TOP);
            let done = system.cpu.escape(DD, modrm, segment);

            set_unit_status(system, status);
            done?;
        }
        Carried::As { opcode, modrm, pop } => {
            let before = fpu_status(system) & 0xff;

            set_unit_status(system, fpu_status(system) & !0xff);
            system.cpu.escape(opcode, modrm, segment)?;

            let after = fpu_status(system);
            let raised = after & 0x7f;

            if raised & UNIT_STACK_FAULT != 0 {
                word |= INVALID
                    | if after & UNIT_C1 != 0 {
                        STACK_OVERFLOW
                    } else {
                        STACK_UNDERFLOW
                    };
            } else {
                word |= raised & MASKS;

                if opcode == D9 && modrm == 0xfa && raised & UNIT_INVALID != 0 {
                    word |= SQUARE_ROOT_NEGATIVE;
                }
            }

            set_unit_status(system, (after & !0xff) | before);

            if pop && let Some(fpu) = system.cpu.fpu.as_mut() {
                free(fpu, 0);
            }
        }
    }

    // The end of each (`ec0`): the exceptions gathered, the low byte in
    // the status word too; reported where the control word leaves them
    // unmasked.
    system.floating.status |= word;
    set_unit_status(system, fpu_status(system) | (word & 0xff));

    let masks = (system.floating.control | ALWAYS_MASKED) & MASKS;
    let unmasked = (word & 0xff00) | (word & 0xff & !masks);

    Ok((unmasked & !IN_MEMORY != 0).then(|| report_code(unmasked)))
}

fn unit_control(system: &System) -> u16 {
    system.cpu.fpu.as_ref().map_or(0, |fpu| fpu.control)
}

fn set_unit_control(system: &mut System, control: u16) {
    if let Some(fpu) = system.cpu.fpu.as_mut() {
        fpu.control = control;
    }
}

fn set_unit_status(system: &mut System, status: u16) {
    if let Some(fpu) = system.cpu.fpu.as_mut() {
        fpu.status = status;
    }
}

/// With a coprocessor, the instruction an `INT 34h` to `3Ch` stands for
/// written back over it, and IP left at it to run on the unit, as
/// WIN87EM's handlers with one do (seg1 `8d4`, `840`): `FWAIT` and the ESC
/// opcode, or for `INT 3Ch` `FWAIT`, the segment's prefix and the opcode;
/// then the `FWAIT` made a `NOP` but before `FNSTENV`, `FNSTCW`, `FNSAVE`,
/// `FNSTSW`, `FNCLEX`, `FNINIT` and `FNSTSW AX`, which keep their wait
/// (`8ec`-`917`).
pub(crate) fn put_back(system: &mut System, vector: u8) {
    const FWAIT: u8 = 0x9b;
    const NOP: u8 = 0x90;
    /// The prefixes, by the top two bits of the byte after `INT 3Ch`.
    const PREFIXES: [u8; 4] = [0x3e, 0x36, 0x2e, 0x26];

    let code = system.cpu.segments[CS].base;
    let ip = system.cpu.ip;
    let at = |offset: u16| code.wrapping_add(u32::from(ip.wrapping_add(offset)));
    let bus = &mut system.cpu.bus;
    let escape = if vector == 0x3c {
        let named = bus.read8(at(2));

        bus.write8(at(1), PREFIXES[usize::from(named >> 6)]);
        bus.write8(at(2), 0xc0 | named);
        2
    } else {
        bus.write8(at(1), D8 + (vector - 0x34));
        1
    };

    bus.write8(at(0), FWAIT);

    let (opcode, modrm) = (bus.read8(at(escape)), bus.read8(at(escape + 1)));
    let waits = (opcode & 0xfb == D9 && modrm & 0x30 == 0x30 && modrm < 0xf0)
        || (opcode == DB && modrm & 0xfe == 0xe2)
        || (opcode == DF && modrm == 0xe0);

    if !waits {
        bus.write8(at(0), NOP);
    }
}

/// The report: `INT 3Eh`'s procedure called with the code in AL, and the
/// program on past the instruction once it returns (seg1 `6eb`-`72c`).
/// AH is the program's BH, as the code is made in BL and exchanged into
/// AX (`67d`-`6d1`), which [[probe:fpemu]] records.
pub(crate) async fn report(engine: &Engine, code: u16) -> Result<(), Stop> {
    let (procedure, ax) = {
        let system = engine.system();
        let at = (0xffd << 16) + 0x3e * 4;
        let procedure =
            u32::from(system.cpu.bus.read16(at + 2)) << 16 | u32::from(system.cpu.bus.read16(at));

        (procedure, (system.cpu.regs[BX] & 0xff00) | code)
    };

    // WIN87EM calls it whatever it is (`6cf` jumps to the next
    // instruction either way); a WinBox machine's vectors start as
    // nought, where Windows' own are not recorded, and nought is not
    // called.
    if procedure == 0 {
        return Ok(());
    }

    Box::pin(engine.call_with(procedure, &[], &[Register::Word(AX, ax)]))
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use winbox_cpu::{AX, BX, DX, X87};

    use super::fpmath;
    use crate::call::Args;
    use crate::system::System;

    /// A machine whose task has started, its unit made (`task.rs`).
    fn machine(coprocessor: bool) -> System {
        let mut system = System::new();

        system.coprocessor = coprocessor;
        system.cpu.fpu = Some(X87::default());
        system
    }

    /// `__FPMATH` called with BX and AX: AX and DX after.
    fn call(system: &mut System, bx: u16, ax: u16) -> (u16, u16) {
        system.cpu.regs[BX] = bx;
        system.cpu.regs[AX] = ax;
        fpmath(system, &mut Args::repeat(0)).unwrap();
        (system.cpu.regs[AX], system.cpu.regs[DX])
    }

    /// The program's control word 1332h,
    /// the unit's 1330h, the invalid and denormal exceptions left unmasked
    /// (`WIN87EM.DLL` seg1 `b3`).
    #[test]
    fn fpmath_starts_with_the_control_word_1332h_the_unit_1330h() {
        let mut system = machine(false);

        call(&mut system, 0, 0);
        assert_eq!(call(&mut system, 5, 0).0, 0x1332);
        assert_eq!(system.cpu.fpu.as_ref().unwrap().control, 0x1330);
    }

    #[test]
    fn fpmath_says_whether_there_is_a_coprocessor() {
        assert_eq!(call(&mut machine(true), 11, 0).0, 1);
        assert_eq!(call(&mut machine(false), 11, 0).0, 0);
    }

    #[test]
    fn fpmath_answers_ffffh_past_its_last_function() {
        assert_eq!(call(&mut machine(false), 13, 0), (0xffff, 0xffff));
    }
}
