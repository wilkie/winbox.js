---
kind: topic
name: Drives and disks
summary: What Windows 3.1 and DOS say about the drives there are — GetDriveType as SYSTEM.DRV works it out, the network calls with no network, disk space, the drive IOCTL calls, MSCDEX and absolute disk reads — how DOSBox's C: lists a folder, stamps it and renames in it, and what DOSBox makes of a floppy, hard disk or CD-ROM image -- and how both engines, the native build and the page mount, swap and save such images as drives -- measured where Windows and DOSBox answer and documented where DOS does.
probes: [drivetyp, netcaps, diskfree, dirorder, drvioctl, mscdex, imgflop, imgcd, imghdd, imgwrite, imgswap, imgbin, imgcue, imgcue2, imgtrk]
---

File Manager asks each drive letter whether it exists, what kind it is, whether it is on a network, and how much room it has.

## GetDriveType

- [[measured]] [[probe:drivetyp]] finds that a drive that is not there answers **0**, and so does any number past Z:. Under DOSBox, where the oracle's Windows ran, A: is removable (2), and C: and Z: are fixed (3).
- [[read out]] KERNEL asks `SYSTEM.DRV` for the answer, not DOS: its `InquireSystem` (`SYSTEM.DRV` seg1 `0002`-`0169`), code 1, the drive from nought for A:. It asks DOS in turn:
  1. It selects the drive (function 0Eh) and asks which is current (19h), then selects the one that was. A drive that did not become current answers **0** (`0031`-`005c`).
  2. IOCTL 4409h succeeding with bit 12 of DX set is a remote drive, **4** (`0079`-`0090`).
  3. 4408h succeeding with bit 0 of AX set is a fixed drive, **3**; with it clear, a removable one, **2** -- but A: or B: only where bit 0 of the BIOS's equipment word says a floppy drive is there, else **0** (`0092`-`00b8`).
  4. 4408h failing: the equipment word's count of floppy drives less one (bits 6-7), nought taken as one, is compared with the drive's number: below it **3**, else **2** (`00e5`-`00f9`).
  5. Then 440Eh. Succeeding with AL nought, the kind stands (`00bb`-`00e2`). Failing, B: with the count nought -- the one floppy drive's second letter -- answers **0**, and DX 1 beside it; any other drive the kind (`00fb`-`010b`).
- [[read out]] `SYSTEM.DRV` reads the equipment word once, as it starts, with `INT 11h`: bits 6-7 at its data's `0Ah`, the low byte at `0Bh` (`01e4`-`020b`). Under DOS 4.00 and 4.01 it asks 5F02h for network drives instead of 4409h (`005f`-`0077`, `019b`); not under DOSBox's DOS 5.
- [[read out]] DOSBox selects A: and B: whether or not anything is mounted there (`DOS_SetDefaultDrive`, `dos_files.cpp` 56), and its BIOS counts no floppy drive until a floppy image is mounted (`bios.cpp` 1043; `imageDisk::imageDisk`, `bios_disk.cpp` 219-229, bit 0 set by the first, the count by the second). So with nothing mounted A: answers 2 by step 4, and B: 0 by step 5.
- [[measured]] [[probe:drvioctl]] with a floppy image as B: and a CD-ROM image as D:: A:, with nothing in it, **2**; B: **2**; C: **3**; D: **4**; E:, not there, **0**; Z: **3**.
- [[measured]] winbox.js answered 1 for a missing drive before. File Manager then showed all 26 letters as drives.

## The network, with none installed

- [[measured]] [[probe:netcaps]]: `WNetGetConnection` answers `WN_NOT_SUPPORTED` (1) for every drive and writes nothing. `WNetGetCaps` answers nought for every index.
- [[measured]] With both stubs answering success, File Manager took every letter for a network drive.

## DOS

- [[documented]] **Function 36h** answers a drive's sectors to a cluster, its free clusters, its bytes to a sector and its clusters, or FFFFh for a drive that is not there.
- [[documented]] **Function 44h:** 08h answers whether a drive is removable, 09h whether it is remote, 0Dh a block device's generic request -- with `CX` 0860h its parameters -- and 0Eh the logical drive map. With no answer at all, the carry flag was whatever it happened to be, and File Manager read a parameter block nothing had written.
- [[measured]] [[probe:drvioctl]] asks each of them of the current drive, A: to E:, Z: and the number past Z:, BL the drive, BH nought, CX 0C0Ch and DX 0D0Dh before, and a buffer of 40 bytes of CCh at DS:DX for 0Dh. Under DOSBox, B: a floppy image and D: a CD-ROM image:

  | Drive                        | 4408h     | 4409h              | 440Dh CL 60h                | 440Dh CL 46h, 66h | 440Eh     |
  | ---------------------------- | --------- | ------------------ | --------------------------- | ----------------- | --------- |
  | C:, Z:, a hard disk image    | AX 1      | AX 0300h, DX 0802h | type 5, "not removable" 1   | AX as it was      | AL 0      |
  | B:, a floppy image           | AX 0      | AX 0300h, DX 0802h | type 14h, "not removable" 0 | AX as it was      | AL 0      |
  | D:, a CD-ROM image           | error 1   | AX 0300h, DX 1000h | error 1                     | error 1           | error 1   |
  | A: with nothing, E:, past Z: | error 0Fh | error 0Fh          | error 0Fh                   | error 0Fh         | error 0Fh |

  Every other register is left as it was. Any other CL, 67h among them, is error 1.

- [[measured]] The parameter block 440Dh CL 60h writes is DOSBox's: byte 0 is 3, byte 1 the type, word 2 whether it is not removable, word 4 the cylinders, nought, byte 6 the media type, nought; then where the BIOS parameter block begins, DOSBox's own drive number (2 for C:, 1 for B:, 19h for Z:) and a nought, and FFFFFFFFh at 1Fh. Bytes 9 to 1Eh are left as they were: there is no BIOS parameter block. The hard disk image's is the same as C:'s ([[probe:imghdd]]), the floppy image's as B:'s with its own drive number ([[probe:imgflop]]).
- [[read out]] DOSBox's `DOS_IOCTL` (`dos_ioctl.cpp` 41-46, 127-204): a drive not there is error 0Fh; 08h answers AX 0 for A: and B: whatever is mounted, then error 1 for a drive that is removable -- only its CD-ROM drives say so (`isoDrive::isRemovable`, `drive_iso.cpp` 378-380; a FAT image's is false, `drive_fat.cpp` 764) -- else 1; 09h DX 1000h for a remote drive (a CD-ROM), else 0802h, and AX 0300h; 0Dh and 0Eh refuse a removable drive with error 1; 0Dh looks at CL alone. For CL 46h and 66h it writes a serial number, the label and the file system's name, but none of it reaches the program: Windows' DOS extender in standard mode copies back the parameter block of 60h, and not that of 66h. [[inferred]] It copies back only for the minor codes it knows.
- [[documented]] **`INT 25h` and `INT 26h`** read and write a volume's sectors by number. Unlike other interrupts, they return with the flags still on the stack, and the caller pops them. File Manager reads a drive's boot sector this way. With no handler, its pop took its own return address.
- [[documented]] A drive that is not there answers 8002h to `INT 25h`, as DOSBox's does.

- [[measured]] Function 47h, the current directory, fails on a removable drive with no disk in it: COMMDLG's Open box, changed to an empty `a:`, says it cannot read the drive ([[probe:ofnopen]]). [[inferred]] The engines answer error 0Fh, invalid drive, as for a drive that is not there; the box says the same for any error.

## MSCDEX

[[measured]] [[probe:mscdex]] makes MSCDEX's register calls through `INT 2Fh` with no disc mounted, BX 0B0Bh, CX 0C0Ch and DX 0D0Dh before; [[probe:imgcd]] makes them with a CD-ROM image as D:.

| Call                              | No disc                    | A disc as D:              |
| --------------------------------- | -------------------------- | ------------------------- |
| 1500h, installed?                 | AL FFh, BX 0, CX as it was | AL FFh, BX 1, CX 3        |
| 150Bh, CX the drive from 0 for A: | AX 0, BX ADADh             | AX 5AD8h for D:, BX ADADh |
| 150Ch, the version                | BX 0217h                   | BX 0217h                  |
| 1100h, the network redirector's   | AL FFh                     |                           |

- [[read out]] DOSBox installs its own MSCDEX whether or not a disc is mounted (`MSCDEX_Init`, `dos_mscdex.cpp` 1312-1322) and answers these as recorded (`MSCDEX_Handler`, 1069-1167). Its version is 2.23 (`MSCDEX_VERSION_HIGH`, `_LOW`, 37-38). 1100h also writes ADADh over a word of DADAh on the caller's stack (1071-1074): through Windows that stack is the DOS extender's. The calls that take a buffer at ES:BX -- 1501h, 150Dh, 1505h, 150Fh, 1510h -- are not recorded: through Windows they need DPMI's real-mode calls and a buffer below 1 MB.
- [[read out]] File Manager asks MSCDEX of each drive. With no handler, `INT 2Fh` went through an empty vector. Then both engines left every register as it was, which to 1500h says "not installed".
- Both engines now answer 1100h, 1500h, 150Bh and 150Ch as DOSBox does, a CD-ROM drive being a drive removable and remote (`multiplex_interrupt` in `run.rs`, `DOS.multiplexInterrupt` in `src/dos.ts`). Any other function changes nothing. See [[topic:cd-rom]].

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

## Disk and CD images

DOSBox mounts disk and disc images as drives with `IMGMOUNT`: a floppy's or hard disk's FAT, or an ISO 9660 CD-ROM. The probes [[probe:imgflop]], [[probe:imgcd]] and [[probe:imghdd]] record what Windows sees of each, [[probe:imgwrite]] what writing to a floppy image does, and [[probe:drvioctl]] mounts a floppy image as B: and a CD-ROM image as D:. Both engines mount a FAT image, read and written as DOSBox reads and writes one, what is written kept apart from the image ([[format:fat]]), and an ISO 9660 disc as DOSBox's `isoDrive` reads one ([[topic:cd-rom]]).

### How the probes mount them

- A probe's images are listed in `oracle/probes/<probe>.mounts`, a line each: a drive, an image of `oracle/probes/images/` and its kind -- `floppy`, `iso` or `hdd` -- as `a:imgflop.img floppy`. `scripts/oracle/record.mjs` copies each into the build and mounts it with `imgmount <drive> <copy> -t <kind>` before `win`. DOSBox writes a disk image's changes straight into its file (`fatDrive::fatDrive` opens it `rb+`, `drive_fat.cpp` 642), so the committed image is never the one written. Both replays read the same list (`mountsOf` in `test/win16/run-probe.ts`, `mounts_of` in `tests/support/mod.rs`) and mount what their engine can present (`imageDrive`, `image_volume`): a FAT image, a floppy's or a hard disk's, as `FATImage` and `FatVolume`, and a disc as `ISO9660` and `IsoVolume`.
- `scripts/oracle/make-images.mjs` makes the images, the same bytes every time: `imgflop.img`, a 1.44 MB FAT12 floppy (`mformat`, `mcopy`); `imghdd.img`, 6 cylinders of 16 heads and 63 sectors with a master boot record and one FAT16 partition from sector 63; `imgcd.iso` (`xorriso`), an ISO 9660 primary volume descriptor alone; and `imgwrite.img`, a floppy with a file of no extension and a hidden folder, for [[probe:imgwrite]] to write to. `make-images.mjs imgwrite.img` makes the one named alone. Every entry's creation, access and modification stamps are set apart, so a listing shows which a drive answers.
- [[read out]] `IMGMOUNT` takes several files only for ISOs (`dos_programs.cpp` 1206-1209), and its drive manager swaps only those; a hard disk image is sized from its file only in whole cylinders of 16 heads and 63 sectors (1213-1236).

### A FAT image

- [[measured]] [[probe:imgflop]]: the root lists its entries in the order the disk holds them -- `README.TXT`, `ZEBRA.TXT`, `APPLE.TXT`, `LONGFI~1.TXT`, `DATA.BIN`, `SUBDIR`, `HIDDEN.SYS` -- with no `.` or `..`; the label entry, the deleted entry and the long name's VFAT entries are passed over. A subfolder lists its `.` and `..` first, as they are on the disk.
- [[measured]] The date and time a search and 5700h give are the entry's **creation** stamp (bytes 0Eh-11h), not its last write: `README.TXT`, created 1993-04-05 06:07:08 and written 1992-03-10 03:10:00, lists as 1A85h 30E4h. [[read out]] `fatDrive::FindNextInternal` and `fatFile` take `crtTime` and `crtDate` (`drive_fat.cpp` 809-810, 833-834, 957).
- [[measured]] A search for the label (attribute 08h) answers error 18, no more files, though the floppy has a label entry. [[read out]] `fatDrive::FindFirst` answers the label search so (857-867).
- [[measured]] Attributes are the entry's own: `HIDDEN.SYS` 27h. A file is found by its short name in either case; a long name is not found (error 2).
- [[measured]] 36h answers the FAT's own figures: the floppy 1 sector to a cluster, 2,832 free of 2,847, 512 bytes to a sector; the hard disk image 1, 5,917 free of 5,921, 512.
- [[measured]] Written: a file made with 3Ch, written and closed, and a folder made, list with date and time **nought**; the file's attributes are those 3Ch was given, nought, not 20h. A file made or renamed takes the folder's first slot deleted or never used -- [[probe:imgflop]]'s `NEW.TXT` the deleted entry's, its rename the end; one deleted is gone from the listing, and the room it had is free again.
- [[measured]] [[probe:imgwrite]]: a file with no extension lists as `NOEXT.`, and is found with the dot or without; a hidden folder lists, but a path through it is not found (3), nor a search in it, and a folder made in it costs a cluster all the same; a seek stops at the file's end; a file made over one there keeps its old clusters lost; a write that fills its second cluster takes a third; 4301h and 5701h change nothing; a file open twice reads what it read as it was opened, and writes it back as it is closed. [[format:fat]] has each, and the slots a search carries on from.
- [[measured]] The hard disk image answers 4408h AX 1 and `GetDriveType` 3, as C: does ([[probe:imghdd]]); the floppy image as A: answers 4408h AX 0 and 2.

### An ISO 9660 image

- [[measured]] [[probe:imgcd]]: names lose their `;1` and a trailing dot, are cut to eight characters before the dot and twelve in all, and are listed in capitals: `A_Very_Long_File_Name.Text` lists as `A_VERY_L.TEX`, `LONGNAMEDFOLDER` as `LONGNAMEDFOL`, `NOEXT.` as `NOEXT`. Entries come in the disc's order; the root has no `.` and `..`, a subfolder has them first.
- [[measured]] A file is found by its listed name, by its whole name and in either case. **A folder whose name was cut cannot be entered**: `LONGNAMEDFOL` lists, but neither it nor `LONGNAMEDFOLDER` opens as a path (error 3), and 4300h of it is error 2. An 8.3 folder, `SUBDIR`, works.
- [[measured]] Attributes in a listing: 20h a file, 10h a folder, and 02h added for a record marked hidden. 4300h answers 21h for a file, 23h hidden, 31h for a folder: read-only added. Folders list 2,048 bytes long.
- [[measured]] Stamps are the record's date with its year from 1900; the offset from GMT is ignored (`ZONE.TXT`, written 08:09:10 two hours east of GMT, lists 08:09:10).
- [[measured]] The label search answers `WINBOXCD.202` for the volume `WINBOXCD2026`, attribute 08h, stamped nought: the name made 8.3 with a dot.
- [[measured]] 36h answers 1 sector to a cluster, nought free, 2,048 bytes to a sector, 60,000 clusters, whatever the disc. 3Ch and 41h and 56h answer error 2, 39h error 3: nothing is written.
- [[read out]] `isoDrive` (`drive_iso.cpp`): the primary volume descriptor at sector 16 only, no Joliet or Rock Ridge (516-526); names made at 309; lookup without regard to case (553); 36h's figures (342-348); remote and removable (374-380). The label is `Set_Label` with `cdrom` true (`drives.cpp` 80-108).

### Swapping a disk

- [[read out]] DOSBox keeps several images for a drive only for discs (`IMGMOUNT`, `dos_programs.cpp` 1206-1209). Its swap key, Ctrl+F4 (the mapper's `swapimg`, `bios_disk.cpp` 124-135, 527), calls `DriveManager::CycleAllDisks` (`drives.cpp` 173-191): **every** drive with more than one disk takes its next, the last followed by the first, and the new disk is given the old one's current folder (`strcpy(newDisk->curdir, oldDisk->curdir)`), whether it has that folder or not. Nothing is said to Windows; File Manager shows the new disk when it next reads the drive.
- [[measured]] A disc's file open across a swap reads the **new** disc at its own sectors, but for the sector it last read, which it keeps: [[probe:imgswap]] ([[topic:cd-rom]], "Swapping a disc"). A search under way ends (error 12h); the current folder is kept though the new disc has none such.
- [[read out]] A FAT image's file open across a swap would keep the drive it was opened on (`fatFile`'s `myDrive`, `drive_fat.cpp` 64, 92), going on reading and writing the old image -- but DOSBox 0.74-3 never swaps a FAT image: `IMGMOUNT` refuses several images of any other kind (`dos_programs.cpp` 1204-1207), so it cannot be recorded.
- How the oracle swaps: a probe with a set on a drive (`d: imgsw1.iso,imgsw2.iso iso` in its `.mounts`) is recorded on a virtual X display, and each time it writes a record of `swap` whose result is `request`, `record.mjs` presses Ctrl+F4 (`runSwapping`, `xkeys.py`); the probe then waits until a file of the disc coming in is there. The harnesses swap the next disk into each drive with a set as the probe's `_lwrite` of that record is made (`swap_at_request` in `support/mod.rs`, through `System::call_watch`; `swapAtRequest` in `run-probe.ts`, through `onCall`): the same place in every run, stepped or not.
- [[read out]] DOSBox cannot take a disk out: a drive mounted stays mounted until `IMGMOUNT -u`. An empty drive is the BIOS's floppy drive with nothing mounted, which DOS answers as no drive (error 0Fh, as [[probe:drvioctl]] records for A:).

### The native build's drives

`winbox-native --mount [L:]IMAGE[,IMAGE...]` mounts images beside C: (`crates/winbox-native/src/mounts.rs`), for any run: a program's file, `--program` or `--install`.

- **Kinds.** An `.iso`, a `.bin` or a `.cue` is a disc (`IsoVolume`, `open_disc`), read as DOSBox's `SetDevice` reads one: a cue sheet, its files found as named from the working folder and then beside the sheet (`real_file_name`, `GetRealFileName`'s first two tries), else one data track of 2,048-, 2,352- or 2,336-byte sectors ([[topic:cd-rom]], "Cue sheets and raw images"). A sheet refused is said with its line and why. Anything else is a FAT image (`FatVolume`): a floppy where DOSBox takes the image for one (2,880 KB or less, `is_floppy`), else a hard disk; and a disc where it holds no FAT. Each is read from its file on the host as sectors are asked for (`FileSectors`), the file opened only to read, so a disc of hundreds of megabytes is never held whole.
- **Letters** (the owner's decision 3). A letter given is used: `A:disk1.img`. Without one, a floppy takes A:, then B:; a hard disk image the first free from D:; a disc the first free after the hard disks. C: is the program's and is refused, and so is a letter given twice. On a Windows host, `C:\GAMES\GAME.ISO` is a path of the host's with no letter given, and `D:C:\GAMES\GAME.ISO` gives one; elsewhere a letter and a colon always begin a `--mount`.
- **Sets.** Several images for one letter are an ordered set, the first in the drive. A set is of one kind, floppies or discs; a hard disk image is mounted alone, as a hard disk is not taken out. Unlike DOSBox, a set of floppies may be swapped: the owner wants installers' floppy sets.
- **Writes** (the owner's decision 1). What programs write to a floppy goes to its copy-on-write overlay, never to the image ([[format:fat]]). A disk taken out keeps its overlay for the run, and is put back as it was written (`Files::swap` hands the disk that was in back to the set). `a save FILE` on the console saves the disk in A: as written to a new file; `--write-back DIR` saves each disk written to into `DIR` by its image's own name as the run ends, the disks out of their drives too. Neither ever writes over a file that is there, so never over the image itself (`write_new`: `create_new`). Without `--write-back`, the disks written to are named on the console as not saved.
- **Swapping.** Lines typed on the console while the program runs, taken between frames (`console.rs`, `Mounts::poll`): `a next` (the next disk, the first after the last), `a 2` (a disk by its number), `a eject` (taken out: the drive stays, empty), `a` (where A: is), `drives`, `a save FILE`. A drive's current folder is kept across a swap, as `CycleAllDisks` keeps it. `next` on an empty drive puts in the disk after the one taken out.
- **The key.** **Ctrl+Shift+F12** puts the next disk in each drive with a set of more than one, as DOSBox's swap key does (`Mounts::cycle`). It is the drives' only while images are mounted; F12's press and release do not reach Windows, while Ctrl and Shift do and are let go of as ever (`input.rs`). Why this key:
  - [[documented]] DOSBox's Ctrl+F4 is Windows' own: it closes the active MDI child, a group in Program Manager or a directory window in File Manager.
  - [[read out]] No accelerator table of Windows 3.1's own programs (`PROGMAN`, `WINFILE`, `WRITE`, `CALC`, `CARDFILE`, `CALENDAR`, `NOTEPAD`, `PBRUSH`, `PACKAGER`, `REGEDIT`, `WINHELP`, `SOUNDREC`, `SYSEDIT` and the rest of `C:\WINDOWS`) nor of the corpus's programs names F11 or F12 with any modifier; Shift+F4 (tile) and Shift+F5 (cascade) are Program Manager's and File Manager's, F1 to F9 are taken by many, Alt+F4 and Ctrl+F6 are USER's. [[documented]] Ctrl+Alt with a function key is the host's on Linux (a virtual terminal), and Ctrl+Alt with a key is what Program Manager's shortcut keys are made of.
  - [[inferred]] A program that reads F12 itself, outside an accelerator table, is not seen by such a reading; Word for Windows 2.0, not in the corpus, takes Ctrl+Shift+F12 to print. With images mounted it cannot have that chord.
- **Taking a disk out** is the simplest choice, as DOSBox has none: the drive becomes an `EmptyDrive`, removable, with no disk, so DOS answers it as no drive (error 0Fh) as DOSBox's empty floppy drive is answered. A CD-ROM drive emptied stays remote, so MSCDEX still counts it. A real drive's "not ready" (`INT 24h`) is not raised, as DOSBox never raises it ([[topic:cd-rom]]).
- **A file open across a swap.** A floppy's keeps the disk it was opened on, in both engines, as DOSBox's `fatFile` would ([[read out]]; DOSBox swaps no floppies, so unrecorded). A disc's reads the disc swapped in, but for the sector it last read, as [[probe:imgswap]] records under DOSBox; a disc taken out leaves it nothing to read.
- **Installing from floppies.** `--install NAME A: [SETUP.EXE]` runs the installer from the images at A: (`Store::stage_drive`): nothing is put on C:, so nothing of C: is dropped as media, and the lines the installer wrote that name `A:\` are told ([[format:layer]]). Program Manager, the run's shell, starts it there ([[topic:program-manager-dde]], "As the shell in install runs"): `ShellExecute` given its folder makes that drive current and its folder the current one, as a program's own folder is.
- **Remembered.** A program installed or run with `--mount` keeps its images in its record (`media`: each image's letter, kind, name, size and full path, a set's in order; a disc's cue sheet by its own path, its files found beside it again); `--program NAME` with no `--mount` mounts them again, at the same letters. An image no longer there is said, and the program runs without its images.

### The page's drives

The page (`run.html`, either engine) mounts images beside C: from its **Drives** strip (`src/run/drives.ts`, `src/run/main.ts`).

- **What an image is.** A file dropped or chosen that is not a zip is read with the TypeScript engine's own readers, as DOSBox's `imgmount` would mount it (`imageKind`): an `.iso` or `.bin` a disc (`ISO9660`); anything else a FAT volume (`FATImage`) -- a floppy where it is 2,880 KB or less, as `is_floppy` has it, a hard disk else -- and a disc where it holds no FAT, whatever it is named. Anything neither reader takes is read as before ([[topic:asset-bundle]]).
- **Cue sheets.** A `.cue` dropped or chosen is paired with the files it names among those dropped or chosen with it (`pairCues`, `cueFile`): by name without regard to case, else by the name's last part. With them all it is one disc, its files its tracks (`Disk.tracks`), read through them by both engines (`findIn`; the Rust engine's `ImageBytes.file`). Without them it asks for each by name -- `GAME.CUE wants GAME.BIN: drop or choose it too.`, and a row each under the drives -- and takes them from the files dropped or chosen next. A kept program remembers a sheet's files with it (`Medium.tracks`), kept and asked for again as the sheet is. A `.bin` alone is a raw disc.
- **Windows' disks or a drive.** A floppy's image goes to the asset maker only where there is no Windows on the page yet -- no installation, no bundle, none dropped with it -- or it is one of the Windows media WinBox knows: a file on it of a name, size and SHA-256 that `known-media.json` lists (`isKnownMedia`). Otherwise it is a drive, and so is every disc and hard disk image. Floppies taken for Windows' disks for want of Windows that the maker refuses (no `SETUP.INF` among them) are mounted as drives after all, and the status line says so. **Add images…** takes images as drives always.
- **Sets and letters** as natively (the owner's decision 3, `assignLetters`): floppies dropped together are one set, in the order of their names, numbers counted as numbers (`DISK2` before `DISK10`, `orderSet`), at A:, then B:; discs dropped together likewise, at the first free letter after the hard disks'; each hard disk image a drive of its own from D:. A kept program's letters are pinned.
- **The strip.** Each drive says where it is -- `A: Disk 2 of 6, DISK2.IMG`, `A: Empty (6 disks)` -- with a list to pick a disk, **Next** (the first after the last; on an empty drive the one after the disk taken out), **Eject**, **Insert** for an empty drive of one disk, **Save image…**, **Install** where an installer is on its disk, and **Remove**; images dropped on a drive's row go into its set, after its disks, the first of them put in. Each button is named for its drive for a screen reader (`Next disk in A:`, `Eject A:`, `Save the image in A:`). A drive changed while a program runs is changed under it, with nothing made afresh -- as an installer asking for its next disk wants -- each engine's `Files::swap` and `eject` (`Session::insert_disk`, `eject_disk`; `FileManager.swap`, `eject`). A swap keeps the drive's current folder, as `CycleAllDisks` does. The page has no swap key: Ctrl+Shift+F12 is the native build's.
- **Programs on a drive.** The Windows programs on each drive's disk are listed under Programs after C:'s (`programsOn`, folders walked four deep) and run from there: the program's drive is made current and its folder the current one, as the native build starts an installer from A:.
- **Writes** (the owner's decision 1). What programs write to a floppy or hard disk image is kept in its copy-on-write overlay, never in the file dropped. **Save image…** downloads the disk as programs wrote it as a new file, `<name>-saved.img`; the page never offers to write over the file, and so uses no save picker. A machine made afresh -- another display, Windows ended -- is given each disk as written (`Engine.carry`, `Disk.written`), so what was written is kept for the visit.
- **Where the bytes are** (the owner's decision 2). An image is read once into the page's memory and never copied into the browser's storage unless asked. Both engines read that one copy where it is: the TypeScript engine's `FATImage` and `ISO9660` over the same bytes, and the Rust engine through `ImageBytes`, a slice at a time into the module (`PageSectors`, `crates/winbox-web/src/lib.rs`), so a disc is never copied into its memory. Neither reads slices of the file itself: the TypeScript engine's readers read a sector at once and synchronously, and the Rust engine runs on the page's thread, where a `File` is read only asynchronously. A worker reading the file synchronously is a later step.
- **Kept programs' images.** A kept program remembers the images in the drives as it is kept, and as they change while it is open (`KeptProgram.media`: each image's letter, kind, name, size and key -- its name, size and last change, not hashed). The `images` store (IndexedDB `winbox-run` version 5) keeps of each no copy, only what the browser gives: a File System Access handle on its file, where it gives one (Chromium: a drop's `getAsFileSystemHandle`, or **Add images…** through `showOpenFilePicker`); or the image's bytes, where **Keep copies of a kept program's images in this browser** is ticked. Opened on a later visit, the program's images are put back in their drives from the copy, or from the handle once the browser grants leave to read it again, asked as Open is clicked; any other is asked for by name -- `Choose again, or drop, the images it is run with: GAME.ISO for D:` -- and a set is mounted once each of its images is had again, by a file of the same name and size. Forgetting a program lets go of what is kept of its images (`collect`).
- **Installing from floppies.** **Install** on a drive offers its installer -- `SETUP.EXE` or `INSTALL.EXE`, the shallowest (`installerOn`) -- as an archive's is offered ([[format:layer]], "On the page"): run from its drive over the base or a kept program's stack, nothing of its media put on C: (`installedLayer` with the media `A:\`), Program Manager, the run's shell, starting it there and making the drive current ([[topic:program-manager-dde]]), what it writes kept as a layer on **Keep**, and what it wrote that names `A:\` told. The floppies installed from are not remembered with the program, as a program installed needs them no more; a disc installed from is, as a program on a CD reads it as it runs.
- [[measured]] `e2e/run.spec.ts`, each engine, Chromium and Firefox: two floppies and a disc dropped beside an installation are A:, a set of two in the order of their names, and D:; [[probe:imgflop]] run from C: reads A: as Windows read it under DOSBox (its first entry `README.TXT 20 39 1a85 30e4`) and writes the overlay alone; **Save image…** downloads the disk as written; Next, Eject and the list swap it; on a machine made afresh the disk is as written, and [[probe:imgcd]] reads D:; a disc dropped on D:'s row goes in its set. [[probe:instlay]]'s installer and program written to a floppy by the page's own `FATImage` install from `A:\INSTALL\SETUP.EXE` into a layer of seven files (`PROGMAN.INI`, which Program Manager wrote, the seventh), `WIN.INI`'s `Media=A:\INSTALL\INSTLAYC.EXE` told, the floppy not remembered, and the program installed runs. A program kept with a disc in D: asks for it by name on the next visit, takes it chosen again and runs `imgcd` from it; with copies ticked, the disc is in D: as soon as the program is opened; forgotten, nothing of it is kept. `crates/winbox-web/tests/disks.rs` and `test/run/drives_test.ts` hold the rest: sets, swaps, the overlay, a program run from A:, kinds, order, letters, Windows' disks known, an installer found.

### How the images became drives

Each step has its probe agreeing in both engines:

1. **The oracle's groundwork:** the `.mounts` lists, the images and the probes above.
2. **Drives' kinds:** `Volume` gains `remote`, `label`, `media_byte` and `listing` (`Listing::Sorted` for a folder as DOSBox lists one, `AsStored` for an image), the TypeScript `FileSystem` the same; IOCTL 4408h, 4409h, 440Dh and 440Eh as DOSBox answers them; `GetDriveType` as `SYSTEM.DRV` works it out; MSCDEX's register calls. [[probe:drvioctl]] agrees for A:, C:, E:, Z: and the numbers past, [[probe:mscdex]] wholly.
3. **A FAT12 or FAT16 image read** ([[format:fat]]): one FAT reader for both by the count of clusters, as DOSBox chooses (`drive_fat.cpp` 700-711), over the image's sectors -- a floppy if 2,880 KB or less with no partition table, else a hard disk whose first partition is used, else sector 63 (660-678). Its stamps, order, attributes and room as above: [[probe:imgflop]]'s and [[probe:imghdd]]'s reads, and [[probe:drvioctl]]'s B:.
4. **Writes to a FAT image,** as DOSBox makes them, kept apart from the image (decision 1; [[format:fat]]): a copy-on-write overlay of sectors under each engine's FAT drive, DOSBox's `fatDrive` and `fatFile` followed function by function; [[probe:imgflop]], [[probe:imghdd]] and [[probe:imgwrite]] agree wholly in both engines. The image as written is there to be saved (`Files::image`, `FatVolume::image`; `FATImage.image`) for the page's "Save image…" and the native `--write-back`.
5. **ISO 9660 and MSCDEX with a disc** ([[topic:cd-rom]]): `isoDrive` followed function by function in both engines, and `DOS_MakeName`'s cuts and refusals on an image's drive; [[probe:imgcd]] and [[probe:drvioctl]] agree wholly.
6. **The native front end** (The native build's drives, above): `--mount A:disk1.img,disk2.img`, `--mount D:game.iso`, swapping a set's disks by commands on standard input and a key other than Ctrl+F4, which closes an MDI child; `--install` from A:. `Files::swap` and `Files::eject` in the Rust engine, `FileManager.swap` and `eject` in the TypeScript one, with `EmptyDrive` in each; `--write-back` and `a save`; a program's images remembered.
7. **The page** (The page's drives, above): images dropped beside Windows as drives, a strip of drives with Next and Eject for a set of floppies, installing from floppies, a program's CD remembered. `Session::add_disk`, `insert_disk`, `eject_disk` in the Rust engine's page module, read through the page's bytes; the TypeScript engine's `FATImage` and `ISO9660` mounted on its `FileManager`; `Files::unmount` beside `FileManager.unmount`.
8. **Swapping a disk with a file open on it:** [[probe:imgswap]] recorded (the oracle presses DOSBox's swap key at the probe's request) and agreeing wholly in both engines ([[topic:cd-rom]], "Swapping a disc").
9. **CUE/BIN images' data track** ([[topic:cd-rom]], "Cue sheets and raw images"): [[probe:imgbin]], [[probe:imgcue]], [[probe:imgcue2]] and [[probe:imgtrk]] agreeing wholly; natively `--mount D:game.cue`, and on the page a `.cue` with its files.

The owner's decisions (2026-10-22):

- **Floppy writes:** copy-on-write. The user's image is never changed; what is written is kept beside it, and saved as a new image on request ("Save image…", `--write-back`).
- **ISO storage on the page:** no copy of a read-only image. Where the browser offers it, a File System Access handle, whose permission is asked again each visit; elsewhere the file is chosen or dropped again each visit and read where it is, by slices. A copy in the browser's storage only when asked for. Not yet as decided: the page reads the image once into its memory and the engines read that copy, the Rust engine a slice at a time; reading the file itself by slices, from a worker, is still to do (The page's drives, "Where the bytes are"; Not yet done).
- **Drive letters:** floppies A: and B:; hard disk images from D:; CD-ROMs at the first free letter after, one after another, each program's kept.
- **DOSBox's quirks on a FAT image** -- creation stamps listed, nought stamps written, no label found -- followed as recorded.
- **CUE/BIN:** the data track only, after ISO; audio later. **Hard disk images:** later, raw only.
- **MSCDEX with no disc:** answered as DOSBox does.

## Sectors

- [[read out]] File Manager reads each drive's boot sector with `INT 25h` and takes one whose media byte is F8h with one FAT for a RAM drive (`WINFILE.EXE` seg6 `09e3`-`09fd`). The TypeScript engine reads the sector from its disk, or answers AX 8002h with the carry set where there is no disk; the Rust engine's drives are files, not sectors, and answer so. `INT 25h` and `26h` return with the flags still on the stack. The Rust engine stopped at the interrupt, and File Manager never opened.

## Not yet done

- Functions 1Bh, 1Ch, 1Fh and 32h: a drive's allocation and its parameter block. The parameter block's pointer would need a selector over a table of the engine's own.
- Images as drives: hard disk images of other layouts, MSCDEX's buffer calls (below), CD audio, and `INT 25h` and `26h` as DOSBox answers them (it reads nothing, `dos.cpp` 1095-1118). [[format:fat]] has what is left of a FAT image, [[topic:cd-rom]] of a disc.
- The page reading an image from its file a slice at a time, with no copy in memory: a worker reading synchronously (`FileReaderSync`, or an OPFS file's synchronous handle) for the Rust engine, and the TypeScript engine's readers made to wait for a sector. Both hold an image in memory now, once.
- On the page, what is written to a floppy is kept for the visit, and saved only as a new file; it is not kept with a kept program from one visit to the next.
- A handle's leave to read is asked again on each visit, as the browser has it; Firefox and Safari give no handle, and a kept program's images are chosen again there unless a copy is kept.
- A floppy's overlay from one native run to the next: what is written is kept for the run, and saved only as a new image. Running again mounts the image as it was.
- What Windows' own programs make of a disk swapped under them -- File Manager's window of the drive, an installer's prompt for its next disk -- with no probe of their own; and MSCDEX's media-changed answer, a buffer call ([[topic:cd-rom]]).
- IOCTL 4404h, 4405h and 4411h, and 440Dh's minor codes other than 46h, 60h and 66h, which DOSBox refuses with error 1.
- MSCDEX's calls with a buffer, and 1100h's word on the caller's stack.
- The BIOS's equipment word itself, `INT 11h`: neither engine answers it. `GetDriveType` counts each removable drive with a disk in it as DOSBox's BIOS counts a floppy image mounted.
- B: under DOSBox is selectable with nothing mounted; a session here without B: has none, and answers 0 for it as DOSBox does -- but with two floppy images DOSBox's B: would answer 2. Unrecorded.
- The stamps of the root's `.` and `..`, which are the host folder's and its parent's under DOSBox, and unmeasured. Both engines give the root's own stamp to both. The TypeScript engine's root stamp is held in memory, and the Rust engine's for a drive held in memory is not among its changes, so neither is kept from one visit to the next.
- A search's attributes as DOSBox gives them: only a folder's bit or the archive bit, from the host (`drive_local.cpp` 255-266). The engines give each file's own.
- Long names on the host, which DOSBox lists by short names it makes (`CreateShortName`) and sorts by them.

## In winbox.js

- `src/win16/kernel/GetDriveType.ts` and `src/win16/user/wnet.ts` hold the Windows calls; the Rust engine's `drive_type` is in `modules_kernel.rs`.
- `src/dos/syscall/diskSpace.ts` and `src/dos/syscall/ioctl.ts` hold the DOS functions, and `DOS.absoluteDisk` and `DOS.multiplexInterrupt` in `src/dos.ts` the interrupts; the Rust engine's are `drive_ioctl` in `dos.rs` and `multiplex_interrupt` in `run.rs`.
- A FAT disk image is `FatVolume` (`crates/winbox-machine/src/files/fat.rs`, `files/mbr.rs`) and `FATImage` (`src/file-systems/fat-image.ts`, `fat-drive.ts`), [[format:fat]]; what is written to it, an `Overlay` (`files/overlay.rs`) and an `OverlayDisk` (`src/file-systems/overlay-disk.ts`). An ISO 9660 disc is `IsoVolume` (`files/iso.rs`) and `ISO9660` (`src/file-systems/iso9660.ts`), [[topic:cd-rom]].
- A drive's kind is the `Volume` trait's (`crates/winbox-machine/src/files.rs`): `removable`, `remote`, `label`, `media_byte`, `listing`; `Files::has_disk` and `Files::floppy_disks` from them. The TypeScript engine's `FileSystem` has the same getters (`src/file-system.ts`).
- The page's drives are `src/run/drives.ts` (kinds, sets, letters, Windows' disks known, programs on a drive) and the Drives strip in `src/run/main.ts`; each engine's side is `Session::add_disk` and its kin (`crates/winbox-web/src/session.rs`, `ImageBytes` in `lib.rs`) and the TypeScript engine's `mount`, `insert` and `eject` (`src/run/engines/ts.ts`).
- A disk swapped is `Files::swap` and `Files::eject` (`files.rs`), an empty drive `EmptyDrive` (`files/empty.rs`); the TypeScript engine's `FileManager.swap` and `eject` (`src/dos/file-manager.ts`) and `EmptyDrive` (`src/file-systems/empty-drive.ts`). The native build's `--mount`, sets, commands and key are `crates/winbox-native/src/mounts.rs`, `console.rs` and `input.rs`. A disc's file across a swap is `DiscFile` and `Volume::give_disc` (`files/iso.rs`), `DiscFile` and `giveDisc` (`iso9660.ts`). [[measured]] `swaps_a_disk_keeping_the_folder_and_what_was_written`, `a_discs_file_reads_the_disc_swapped_in` and `ejects_a_disk_leaving_the_drive_empty` (`files.rs`), `test/dos/swap_test.ts`, and `mounts/tests.rs` (letters, sets, swaps, saves, the images left as they were, a program's images remembered).
