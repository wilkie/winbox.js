//! The BIOS's video and disk interrupts, `INT 10h` and `INT 13h`, and the
//! Virtual DMA Services' interrupt, `INT 4Bh`, as a Windows program issues
//! them in protected mode (`kb/topics/bios-interrupts.md`).
//!
//! Each goes through Windows before the BIOS below it: in standard mode
//! DOSX's handler of the vector (its table at `0000h:2964h` of its
//! unpacked image) passes it on to real mode, translating a buffer where
//! one is given; in 386 enhanced mode WIN386's. The BIOS is the oracle's
//! DOSBox's (`ints/int10*.cpp`, `ints/bios_disk.cpp`). What each answers
//! is **recorded** by `biosint` and `biosintm`, in both modes.

use winbox_cpu::{AX, BX, CX, DI, DX, ES, SI};

use crate::dpmi::DOSX_DOS_SEGMENT;
use crate::system::System;

const CARRY: u16 = 0x0001;

/// The segment ES holds after `INT 13h` 08h of a floppy drive in 386
/// enhanced mode, **recorded** by `biosint`: C000h, the video BIOS's.
const ENHANCED_DISK_SEGMENT: u16 = 0xc000;

/// A floppy image's largest size in KB; past it, a hard disk's
/// (`fatDrive::fatDrive`, `drive_fat.cpp` 648).
const FLOPPY_MOST: u64 = 2880;

/// The 64 colours DOSBox's BIOS puts in the DAC as it sets mode 12h
/// (`text_palette`, `int10_modes.cpp` 255-264, written at 1159-1160 and
/// 1201-1207): each register's six bits the EGA's `rgbRGB`, bits 0-2 blue,
/// green and red at two thirds (2Ah) and bits 3-5 at one third (15h).
fn mode_12h_colour(register: u8) -> [u8; 3] {
    let component = |high: u8, low: u8| {
        (if register & high != 0 { TWO_THIRDS } else { 0 })
            + if register & low != 0 { ONE_THIRD } else { 0 }
    };

    [component(4, 0x20), component(2, 0x10), component(1, 0x08)]
}

const TWO_THIRDS: u8 = 0x2a;
const ONE_THIRD: u8 = 0x15;

/// The EGA's six bits of a colour, as `VGA.DRV`'s table names them: blue,
/// green and red at two thirds, then at one third.
const B: u8 = 0x01;
const G: u8 = 0x02;
const R: u8 = 0x04;
const B_THIRD: u8 = 0x08;
const G_THIRD: u8 = 0x10;
const R_THIRD: u8 = 0x20;

/// The sixteen palette registers as `VGA.DRV`'s `Enable` sets them with
/// `INT 10h` 1002h from its table (seg4 `00ec`-`00f6`, the table at seg4
/// `0263`; the same at seg1 `000a`), by the driver's colour: each the DAC
/// register it shows, the dark colours with a third of another.
const PALETTE_REGISTERS: [u8; 16] = [
    0,                                       // black
    R | B_THIRD,                             // dark red
    G | B_THIRD,                             // dark green
    R | G | B_THIRD,                         // dark yellow
    B,                                       // dark blue
    R | B | G_THIRD,                         // dark magenta
    G | B | R_THIRD,                         // dark cyan
    R | G | B,                               // dark grey, DAC 7 set again below
    R | G | B | B_THIRD,                     // light grey, DAC 0Fh set again below
    R | R_THIRD,                             // red
    G | G_THIRD,                             // green
    R | G | R_THIRD | G_THIRD,               // yellow
    B | B_THIRD,                             // blue
    R | B | R_THIRD | B_THIRD,               // magenta
    G | B | G_THIRD | B_THIRD,               // cyan
    R | G | B | R_THIRD | G_THIRD | B_THIRD, // white
];

/// The overscan register, the table's seventeenth byte: black.
const OVERSCAN: u8 = 0;

/// The two DAC registers `VGA.DRV`'s `Enable` writes after, with `INT 10h`
/// 1010h: its greys (seg4 `00f8`-`0104`, `0106`-`0112`).
const DARK_GREY: (u8, [u8; 3]) = (0x07, [0x21, 0x22, 0x23]);
const LIGHT_GREY: (u8, [u8; 3]) = (0x0f, [0x30, 0x31, 0x32]);

/// The VGA's palette registers and DAC as the video BIOS reads and writes
/// them: as `VGA.DRV` leaves them on DOSBox's VGA, then as programs write
/// them. Only what the BIOS answers: the screen is not shown through them.
#[derive(Debug, Clone)]
pub struct VideoBios {
    pub palette: [u8; 16],
    pub overscan: u8,
    pub dac: [[u8; 3]; 256],
}

impl Default for VideoBios {
    fn default() -> Self {
        // The 192 registers past mode 12h's 64 DOSBox leaves as its VGA
        // began them, nought (`vga_dac.cpp`); measured at 40h and FFh.
        let mut dac = [[0; 3]; 256];

        for (register, colour) in dac.iter_mut().enumerate().take(64) {
            *colour = mode_12h_colour(register as u8);
        }

        for (register, colour) in [DARK_GREY, LIGHT_GREY] {
            dac[usize::from(register)] = colour;
        }

        Self {
            palette: PALETTE_REGISTERS,
            overscan: OVERSCAN,
            dac,
        }
    }
}

/// The disk BIOS's state: the status of its last operation
/// (`last_status`, `bios_disk.cpp` 48).
#[derive(Debug, Clone, Default)]
pub struct DiskBios {
    last_status: u8,
}

/// The floppy geometries DOSBox's BIOS knows, by the image's size in KB
/// (`DiskGeometryList`, `bios_disk.cpp` 32-44): sectors a track, heads,
/// cylinders and the type function 08h answers in BL.
const FLOPPIES: [(u64, u8, u8, u8, u8); 10] = [
    (160, 8, 1, 40, 0),
    (180, 9, 1, 40, 0),
    (200, 10, 1, 40, 0),
    (320, 8, 2, 40, 1),
    (360, 9, 2, 40, 1),
    (400, 10, 2, 40, 1),
    (720, 9, 2, 80, 3),
    (1200, 15, 2, 80, 2),
    (1440, 18, 2, 80, 4),
    (2880, 36, 2, 80, 6),
];

/// A disk the BIOS has, as DOSBox's `imageDisk` keeps one.
#[derive(Debug, Clone, Copy)]
struct Disk {
    hard: bool,
    active: bool,
    heads: u32,
    cylinders: u32,
    sectors: u32,
    bios_type: u8,
}

impl Disk {
    /// An image of so many bytes: a floppy to 2,880 KB, of the geometry
    /// its size names, else not active (`imageDisk::imageDisk`,
    /// `bios_disk.cpp` 219-247); a hard disk past that, of whole cylinders
    /// of 16 heads and 63 sectors, as `IMGMOUNT` sizes one
    /// (`dos_programs.cpp` 1213-1236, `Set_Geometry`), its type nought.
    fn of(size: u64) -> Self {
        let kb = size / 1024;

        if kb > FLOPPY_MOST {
            return Self {
                hard: true,
                active: true,
                heads: 16,
                cylinders: (size / (512 * 16 * 63)) as u32,
                sectors: 63,
                bios_type: 0,
            };
        }

        FLOPPIES
            .iter()
            .find(|&&(known, ..)| known == kb || known + 1 == kb)
            .map_or(
                Self {
                    hard: false,
                    active: false,
                    heads: 0,
                    cylinders: 0,
                    sectors: 0,
                    bios_type: 0,
                },
                |&(_, sectors, heads, cylinders, bios_type)| Self {
                    hard: false,
                    active: true,
                    heads: u32::from(heads),
                    cylinders: u32::from(cylinders),
                    sectors: u32::from(sectors),
                    bios_type,
                },
            )
    }
}

/// What the BIOS answers a call with: AH, and the carry.
enum Status {
    /// AH set and the carry as given.
    Ah(u8, bool),
    /// The carry set, AH as it was.
    Carry,
}

impl System {
    /// The BIOS data area as Windows leaves it for a program, by mode:
    /// byte 7Bh's bit 5, the Virtual DMA Services there -- DOSX's
    /// real-mode code sets it each time it goes into protected mode
    /// (150Ch:`0a70`-`0a75`) -- and in enhanced mode bits 5 and 3.
    /// **Recorded** by `biosint`: 20h and 28h.
    pub(crate) fn bios_data_for_windows(&mut self) {
        let flags = if self.dpmi_enhanced() { 0x28 } else { 0x20 };

        self.cpu
            .bus
            .write8(winbox_machine::FIRST_MEGABYTE + 0x47b, flags);
    }

    /// `INT 10h` from a program: false where it is a function no recording
    /// has, or the display is not the VGA's, nothing done.
    pub(crate) fn video_interrupt(&mut self) -> bool {
        if self.display.driver_file != "VGA.DRV" {
            return false;
        }

        let ax = self.cpu.regs[AX];
        let [al, ah] = ax.to_le_bytes();
        let bx = self.cpu.regs[BX];
        let [bl, _] = bx.to_le_bytes();

        match (ah, al) {
            // The mode `VGA.DRV`'s `Enable` set, 12h (seg4 `00d0`), its 80
            // columns and page nought, as `INT10_Handler` reads them from
            // the BIOS's data (`int10.cpp` 135-139); BL as it was.
            (0x0f, _) => {
                self.cpu.regs[AX] = 80 << 8 | 0x12;
                self.cpu.regs[BX] = bx & 0x00ff;
            }
            // The display combination: the entry of the video ROM's table
            // the BIOS's data names (`int10.cpp` 449-466), 08h, a VGA
            // with a colour display; AH emptied.
            (0x1a, 0x00) => {
                self.cpu.regs[AX] = 0x001a;
                self.cpu.regs[BX] = 0x0008;
            }
            // The EGA's information (`int10.cpp` 319-328): a colour
            // display's controller at 3D4h (BH nought), 256 KB (BL 3), and
            // the switches' byte the BIOS keeps, 09h, its halves in CL and
            // CH.
            (0x12, _) if bl == 0x10 => {
                self.cpu.regs[BX] = 0x0003;
                self.cpu.regs[CX] = 0x0009;
            }
            // A palette register (`INT10_GetSinglePaletteRegister`,
            // `int10_pal.cpp` 123-130), and the overscan register.
            (0x10, 0x07) if bl < 16 => {
                self.cpu.regs[BX] =
                    u16::from(self.video_bios.palette[usize::from(bl)]) << 8 | u16::from(bl);
            }
            (0x10, 0x07) if bl == 0x11 => {
                self.cpu.regs[BX] = u16::from(self.video_bios.overscan) << 8 | u16::from(bl);
            }
            (0x10, 0x07) if bl > 0x14 => {}
            (0x10, 0x08) => {
                self.cpu.regs[BX] = u16::from(self.video_bios.overscan) << 8 | u16::from(bl);
            }
            // A DAC register written, six bits of each (`write_p3c9`,
            // `vga_dac.cpp` 105-106).
            (0x10, 0x10) => {
                let [blue, green] = self.cpu.regs[CX].to_le_bytes();
                let red = self.cpu.regs[DX] >> 8;

                self.video_bios.dac[usize::from(bl)] =
                    [red as u8 & 0x3f, green & 0x3f, blue & 0x3f];
            }
            // A DAC register read: DH red, CH green, CL blue. In standard
            // mode DOSX gives every 10h back with DX as the program gave it
            // (`16fd`-`176c`), so DH keeps what it held.
            (0x10, 0x15) => {
                let [red, green, blue] = self.video_bios.dac[usize::from(bl)];

                self.cpu.regs[CX] = u16::from(green) << 8 | u16::from(blue);

                if self.dpmi_enhanced() {
                    self.cpu.regs[DX] = u16::from(red) << 8 | (self.cpu.regs[DX] & 0x00ff);
                }
            }
            _ => return false,
        }

        self.cpu.ip += 2;
        self.instructions += 1;
        true
    }

    /// The disks DOSBox's BIOS has, by its drive numbers 00h, 01h, 80h and
    /// 81h (`imageDiskList`): `IMGMOUNT` puts a floppy image as 00h, the
    /// last mounted, and the first two hard disk images as 80h and 81h
    /// (`dos_programs.cpp` 1269-1283). Taken here by the drives' letters.
    fn bios_disks(&self) -> [Option<Disk>; 4] {
        let mut disks = [None; 4];

        for size in self.files.disk_images() {
            let disk = Disk::of(size);

            if !disk.hard {
                disks[0] = Some(disk);
            } else if disks[2].is_none() {
                disks[2] = Some(disk);
            } else if disks[3].is_none() {
                disks[3] = Some(disk);
            }
        }

        disks
    }

    /// `INT 13h` from a program: false where it reads or writes sectors,
    /// which is not answered, nothing done.
    pub(crate) fn disk_interrupt(&mut self) -> bool {
        let ax = self.cpu.regs[AX];
        let [al, ah] = ax.to_le_bytes();
        let [dl, _] = self.cpu.regs[DX].to_le_bytes();
        let enhanced = self.dpmi_enhanced();

        // In 386 enhanced mode a hard disk's call comes back with the
        // carry set and every register as it was, the disk there or not:
        // **recorded**, WIN386's own refusal, not read out.
        if enhanced && dl & 0x80 != 0 {
            self.cpu.flags |= CARRY;
            self.cpu.ip += 2;
            self.instructions += 1;
            return true;
        }

        if matches!(ah, 0x02 | 0x03) {
            return false;
        }

        let disks = self.bios_disks();
        let any = disks.iter().any(Option::is_some);
        // `GetDosDriveNumber` (`bios_disk.cpp` 259-275).
        let number = match dl {
            0x00 => 0,
            0x01 => 1,
            0x80..=0x83 => usize::from(dl - 0x80) + 2,
            _ => 0x7f,
        };
        let disk = disks.get(number).copied().flatten();
        // `driveInactive` (277-297): a disk not there, or not active,
        // sets the last status 1 and the carry.
        let inactive = !disk.is_some_and(|disk| disk.active);
        let status = &mut self.disk_bios.last_status;
        let mut es_back = false;

        let answer = match ah {
            // A reset: with no image at all, always done (319-339).
            0x00 if any && inactive => {
                *status = 1;
                Status::Carry
            }
            0x00 => {
                *status = 0;
                Status::Ah(0, false)
            }
            0x01 if *status != 0 => Status::Ah(*status, true),
            0x01 => Status::Ah(0, false),
            0x04 if al == 0 => Status::Ah(1, true),
            0x04 if inactive => {
                *status = 1;
                Status::Carry
            }
            0x04 => Status::Ah(0, false),
            // A drive's parameters (406-438).
            0x08 if inactive => {
                *status = 7;
                es_back = enhanced;
                Status::Ah(7, true)
            }
            0x08 => {
                let disk = disk.expect("an active disk");
                let cylinder = disk.cylinders.saturating_sub(1);
                let head = disk.heads.saturating_sub(1);
                let count = if dl & 0x80 != 0 {
                    disks[2..].iter().filter(|disk| disk.is_some()).count()
                } else {
                    disks[..2].iter().filter(|disk| disk.is_some()).count()
                };

                *status = 0;
                self.cpu.regs[AX] = 0;
                self.cpu.regs[BX] = (self.cpu.regs[BX] & 0xff00) | u16::from(disk.bios_type);
                self.cpu.regs[CX] = ((cylinder & 0xff) as u16) << 8
                    | ((cylinder >> 2) & 0xc0) as u16
                    | (disk.sectors & 0x3f) as u16;
                self.cpu.regs[DX] = (head as u16 & 0xff) << 8 | count as u16;
                es_back = true;
                Status::Ah(0, false)
            }
            // Recalibrating, and the type set for a format (439-447).
            0x11 | 0x17 => Status::Ah(0, false),
            _ => Status::Ah(0xff, true),
        };

        match answer {
            Status::Ah(value, carry) => {
                self.cpu.regs[AX] = u16::from(value) << 8 | (self.cpu.regs[AX] & 0x00ff);
                self.set_carry(carry);
            }
            Status::Carry => self.set_carry(true),
        }

        // The segment the BIOS leaves in ES made a selector: DOSX's own
        // data, given to the BIOS as the call's ES, after a 08h that
        // succeeded (`DOSX.EXE` `3535`-`354e`, the frame's ES from `[cs:2]`
        // at `18e4`); in enhanced mode C000h's after any 08h of a floppy
        // drive, **recorded**.
        if es_back {
            let paragraph = if enhanced {
                ENHANCED_DISK_SEGMENT
            } else {
                DOSX_DOS_SEGMENT
            };

            if let Some(selector) = self.dpmi_segment_selector(paragraph) {
                let _ = self.cpu.load_segment(ES, selector);
            }
        }

        self.cpu.ip += 2;
        self.instructions += 1;
        true
    }

    /// `INT 4Bh` from a program: the Virtual DMA Services' version, as
    /// DOSX's own services answer it in standard mode (`37c6`-`380b`,
    /// `3986`-`39c8`: 1.0, product 2, revision 1, no buffer, flags 8,
    /// DOSBox having no services of its own beneath) and WIN386's in
    /// enhanced mode (**recorded**: product 3, revision 2.00, a buffer of
    /// 4000h bytes, no flags). A number out of DOSX's range 02h-0Ch is
    /// error 0Fh, flags in DX it does not know 10h, the carry set. False
    /// for another of its calls, which no recording has, nothing done.
    pub(crate) fn vds_interrupt(&mut self) -> bool {
        let [al, ah] = self.cpu.regs[AX].to_le_bytes();
        let enhanced = self.dpmi_enhanced();

        match (ah, al) {
            // Another function DOSX passes on to the real-mode vector,
            // DOSBox's, which does nothing (`380b`-`384f`; `ems.cpp`
            // 1252-1263).
            (0x81, _) if enhanced && al != 0x02 => return false,
            (0x81, 0x02) if enhanced => {
                self.cpu.regs[AX] = 0x0100;
                self.cpu.regs[BX] = 0x0003;
                self.cpu.regs[CX] = 0x0200;
                self.cpu.regs[DX] = 0x0000;
                self.cpu.regs[SI] = 0x0000;
                self.cpu.regs[DI] = 0x4000;
                self.set_carry(false);
            }
            (0x81, _) if !(0x02..=0x0c).contains(&al) => {
                self.cpu.regs[AX] = u16::from(ah) << 8 | 0x0f;
                self.set_carry(true);
            }
            (0x81, _) if self.cpu.regs[DX] & 0xff81 != 0 => {
                self.cpu.regs[AX] = u16::from(ah) << 8 | 0x10;
                self.set_carry(true);
            }
            (0x81, 0x02) => {
                self.cpu.regs[AX] = 0x0100;
                self.cpu.regs[BX] = 0x0002;
                self.cpu.regs[CX] = 0x0001;
                self.cpu.regs[DX] = 0x0008;
                self.cpu.regs[SI] = 0x0000;
                self.cpu.regs[DI] = 0x0000;
                self.set_carry(false);
            }
            (0x81, _) => return false,
            _ if enhanced => return false,
            _ => {}
        }

        self.cpu.ip += 2;
        self.instructions += 1;
        true
    }

    fn set_carry(&mut self, carry: bool) {
        if carry {
            self.cpu.flags |= CARRY;
        } else {
            self.cpu.flags &= !CARRY;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// DOSBox's mode-12h colours, as `biosint` read them through the BIOS
    /// in enhanced mode.
    #[test]
    fn mode_12h_colours_are_the_egas() {
        assert_eq!(mode_12h_colour(0x0c), [0x2a, 0x00, 0x15]);
        assert_eq!(mode_12h_colour(0x24), [0x3f, 0x00, 0x00]);
        assert_eq!(mode_12h_colour(0x23), [0x15, 0x2a, 0x2a]);
        assert_eq!(mode_12h_colour(0x3f), [0x3f, 0x3f, 0x3f]);
    }

    /// `VGA.DRV`'s table, as `biosint` read it with 1007h.
    #[test]
    fn the_palette_registers_are_vga_drvs() {
        assert_eq!(
            PALETTE_REGISTERS,
            [
                0x00, 0x0c, 0x0a, 0x0e, 0x01, 0x15, 0x23, 0x07, 0x0f, 0x24, 0x12, 0x36, 0x09, 0x2d,
                0x1b, 0x3f
            ]
        );
    }

    /// The floppy image of `biosintm`, 1.44 MB, and its hard disk image,
    /// six cylinders.
    #[test]
    fn disks_are_dosboxs() {
        let floppy = Disk::of(1440 * 1024);

        assert!(floppy.active && !floppy.hard);
        assert_eq!(
            (
                floppy.cylinders,
                floppy.heads,
                floppy.sectors,
                floppy.bios_type
            ),
            (80, 2, 18, 4)
        );

        let hard = Disk::of(6 * 16 * 63 * 512);

        assert!(hard.active && hard.hard);
        assert_eq!(hard.cylinders, 6);
        assert!(!Disk::of(1000 * 1024).active);
    }
}
