---
kind: topic
name: CD-ROM drives
summary: What a Windows 3.1 program sees of a CD-ROM drive under DOSBox — MSCDEX's register calls with and without a disc, a disc's drive as IOCTL and GetDriveType answer for it, and an ISO 9660 image's names, stamps, attributes and room — measured, read out of DOSBox's isoDrive, and followed function by function in both engines.
probes: [mscdex, imgcd, drvioctl]
---

Programs of the time find their CD-ROM by asking MSCDEX through `INT 2Fh`, then read its files through DOS like any drive's. Under DOSBox, where the oracle's Windows runs, a disc is an ISO 9660 image mounted with `IMGMOUNT -t iso` (see [[topic:drives-and-disks]], "Disk and CD images", for how the probes mount one and the design that will mount one here).

## MSCDEX

- [[measured]] [[probe:mscdex]], with no disc: 1500h answers AL FFh -- installed -- BX 0 drives, CX as it was; 150Bh answers AX 0 and BX ADADh for every drive; 150Ch BX 0217h, version 2.23; 1100h AL FFh.
- [[measured]] [[probe:imgcd]], a disc as D:: 1500h BX 1, CX 3 (D:, from nought for A:); 150Bh AX 5AD8h for D:, nought for the others.
- [[read out]] DOSBox installs its own MSCDEX whether or not a disc is mounted (`dos_mscdex.cpp` 1312-1322).
- Both engines answer these four as DOSBox does, a drive removable and remote counted a CD-ROM ([[topic:drives-and-disks]], "MSCDEX").

## The drive

- [[measured]] [[probe:imgcd]]: IOCTL 4408h is error 1; 4409h DX 1000h, remote; 440Dh and 440Eh error 1; `GetDriveType` 4, `DRIVE_REMOTE`. [[read out]] `isoDrive` is remote and removable (`drive_iso.cpp` 374-380), and `SYSTEM.DRV` takes a remote drive for `DRIVE_REMOTE` before asking anything else.
- [[measured]] 36h: 1 sector to a cluster, nought free, 2,048 bytes to a sector, 60,000 clusters, whatever the disc.

## The disc's files

- [[measured]] Names lose their `;1` and a trailing dot, are cut to eight characters before the dot and twelve in all, and are listed in capitals, in the disc's order. The root has no `.` and `..`; a folder lists them first. A folder whose name was cut cannot be entered by either name.
- [[measured]] A file is found by its listed name, its whole name, in either case.
- [[measured]] Attributes listed: 20h a file, 10h a folder, 02h added where the record is marked hidden. 4300h adds read-only: 21h, 23h, 31h.
- [[measured]] Stamps are the record's own, the offset from GMT ignored.
- [[measured]] The label search answers the volume's name made 8.3 with a dot: `WINBOXCD.202` for `WINBOXCD2026`.
- [[measured]] Making, deleting and renaming a file answer error 2, making a folder error 3.
- [[measured]] A name DOS will not take is refused before the disc is asked: `README.TXT;1` is error 3, path not found. [[read out]] `DOS_MakeName` (`dos_files.cpp` 58-180) takes letters, digits, the punctuation ``\$#@()!%{}`~_-.*?&'+^`` and five bytes above 7Fh, drops spaces, and refuses anything else with error 3, and a name with a second dot after its first with error 2 (3 for a folder's); it cuts each name to eight characters before its dot and three after, so `A_VERY_LONG_FILE_NAME.TEXT` reaches the disc as `A_VERY_L.TEX` and `LONGNAMEDFOLDER` as `LONGNAME`, which no record's twelve characters match.

## Inside DOSBox

[[read out]] `isoDrive` (`drive_iso.cpp`), with its image read through `CDROM_Interface_Image` (`cdrom_image.cpp`):

- **The track.** An `.iso` is one data track whose sectors are the first of four layouts with a primary volume descriptor at sector 16: 2,048-byte sectors, 2,352 with the data 16 bytes in, or mode 2's 2,336 or 2,352 with it 24 in (`LoadIsoFile`, `CanReadPVD`, 350-404). A sector past the image's whole sectors is not read. Sector 16 must be type 1, `CD001`, version 1, and its root record readable, or the image is not mounted (`loadImage`, 516-526). No other descriptor is looked at: no Joliet, no Rock Ridge.
- **A record** (`readDirEntry`, 476-514) is copied over the one read before it, as many bytes as its first says. One with extended attributes, interleaving, a name longer than the record or than 200 bytes is not read -- and ends its folder's listing and lookup there, since `GetNextDirEntry` then answers false. A folder's own two are `.` and `..`; a file's name ends at its first `;`, loses a dot at its end; then any name is cut to eight characters before its first dot when that dot is further in, and to twelve.
- **Searching.** A folder is read through one of the drive's 2,048 directory iterators, taken in turn and let go as a search ends (`GetDirIterator`, `FreeDirIterator`, 390-452); its number is kept in the search's record, the word at 0Dh. `FindFirst` (250-284) looks the folder up -- folder or not -- and takes an iterator; with the label's attribute alone it answers the label, wherever it is asked, or no more files where the disc has none; with the label's among others, in the root, the label first where the pattern takes it. `FindNext` (286-323) passes over `.` and `..` in the root, and a folder or hidden record not asked for; a name is listed upper case, its size its data's length, 10h a folder else 20h, with 02h where the record's existence bit is set.
- **Looking up** (`lookup`, 528-562) goes from the root, name by name, a dot at the end of each taken off, comparing at most 37 characters without regard to case.
- **Files.** `FileOpen` (204-223) refuses a file opened to write alone, access denied -- and DOS's `DOS_OpenFile` then answers 5 where the file is there; a file opened to read and write is opened, but every write fails. Reads stop at the end of the file, a seek outside it puts it at its end (`isoFile`, 63-123). A file's stamp is its record's, packed by `DOS_PackDate` and `DOS_PackTime` with their masks (`dos_inc.h` 220-226). 4400h answers 40h with the drive (`GetInformation`, 130-132). 4301h on a disc is access denied before the file is looked for (`DOS_SetFileAttr`, `dos_files.cpp` 643-656).
- **The label** is the volume's name as MSCDEX reads it -- sector 16's bytes from 40, at most 31, white space at the end taken off (`GetVolumeName`, `dos_mscdex.cpp` 561-597) -- made by `Set_Label` with `cdrom` true (`drives.cpp` 80-108): eight characters, a dot, three, case kept, and a dot left at the end where it is the ninth.

## In WinBox

- An ISO 9660 image is `IsoVolume` (`crates/winbox-machine/src/files/iso.rs`) and `ISO9660` (`src/file-systems/iso9660.ts`), each `isoDrive`'s functions by their names: the track found as `LoadIsoFile` finds it, records copied over one another, the 2,048 iterators taken and let go in turn, `lookup`, `FindFirst`, `FindNext`, `GetFileAttr`, `isoFile`'s reads and seeks. Its search is begun by `Volume::find_first` / `ISO9660.findFirst` and carried on through the iterator its record names (`find_from`).
- Both engines' DOS follows `DOS_MakeName` on an image's drive, a disc's or a FAT's (`dos_name` and `make_name_error` in `dos.rs`; `dosName`, `makeNameError` and `refusedName` in `src/dos/syscall/directory.ts`), and opens the name it made; a disc's file opened to write alone is refused, and why a file is not opened is told as `DOS_OpenFile` tells it (`open_path`, `open_error`; `open.ts`).
- Both harnesses mount a probe's `iso` images (`image_volume`, `imageDrive`). [[probe:imgcd]] agrees wholly, 91 of 91 records, and [[probe:drvioctl]] 64 of 64, in both engines; [[probe:mscdex]] still 31 of 31.
- MSCDEX counts a drive removable and remote a CD-ROM, so a disc mounted answers 1500h and 150Bh as `imgcd` recorded.

## Not yet done

- Mounting a disc on the page (phase 7 of the design in [[topic:drives-and-disks]]). The native build mounts one (`--mount D:GAME.ISO`), read from its file as sectors are asked for, and swaps a set of discs ([[topic:drives-and-disks]], "The native build's drives").
- A write to a disc's file opened to read and write: DOSBox's `isoFile::Write` fails and DOS answers whatever error it last set (`dos.cpp` 590-603), which neither engine keeps; both answer 5.
- `DOS_MakeName` on a folder's drive, C: among them: both engines take any name there, cut nothing and refuse nothing, where DOSBox does as on an image.
- MSCDEX's calls that take a buffer (1501h, 1505h, 150Dh, 150Fh, 1510h), which through Windows need DPMI's real-mode calls and memory below 1 MB.
- CUE/BIN images, their data track and then CD audio.
- A swapped disc with a file open on it: [[read out]] DOSBox's `isoFile` reads through MSCDEX, which the new disc's `Activate` points at the new image (`drive_iso.cpp` 200-202, 472), so it reads the new disc; both engines' `DiscFile` keeps reading the disc it was opened on. Phase 8 (`imgswap`).
