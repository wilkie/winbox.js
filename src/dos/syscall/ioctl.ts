/**
 * Asking DOS about a drive: INT 21h function 44h, subfunctions 08h (whether
 * it is removable), 09h (whether it is remote) and 0Dh (a block device's
 * parameters). BL is the drive, 0 for the current one and 1 for A:; a drive
 * that is not there is error 0Fh. DOS as documented: every drive here is a
 * fixed disk, local.
 *
 * File Manager asks each drive letter with 440Dh. With no answer the carry
 * flag was whatever it happened to be, and it read a parameter block nothing
 * had written.
 */

const ERROR_INVALID_FUNCTION = 0x01;
const ERROR_INVALID_DRIVE = 0x0f;

function driveOf(dos: any, drive: number) {
  const letter = drive === 0 ? dos.files.drive : String.fromCharCode(0x40 + drive);
  const fileSystem = drive > 26 ? null : dos.files.query(letter);

  if (!fileSystem) {
    throw ERROR_INVALID_DRIVE;
  }

  return fileSystem;
}

/** 4408h: 0 for removable, 1 for fixed. */
export function isRemovable(this: any, drive: number) {
  driveOf(this, drive);

  return 1;
}

/** 4409h: the device's attributes in DX, bit 12 set for a remote drive. */
export function isRemote(this: any, drive: number) {
  driveOf(this, drive);

  return 0;
}

/**
 * 440Dh: a generic request of a block device. Only "get device parameters"
 * (CX 0860h) is answered: a fixed disk (type 5, attributes 1), its
 * cylinders, and the BIOS parameter block from its boot sector.
 */
export async function blockDeviceRequest(this: any, drive: number, code: number, address: number) {
  const fileSystem = driveOf(this, drive);

  if (code !== 0x0860 || !fileSystem.disk) {
    throw ERROR_INVALID_FUNCTION;
  }

  const memory = this.machine.memory;
  const bpb: number[] = [];

  for (let i = 0; i < 25; i++) {
    bpb.push(await fileSystem.disk.read8(0, 11 + i));
  }

  const word = (at: number) => bpb[at] | (bpb[at + 1] << 8);
  const sectors = word(8) || (word(21) | (word(23) << 16));
  const perCylinder = Math.max(1, word(13) * word(15));
  const cylinders = Math.ceil(sectors / perCylinder);

  memory.write8(address + 1, 5);
  memory.write8(address + 2, 1);
  memory.write8(address + 3, 0);
  memory.write8(address + 4, cylinders & 0xff);
  memory.write8(address + 5, (cylinders >> 8) & 0xff);
  memory.write8(address + 6, 0);

  bpb.forEach((byte, i) => memory.write8(address + 7 + i, byte));

  return 0;
}
