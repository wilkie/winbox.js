//! The machine's CMOS, as a program reads it itself through ports 70h and
//! 71h: the register chosen by a write to 70h, read from 71h, written at
//! 71h. Every one of the 64 is answered as the oracle's DOSBox answers it:
//! `InstallShield`'s Setup reads the extended memory's size, registers 17h
//! and 18h, before its dialogs (Widget Workshop's, from its CD); Windsock
//! and Windows Speed read all 64 in turn for their system pages.
//!
//! **Read out** (DOSBox 0.74-3, `hardware/cmos.cpp`): a write to 70h keeps
//! its low six bits as the register (`cmos_selreg`, 76-79), the register
//! 0Dh to begin with (307). Its start writes status A 26h, status B 02h
//! (BCD, 24-hour) and status D 80h, and fills in the base memory (15h-16h,
//! 640 KB always) and the extended (17h-18h and 30h-31h, the machine's
//! pages less the first megabyte, in KB: 15,360 for the oracle's 16 MB,
//! `memsize=16`) (297-319); register 14h is the BIOS's equipment byte
//! (`ints/bios.cpp` 1075). A read (`cmos_readreg`, 127-285): the clock's
//! registers are the time it is, in BCD while status B's bit 2 is clear
//! (`MAKE_RETURN`), the day of the week Sunday 1, the century 19 plus the
//! years since 1900 over a hundred; status A has its update bit (7) set in
//! the first 0.002 of each millisecond of the machine's clock
//! (`PIC_TickIndex`); status C, with the periodic interrupt off, has bit 6
//! once each period of status A's rate since it last had it and bit 4 once
//! a second (`PIC_FullIndex`, `cmos.last`); the floppy drives' (10h) are
//! the images mounted; the hard disks' (12h, 19h-2Ch) are nought with no
//! hard disk image mounted, as the oracle mounts its drives as folders; the
//! rest are what was last written, nought to begin with. **Recorded** by
//! `ioports` in both modes, alike: each register's byte (the clock's only
//! as BCD).

/// The register chosen, the registers' bytes as DOSBox keeps them, and the
/// times status C last had its bits.
#[derive(Debug, Clone)]
pub struct Cmos {
    register: u8,
    registers: [u8; 64],
    /// Whether the clock's registers are BCD: status B's bit 2 clear.
    bcd: bool,
    /// Status A's rate select (its low four bits), as `cmos.timer.div`.
    rate: u8,
    /// Whether status B's bit 6 turns the periodic interrupt on.
    periodic: bool,
    /// When status C last had its periodic bit (6) and its update-ended
    /// bit (4), in the machine's milliseconds (`cmos.last`).
    last_periodic: f64,
    last_ended: f64,
}

/// The registers named.
const STATUS_A: usize = 0x0a;
const STATUS_B: usize = 0x0b;
const STATUS_C: usize = 0x0c;
const STATUS_D: usize = 0x0d;
const FLOPPIES: usize = 0x10;

impl Default for Cmos {
    fn default() -> Self {
        let mut cmos = Self {
            // DOSBox's start leaves 0Dh chosen (`cmos.cpp` 307).
            register: 0x0d,
            registers: [0; 64],
            bcd: true,
            rate: 0,
            periodic: false,
            last_periodic: 0.0,
            last_ended: 0.0,
        };

        // As `CMOS::CMOS` writes them (301-308).
        for (register, value) in [(STATUS_A, 0x26), (STATUS_B, 0x02), (STATUS_D, 0x80)] {
            cmos.register = register as u8;
            cmos.write(value);
        }

        cmos.register = STATUS_D as u8;
        cmos.registers[0x15] = 0x80;
        cmos.registers[0x16] = 0x02;
        cmos.registers[0x17] = EXTENDED_KB as u8;
        cmos.registers[0x18] = (EXTENDED_KB >> 8) as u8;
        cmos.registers[0x30] = EXTENDED_KB as u8;
        cmos.registers[0x31] = (EXTENDED_KB >> 8) as u8;
        cmos
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

/// What a read of the CMOS is made of beyond its own registers: the
/// machine's equipment word and floppy images, the date and time it is
/// (year, month, day, hour, minute, second, day of the week with Sunday
/// nought, as `System::date`), and the machine's clock in milliseconds.
#[derive(Debug, Clone, Copy)]
pub struct Moment {
    pub equipment: u16,
    pub floppies: usize,
    pub date: [u16; 7],
    pub ms: f64,
}

impl Cmos {
    /// Port 70h written: the register chosen, its low six bits.
    pub fn select(&mut self, value: u8) {
        self.register = value & 0x3f;
    }

    /// Port 71h written, as `cmos_writereg` keeps each register (81-122):
    /// the clock's own registers not changed; status A and B kept less
    /// bit 7, B's bit 2 choosing binary and its bit 6 the periodic
    /// interrupt; D only its bit 7; the rest less bit 7.
    pub fn write(&mut self, value: u8) {
        let register = usize::from(self.register);

        match register {
            0x00 | 0x02 | 0x04 | 0x06 | 0x07 | 0x08 | 0x09 | 0x32 => {}
            0x01 | 0x03 | 0x05 => self.registers[register] = value,
            STATUS_A => {
                self.registers[register] = value & 0x7f;
                self.rate = value & 0x0f;
            }
            STATUS_B => {
                self.bcd = value & 0x04 == 0;
                self.registers[register] = value & 0x7f;
                self.periodic = value & 0x40 != 0;
            }
            STATUS_D => self.registers[register] = value & 0x80,
            _ => self.registers[register] = value & 0x7f,
        }
    }

    /// The periodic interrupt's period in milliseconds, status A's rate as
    /// `cmos_checktimer` takes it (63-66): a rate of 2 or less made 7 more,
    /// then 32,768 Hz halved one less time than the rate.
    fn period(&self) -> f64 {
        let rate = if self.rate <= 2 {
            self.rate + 7
        } else {
            self.rate
        };

        1000.0 / (32768.0 / f64::from(1u32 << (rate - 1)))
    }

    /// Port 71h read: the register chosen; `None` for the floppy drives'
    /// with an image mounted, whose BIOS type follows the image's size.
    pub fn read(&mut self, at: &Moment) -> Option<u8> {
        let register = usize::from(self.register);
        let [year, month, day, hour, minute, second, weekday] = at.date;
        let clock = |value: u16| {
            let value = value as u8;

            if self.bcd {
                (value / 10) << 4 | value % 10
            } else {
                value
            }
        };

        Some(match register {
            0x00 => clock(second),
            0x02 => clock(minute),
            0x04 => clock(hour),
            0x06 => clock(weekday + 1),
            0x07 => clock(day),
            0x08 => clock(month),
            0x09 => clock(year % 100),
            0x32 => clock((year - 1900) / 100 + 19),
            STATUS_A => {
                let update = if at.ms.fract() < 0.002 { 0x80 } else { 0 };

                (self.registers[STATUS_A] & 0x7f) | update
            }
            STATUS_C if self.periodic => {
                // Only the periodic interrupt sets it, and WinBox raises
                // none: nought.
                std::mem::take(&mut self.registers[STATUS_C])
            }
            STATUS_C => {
                let mut value = 0;

                if at.ms >= self.last_periodic + self.period() {
                    self.last_periodic = at.ms;
                    value |= 0x40;
                }

                if at.ms >= self.last_ended + 1000.0 {
                    self.last_ended = at.ms;
                    value |= 0x10;
                }

                value
            }
            FLOPPIES if at.floppies > 0 => return None,
            FLOPPIES => 0,
            // The hard disks' and 39h-3Ah: nought, no image mounted.
            0x12 | 0x19..=0x2c | 0x39 | 0x3a => 0,
            0x14 => at.equipment as u8,
            // 0Bh, 0Dh, 0Fh, the memory's, and every other register: as
            // last written, or as DOSBox's start left it.
            _ => self.registers[register],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{Cmos, Moment};

    /// 2026-11-16, a Monday, 09:41:07, half a millisecond into the clock's
    /// 5,000th.
    fn moment(floppies: usize) -> Moment {
        Moment {
            equipment: super::equipment(floppies),
            floppies,
            date: [2026, 11, 16, 9, 41, 7, 1],
            ms: 5000.5,
        }
    }

    #[test]
    fn the_registers_are_the_oracles() {
        let mut cmos = Cmos::default();
        let mut read = |register: u8| {
            cmos.select(register);
            cmos.read(&moment(0))
        };

        // As `biosmem` and `ioports` recorded them.
        assert_eq!(read(0x14), Some(0x26));
        assert_eq!(read(0x15), Some(0x80));
        assert_eq!(read(0x16), Some(0x02));
        assert_eq!(read(0x17), Some(0x00));
        assert_eq!(read(0x18), Some(0x3c));
        assert_eq!(read(0x30), Some(0x00));
        assert_eq!(read(0x31), Some(0x3c));
        assert_eq!(read(0x0a), Some(0x26));
        assert_eq!(read(0x0b), Some(0x02));
        assert_eq!(read(0x0d), Some(0x80));
        assert_eq!(read(0x10), Some(0x00));
        assert_eq!(read(0x3f), Some(0x00));
        // The NMI bit is not part of the register.
        assert_eq!(read(0x80 | 0x18), Some(0x3c));
    }

    #[test]
    fn the_clock_is_bcd() {
        let mut cmos = Cmos::default();
        let mut read = |register: u8| {
            cmos.select(register);
            cmos.read(&moment(0)).unwrap()
        };

        assert_eq!(
            [0x00, 0x02, 0x04, 0x06, 0x07, 0x08, 0x09, 0x32].map(&mut read),
            [0x07, 0x41, 0x09, 0x02, 0x16, 0x11, 0x26, 0x20]
        );
    }

    #[test]
    fn status_a_and_c_follow_the_clock() {
        let mut cmos = Cmos::default();
        let mut at = moment(0);

        cmos.select(0x0a);
        at.ms = 5000.001;
        assert_eq!(cmos.read(&at), Some(0xa6));
        at.ms = 5000.5;
        assert_eq!(cmos.read(&at), Some(0x26));

        // Both bits the first time; then the periodic one again a period
        // (0.977 ms at 26h's rate) on, the update-ended one a second on.
        cmos.select(0x0c);
        assert_eq!(cmos.read(&at), Some(0x50));
        at.ms += 0.5;
        assert_eq!(cmos.read(&at), Some(0x00));
        at.ms += 0.5;
        assert_eq!(cmos.read(&at), Some(0x40));
        at.ms += 1000.0;
        assert_eq!(cmos.read(&at), Some(0x50));
    }

    #[test]
    fn writes_are_kept_as_dosbox_keeps_them() {
        let mut cmos = Cmos::default();
        let mut at = moment(0);

        // Binary, by status B's bit 2.
        cmos.select(0x0b);
        cmos.write(0x06);
        cmos.select(0x04);
        assert_eq!(cmos.read(&at), Some(9));
        cmos.write(0x23);
        assert_eq!(cmos.read(&at), Some(9));

        cmos.select(0x3e);
        cmos.write(0xff);
        assert_eq!(cmos.read(&at), Some(0x7f));

        // A floppy image's type is not answered.
        at = moment(1);
        cmos.select(0x10);
        assert_eq!(cmos.read(&at), None);
        cmos.select(0x14);
        assert_eq!(cmos.read(&at), Some(0x27));
        assert_eq!(super::equipment(3) as u8, 0x67);
    }
}
