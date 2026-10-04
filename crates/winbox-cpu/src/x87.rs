//! The 387 floating-point unit, as the JavaScript core's `X87` has it: the
//! stack of eight registers from `TOP`, the status word's condition codes,
//! the control word's rounding, and every instruction of the 8087, 287 and
//! 387 a sixteen-bit program can issue. Values are doubles, as DOSBox and
//! the JavaScript core hold them, and exceptions are recorded as masked ones,
//! never raised.
//!
//! The host turns it on ([`Cpu::fpu`]); off, an `ESC` and `WAIT` are the
//! host's, as they are to the hybrid beside the JavaScript core, which keeps
//! its own unit.

// The unit works in doubles exactly as JavaScript's numbers do: a half is a
// half, and a 64-bit integer or significand rounds to one as it is loaded.
#![allow(clippy::float_cmp, clippy::cast_precision_loss)]

use crate::{AX, Bus, Cpu, Exit, Place};

const TAG_VALID: u16 = 0;
const TAG_ZERO: u16 = 1;
const TAG_SPECIAL: u16 = 2;
const TAG_EMPTY: u16 = 3;

const ROUND_DOWN: u16 = 1;
const ROUND_UP: u16 = 2;
const ROUND_CHOP: u16 = 3;

const IE: u16 = 0x0001;
const ZE: u16 = 0x0004;
const SF: u16 = 0x0040;
const C0: u16 = 0x0100;
const C1: u16 = 0x0200;
const C2: u16 = 0x0400;
const C3: u16 = 0x4000;
const B: u16 = 0x8000;

/// The constants `FLD1` to `FLDZ` load, as JavaScript computes them.
const CONSTANTS: [u64; 7] = [
    0x3ff0_0000_0000_0000,
    0x400a_934f_0979_a371,
    0x3ff7_1547_652b_82fe,
    0x4009_21fb_5444_2d18,
    0x3fd3_4413_509f_79ff,
    0x3fe6_2e42_fefa_39ef,
    0,
];

/// The unit's state.
#[derive(Debug, Clone)]
pub struct X87 {
    pub registers: [f64; 8],
    /// Whether each physical register is empty.
    pub empty: [bool; 8],
    pub status: u16,
    pub control: u16,
}

impl Default for X87 {
    fn default() -> Self {
        Self {
            registers: [0.0; 8],
            empty: [true; 8],
            status: 0,
            control: 0x037f,
        }
    }
}

/// `Math.round`: a half rounded up, toward positive infinity.
fn js_round(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }

    let floor = value.floor();
    let rounded = if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    };

    if rounded == 0.0 && value.is_sign_negative() {
        -0.0
    } else {
        rounded
    }
}

/// Rounded to the nearest integer, a half to the even one.
pub fn round_even(value: f64) -> f64 {
    if (value % 1.0).abs() == 0.5 {
        2.0 * js_round(value / 2.0)
    } else {
        js_round(value)
    }
}

fn is_denormal(value: f64) -> bool {
    value != 0.0 && value.abs() < f64::MIN_POSITIVE
}

/// A double as the extended format: a significand with its integer bit,
/// and a sign and an exponent biased by 16383.
pub fn to_extended(value: f64) -> (u64, u16) {
    let sign = if value.is_sign_negative() { 0x8000 } else { 0 };

    if value.is_nan() {
        return (0xc000_0000_0000_0000, 0xffff);
    }

    if value.is_infinite() {
        return (0x8000_0000_0000_0000, sign | 0x7fff);
    }

    if value == 0.0 {
        return (0, sign);
    }

    let bits = value.abs().to_bits();
    let mut exponent = (bits >> 52) as i32;
    let mut significand = bits & 0x000f_ffff_ffff_ffff;

    if exponent == 0 {
        exponent = 1;

        while significand & 0x0010_0000_0000_0000 == 0 {
            significand <<= 1;
            exponent -= 1;
        }
    } else {
        significand |= 0x0010_0000_0000_0000;
    }

    (significand << 11, sign | (exponent - 1023 + 16383) as u16)
}

/// The extended format as a double, rounded to nearest where it has more
/// precision.
pub fn from_extended(mantissa: u64, sign_exponent: u16) -> f64 {
    let sign = if sign_exponent & 0x8000 != 0 {
        -1.0
    } else {
        1.0
    };
    let exponent = i32::from(sign_exponent & 0x7fff);

    if exponent == 0x7fff {
        return if mantissa.trailing_zeros() >= 63 {
            sign * f64::INFINITY
        } else {
            f64::NAN
        };
    }

    if mantissa == 0 {
        return sign * 0.0;
    }

    // Scaled in two steps, so that neither overflows on its own.
    let power = exponent - 16383 - 63;
    let half = power / 2;

    sign * (mantissa as f64) * 2f64.powi(half) * 2f64.powi(power - half)
}

impl X87 {
    /// `FINIT`: the control word `037Fh`, every exception masked, the stack
    /// empty.
    pub fn reset(&mut self) {
        self.control = 0x037f;
        self.status = 0;
        self.empty = [true; 8];
    }

    fn top(&self) -> usize {
        usize::from((self.status >> 11) & 7)
    }

    fn set_top(&mut self, value: usize) {
        self.status = (self.status & !0x3800) | ((value as u16 & 7) << 11);
    }

    fn physical(&self, i: usize) -> usize {
        (self.top() + i) & 7
    }

    fn flag(&mut self, bit: u16, on: bool) {
        if on {
            self.status |= bit;
        } else {
            self.status &= !bit;
        }
    }

    fn codes(&mut self, c3: bool, c2: bool, c0: bool) {
        self.flag(C3, c3);
        self.flag(C2, c2);
        self.flag(C0, c0);
    }

    /// A masked invalid operation: `IE`, and for a stack fault `SF`, with
    /// `C1` saying which way.
    fn invalid(&mut self, stack: bool, overflow: bool) {
        self.status |= IE;

        if stack {
            self.status |= SF;
            self.flag(C1, overflow);
        }
    }

    pub fn st(&mut self, i: usize) -> f64 {
        let at = self.physical(i);

        if self.empty[at] {
            self.invalid(true, false);
            return f64::NAN;
        }

        self.registers[at]
    }

    fn set_st(&mut self, i: usize, value: f64) {
        let at = self.physical(i);

        self.registers[at] = value;
        self.empty[at] = false;
    }

    fn push(&mut self, mut value: f64) {
        let top = (self.top() + 7) & 7;

        if !self.empty[top] {
            self.invalid(true, true);
            value = f64::NAN;
        }

        self.set_top(top);
        self.registers[top] = value;
        self.empty[top] = false;
    }

    fn pop(&mut self) {
        let top = self.top();

        self.empty[top] = true;
        self.set_top(top + 1);
    }

    fn rounding(&self) -> u16 {
        (self.control >> 10) & 3
    }

    /// A value rounded to an integer as the control word says.
    fn round_integer(&self, value: f64) -> f64 {
        match self.rounding() {
            ROUND_DOWN => value.floor(),
            ROUND_UP => value.ceil(),
            ROUND_CHOP => value.trunc(),
            _ => round_even(value),
        }
    }

    /// A comparison: `C3 C2 C0` 000 above, 001 below, 100 equal, 111
    /// unordered; a NaN invalid to `FCOM`, not to `FUCOM`.
    fn compare(&mut self, a: f64, b: f64, unordered: bool) {
        if a.is_nan() || b.is_nan() {
            if !unordered {
                self.status |= IE;
            }

            self.codes(true, true, true);
        } else if a > b {
            self.codes(false, false, false);
        } else if a < b {
            self.codes(false, false, true);
        } else {
            self.codes(true, false, false);
        }

        self.flag(C1, false);
    }

    fn divide(&mut self, destination: usize, dividend: f64, divisor: f64) {
        if divisor == 0.0 && dividend.is_finite() && dividend != 0.0 {
            self.status |= ZE;
        }

        self.set_st(destination, dividend / divisor);
    }

    /// `destination op= source` for add, multiply, subtract, reversed
    /// subtract, divide and reversed divide, and `FCOM`/`FCOMP`; with ST(i)
    /// the destination, the encoding's subtraction and division swapped.
    fn arithmetic(&mut self, reg: usize, destination: usize, source: f64, reversed: bool) {
        let target = self.st(destination);

        match reg {
            0 => self.set_st(destination, target + source),
            1 => self.set_st(destination, target * source),
            2 => {
                let top = self.st(0);

                self.compare(top, source, false);
            }
            3 => {
                let top = self.st(0);

                self.compare(top, source, false);
                self.pop();
            }
            4 => self.set_st(
                destination,
                if reversed {
                    source - target
                } else {
                    target - source
                },
            ),
            5 => self.set_st(
                destination,
                if reversed {
                    target - source
                } else {
                    source - target
                },
            ),
            6 => {
                let (a, b) = if reversed {
                    (source, target)
                } else {
                    (target, source)
                };

                self.divide(destination, a, b);
            }
            _ => {
                let (a, b) = if reversed {
                    (target, source)
                } else {
                    (source, target)
                };

                self.divide(destination, a, b);
            }
        }
    }

    /// Sine, cosine and tangent: an operand of 2^63 or more is left, with
    /// `C2` set.
    fn trigonometric(&mut self, operation: impl FnOnce(&mut Self)) {
        if self.st(0).abs() >= 2f64.powi(63) {
            self.flag(C2, true);
            return;
        }

        self.flag(C2, false);
        operation(self);
    }

    /// `FXAM`: ST(0)'s kind in `C3 C2 C0`, its sign in `C1`.
    fn examine(&mut self) {
        let at = self.physical(0);
        let value = self.registers[at];

        self.flag(
            C1,
            value.is_sign_negative() && !value.is_nan() || value < 0.0,
        );

        if self.empty[at] {
            self.codes(true, false, true);
        } else if value.is_nan() {
            self.codes(false, false, true);
        } else if value.is_infinite() {
            self.codes(false, true, true);
        } else if value == 0.0 {
            self.codes(true, false, false);
        } else {
            self.codes(false, true, false);
        }
    }

    /// `FXTRACT`: ST(0) split into its exponent, left, and its significand,
    /// pushed.
    fn extract(&mut self) {
        let value = self.st(0);

        if value == 0.0 {
            self.status |= ZE;
            self.set_st(0, f64::NEG_INFINITY);
            self.push(value);
            return;
        }

        let exponent = value.abs().log2().floor();
        let mut significand = value / 2f64.powf(exponent);

        if significand.abs() >= 2.0 {
            significand /= 2.0;
            self.set_st(0, exponent + 1.0);
        } else if significand.abs() < 1.0 {
            significand *= 2.0;
            self.set_st(0, exponent - 1.0);
        } else {
            self.set_st(0, exponent);
        }

        self.push(significand);
    }

    /// `FPREM` and `FPREM1`: ST(0) less a multiple of ST(1), the quotient's
    /// low three bits in `C0`, `C3` and `C1`, `C2` clear.
    fn remainder(&mut self, ieee: bool) {
        let dividend = self.st(0);
        let divisor = self.st(1);

        if divisor == 0.0 || !dividend.is_finite() {
            self.status |= IE;
            self.set_st(0, f64::NAN);
            return;
        }

        let quotient = if ieee {
            round_even(dividend / divisor)
        } else {
            (dividend / divisor).trunc()
        };
        let remainder = if ieee {
            dividend - quotient * divisor
        } else {
            dividend % divisor
        };
        let q = quotient.abs() as i64;

        self.set_st(0, remainder);
        self.flag(C0, q & 4 != 0);
        self.flag(C3, q & 2 != 0);
        self.flag(C1, q & 1 != 0);
        self.flag(C2, false);
    }

    /// The tag word: two bits a physical register.
    pub fn tag_word(&self) -> u16 {
        (0..8).fold(0, |word, at| {
            let value = self.registers[at];
            let tag = if self.empty[at] {
                TAG_EMPTY
            } else if value == 0.0 {
                TAG_ZERO
            } else if !value.is_finite() || is_denormal(value) {
                TAG_SPECIAL
            } else {
                TAG_VALID
            };

            word | tag << (2 * at)
        })
    }
}

impl<B: Bus> Cpu<B> {
    /// Bytes of an `ESC`'s memory operand, the offset kept within 64K.
    fn x87_read(&self, place: Place, offset: u32, size: u32) -> Result<Vec<u8>, Exit> {
        let Place::Memory(segment, at) = place else {
            return Err(Exit::Unimplemented(0xd8));
        };

        (0..size)
            .map(|step| self.read8(segment, (at + offset + step) & 0xffff))
            .collect()
    }

    fn x87_write(&mut self, place: Place, offset: u32, bytes: &[u8]) -> Result<(), Exit> {
        let Place::Memory(segment, at) = place else {
            return Err(Exit::Unimplemented(0xd8));
        };

        for (step, &byte) in bytes.iter().enumerate() {
            self.write8(segment, (at + offset + step as u32) & 0xffff, byte)?;
        }

        Ok(())
    }

    fn x87_f32(&self, place: Place) -> Result<f64, Exit> {
        let bytes = self.x87_read(place, 0, 4)?;

        Ok(f64::from(f32::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3],
        ])))
    }

    fn x87_f64(&self, place: Place) -> Result<f64, Exit> {
        let bytes = self.x87_read(place, 0, 8)?;

        Ok(f64::from_le_bytes(bytes.try_into().expect("eight bytes")))
    }

    fn x87_f80(&self, place: Place, offset: u32) -> Result<f64, Exit> {
        let bytes = self.x87_read(place, offset, 10)?;
        let mantissa = u64::from_le_bytes(bytes[..8].try_into().expect("eight bytes"));

        Ok(from_extended(
            mantissa,
            u16::from_le_bytes([bytes[8], bytes[9]]),
        ))
    }

    fn x87_write_f80(&mut self, place: Place, offset: u32, value: f64) -> Result<(), Exit> {
        let (mantissa, sign_exponent) = to_extended(value);
        let mut bytes = mantissa.to_le_bytes().to_vec();

        bytes.extend_from_slice(&sign_exponent.to_le_bytes());
        self.x87_write(place, offset, &bytes)
    }

    /// `FIST`: ST(0) as an integer of `bits`, or the integer indefinite --
    /// the most negative -- where it does not fit.
    fn x87_store_integer(&mut self, fpu: &mut X87, place: Place, bits: u32) -> Result<(), Exit> {
        let top = fpu.st(0);
        let value = fpu.round_integer(top);
        let limit = 2f64.powi(bits as i32 - 1);
        let fits = value.is_finite() && value >= -limit && value < limit;

        if !fits {
            fpu.status |= IE;
        }

        let bytes = match bits {
            16 => (if fits { value as i16 } else { i16::MIN })
                .to_le_bytes()
                .to_vec(),
            32 => (if fits { value as i32 } else { i32::MIN })
                .to_le_bytes()
                .to_vec(),
            _ => (if fits { value as i64 } else { i64::MIN })
                .to_le_bytes()
                .to_vec(),
        };

        self.x87_write(place, 0, &bytes)
    }

    /// The environment, sixteen-bit: the control, status and tag words, and
    /// where the last instruction was, not kept, noughts. Fourteen bytes.
    fn x87_store_environment(&mut self, fpu: &X87, place: Place) -> Result<(), Exit> {
        let mut bytes = [0u8; 14];

        bytes[0..2].copy_from_slice(&fpu.control.to_le_bytes());
        bytes[2..4].copy_from_slice(&fpu.status.to_le_bytes());
        bytes[4..6].copy_from_slice(&fpu.tag_word().to_le_bytes());
        self.x87_write(place, 0, &bytes)
    }

    fn x87_load_environment(&self, fpu: &mut X87, place: Place) -> Result<(), Exit> {
        let bytes = self.x87_read(place, 0, 6)?;
        let tags = u16::from_le_bytes([bytes[4], bytes[5]]);

        fpu.control = u16::from_le_bytes([bytes[0], bytes[1]]);
        fpu.status = u16::from_le_bytes([bytes[2], bytes[3]]);

        for at in 0..8 {
            fpu.empty[at] = (tags >> (2 * at)) & 3 == TAG_EMPTY;
        }

        Ok(())
    }

    /// An `ESC` instruction, `D8h` to `DFh`, run on the unit.
    pub(crate) fn x87(&mut self, opcode: u8) -> Result<(), Exit> {
        let Some(mut fpu) = self.fpu.take() else {
            return Err(Exit::Unimplemented(opcode));
        };
        let result = self.x87_execute(&mut fpu, opcode);

        self.fpu = Some(fpu);
        result
    }

    #[allow(clippy::too_many_lines)]
    fn x87_execute(&mut self, fpu: &mut X87, opcode: u8) -> Result<(), Exit> {
        let (reg, place) = self.modrm()?;
        let rm = match place {
            Place::Register(index) => Some(index),
            Place::Memory(..) => None,
        };
        let undefined = Err(Exit::Unimplemented(opcode));

        match (opcode, rm) {
            (0xd8, None) => {
                let source = self.x87_f32(place)?;

                fpu.arithmetic(reg, 0, source, false);
            }
            (0xd8, Some(rm)) => {
                let source = fpu.st(rm);

                fpu.arithmetic(reg, 0, source, false);
            }
            (0xdc, None) => {
                let source = self.x87_f64(place)?;

                fpu.arithmetic(reg, 0, source, false);
            }
            (0xdc, Some(rm)) if reg == 2 || reg == 3 => {
                let source = fpu.st(rm);

                fpu.arithmetic(reg, 0, source, false);
            }
            (0xdc, Some(rm)) => {
                let source = fpu.st(0);

                fpu.arithmetic(reg, rm, source, true);
            }
            (0xda, None) => {
                let bytes = self.x87_read(place, 0, 4)?;

                fpu.arithmetic(
                    reg,
                    0,
                    f64::from(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
                    false,
                );
            }
            (0xda, Some(1)) if reg == 5 => {
                let (a, b) = (fpu.st(0), fpu.st(1));

                fpu.compare(a, b, true);
                fpu.pop();
                fpu.pop();
            }
            (0xde, None) => {
                let bytes = self.x87_read(place, 0, 2)?;

                fpu.arithmetic(
                    reg,
                    0,
                    f64::from(i16::from_le_bytes([bytes[0], bytes[1]])),
                    false,
                );
            }
            (0xde, Some(rm)) if reg == 3 => {
                if rm != 1 {
                    return undefined;
                }

                let (a, b) = (fpu.st(0), fpu.st(1));

                fpu.compare(a, b, false);
                fpu.pop();
                fpu.pop();
            }
            (0xde, Some(rm)) => {
                let source = fpu.st(0);

                fpu.arithmetic(reg, rm, source, true);
                fpu.pop();
            }
            (0xd9, None) => match reg {
                0 => {
                    let value = self.x87_f32(place)?;

                    fpu.push(value);
                }
                2 | 3 => {
                    let value = fpu.st(0) as f32;

                    self.x87_write(place, 0, &value.to_le_bytes())?;

                    if reg == 3 {
                        fpu.pop();
                    }
                }
                4 => self.x87_load_environment(fpu, place)?,
                5 => {
                    let bytes = self.x87_read(place, 0, 2)?;

                    fpu.control = u16::from_le_bytes([bytes[0], bytes[1]]);
                }
                6 => self.x87_store_environment(fpu, place)?,
                7 => self.x87_write(place, 0, &fpu.control.to_le_bytes())?,
                _ => return undefined,
            },
            (0xd9, Some(rm)) => match (reg, rm) {
                (0, _) => {
                    let value = fpu.st(rm);

                    fpu.push(value);
                }
                (1, _) => {
                    let (a, b) = (fpu.physical(0), fpu.physical(rm));

                    fpu.registers.swap(a, b);
                    fpu.empty.swap(a, b);
                    fpu.flag(C1, false);
                }
                (2, 0) => {}
                (3, _) => {
                    let value = fpu.st(0);

                    fpu.set_st(rm, value);
                    fpu.pop();
                }
                (4, 0) => {
                    let value = fpu.st(0);

                    fpu.set_st(0, -value);
                }
                (4, 1) => {
                    let value = fpu.st(0);

                    fpu.set_st(0, value.abs());
                }
                (4, 4) => {
                    let value = fpu.st(0);

                    fpu.compare(value, 0.0, false);
                }
                (4, 5) => fpu.examine(),
                (5, 0..=6) => fpu.push(f64::from_bits(CONSTANTS[rm])),
                (6, 0) => {
                    let value = fpu.st(0);

                    fpu.set_st(0, 2f64.powf(value) - 1.0);
                }
                (6, 1) => {
                    let (x, y) = (fpu.st(0), fpu.st(1));

                    fpu.set_st(1, y * x.log2());
                    fpu.pop();
                }
                (6, 2) => fpu.trigonometric(|fpu| {
                    let value = fpu.st(0);

                    fpu.set_st(0, value.tan());
                    fpu.push(1.0);
                }),
                (6, 3) => {
                    let (x, y) = (fpu.st(0), fpu.st(1));

                    fpu.set_st(1, y.atan2(x));
                    fpu.pop();
                }
                (6, 4) => fpu.extract(),
                (6, 5) => fpu.remainder(true),
                (6, 6) => {
                    let top = fpu.top();

                    fpu.set_top(top + 7);
                }
                (6, 7) => {
                    let top = fpu.top();

                    fpu.set_top(top + 1);
                }
                (7, 0) => fpu.remainder(false),
                (7, 1) => {
                    let (x, y) = (fpu.st(0), fpu.st(1));

                    fpu.set_st(1, y * (x + 1.0).log2());
                    fpu.pop();
                }
                (7, 2) => {
                    let value = fpu.st(0);

                    if value < 0.0 {
                        fpu.status |= IE;
                    }

                    fpu.set_st(0, value.sqrt());
                }
                (7, 3) => fpu.trigonometric(|fpu| {
                    let value = fpu.st(0);

                    fpu.set_st(0, value.sin());
                    fpu.push(value.cos());
                }),
                (7, 4) => {
                    let value = fpu.st(0);
                    let rounded = fpu.round_integer(value);

                    fpu.set_st(0, rounded);
                }
                (7, 5) => {
                    let (value, scale) = (fpu.st(0), fpu.st(1));

                    fpu.set_st(0, value * 2f64.powf(scale.trunc()));
                }
                (7, 6) => fpu.trigonometric(|fpu| {
                    let value = fpu.st(0);

                    fpu.set_st(0, value.sin());
                }),
                (7, 7) => fpu.trigonometric(|fpu| {
                    let value = fpu.st(0);

                    fpu.set_st(0, value.cos());
                }),
                _ => return undefined,
            },
            (0xdb, None) => match reg {
                0 => {
                    let bytes = self.x87_read(place, 0, 4)?;

                    fpu.push(f64::from(i32::from_le_bytes([
                        bytes[0], bytes[1], bytes[2], bytes[3],
                    ])));
                }
                2 => self.x87_store_integer(fpu, place, 32)?,
                3 => {
                    self.x87_store_integer(fpu, place, 32)?;
                    fpu.pop();
                }
                5 => {
                    let value = self.x87_f80(place, 0)?;

                    fpu.push(value);
                }
                7 => {
                    let value = fpu.st(0);

                    self.x87_write_f80(place, 0, value)?;
                    fpu.pop();
                }
                _ => return undefined,
            },
            // FENI and FDISI, the 8087's, and FSETPM, the 287's: nothing on
            // a 387. FNCLEX; FNINIT.
            (0xdb, Some(0 | 1 | 4)) if reg == 4 => {}
            (0xdb, Some(2)) if reg == 4 => fpu.status &= !(0x00ff | B),
            (0xdb, Some(3)) if reg == 4 => fpu.reset(),
            (0xdd, None) => match reg {
                0 => {
                    let value = self.x87_f64(place)?;

                    fpu.push(value);
                }
                2 | 3 => {
                    let value = fpu.st(0);

                    self.x87_write(place, 0, &value.to_le_bytes())?;

                    if reg == 3 {
                        fpu.pop();
                    }
                }
                4 => {
                    // FRSTOR.
                    self.x87_load_environment(fpu, place)?;

                    for i in 0..8 {
                        let value = self.x87_f80(place, 14 + 10 * i as u32)?;
                        let at = fpu.physical(i);

                        fpu.registers[at] = value;
                    }
                }
                6 => {
                    // FNSAVE, then FNINIT.
                    self.x87_store_environment(fpu, place)?;

                    for i in 0..8 {
                        let value = fpu.registers[fpu.physical(i)];

                        self.x87_write_f80(place, 14 + 10 * i as u32, value)?;
                    }

                    fpu.reset();
                }
                7 => self.x87_write(place, 0, &fpu.status.to_le_bytes())?,
                _ => return undefined,
            },
            (0xdd, Some(rm)) => match reg {
                0 => {
                    let at = fpu.physical(rm);

                    fpu.empty[at] = true;
                }
                1 => {
                    let (a, b) = (fpu.physical(0), fpu.physical(rm));

                    fpu.registers.swap(a, b);
                    fpu.empty.swap(a, b);
                }
                2 | 3 => {
                    let value = fpu.st(0);

                    fpu.set_st(rm, value);

                    if reg == 3 {
                        fpu.pop();
                    }
                }
                4 | 5 => {
                    let (a, b) = (fpu.st(0), fpu.st(rm));

                    fpu.compare(a, b, true);

                    if reg == 5 {
                        fpu.pop();
                    }
                }
                _ => return undefined,
            },
            (0xdf, None) => match reg {
                0 => {
                    let bytes = self.x87_read(place, 0, 2)?;

                    fpu.push(f64::from(i16::from_le_bytes([bytes[0], bytes[1]])));
                }
                2 => self.x87_store_integer(fpu, place, 16)?,
                3 => {
                    self.x87_store_integer(fpu, place, 16)?;
                    fpu.pop();
                }
                4 => {
                    // FBLD: eighteen packed digits, the low byte first, and a
                    // sign byte.
                    let bytes = self.x87_read(place, 0, 10)?;
                    let value = bytes[..9].iter().rev().fold(0.0, |value, &byte| {
                        value * 100.0 + f64::from(byte >> 4) * 10.0 + f64::from(byte & 0xf)
                    });

                    fpu.push(if bytes[9] & 0x80 != 0 { -value } else { value });
                }
                5 => {
                    let bytes = self.x87_read(place, 0, 8)?;

                    fpu.push(i64::from_le_bytes(bytes.try_into().expect("eight bytes")) as f64);
                }
                6 => {
                    // FBSTP.
                    let top = fpu.st(0);
                    let value = fpu.round_integer(top);
                    let mut bytes = [0u8; 10];

                    if !value.is_finite() || value.abs() >= 1e18 {
                        fpu.status |= IE;
                        bytes = [0, 0, 0, 0, 0, 0, 0, 0xc0, 0xff, 0xff];
                    } else {
                        let mut digits = value.abs() as u64;

                        for byte in bytes.iter_mut().take(9) {
                            let low = (digits % 10) as u8;

                            digits /= 10;

                            let high = (digits % 10) as u8;

                            digits /= 10;
                            *byte = high << 4 | low;
                        }

                        bytes[9] = if value.is_sign_negative() { 0x80 } else { 0 };
                    }

                    self.x87_write(place, 0, &bytes)?;
                    fpu.pop();
                }
                _ => {
                    self.x87_store_integer(fpu, place, 64)?;
                    fpu.pop();
                }
            },
            (0xdf, Some(rm)) if reg == 0 => {
                let at = fpu.physical(rm);

                fpu.empty[at] = true;
                fpu.pop();
            }
            (0xdf, Some(0)) if reg == 4 => self.regs[AX] = fpu.status,
            _ => return undefined,
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CS, DS, ES, SP, SS, VecBus};

    const DATA: u16 = 0x100;

    /// Instructions run on the unit, real mode, with data at DS:100h.
    fn run(instructions: &[&[u8]], data: &[(u16, Vec<u8>)]) -> Cpu<VecBus> {
        let mut cpu = Cpu::new(VecBus(vec![0; 0x40000]));

        for (segment, selector) in [(CS, 0x1000), (DS, 0x2000), (ES, 0x2000), (SS, 0x3000)] {
            cpu.load_segment(segment, selector).unwrap();
        }

        cpu.regs[SP] = 0xfffe;
        cpu.fpu = Some(X87::default());

        let code: Vec<u8> = instructions
            .iter()
            .flat_map(|bytes| bytes.iter().copied())
            .chain([0xf4])
            .collect();

        cpu.bus.0[0x10000..0x10000 + code.len()].copy_from_slice(&code);

        for (offset, bytes) in data {
            let at = 0x20000 + usize::from(DATA + offset);

            cpu.bus.0[at..at + bytes.len()].copy_from_slice(bytes);
        }

        let (_, exit) = cpu.run(1000);

        assert_eq!(exit, Exit::Halt);
        cpu
    }

    fn bytes(cpu: &Cpu<VecBus>, offset: u16, length: usize) -> Vec<u8> {
        let at = 0x20000 + usize::from(DATA + offset);

        cpu.bus.0[at..at + length].to_vec()
    }

    fn f64_at(cpu: &Cpu<VecBus>, offset: u16) -> f64 {
        f64::from_le_bytes(bytes(cpu, offset, 8).try_into().unwrap())
    }

    fn i16_at(cpu: &Cpu<VecBus>, offset: u16) -> i16 {
        i16::from_le_bytes(bytes(cpu, offset, 2).try_into().unwrap())
    }

    /// A memory operand at DS:100h and `offset`, `[disp16]`.
    fn mem(opcode: u8, reg: u8, offset: u16) -> Vec<u8> {
        let [low, high] = (DATA + offset).to_le_bytes();

        vec![opcode, (reg << 3) | 6, low, high]
    }

    const FLD1: &[u8] = &[0xd9, 0xe8];
    const FLDZ: &[u8] = &[0xd9, 0xee];
    const FLDPI: &[u8] = &[0xd9, 0xeb];
    const FNSTSW_AX: &[u8] = &[0xdf, 0xe0];

    #[test]
    fn adds_on_the_stack() {
        let cpu = run(&[FLD1, FLDPI, &[0xde, 0xc1], &mem(0xdd, 3, 0)], &[]);

        assert_eq!(f64_at(&cpu, 0), 1.0 + std::f64::consts::PI);
    }

    #[test]
    fn subtracts_and_divides_with_their_senses() {
        // 10, 4: FSUBP gives 6; 2, then FDIVP gives 3.
        let cpu = run(
            &[
                &mem(0xdf, 0, 0),
                &mem(0xdf, 0, 2),
                &[0xde, 0xe9],
                &mem(0xdf, 0, 4),
                &[0xde, 0xf9],
                &mem(0xdd, 3, 8),
            ],
            &[(0, vec![10, 0]), (2, vec![4, 0]), (4, vec![2, 0])],
        );

        assert_eq!(f64_at(&cpu, 8), 3.0);

        // FSUBRP: 4 - 10.
        let cpu = run(
            &[
                &mem(0xdf, 0, 0),
                &mem(0xdf, 0, 2),
                &[0xde, 0xe1],
                &mem(0xdd, 3, 8),
            ],
            &[(0, vec![10, 0]), (2, vec![4, 0])],
        );

        assert_eq!(f64_at(&cpu, 8), -6.0);
    }

    #[test]
    fn compares_into_the_condition_codes() {
        let below = run(&[FLD1, FLDZ, &[0xd8, 0xd1], FNSTSW_AX], &[]);
        let equal = run(&[FLD1, FLD1, &[0xd8, 0xd1], FNSTSW_AX], &[]);
        let above = run(&[FLDZ, FLD1, &[0xd8, 0xd1], FNSTSW_AX], &[]);

        assert_eq!(below.regs[AX] & 0x4500, 0x0100);
        assert_eq!(equal.regs[AX] & 0x4500, 0x4000);
        assert_eq!(above.regs[AX] & 0x4500, 0x0000);
        assert_eq!((run(&[FLD1, FLD1, FNSTSW_AX], &[]).regs[AX] >> 11) & 7, 6);
    }

    #[test]
    fn starts_with_the_control_word_037f() {
        assert_eq!(
            bytes(&run(&[&mem(0xd9, 7, 0)], &[]), 0, 2),
            vec![0x7f, 0x03]
        );
    }

    #[test]
    fn rounds_an_integer_store_as_the_control_word_says() {
        let store = |control: u16, value: f64| {
            let cpu = run(
                &[&mem(0xd9, 5, 0), &mem(0xdd, 0, 8), &mem(0xdf, 3, 16)],
                &[
                    (0, control.to_le_bytes().to_vec()),
                    (8, value.to_le_bytes().to_vec()),
                ],
            );

            i16_at(&cpu, 16)
        };

        assert_eq!(store(0x037f, 2.5), 2);
        assert_eq!(store(0x037f, 3.5), 4);
        assert_eq!(store(0x0f7f, 2.7), 2);
        assert_eq!(store(0x0f7f, -2.7), -2);
        assert_eq!(store(0x077f, -2.2), -3);
        assert_eq!(store(0x037f, 70000.0), i16::MIN);
    }

    #[test]
    fn exchanges_negates_and_takes_the_absolute_value() {
        let cpu = run(
            &[
                &mem(0xdf, 0, 0),
                &[0xd9, 0xe1],
                &[0xd9, 0xe0],
                &mem(0xdf, 3, 2),
            ],
            &[(0, (-5i16).to_le_bytes().to_vec())],
        );

        assert_eq!(i16_at(&cpu, 2), -5);
        assert_eq!(
            f64_at(&run(&[FLD1, FLDZ, &[0xd9, 0xc9], &mem(0xdd, 3, 0)], &[]), 0),
            1.0
        );
    }

    #[test]
    fn loads_and_stores_the_eighty_bit_format_and_packed_decimal() {
        let one_and_a_half = vec![0, 0, 0, 0, 0, 0, 0, 0xc0, 0xff, 0x3f];
        let cpu = run(
            &[
                &mem(0xdb, 5, 0),
                &[0xd9, 0xc0],
                &mem(0xdb, 7, 16),
                &mem(0xdd, 3, 32),
            ],
            &[(0, one_and_a_half.clone())],
        );

        assert_eq!(f64_at(&cpu, 32), 1.5);
        assert_eq!(bytes(&cpu, 16, 10), one_and_a_half);

        let cpu = run(
            &[
                &mem(0xdf, 0, 0),
                &mem(0xdf, 6, 16),
                &mem(0xdf, 4, 16),
                &mem(0xdd, 3, 32),
            ],
            &[(0, (-1234i16).to_le_bytes().to_vec())],
        );

        assert_eq!(
            bytes(&cpu, 16, 10),
            vec![0x34, 0x12, 0, 0, 0, 0, 0, 0, 0, 0x80]
        );
        assert_eq!(f64_at(&cpu, 32), -1234.0);
    }

    #[test]
    fn takes_a_partial_remainder_and_examines() {
        // 17 by 5: 2, the quotient 3.
        let cpu = run(
            &[
                &mem(0xdf, 0, 0),
                &mem(0xdf, 0, 2),
                &[0xd9, 0xf8],
                FNSTSW_AX,
                &mem(0xdd, 3, 8),
            ],
            &[(0, vec![5, 0]), (2, vec![17, 0])],
        );

        assert_eq!(f64_at(&cpu, 8), 2.0);
        assert_eq!(cpu.regs[AX] & 0x4700, 0x4200);
        assert_eq!(
            run(&[FLDZ, &[0xd9, 0xe5], FNSTSW_AX], &[]).regs[AX] & 0x4500,
            0x4000
        );
        assert_eq!(
            run(&[FLD1, &[0xd9, 0xe5], FNSTSW_AX], &[]).regs[AX] & 0x4500,
            0x0400
        );
        assert_eq!(
            run(&[&[0xd9, 0xe5], FNSTSW_AX], &[]).regs[AX] & 0x4500,
            0x4100
        );
    }

    #[test]
    fn saves_and_restores_the_whole_unit() {
        let cpu = run(
            &[
                FLDPI,
                FLD1,
                &mem(0xdd, 6, 0),
                FNSTSW_AX,
                &mem(0xdd, 4, 0),
                &[0xde, 0xc1],
                &mem(0xdd, 3, 120),
            ],
            &[],
        );

        assert_eq!(cpu.regs[AX] & 0x3800, 0);
        assert_eq!(f64_at(&cpu, 120), std::f64::consts::PI + 1.0);
    }

    #[test]
    fn round_trips_the_eighty_bit_format_and_rounds_a_half_to_even() {
        for value in [
            1.0,
            -2.5,
            std::f64::consts::PI,
            1e300,
            5e-324,
            0.0,
            -0.0,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ] {
            let (mantissa, sign_exponent) = to_extended(value);

            assert_eq!(
                from_extended(mantissa, sign_exponent).to_bits(),
                value.to_bits()
            );
        }

        let (mantissa, sign_exponent) = to_extended(f64::NAN);

        assert!(from_extended(mantissa, sign_exponent).is_nan());

        let rounded: Vec<u64> = [0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6]
            .map(round_even)
            .iter()
            .map(|v| v.to_bits())
            .collect();
        let wanted: Vec<u64> = [0.0, 2.0, 2.0, -0.0, -2.0, 2.0, 3.0]
            .iter()
            .map(|v: &f64| v.to_bits())
            .collect();

        assert_eq!(rounded, wanted);
    }
}
