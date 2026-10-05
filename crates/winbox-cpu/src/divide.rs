//! `DIV` and `IDIV` of a byte and of a word, as the JavaScript core's ALU
//! runs them (`div8`, `div16`, `idiv8` and `idiv16`): the documented-
//! undefined flags as the microcode leaves them, and a divide error, which
//! is not a clean abort -- the routine runs far enough to disturb the flags
//! first, and it is with those that the fault is taken.

use crate::{AF, AX, Alu, Bus, Cpu, DX, Exit, OF, PF, SF, ZF};

/// A non-negative value modulo 2^32, for the 16-bit routines' 32-bit
/// running value.
fn wrap(value: i64) -> i64 {
    value.rem_euclid(1 << 32)
}

impl<B: Bus> Cpu<B> {
    /// `DIV` of AX by a byte: AL the quotient, AH the remainder. CF and OF
    /// are what the microcode's undo-and-compare leaves, SF, ZF and PF the
    /// remainder's, AF set. A quotient past a byte -- a divisor of nought
    /// among them -- is a divide error, after the flags of the compare the
    /// routine ends on.
    pub(crate) fn divide_byte(&mut self, value: u8) -> Result<(), Exit> {
        let (dividend, divisor) = (u32::from(self.regs[AX]), u32::from(value));

        if dividend >= divisor << 8 {
            let scaled = (divisor << 8) & 0xffff;
            let mut accumulator = if dividend >= scaled {
                ((dividend - scaled) | 1) & 0xffff
            } else {
                dividend
            };

            for _ in 0..6 {
                accumulator = if accumulator << 1 >= scaled || accumulator & 0x8000 != 0 {
                    (((accumulator << 1) - scaled) | 1) & 0xffff
                } else {
                    (accumulator << 1) & 0xffff
                };
            }

            self.alu(Alu::Sub, (accumulator & 0x7fff) >> 7, divisor, 8);
            return self.fault(0);
        }

        let remainder = dividend % divisor;
        let result = (remainder << 8) | ((dividend / divisor) & 0xff);
        let compared = if result & 1 != 0 {
            (((result & !1) + (divisor << 8)) & 0xffff) >> 8
        } else {
            remainder
        };

        self.wide_flags(compared < divisor, remainder, 8);
        self.regs[AX] = result as u16;
        Ok(())
    }

    /// `DIV` of DX:AX by a word, as [`Self::divide_byte`]: AX the quotient,
    /// DX the remainder.
    pub(crate) fn divide_word(&mut self, value: u16) -> Result<(), Exit> {
        let dividend = (u32::from(self.regs[DX]) << 16) | u32::from(self.regs[AX]);
        let divisor = u32::from(value);

        if u64::from(dividend) >= u64::from(divisor) << 16 {
            let scaled = i64::from(divisor) << 16;
            let dividend = i64::from(dividend);
            let mut accumulator = if dividend >= scaled {
                (dividend - scaled) | 1
            } else {
                dividend
            };

            for _ in 0..14 {
                let shifted = wrap(accumulator * 2);

                accumulator = if shifted >= scaled || accumulator >= 0x8000_0000 {
                    wrap(shifted - scaled) | 1
                } else {
                    shifted
                };
            }

            self.alu(
                Alu::Sub,
                ((accumulator % 0x8000_0000) / 0x8000) as u32,
                divisor,
                16,
            );
            return self.fault(0);
        }

        let quotient = (dividend / divisor) & 0xffff;
        let remainder = dividend % divisor;
        // As DIV of a byte, over DX:AX.
        let compared = if quotient & 1 != 0 {
            ((quotient & !1) | (remainder << 16)).wrapping_add(divisor << 16) >> 16
        } else {
            remainder
        };

        self.wide_flags(compared < divisor, remainder, 16);
        self.regs[AX] = quotient as u16;
        self.regs[DX] = remainder as u16;
        Ok(())
    }

    /// The flags the long way of `IDIV` leaves: SF, ZF and PF from its
    /// status value, CF and OF from its compare.
    fn long_division_flags(&mut self, status: u32, compared: bool, bits: u32) {
        self.flags &= !(OF | crate::CF | SF | ZF | PF);

        if compared {
            self.flags |= OF | crate::CF;
        }

        if status == 0 {
            self.flags |= ZF;
        }

        if status & (1 << (bits - 1)) != 0 {
            self.flags |= SF;
        }

        if (status as u8).count_ones().is_multiple_of(2) {
            self.flags |= PF;
        }
    }

    /// `IDIV` of AX by a byte. Where the quotient may not fit -- the
    /// one's complement of a negative dividend against the divisor's
    /// magnitude shifted into place -- the division is done the long way,
    /// as the microcode does it, since that decides whether it faults at
    /// all: a quotient of exactly -128 is let through. Its flags are the
    /// routine's, read before its adjustments, the status following the
    /// dividend's sign and CF the divisor's.
    pub(crate) fn signed_divide_byte(&mut self, value: u8) -> Result<(), Exit> {
        let ax = self.regs[AX];
        let negative = ax & 0x8000 != 0;
        let magnitude = if value & 0x80 != 0 {
            value.wrapping_neg()
        } else {
            value
        };
        let ones = if negative { !ax } else { ax };

        self.flags |= AF;

        if u32::from(ones) >= u32::from(magnitude) << 7 {
            let mut accumulator = i64::from(ones);
            let scaled = (i64::from(magnitude) << 8) - 1;

            for _ in 0..8 {
                accumulator = (accumulator * 2) & 0xffff;
                accumulator -= if accumulator > scaled { scaled } else { 0 };
            }

            let mut remainder = ((accumulator >> 8) & 0xff) as u8;
            let mut quotient = (accumulator & 0xff) as u8;
            let mut status = if negative { !remainder } else { remainder };
            let compared = (if value & 0x80 != 0 {
                !remainder
            } else {
                remainder
            }) < value;

            if negative {
                remainder = remainder.wrapping_add(1);
            }

            if remainder == magnitude {
                remainder = 0;
                quotient = quotient.wrapping_add(1);
                status = 0;
            }

            if negative {
                remainder = remainder.wrapping_neg();
            }

            self.long_division_flags(u32::from(status), compared, 8);

            if negative == (value & 0x80 != 0) {
                return self.fault(0);
            }

            quotient = quotient.wrapping_neg();

            if quotient != 0x80 {
                return self.fault(0);
            }

            self.regs[AX] = u16::from(remainder) << 8 | u16::from(quotient);
            return Ok(());
        }

        let (dividend, divisor) = (i32::from(ax as i16), i32::from(value as i8));
        let remainder = (dividend % divisor) as u8;

        self.wide_flags(
            i32::from(remainder as i8) < divisor,
            u32::from(remainder),
            8,
        );
        self.regs[AX] = (u16::from(remainder) << 8) | u16::from((dividend / divisor) as u8);
        Ok(())
    }

    /// `IDIV` of DX:AX by a word, as [`Self::signed_divide_byte`], a
    /// quotient of exactly -32768 let through.
    pub(crate) fn signed_divide_word(&mut self, value: u16) -> Result<(), Exit> {
        let dxax = (u32::from(self.regs[DX]) << 16) | u32::from(self.regs[AX]);
        let negative = dxax & 0x8000_0000 != 0;
        let magnitude = if value & 0x8000 != 0 {
            value.wrapping_neg()
        } else {
            value
        };
        let ones = if negative { !dxax } else { dxax };

        self.flags |= AF;

        if u64::from(ones) >= u64::from(magnitude) << 15 {
            let mut accumulator = i64::from(ones);
            let scaled = (i64::from(magnitude) << 16) - 1;

            for _ in 0..16 {
                accumulator = (accumulator * 2) % (1 << 32);
                accumulator -= if accumulator > scaled { scaled } else { 0 };
            }

            let mut remainder = ((accumulator >> 16) & 0xffff) as u16;
            let mut quotient = (accumulator & 0xffff) as u16;
            let mut status = if negative { !remainder } else { remainder };
            let compared = (if value & 0x8000 != 0 {
                !remainder
            } else {
                remainder
            }) < value;

            if negative {
                remainder = remainder.wrapping_add(1);
            }

            if remainder == magnitude {
                remainder = 0;
                quotient = quotient.wrapping_add(1);
                status = 0;
            }

            if negative {
                remainder = remainder.wrapping_neg();
            }

            self.long_division_flags(u32::from(status), compared, 16);

            if negative == (value & 0x8000 != 0) {
                return self.fault(0);
            }

            quotient = quotient.wrapping_neg();

            if quotient != 0x8000 {
                return self.fault(0);
            }

            self.regs[AX] = quotient;
            self.regs[DX] = remainder;
            return Ok(());
        }

        let (dividend, divisor) = (i64::from(dxax as i32), i64::from(value as i16));
        let remainder = (dividend % divisor) as u16;

        self.wide_flags(
            i64::from(remainder as i16) < divisor,
            u32::from(remainder),
            16,
        );
        self.regs[AX] = (dividend / divisor) as u16;
        self.regs[DX] = remainder;
        Ok(())
    }
}
