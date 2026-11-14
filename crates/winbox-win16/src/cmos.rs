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

/// The BIOS's equipment word, as DOSBox's BIOS sets it as it starts
/// (`ints/bios.cpp` 1039-1073) and `INT 11h` answers it (364-367): three
/// parallel ports (bits 14-15, `0xc000` where DOSBox finds no second at
/// 278h), the game port (bit 12), two serial ports (bits 9-11,
/// `BIOS_SetComPorts`, 1115-1127), the video mode 80 by 25 in colour (bits
/// 4-5, as VGA's BIOS leaves it), the PS/2 mouse (bit 2) and the
/// coprocessor (bit 1). **Recorded** by `biosequ`: D426h, its low byte the
/// CMOS's register 14h, as `biosmem` reads it.
const PARALLEL_PORTS: u16 = 3 << 14;
const GAME_PORT: u16 = 1 << 12;
const SERIAL_PORTS: u16 = 2 << 9;
const COLOUR_80_BY_25: u16 = 2 << 4;
const PS2_MOUSE: u16 = 1 << 2;
const COPROCESSOR: u16 = 1 << 1;

/// The equipment word with `floppies` floppy images mounted, as DOSBox's
/// `imageDisk` counts them, whatever their letters (`ints/bios_disk.cpp`
/// 219-229; `fatDrive`, `drive_fat.cpp` 648): the first sets bit 0, the
/// second makes bits 6-7, the drives less one, one; no more than two are
/// counted. **Recorded** by `biosequa` (D427h), `biosequ2` and `biosequd`
/// (D467h, the second floppy image at D:). DOSBox writes its low byte into
/// the CMOS's register 14h each time.
pub fn equipment(floppies: usize) -> u16 {
    let floppy_bits = match floppies {
        0 => 0,
        1 => 1,
        _ => 1 | 1 << 6,
    };

    PARALLEL_PORTS
        | GAME_PORT
        | SERIAL_PORTS
        | COLOUR_80_BY_25
        | PS2_MOUSE
        | COPROCESSOR
        | floppy_bits
}
/// The extended memory, in KB: 16 MB less the first.
const EXTENDED_KB: u16 = 16 * 1024 - 1024;

impl Cmos {
    /// Port 70h written: the register chosen, its low six bits.
    pub fn select(&mut self, value: u8) {
        self.register = value & 0x3f;
    }

    /// Port 71h read: the register chosen, where it is one answered; the
    /// equipment byte the low byte of `equipment`'s word.
    pub fn read(&self, equipment: u16) -> Option<u8> {
        match self.register {
            0x14 => Some(equipment as u8),
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
            cmos.read(super::equipment(0))
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

        // A floppy image or two mounted, as `biosequa` and `biosequ2`.
        cmos.select(0x14);
        assert_eq!(cmos.read(super::equipment(1)), Some(0x27));
        assert_eq!(cmos.read(super::equipment(3)), Some(0x67));
    }
}
