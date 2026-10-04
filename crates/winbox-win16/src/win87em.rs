//! WIN87EM, the coprocessor and emulator library, as winbox.js keeps it:
//! `__FPMATH` and its saving and restoring, over the processor's own unit.
//! **Read out** of `WIN87EM.DLL` (seg1 `2a`-`220`).

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{AX, BX, DX, X87, from_extended, round_even, to_extended};

use crate::call::{Answer, Args, Stop};
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
fn save_unit(system: &mut System, far: u32) -> Result<(), Stop> {
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
fn restore_unit(system: &mut System, far: u32) -> Result<(), Stop> {
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
