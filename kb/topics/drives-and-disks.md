---
kind: topic
name: Drives and disks
summary: What Windows 3.1 and DOS say about the drives there are — GetDriveType, the network calls with no network, disk space, the drive IOCTL calls and absolute disk reads — measured where Windows answers and documented where DOS does.
probes: [drivetyp, netcaps, diskfree]
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

## Free space

[[measured]] [[probe:diskfree]] asks function 36h about the current drive, A:, B:, C:, Z: and the number past Z:, with BX and CX set to 0B0Bh and 0C0Ch first, and function 1Ch about the same drives.

| Drive | AX, sectors to a cluster | BX, free clusters | CX, bytes to a sector | DX, clusters |
|---|---|---|---|---|
| C:, and the current drive | 007Fh | 0FBFh | 0200h | 3FFFh |
| Z: | 007Fh | 0000h | 0200h | 4081h |
| A:, B:, past Z: | FFFFh | 0B0Bh, as it was | 0C0Ch, as it was | the drive, as it was |

- [[read out]] These are DOSBox's own figures, not the host's disk. DOSBox 0.74-3's `MOUNT` gives a folder mounted as a hard disk the fixed geometry "512,127,16383,4031" (`dos_programs.cpp`): 512 bytes to a sector, 127 sectors to a cluster, 16,383 clusters, 4,031 free. Its comment says "~1GB total size" and "~250MB total free size". `localDrive::AllocationInfo` answers what it was given (`drive_local.cpp`). Only `-freesize` or `-size` change it, and the oracle mounts C: with neither (`scripts/oracle/record.mjs`). A floppy mounted with `-t floppy` is "512,1,2880,2880", all of it free. Z:, DOSBox's own drive, is "512,127,16513,0" (`drive_virtual.cpp`).
- [[measured]] A drive that is not there answers FFFFh in AX and leaves BX, CX and DX as they were. Under DOSBox, A: is not mounted, so it is not there, though [[fn:KERNEL.GetDriveType]] calls it removable.
- [[measured]] Function 1Ch answers the same geometry without the free clusters: AL 7Fh, CX 0200h, DX 3FFFh for C:, and AL FFh for a drive that is not there. DS:BX comes back as a selector other than the program's own (DOSX's, in standard mode), over the media byte: F8h for C:, 00h for Z:.
- [[read out]] File Manager multiplies the three numbers out before it copies (`WINFILE.EXE` `3b62`). With FFFFh it says "Not enough disk space". It makes the copy with function 6C00h, extended open, BX 2012h and DX 12h, which replaces a file that is there and makes one that is not (`1f785`). It then asks 4401h to set the new handle's device information (DX 20h), and goes on whatever is answered. It reads the source's stamp with 5700h and sets the copy's with 5701h (`1f879`). DOSBox's 5701h does nothing: "DOS:57:Set File Date Time Faked" (`dos.cpp`).
- [[read out]] File Manager also asks function 32h for a drive parameter block, and copies 21h bytes from DS:BX (`WINFILE.EXE` `e43a`). Neither engine answers 32h or 1Ch.

### In each engine

- The TypeScript engine's drives are FAT16 volumes in memory, and 36h answers each one's own geometry. The oracle's drive copied into 40 MB answers 4 sectors to a cluster, 16,621 clusters free of 20,431, 512 bytes to a sector. That differs from DOSBox's C:, so `diskfree`'s `space` is a known gap there. A drive that is not there leaves BX, CX and DX as they were. Before, it wrote noughts into them.
- The Rust engine's drives are folders of the host's (`HostDrive`) or trees held in memory (`MemoryDrive`), with no FAT. They answer as DOSBox answers for the folders it mounts (`Allocation` in `crates/winbox-machine/src/files.rs`). A fixed drive is "512,127,16383,4031" whatever it holds. A removable drive with files on it is DOSBox's floppy, "512,1,2880,2880". An empty removable drive answers FFFFh, standing in for DOSBox's unmounted A:. So the page's C: tells about 250 MB free (4,031 × 127 × 512 bytes, 262,107,136), and the TypeScript page's C: tells what its own volume has.
- [[measured]] The Rust engine agrees with five of `diskfree`'s six `space` records. Z: is the sixth: the survey's Z: is an empty folder, which answers as a fixed drive does, not as DOSBox's own Z:.
- The Rust engine answers 6C00h as DOSBox's `DOS_OpenFileExtended` does (`dos_files.cpp`). It answers 5700h from the file's entry, 5701h by doing nothing, as DOSBox does, and 4401h as DOSBox's IOCTL does: error 1 for a file, error 0Dh with DH not nought.

## Sectors

- [[read out]] File Manager reads each drive's boot sector with `INT 25h` and takes one whose media byte is F8h with one FAT for a RAM drive (`WINFILE.EXE` seg6 `09e3`-`09fd`). The TypeScript engine reads the sector from its disk, or answers AX 8002h with the carry set where there is no disk; the Rust engine's drives are files, not sectors, and answer so. `INT 25h` and `26h` return with the flags still on the stack. The Rust engine stopped at the interrupt, and File Manager never opened.

## Not yet done

- Functions 1Bh, 1Ch, 1Fh and 32h: a drive's allocation and its parameter block. The parameter block's pointer would need a selector over a table of the engine's own.
- Drives mounted as removable, and floppy drives.
- The IOCTL requests other than getting a device's parameters.

## In winbox.js

- `src/win16/kernel/GetDriveType.ts` and `src/win16/user/wnet.ts` hold the Windows calls.
- `src/dos/syscall/diskSpace.ts` and `src/dos/syscall/ioctl.ts` hold the DOS functions, and `DOS.absoluteDisk` in `src/dos.ts` the interrupts.
