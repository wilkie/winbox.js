//! DOS's functions, `INT 21h`, as far as the Rust engine answers them: by
//! AH, and for a few by AX, as winbox.js's `SyscallManager` takes them.

use winbox_cpu::{AX, BX, CX};

use crate::call::Stop;
use crate::system::System;

/// The carry flag, which says a DOS function failed.
#[allow(dead_code)]
const CARRY: u16 = 0x0001;

impl System {
    /// The `INT 21h` at CS:IP answered; the program goes on after it.
    pub(crate) fn dos_interrupt(&mut self) -> Result<(), Stop> {
        self.dos_call()?;
        self.cpu.ip += 2;
        Ok(())
    }

    /// The DOS function AH names, answered: by `INT 21h`, or by KERNEL's
    /// `Dos3Call`.
    pub(crate) fn dos_call(&mut self) -> Result<(), Stop> {
        let ax = self.cpu.regs[AX];

        match ax >> 8 {
            // The version: DOS 6.0.
            0x30 => {
                self.cpu.regs[AX] = 0x0006;
                self.cpu.regs[BX] = 0;
                self.cpu.regs[CX] = 0;
            }
            _ => return Err(Stop::Dos(ax)),
        }

        Ok(())
    }
}
