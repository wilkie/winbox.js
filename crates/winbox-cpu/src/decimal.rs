//! The decimal adjustments -- `DAA`, `DAS`, `AAA`, `AAS`, `AAM` and `AAD` --
//! and `SALC`, with the flags the JavaScript core's ALU leaves (`alu.ts`),
//! the documented-undefined ones as the 80286 vectors have them.

use crate::{AF, AX, Bus, CF, Cpu, Exit, OF};

impl<B: Bus> Cpu<B> {
    /// A flag set or cleared.
    pub(crate) fn set_flag(&mut self, flag: u16, on: bool) {
        if on {
            self.flags |= flag;
        } else {
            self.flags &= !flag;
        }
    }

    /// `DAA`: AL brought back to packed BCD after an addition; OF set where
    /// the adjustment took it from positive to negative.
    pub(crate) fn decimal_add(&mut self) {
        let before = self.reg8(0);
        let carry = self.flags & CF != 0;
        let mut result = u32::from(before);
        let low = before & 0x0f > 9 || self.flags & AF != 0;

        if low {
            result += 6;
        }

        self.set_flag(AF, low);

        let high = before > 0x99 || carry;

        if high {
            result += 0x60;
        }

        self.set_flag(CF, high);

        let result = result as u8;

        self.set_flag(OF, result & 0x80 != 0 && before & 0x80 == 0);
        self.szp(u32::from(result), 8);
        self.set_reg8(0, result);
    }

    /// `DAS`: the subtraction's counterpart, the low adjustment's borrow
    /// surviving into CF; OF set where it took AL from negative to positive.
    pub(crate) fn decimal_subtract(&mut self) {
        let before = self.reg8(0);
        let carry_before = self.flags & CF != 0;
        let mut result = i32::from(before);
        let mut carry = false;

        if before & 0x0f > 9 || self.flags & AF != 0 {
            carry = carry_before || result - 6 < 0;
            result -= 6;
            self.flags |= AF;
        } else {
            self.flags &= !AF;
        }

        if before > 0x99 || carry_before {
            result -= 0x60;
            carry = true;
        }

        self.set_flag(CF, carry);

        let result = result as u8;

        self.set_flag(OF, result & 0x80 == 0 && before & 0x80 != 0);
        self.szp(u32::from(result), 8);
        self.set_reg8(0, result);
    }

    /// `AAA` and `AAS`: AX adjusted after adding or subtracting unpacked
    /// digits, the carry or borrow out of AL reaching AH; SF, ZF and PF of
    /// AL before it is masked to one digit, and OF as `DAA`'s and `DAS`'s.
    pub(crate) fn ascii_adjust(&mut self, add: bool) {
        let ax = self.regs[AX];
        let before = ax & 0xff;
        let adjust = ax & 0x0f > 9 || self.flags & AF != 0;
        let result = match (adjust, add) {
            (false, _) => ax,
            (true, true) => ax.wrapping_add(0x106),
            (true, false) => ax.wrapping_sub(0x106),
        };

        self.set_flag(AF, adjust);
        self.set_flag(CF, adjust);
        self.set_flag(
            OF,
            if add {
                result & 0x80 != 0 && before & 0x80 == 0
            } else {
                result & 0x80 == 0 && before & 0x80 != 0
            },
        );
        self.szp(u32::from(result & 0xff), 8);
        self.regs[AX] = result & 0xff0f;
    }

    /// `AAM`: AL split by the base into AH and AL, OF, AF and CF cleared; a
    /// base of nought is a divide error, the flags as they were.
    pub(crate) fn ascii_multiply(&mut self) -> Result<(), Exit> {
        let base = self.fetch8()?;

        if base == 0 {
            return self.fault(0);
        }

        let al = self.reg8(0);
        let (high, low) = (al / base, al % base);

        self.flags &= !(OF | AF | CF);
        self.szp(u32::from(low), 8);
        self.regs[AX] = u16::from(high) << 8 | u16::from(low);
        Ok(())
    }

    /// `AAD`: AH times the base added into AL, AH cleared; CF and AF from
    /// that addition, and OF made CF, as the microcode leaves them.
    pub(crate) fn ascii_divide(&mut self) -> Result<(), Exit> {
        let base = self.fetch8()?;
        let al = u32::from(self.reg8(0));
        let addend = (u32::from(self.regs[AX] >> 8) * u32::from(base)) & 0xff;
        let sum = al + addend;
        let result = sum & 0xff;

        self.set_flag(CF, sum > 0xff);
        self.set_flag(OF, sum > 0xff);
        self.set_flag(AF, (al ^ addend ^ result) & 0x10 != 0);
        self.szp(result, 8);
        self.regs[AX] = result as u16;
        Ok(())
    }

    /// `SALC`: AL all ones for a carry, nought otherwise.
    pub(crate) fn set_al_from_carry(&mut self) {
        self.set_reg8(0, if self.flags & CF != 0 { 0xff } else { 0 });
    }
}
