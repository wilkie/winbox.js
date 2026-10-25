'use strict';

/**
 * The machine's CMOS, as a program reads it itself through ports 70h and
 * 71h: the register chosen by a write to 70h, read from 71h. Only those the
 * oracle's DOSBox fills in as it starts, whatever the machine holds, are
 * answered -- the equipment byte and the memory sizes -- as `biosmem`
 * records them through Windows: InstallShield's Setup reads the extended
 * memory's size, registers 17h and 18h, before its dialogs (Widget
 * Workshop's, from its CD).
 *
 * **Read out** (DOSBox 0.74-3, `hardware/cmos.cpp`): a write to 70h keeps its
 * low six bits as the register (`cmos_selreg`, 76-79), 0Dh chosen to begin
 * with (290-297); register 14h is the BIOS's equipment byte (`ints/bios.cpp`
 * 1075), 15h and 16h the base memory, 640 KB always, and 17h-18h and 30h-31h
 * the extended memory, the machine's pages less the first megabyte, in KB
 * (312-321) -- 15,360 for the oracle's 16 MB. The clock's registers, the
 * floppy drives' (10h) and the hard disks' (12h, 19h on) depend on the
 * host's time and the images mounted, and are not answered: a read of one
 * is a port not answered. As `cmos.rs`.
 */
export class Cmos {
  register = 0x0d;

  /** Port 70h written: the register chosen, its low six bits. */
  select(value: number) {
    this.register = value & 0x3f;
  }

  /** Port 71h read: the register chosen, where it is one answered; else null. */
  read(): number | null {
    switch (this.register) {
      case 0x14:
        return EQUIPMENT;
      case 0x15:
        return 0x80;
      case 0x16:
        return 0x02;
      case 0x17:
      case 0x30:
        return EXTENDED_KB & 0xff;
      case 0x18:
      case 0x31:
        return EXTENDED_KB >> 8;
      default:
        return null;
    }
  }
}

/** The equipment byte as the oracle's BIOS sets it, measured. */
const EQUIPMENT = 0x26;
/** The extended memory, in KB: 16 MB less the first. */
const EXTENDED_KB = 16 * 1024 - 1024;

/**
 * The ports a program's own `IN` and `OUT` reach, as the Rust engine's
 * `ports.rs` answers them but for the FM chip, which only it has: the
 * CMOS's. A write to any other port is passed over; a read of any other is
 * not answered (null), and the instruction is not run.
 */
export class Ports {
  readonly cmos = new Cmos();

  read(port: number): number | null {
    return port === 0x71 ? this.cmos.read() : null;
  }

  write(port: number, value: number) {
    if (port === 0x70) {
      this.cmos.select(value);
    }
  }
}
