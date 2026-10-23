/**
 * Asking DOS about a drive: INT 21h function 44h, subfunctions 08h (whether
 * it is removable), 09h (whether it is remote), 0Dh (a block device's
 * generic request) and 0Eh (the logical drive map). BL is the drive, 0 for
 * the current one and 1 for A:. As DOSBox answers them (`dos_ioctl.cpp`
 * 41-46, 127-204), **recorded** through Windows by `drvioctl`; as `dos.rs`'s
 * `drive_ioctl`.
 *
 * A drive DOS has not got is error 0Fh -- a floppy drive with nothing in it
 * among them, DOSBox's floppy drive with nothing mounted (`hasDisk`).
 * DOSBox's removable drives are its CD-ROMs alone (`isRemovable`), here a
 * drive removable and remote; A: and B: are its floppies, whatever is
 * mounted.
 *
 * File Manager asks each drive letter with 440Dh.
 */

const ERROR_INVALID_FUNCTION = 0x01;
const ERROR_INVALID_HANDLE = 0x06;
const ERROR_INVALID_DRIVE = 0x0f;

/**
 * Whether DOS has a drive: mounted, and not a removable drive with no disk
 * in it. As `Files::has_disk`.
 */
export function hasDisk(fileSystem: any) {
  return Boolean(fileSystem) && !(fileSystem.removable && !fileSystem.space);
}

/** A CD-ROM drive, as DOSBox's removable drives are: removable and remote. */
export function isCompactDisc(fileSystem: any) {
  return Boolean(fileSystem?.removable && fileSystem?.remote);
}

/** The drive BL names, with its number from nought for A:; error 0Fh for none. */
function driveOf(dos: any, drive: number) {
  const letter = drive === 0 ? dos.files.drive : String.fromCharCode(0x40 + drive);
  const fileSystem = drive > 26 ? null : dos.files.query(letter);

  if (!hasDisk(fileSystem)) {
    throw ERROR_INVALID_DRIVE;
  }

  return { fileSystem, number: letter.charCodeAt(0) - 0x41 };
}

/** 4408h: AX 0 (removable) for A: and B:, 1 (fixed) for another; a CD-ROM error 1. */
export function isRemovable(this: any, drive: number) {
  const { fileSystem, number } = driveOf(this, drive);

  if (number < 2) {
    return 0;
  }

  if (isCompactDisc(fileSystem)) {
    throw ERROR_INVALID_FUNCTION;
  }

  return 1;
}

/** 4409h: DX 1000h for a remote drive, else 0802h; AX 0300h. */
export function isRemote(this: any, drive: number) {
  const { fileSystem } = driveOf(this, drive);

  return [fileSystem.remote ? 0x1000 : 0x0802, 0x0300];
}

/**
 * 440Dh: a generic request of a block device, a CD-ROM's error 1. CL 60h,
 * get device parameters: special functions 3, the type 14h (a 1.44 MB
 * floppy) for A: and B: else 5 (a fixed disk), the word "not removable",
 * nought cylinders and media type, then DOSBox's own drive number and
 * nought where the parameter block's bytes per sector begin, and FFFFFFFFh
 * at 1Fh; the rest as it was. CL 46h or 66h, the media id: DOSBox writes
 * it, but through Windows' DOS extender nothing comes back, AX left as it
 * was. Another CL, error 1. CH is not looked at.
 */
export function blockDeviceRequest(this: any, drive: number, code: number, address: number) {
  const { fileSystem, number } = driveOf(this, drive);

  if (isCompactDisc(fileSystem)) {
    throw ERROR_INVALID_FUNCTION;
  }

  const minor = code & 0xff;

  if (minor === 0x46 || minor === 0x66) {
    return [];
  }

  if (minor !== 0x60) {
    throw ERROR_INVALID_FUNCTION;
  }

  const memory = this.machine.memory;
  const floppy = number < 2;

  [3, floppy ? 0x14 : 5, floppy ? 0 : 1, 0, 0, 0, 0, number, 0].forEach((byte, i) =>
    memory.write8(address + i, byte)
  );

  for (let i = 0; i < 4; i++) {
    memory.write8(address + 0x1f + i, 0xff);
  }

  return [];
}

/** 440Eh: AL 0, the drive its own only; a CD-ROM error 1. */
export function logicalDriveMap(this: any, drive: number) {
  const { fileSystem } = driveOf(this, drive);

  if (isCompactDisc(fileSystem)) {
    throw ERROR_INVALID_FUNCTION;
  }

  return 0;
}

/**
 * 4400h: what a handle is, in DX. **Recorded** by `devinfo`, under Windows:
 * a file, made, written or opened again, is its drive, counted from A: as
 * nought, and nothing more -- 0002 on C:, not a device; handles 0 to 4 are
 * each the console, 80D3h; a handle nobody opened is error 6. The Visual
 * Basic runtime asks of a custom control's file, and refuses one that says
 * it is a device (bit 7).
 */
export function deviceInformation(this: any, handle: number) {
  const file = this.files.resolve(handle);

  if (!file) {
    if (handle <= 4) {
      return 0x80d3;
    }

    throw ERROR_INVALID_HANDLE;
  }

  const letter = String(file.mount ?? this.files.drive ?? 'C').toUpperCase();

  /* A disc's file has bit 6 set, as `isoFile::GetInformation` answers 40h
   * (`drive_iso.cpp` 130-132, `dos_ioctl.cpp` 62). As `dos.rs`. */
  return ((letter.charCodeAt(0) - 0x41) & 0x3f) | (file.onDisc ? 0x40 : 0);
}
