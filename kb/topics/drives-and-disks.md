---
kind: topic
name: Drives and disks
summary: What Windows 3.1 and DOS say about the drives there are — GetDriveType, the network calls with no network, disk space, the drive IOCTL calls and absolute disk reads — and how DOSBox's C: lists a folder, stamps it and renames in it, measured where Windows and DOSBox answer and documented where DOS does.
probes: [drivetyp, netcaps, diskfree, dirorder]
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

- [[measured]] Function 47h, the current directory, fails on a removable drive with no disk in it: COMMDLG's Open box, changed to an empty `a:`, says it cannot read the drive ([[probe:ofnopen]]). [[inferred]] The engines answer error 0Fh, invalid drive, as for a drive that is not there; the box says the same for any error.

## Free space

[[measured]] [[probe:diskfree]] asks function 36h about the current drive, A:, B:, C:, Z: and the number past Z:, with BX and CX set to 0B0Bh and 0C0Ch first, and function 1Ch about the same drives.

| Drive                     | AX, sectors to a cluster | BX, free clusters | CX, bytes to a sector | DX, clusters         |
| ------------------------- | ------------------------ | ----------------- | --------------------- | -------------------- |
| C:, and the current drive | 007Fh                    | 0FBFh             | 0200h                 | 3FFFh                |
| Z:                        | 007Fh                    | 0000h             | 0200h                 | 4081h                |
| A:, B:, past Z:           | FFFFh                    | 0B0Bh, as it was  | 0C0Ch, as it was      | the drive, as it was |

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

## A folder as DOS lists and keeps it

The oracle's C: is a folder of the host's that DOSBox mounts (`mount c`), and what a program sees of a folder is what DOSBox makes of the host's: the order its search gives the names, the stamps, and what a rename may do. [[probe:dirorder]] makes a folder, `C:\ORACLE\DO`, and lists it, changes it and lists it again. Its stamps are recorded as the same or different four seconds on, not as times.

### The order of a search

- [[measured]] Function 4Eh and 4Fh give a folder's folders first, then its files, each in order of its name byte by byte. `.` and `..` are folders like any other. A folder whose name starts with a byte below `.`, as `!D` does, comes before them. Made in the order `MID.TXT`, `ZED.TXT`, `A.TXT`, `A!.TXT`, `-DASH.TXT`, `$DOL.TXT`, `1ONE.TXT`, `_UND.TXT`, `~TIL.TXT`, `B`, `AB.C`, `A.CD`, then the folders `SUB`, `AAA` and `!D`, the folder lists as `!D`, `.`, `..`, `AAA`, `SUB`, `$DOL.TXT`, `-DASH.TXT`, `1ONE.TXT`, `A!.TXT`, `A.CD`, `A.TXT`, `AB.C`, `B`, `MID.TXT`, `ZED.TXT`, `_UND.TXT`, `~TIL.TXT`. `A!.TXT` comes before `A.TXT`, so the name is compared as written, not as its eleven characters padded with spaces.
- [[measured]] A file deleted and made again, or a new one made, takes its place in that order. The order of making never shows.
- [[measured]] The root, `C:\`, lists `.` and `..` too.
- [[read out]] DOSBox keeps each folder's names in a list sorted by name with `strcmp` (`drive_cache.cpp` 677-711, `CreateEntry`), made from the host's own listing, `.` and `..` among them (`ReadDir`, 723-741). A search copies that list as it begins and sorts the copy folders first (`FindFirst`, 777-826; `SortByDirName`, 52-56; `DIRALPHABETICAL`, which the cache's constructor sets, 71 and 82).
- [[measured]] **A search is the names there were as it began.** A search of `*.TXT` was left open after its first file. `ADD.TXT` and `ZZZ.TXT` were made, and `MID.TXT`, which it had not reached, was deleted. The rest of the search gave neither new file and passed over `MID.TXT`.
- [[read out]] Each next call takes the next name from the copy and looks at the host's file again (`localDrive::FindNext`, `drive_local.cpp` 231-280). A name gone is passed over, and the size and stamp are the file's as it is now. A search over is let go of. DOSBox keeps up to 2,048 searches (`MAX_OPENDIRS`, `dos_system.h` 124). With none free, it lets all go and starts again from the first (`drive_cache.cpp` 783-805). The search's place is DOSBox's, not the record's. `DOS_Drive_Cache::AddEntry` moves the place of an open read of a folder when an entry is made in it (194-217), but that read is DOSBox's own, for finding names, not a program's search.
- [[documented]] MS-DOS on a FAT disk may differ, and nothing here measures it: Microsoft's FAT specification gives the root no `.` and `..` entries.

### Stamps

- [[measured]] A file's stamp, as the search and 5700h give it:

  | Done four seconds after the file was written | Its stamp |
  | -------------------------------------------- | --------- |
  | renamed                                      | the same  |
  | opened to write, and closed unwritten        | the same  |
  | written nought bytes at its end              | moved     |
  | made again with 3Ch, nothing written         | moved     |
  | written                                      | moved     |

- [[read out]] DOSBox renames with the host's `rename()` (`localDrive::Rename`, `drive_local.cpp` 347-362), which keeps the stamp. A write of nought bytes is `ftruncate` at the file's place (`localFile::Write`, 454-468). Under Linux, where the oracle runs, that moves the stamp though the size stays.
- [[measured]] A folder's own stamp, as its folder lists it, moves when a file is made in it, deleted from it or renamed in it. It does not move when a file in it is written, when the folder itself is renamed, or when it is moved into another folder.
- [[measured]] `.` has the folder's own stamp, and `..` its parent's.
- [[read out]] These are the host's: the stamp is the folder's on the host (`stat`, `drive_local.cpp` 255-276), which moves when the folder's entries change. 3Ch adds an entry only for a file that was not there (`localDrive::FileCreate`, 51-80).

### Renaming and removing

- [[measured]] Function 56h renames a folder, and moves one to another folder with all it holds, answering nought. It moves a file to another folder too.
- [[measured]] Its errors:

  | 56h                                       | AX  |
  | ----------------------------------------- | --- |
  | the new name is there, a file or a folder | 5   |
  | the old name is not there, the new one is | 5   |
  | the old name is not there                 | 2   |
  | into a folder that is not there           | 2   |
  | a folder into a folder inside it          | 2   |

- [[read out]] `DOS_Rename` (`dos_files.cpp` 263-296) answers error 11h for another drive, then 5 if the new name is there, then 2 if the old one is not. A rename the host refuses is error 2 as well. Nothing in it stops a folder moving.
- [[measured]] Function 3Ah on a folder that holds anything answers 5. On a name that is not there, or a file's, it answers 3. `DOS_RemoveDir` (`dos_files.cpp` 235-261) tests for a folder first.

### In each engine

- Both engines list a folder as DOSBox does: `files.rs`'s `Files::list`, and `listed` in `src/dos/syscall/find.ts`. The TypeScript engine's drives are FAT volumes, whose folders hold their entries in the order they were made, with `.` and `..` on the disk. They are listed in DOSBox's order all the same, with `.` and `..` made as they are listed. Before, the TypeScript engine gave the FAT's order, and the Rust engine sorted by name, files and folders together, with no `.` or `..` in the root.
- Both keep each search as DOSBox does: the names as it began, in up to 2,048 numbered searches, the number in the record's bytes 13 and 14 (`Searches` in `dos.rs`, `searches` in `find.ts`). USER's `DlgDirList` and the TypeScript and Rust COMMDLG's own lists take the same order. COMMDLG passes over names starting with `.`, and USER keeps `..`, so the root's list box now shows `[..]`.
- A folder's stamp is DOS's clock's when an entry is made in it, deleted or renamed (`Files::changed`, `FileManager.changed`). The TypeScript engine writes it into the folder's entry. The Rust engine keeps it beside the drive, as it keeps attributes, because a host's folder takes the host's clock and not DOS's. A drive held in memory keeps it itself as well.
- Function 40h with CX nought ends the file where it is and stamps it, as `_lwrite` with nought bytes did already.
- 56h answers as DOSBox's does, and moves folders. Before, both engines refused to move a folder, with error 5, and answered 3 for a folder that is not there.

## Sectors

- [[read out]] File Manager reads each drive's boot sector with `INT 25h` and takes one whose media byte is F8h with one FAT for a RAM drive (`WINFILE.EXE` seg6 `09e3`-`09fd`). The TypeScript engine reads the sector from its disk, or answers AX 8002h with the carry set where there is no disk; the Rust engine's drives are files, not sectors, and answer so. `INT 25h` and `26h` return with the flags still on the stack. The Rust engine stopped at the interrupt, and File Manager never opened.

## Not yet done

- Functions 1Bh, 1Ch, 1Fh and 32h: a drive's allocation and its parameter block. The parameter block's pointer would need a selector over a table of the engine's own.
- Drives mounted as removable, and floppy drives.
- The IOCTL requests other than getting a device's parameters.
- The stamps of the root's `.` and `..`, which are the host folder's and its parent's under DOSBox, and unmeasured. Both engines give the root's own stamp to both. The TypeScript engine's root stamp is held in memory, and the Rust engine's for a drive held in memory is not among its changes, so neither is kept from one visit to the next.
- A search's attributes as DOSBox gives them: only a folder's bit or the archive bit, from the host (`drive_local.cpp` 255-266). The engines give each file's own.
- Long names on the host, which DOSBox lists by short names it makes (`CreateShortName`) and sorts by them.

## In winbox.js

- `src/win16/kernel/GetDriveType.ts` and `src/win16/user/wnet.ts` hold the Windows calls.
- `src/dos/syscall/diskSpace.ts` and `src/dos/syscall/ioctl.ts` hold the DOS functions, and `DOS.absoluteDisk` in `src/dos.ts` the interrupts.
