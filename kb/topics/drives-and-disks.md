---
kind: topic
name: Drives and disks
summary: What Windows 3.1 and DOS say about the drives there are — GetDriveType, the network calls with no network, disk space, the drive IOCTL calls and absolute disk reads — measured where Windows answers and documented where DOS does.
probes: [drivetyp, netcaps]
---

File Manager asks each drive letter whether it exists, what kind it is, whether it is on a network, and how much room it has.

## GetDriveType

- [[measured]] [[probe:drivetyp]] finds that a drive that is not there answers **0**, and so does any number past Z:. Under DOSBox, where the oracle's Windows ran, A: is removable (2), and C: and Z: are fixed (3).
- [[read out]] KERNEL asks `SYSTEM.DRV` for the answer, not DOS.
- [[measured]] winbox.js answered 1 for a missing drive before. File Manager then showed all 26 letters as drives.

## The network, with none installed

- [[measured]] [[probe:netcaps]]: `WNetGetConnection` answers `WN_NOT_SUPPORTED` (1) for every drive and writes nothing. `WNetGetCaps` answers nought for every index.
- [[measured]] With both stubs answering success, File Manager took every letter for a network drive.

## DOS

- [[documented]] **Function 36h** answers a drive's sectors to a cluster, its free clusters, its bytes to a sector and its clusters, or FFFFh for a drive that is not there.
- [[documented]] **Function 44h:**
  - 08h answers whether a drive is removable;
  - 09h answers whether it is remote;
  - 0Dh, with `CX` 0860h, answers a block device's parameters: its type, its cylinders, and the BIOS parameter block from its boot sector.

  A drive that is not there is error 0Fh. With no answer at all, the carry flag was whatever it happened to be, and File Manager read a parameter block nothing had written.
- [[documented]] **`INT 25h` and `INT 26h`** read and write a volume's sectors by number. Unlike other interrupts, they return with the flags still on the stack, and the caller pops them. File Manager reads a drive's boot sector this way. With no handler, its pop took its own return address.
- [[documented]] A drive that is not there answers 8002h to `INT 25h`, as DOSBox's does.

## Sectors

- [[read out]] File Manager reads each drive's boot sector with `INT 25h` and takes one whose media byte is F8h with one FAT for a RAM drive (`WINFILE.EXE` seg6 `09e3`-`09fd`). The TypeScript engine reads the sector from its disk, or answers AX 8002h with the carry set where there is no disk; the Rust engine's drives are files, not sectors, and answer so. `INT 25h` and `26h` return with the flags still on the stack. The Rust engine stopped at the interrupt, and File Manager never opened.

## Not yet done

- Free space on the Rust engine's drives. `INT 21h` 36h answers FFFFh, as for no drive, since a folder of the host's has no FAT's geometry. File Manager shows 0KB free, and will not copy a file: "Not enough disk space".

- Drives mounted as removable, and floppy drives.
- The IOCTL requests other than getting a device's parameters.

## In winbox.js

- `src/win16/kernel/GetDriveType.ts` and `src/win16/user/wnet.ts` hold the Windows calls.
- `src/dos/syscall/diskSpace.ts` and `src/dos/syscall/ioctl.ts` hold the DOS functions, and `DOS.absoluteDisk` in `src/dos.ts` the interrupts.
