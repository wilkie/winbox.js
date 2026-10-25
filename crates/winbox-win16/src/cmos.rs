//! The machine's CMOS, as a program reads it itself through ports 70h and
//! 71h: the register chosen by a write to 70h, read from 71h. Only those
//! the oracle's DOSBox fills in as it starts, whatever the machine holds,
//! are answered -- the equipment byte and the memory sizes -- as
//! `biosmem` records them through Windows: `InstallShield`'s Setup reads
//! the extended memory's size, registers 17h and 18h, before its dialogs
//! (Widget Workshop's, from its CD).
//!
//! **Read out** (DOSBox 0.74-3, `hardware/cmos.cpp`): a write to 70h keeps
//! its low six bits as the register (`cmos_selreg`, 76-79), the register
//! 0Dh to begin with (290-297); register 14h is the BIOS's equipment byte
//! (`ints/bios.cpp` 1075), 15h and 16h the base memory, 640 KB always, and
//! 17h-18h and 30h-31h the extended memory, the machine's pages less the
//! first megabyte, in KB (312-321) -- 15,360 for the oracle's 16 MB
//! (`memsize=16`, `record.mjs`). The clock's registers, the floppy drives'
//! (10h) and the hard disks' (12h, 19h on) depend on the host's time and
//! the images mounted, and are not answered: a read of one stops the run,
//! as a read of a port the machine does not answer does (`ports.rs`).

/// The register chosen, as DOSBox keeps it.
#[derive(Debug, Clone)]
pub struct Cmos {
    register: u8,
}

impl Default for Cmos {
    fn default() -> Self {
        // DOSBox's start leaves 0Dh chosen (`cmos.cpp` 296).
        Self { register: 0x0d }
    }
}

/// The equipment byte as the oracle's BIOS sets it, measured.
const EQUIPMENT: u8 = 0x26;
/// The extended memory, in KB: 16 MB less the first.
const EXTENDED_KB: u16 = 16 * 1024 - 1024;

impl Cmos {
    /// Port 70h written: the register chosen, its low six bits.
    pub fn select(&mut self, value: u8) {
        self.register = value & 0x3f;
    }

    /// Port 71h read: the register chosen, where it is one answered.
    pub fn read(&self) -> Option<u8> {
        match self.register {
            0x14 => Some(EQUIPMENT),
            0x15 => Some(0x80),
            0x16 => Some(0x02),
            0x17 | 0x30 => Some(EXTENDED_KB as u8),
            0x18 | 0x31 => Some((EXTENDED_KB >> 8) as u8),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Cmos;

    #[test]
    fn the_memory_registers_are_the_oracles() {
        let mut cmos = Cmos::default();
        let mut read = |register: u8| {
            cmos.select(register);
            cmos.read()
        };

        // As `biosmem` recorded them.
        assert_eq!(read(0x14), Some(0x26));
        assert_eq!(read(0x15), Some(0x80));
        assert_eq!(read(0x16), Some(0x02));
        assert_eq!(read(0x17), Some(0x00));
        assert_eq!(read(0x18), Some(0x3c));
        assert_eq!(read(0x30), Some(0x00));
        assert_eq!(read(0x31), Some(0x3c));
        // The NMI bit is not part of the register.
        assert_eq!(read(0x80 | 0x18), Some(0x3c));
        // The clock's are not answered.
        assert_eq!(read(0x00), None);
        assert_eq!(read(0x10), None);
    }
}
