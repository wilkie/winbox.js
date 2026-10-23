---
kind: format
name: FAT disk images
summary: A floppy's or hard disk's FAT12 or FAT16 volume in an image file, as DOSBox 0.74-3's IMGMOUNT reads it — where the volume begins, FAT12 or FAT16 by its count of clusters, the boot sector's fields, the FAT's entries, a directory's slots and what a search makes of them — and how each engine mounts one as a drive, read only for now.
probes: [imgflop, imghdd]
---

The oracle's Windows ran under DOSBox, and a disk image a program finds there is one DOSBox's `IMGMOUNT` mounted: a raw image of a floppy or a hard disk, a sector after another. What a program sees of the image is what DOSBox's `fatDrive` makes of it (`src/dos/drive_fat.cpp`), and that is not always what MS-DOS would make of the same disk. [[topic:drives-and-disks]] has the drive's kind, its IOCTL answers and the design these images are part of.

## Where the volume is

- [[read out]] An image of 2,880 KB or less, its size counted in whole KB, is a floppy, and its volume begins at its first sector (`fatDrive::fatDrive`, `drive_fat.cpp` 645-654, 676-679). A larger one is a hard disk, whatever `-t` said.
- [[read out]] A hard disk's first sector is a master boot record. Its four partition entries are 16 bytes each from offset 1BEh. DOSBox takes the first whose size, the entry's bytes 12-15, is not nought, and the volume begins at the entry's first sector, bytes 8-11. With no such entry it begins at sector 63 (654-675). A table without 55h AAh at its end is only logged, and read all the same (660).
- [[measured]] [[probe:imghdd]]'s image, 6 cylinders of 16 heads and 63 sectors with one partition from sector 63, lists as its FAT16 volume holds it.

## The boot sector

The volume's first sector holds the BIOS parameter block. The offsets DOSBox reads:

| Offset | Size | Field                                               |
| ------ | ---- | --------------------------------------------------- |
| 0Bh    | 2    | bytes to a sector                                   |
| 0Dh    | 1    | sectors to a cluster                                |
| 0Eh    | 2    | reserved sectors, the boot sector among them        |
| 10h    | 1    | copies of the FAT                                   |
| 11h    | 2    | entries in the root directory                       |
| 13h    | 2    | sectors on the volume, nought where 20h holds them  |
| 16h    | 2    | sectors to a FAT; nought on FAT32, which is refused |
| 20h    | 4    | sectors on the volume, when 13h is nought           |

- [[read out]] The root directory follows the FATs, and the first cluster, cluster 2, follows the root's sectors. Its clusters are the sectors after the root divided by the sectors to a cluster (`drive_fat.cpp` 696-709).
- [[read out]] **FAT12 or FAT16 is the count of clusters, not the boot sector's word for it**: fewer than 4,085 is FAT12, fewer than 65,525 FAT16, else FAT32 (711-721). A FAT with no sectors to it, FAT32's, is not mounted (687-691).
- [[measured]] [[probe:imgflop]]'s floppy, 2,880 sectors of one to a cluster, has 2,847 clusters and is FAT12; [[probe:imghdd]]'s has 5,921 and is FAT16.

## The FAT

- [[read out]] A FAT16 entry is the word at twice the cluster's number. A FAT12 entry is twelve bits of the word at one and a half times it: the low twelve for an even cluster, the high twelve for an odd one (`getClusterValue`, 289-335). A chain ends at FF8h and above, FFF8h on FAT16 (516-536). An entry of nought is a free cluster.
- [[read out]] Every copy of the FAT is written alike (388-394). Nothing here writes one yet.

## A directory

- [[documented]] Each entry is 32 bytes: the name (8) and extension (3), the attributes (0Bh), the creation time (0Eh) and date (10h), the last access date (12h), the time (16h) and date (18h) last written, the first cluster (1Ah) and the size (1Ch). A first byte of E5h marks a deleted entry, and of nought the end of the directory.
- [[read out]] A search reads the folder's slots one after another, the root's from its own sectors, a folder's along its chain (`FindNextInternal`, 898-960). It passes over a deleted entry and every entry with the volume label's bit, 08h: the label, and a long name's VFAT entries, whose attributes are 0Fh. It stops at a slot whose first byte is nought.
- [[read out]] **The date and time it gives are the creation stamp's**, bytes 0Eh-11h, not the last write's (957). So does 5700h for a file opened (`fatFile`'s time and date, 809-810, 833-834).
- [[read out]] The name is the eight characters and the three trimmed of spaces, joined by a dot where there is an extension; a file with no extension has a dot added all the same (945-948). The attributes are the entry's own byte.
- [[read out]] The search's place is its slot, kept in the search's record, and the next call reads that slot again from the disk (`SetDirID`, 927-928). What has changed in the folder since is what it finds.
- [[read out]] A search for the label alone, attribute 08h, answers the drive's label, and a FAT drive has none: error 18, no more files (`FindFirst`, 857-867).
- [[measured]] [[probe:imgflop]]: the root lists `README.TXT`, `ZEBRA.TXT`, `APPLE.TXT`, `LONGFI~1.TXT`, `DATA.BIN`, `SUBDIR`, `HIDDEN.SYS` -- the order they were copied, with no `.` or `..`, the label, the deleted entry and the long name's entries passed over. `README.TXT`, created 1993-04-05 06:07:08 and written 1992-03-10 03:10:00, lists as date 1A85h, time 30E4h. A subfolder lists its own `.` and `..` first, as its slots hold them.

## Room

- [[read out]] Function 36h answers the volume's own figures: the sectors to a cluster, 512 bytes to a sector, its clusters, and those whose FAT entry is nought free, each count at most FFFFh (`AllocationInfo`, 730-751).
- [[measured]] [[probe:imgflop]]'s floppy: 1 sector to a cluster, 2,832 of 2,847 free. [[probe:imghdd]]'s: 1, 5,917 of 5,921.

## In each engine

Both mount an image the same way, and agree with every record [[probe:imgflop]] and [[probe:imghdd]] make before they write.

- **Rust:** `FatVolume` (`crates/winbox-machine/src/files/fat.rs`) over a `Sectors` trait (`files/mbr.rs`), an image's bytes held in memory for now; a file of the host's is to come for the native build. `volume_start` and `is_floppy` find the volume as above. It is a `Volume` whose `listing` is `Listing::AsStored`, mounted with `Files::mount_boxed` where the kind of drive is chosen as the program runs. `Files::list` gives its folders as it holds them, with neither the attributes set beside a folder's drive nor the folders' stamps kept for one (`Files.attributes`, `Files.folders`). A file is opened as an `ImageFile`, its bytes read as it is opened.
- **TypeScript:** `FATImage` (`src/file-systems/fat-image.ts`), a `FAT16` volume over a `Disk` filled from the volume's bytes, mounted at an explicit letter. `FAT16` reads 12-bit entries as well as 16-bit ones; `mount({ byClusters: true })` chooses by the count of clusters as DOSBox does. The volumes the engine formats itself -- the page's C: among them -- stay FAT16 whatever their count, as `format` writes them, byte for byte as before (`test/file-systems/fat_image_test.ts`). The search (`src/dos/syscall/find.ts`) lists a `stored` drive as the image holds it, and `FileManager.changed` leaves its folders' stamps alone.
- Both refuse to write to an image for now: a file made, 3Ch, error 5; a folder made, 39h, error 5; a rename, 56h, error 2; a deletion, 41h, error 2; attributes set, 4301h, error 5; and a write to a file opened on it writes nought bytes.
- An image with no label of its own has none for COMMDLG's list of drives either, not the `D_DRIVE` a folder DOSBox mounts is given.

## Not yet done

- Writing to an image, as DOSBox writes (`fatDrive::FileCreate` and the rest): a file made has a zeroed entry with the attributes it was made with, and lists with date and time nought, as [[probe:imgflop]] records. The owner's decision is that what is written is kept apart from the image, a sector at a time, and saved as a new image only when asked. Until then `imgflop`'s and `imghdd`'s `write` and `after` records are known gaps.
- A search carried on from its slot, as DOSBox's is: the engines carry one on from the names the folder held as it began, which for a folder nothing writes to is the same.
- A file with no extension, which DOSBox lists with a dot after its name. No image the probes mount has one, and the engines list it without.
- A seek past a file's end, which DOSBox's `fatFile::Seek` stops at the end (255); the engines go past it, as on C:.
- `INT 25h` on an image drive: the TypeScript engine reads the volume's sectors, as DOSBox would not ([[topic:drives-and-disks]]).
- A hidden folder in a path: DOSBox's search for each folder of a path asks only for folders, so a hidden one cannot be passed through (`getDirClustNum`, 478-488). Unrecorded.
