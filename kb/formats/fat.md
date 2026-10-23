---
kind: format
name: FAT disk images
summary: A floppy's or hard disk's FAT12 or FAT16 volume in an image file, as DOSBox 0.74-3's IMGMOUNT reads and writes it — where the volume begins, FAT12 or FAT16 by its count of clusters, the boot sector's fields, the FAT's entries, a directory's slots and what a search makes of them, what a write makes of them — and how each engine mounts one as a drive, what is written kept apart from the image.
probes: [imgflop, imghdd, imgwrite]
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
- [[read out]] An entry is set in the first FAT's sector, and that whole sector is then written over the same sector of every copy -- the next sector too where a FAT12 entry is at its last byte, 511 (`setClusterValue`, 337-395). A copy that differed from the first becomes the first's, a sector at a time.
- [[read out]] DOSBox keeps the FAT sector it last read in one buffer for all its FAT drives (`fatSectBuffer`, `curFatSect`, 40-41, 309-315), told apart by the sector's number alone.

## A directory

- [[documented]] Each entry is 32 bytes: the name (8) and extension (3), the attributes (0Bh), the creation time (0Eh) and date (10h), the last access date (12h), the time (16h) and date (18h) last written, the first cluster (1Ah) and the size (1Ch). A first byte of E5h marks a deleted entry, and of nought the end of the directory.
- [[read out]] A search reads the folder's slots one after another, the root's from its own sectors, a folder's along its chain (`FindNextInternal`, 898-960). It passes over a deleted entry and every entry with the volume label's bit, 08h: the label, and a long name's VFAT entries, whose attributes are 0Fh. It stops at a slot whose first byte is nought.
- [[read out]] **The date and time it gives are the creation stamp's**, bytes 0Eh-11h, not the last write's (957). So does 5700h for a file opened (`fatFile`'s time and date, 809-810, 833-834).
- [[read out]] The name is the eight characters and the three trimmed of spaces, joined by a dot where there is an extension; **a file with no extension has a dot added all the same**, a folder not (945-948). The attributes are the entry's own byte. A name is matched by `WildFileCmp` (`drives.cpp` 27-77), which splits each at its last dot, so `NOEXT.` is found as `NOEXT` too.
- [[measured]] [[probe:imgwrite]]: `NOEXT`, copied to the image with no extension, lists as `NOEXT.`; it opens as `A:\NOEXT`, `A:\NOEXT.` or `A:\noext`, and the patterns `NOEXT` and `NOEXT.*` find it. A file made as `A:\BARE` lists as `BARE.`.
- [[read out]] **The search's place is its slot**, kept in the search's record -- the word at 0Dh, the folder's first cluster the word at 0Fh (`sDTA`'s `dirID` and `dirCluster`, `dos_inc.h` 473-486) -- and the next call reads on from that slot from the disk (`SetDirID`, 927-928). What has changed in the folder since is what it finds: an entry made in a slot it has passed is not found, one made in a slot ahead is, and one renamed into a slot ahead is found again under its new name. The slot is kept as the search goes, so a search over goes on from past the slot that ended it.
- [[measured]] [[probe:imgwrite]], a folder `SEARCH` of `.`, `..`, `B2.TXT`, a deleted slot, `A3.TXT`, `A4.TXT`: a search of `*.TXT` that renames `B2.TXT` to `C2.TXT` after finding it finds `B2.TXT`, `C2.TXT`, `A3.TXT`, `A4.TXT` -- the new name in the deleted slot ahead. One that makes `D5.TXT` and `E6.TXT` after finding `C2.TXT` finds `E6.TXT`, at the end, and not `D5.TXT`, in the slot it passed. A file made after a search is over is not found by its next call (error 18).
- [[read out]] A path's folders are looked for each by a search for folders alone (`getDirClustNum`, 465-499; `getFileDirEntry`, 418-463), which passes over a hidden or system folder: **a hidden folder cannot be passed through.** A file is looked for by a search for hidden, system and read-only files, which passes over a folder.
- [[measured]] [[probe:imgwrite]]: `HIDDIR`, hidden, lists with 12h, and 4300h answers 12h for it -- `GetFileAttr` falls back to its parent's slots by the eleven characters (969-996) -- but `A:\HIDDIR\INSIDE.TXT` opens as error 3, 4300h of it answers 2, a search in it 3, changing to it 3, removing it 3, deleting the file in it 2, and making a file or a folder in it 3.
- [[read out]] A search for the label alone, attribute 08h, answers the drive's label, and a FAT drive has none: error 18, no more files (`FindFirst`, 857-867).
- [[measured]] [[probe:imgflop]]: the root lists `README.TXT`, `ZEBRA.TXT`, `APPLE.TXT`, `LONGFI~1.TXT`, `DATA.BIN`, `SUBDIR`, `HIDDEN.SYS` -- the order they were copied, with no `.` or `..`, the label, the deleted entry and the long name's entries passed over. `README.TXT`, created 1993-04-05 06:07:08 and written 1992-03-10 03:10:00, lists as date 1A85h, time 30E4h. A subfolder lists its own `.` and `..` first, as its slots hold them.

## Writing

DOSBox writes to the image's file as a program writes to the drive (`fopen(..., "rb+")`, 642); each function below is `fatDrive`'s or `fatFile`'s, and [[probe:imgflop]], [[probe:imghdd]] and [[probe:imgwrite]] record what comes of them through Windows.

- [[read out]] **A file made** (`FileCreate`, 773-814) where none is has an entry of noughts but for its eleven characters, upper case, and the attributes 3Ch was given (795): no stamp, no cluster, no size. It goes in the folder's first slot deleted or never used (`addDirectoryEntry`, 1070-1110), a subfolder grown by a zeroed cluster where it has none, the root not past its room. Made where a file is, the file keeps its entry, attributes and clusters, its size nought: **its clusters are lost**, for the first write takes new ones.
- [[measured]] [[probe:imgflop]]: `NEW.TXT`, made with 3Ch, written nine bytes and closed, then renamed, lists as `RENAMED.TXT 00 9 0000 0000`. [[probe:imgwrite]]: `ONE.TXT` made again over itself is nought bytes long and the room is as it was; one byte written takes another cluster. `HID.TXT` made with 02h lists hidden; a search without 02h does not find it.
- [[read out]] **Nothing is stamped**: not as a file is made, not as it is written, not as it is closed (`Close`, 270-275, writes only its sector back). 5700h answers the creation stamp the entry had as the file was opened (809-810, 833-834), and 5701h does nothing at all (`dos.cpp` 807-809). 4301h only looks for the file (`DOS_SetFileAttr`, `dos_files.cpp` 643-656).
- [[measured]] [[probe:imgwrite]]: 5701h on a file made answers success and 5700h answers 0000h 0000h, before and after it is opened again; 5700h of `BIG.TXT` answers its creation stamp, 0021h 0000h. 4301h of `TWO.TXT` to hidden and read-only answers success, and 4300h still 20h.
- [[read out]] **A write** (`fatFile::Write`, 160-236) to a file of no clusters takes the first free cluster (`getFirstFreeClust`, 753-761); writing on past the end of its chain adds the first free cluster, zeroed (`appendCluster`, 569-600). A sector is written as the write leaves it, and the last as the write ends; then the entry is read again and its size and first cluster written, nothing else. The next sector is looked for as soon as a sector is filled, so **a write that ends at the end of its chain's last cluster takes one more**. A write of nought bytes cuts nothing: it writes its sector back and the entry as it was.
- [[measured]] [[probe:imgwrite]]: `GROW.TXT`, 1,024 bytes written to it at once, two clusters' worth, takes three (0B11h free before, 0B0Eh after). Nought bytes written at byte 100 of `BIG.TXT` leave it 1,000 bytes long.
- [[read out]] **A file open** (`fatFile`, 43-105) keeps its own copy of the sector it is at, read as it is opened and as it is moved, and writes it back as it is closed, whether anything was written to it or not (270-275). A file open twice does not see the other's writes in its sector, and its close puts back what it read.
- [[measured]] [[probe:imgwrite]]: `STALE.TXT`, `AAAA`, opened to write and to read: `BBBB` written through the one, the other reads `AAAA`; the first closed, the file reads `BBBB`; the second closed, `AAAA` again.
- [[read out]] **A seek** (`fatFile::Seek`, 238-268) goes no further than the file's end, and before its start to its end: the offset from the start, from where it is or from the end, taken as signed, then compared unsigned with the length. A file opened to read alone refuses a write, error 5, and one opened to write alone a read (108-111, 163-166).
- [[measured]] [[probe:imgwrite]], `BIG.TXT` of 1,000 bytes: a seek to 5,000 answers 1,000; to 10 before the end, 990, and 16 bytes read give 10; to 2,000 before where it is, 1,000; to 100 past the end, 1,000; to -5 from the start, 1,000. A write to a file opened to read is error 5, nought written; a read from one opened to write, error 5.
- [[read out]] **A file deleted** (`FileUnlink`, 843-855) has E5h put first in its entry and its chain freed; a folder is not found so, and not deleted. **A folder made** (`MakeDir`, 1123-1173) takes the first free cluster, zeroed, before its parent is looked for; its entry has its name and 10h alone, then `.` and `..` in its cluster, each 10h, `..` pointing at the parent, nought for the root. It is refused only where a folder of its name is: **a file of its name does not stop it.** **A folder removed** (`RemoveDir`, 1175-1226) must have no slot past its first two that is not deleted. **A rename** (`Rename`, 1228-1265) puts a copy of the entry, the new name in it, in the target folder's first free slot, then deletes the old: a folder is not found, and so not renamed.
- [[read out]] DOS's own checks around them (`dos_files.cpp`): 39h refused is access denied where the folder is there, else path not found (217-233); 3Ah is path not found where a search for folders does not find it, 10h for the current folder, else access denied (235-261); 56h is access denied where the new name is there, file or folder, file not found where the old is not, or the drive's rename fails (263-296); 3Dh of a folder is access denied (517-523), and a file not found is path not found where its folder is not there either (`PathExists`, 447-459); 3Ch that the drive refuses is file not found where its folder is there (501-504); 41h the drive refuses is file not found (621-630); 4300h not found is file not found (632-641).
- [[measured]] [[probe:imgwrite]]: a folder made, again (5), a file in it, removed full (5), the file deleted, removed (0), removed again (3). `TWO.TXT` renamed into `SUBDIR` lists there after `.` and `..`; `SUBDIR` renamed answers 2, deleted with 41h 2, opened 5; `THREE.TXT` renamed onto `BIG.TXT` 5. A folder made in the hidden folder answers 3, and the room is a cluster less.
- [[measured]] [[probe:imgwrite]]: **a folder made with the name of a file** (`THREE.TXT`) is made, at the end of the root; 4300h of the name then answers the file's 20h. **A file made with the name of a folder** (`SUBDIR`) answers 2 -- its entry put in the root, then not found, for the search for the path finds the folder first -- and lists as `SUBDIR.`; the folder still lists, opens as 5 and lists its files.

## Room

- [[read out]] Function 36h answers the volume's own figures: the sectors to a cluster, 512 bytes to a sector, its clusters, and those whose FAT entry is nought free, each count at most FFFFh (`AllocationInfo`, 730-751).
- [[measured]] [[probe:imgflop]]'s floppy: 1 sector to a cluster, 2,832 of 2,847 free. [[probe:imghdd]]'s: 1, 5,917 of 5,921.

## In each engine

Both mount an image the same way, read and write it as DOSBox does, and agree with every record [[probe:imgflop]], [[probe:imghdd]] and [[probe:imgwrite]] make.

- **What is written is kept apart** (the owner's decision of 2026-10-22): each engine's FAT drive reads and writes sectors through an overlay over the image's -- `Overlay` (`crates/winbox-machine/src/files/overlay.rs`), `OverlayDisk` (`src/file-systems/overlay-disk.ts`) -- which keeps each 512-byte sector written, by its number in the image, and leaves the image's own bytes untouched. A sector written as it already was is not kept. The image as written is `FatVolume::image` and `Files::image(letter)` in the Rust engine, `FATImage.image()` in the TypeScript one; the sectors written alone are `FatVolume::written` and `FATImage.written()`, and whether anything was, `changed`. The page's "Save image…" and the native `--write-back` are to use them (phases 6 and 7 of [[topic:drives-and-disks]]). `image_probes_leave_their_images_as_they_were` (`tests/probes.rs`) and `image_writes_test.ts` run [[probe:imgwrite]] and find the committed images as they were, and what it wrote in the image as written.
- **Rust:** `FatVolume` (`files/fat.rs`) holds a `Drive`, DOSBox's `fatDrive` function by function, by its names (`get_cluster_value`, `find_next_internal`, `add_directory_entry`, `file_create` and the rest), shared with each `ImageFile` open on it, DOSBox's `fatFile`, with its own sector buffer. `Volume` gains `create_with` (the attributes 3Ch was given), `remove_dir`, `attributes`, `search_folder`, `find_from` and `image`; `Files` the same by letter, and `Body::close`, which writes an image file's sector back. `dos.rs` keeps a search of an image by slot and cluster in the record (`carry_on_image`), and asks the drive first, as DOSBox's DOS does, for 39h, 3Ah, 41h, 56h, 3Dh and 4300h on an image.
- **TypeScript:** `FATImage` (`src/file-systems/fat-image.ts`) over a `FatDrive` and its `FatFile`s (`fat-drive.ts`), the same functions line for line; its folders and open files are what the engine's DOS looks for in a drive's (`lookup`, `list`, `read`, `write`, `position`). The engine's own volumes, the page's C: among them, stay `FAT16`'s. `find.ts`, `files.ts`, `open.ts`, `read.ts` and `seek.ts` do as `dos.rs` for an image drive.
- An image with no label of its own has none for COMMDLG's list of drives either, not the `D_DRIVE` a folder DOSBox mounts is given.

## Not yet done

- `INT 25h` and `26h` on an image drive: the TypeScript engine reads and writes the volume's sectors -- through the overlay -- as DOSBox would not ([[topic:drives-and-disks]]).
- DOSBox's one buffer of a FAT sector for all its FAT drives: two FAT images mounted at once, their FATs at the same sector of their images, would read each other's under DOSBox. Each engine's drive reads its own. Unrecorded.
- A sector read past an image's end: DOSBox's `fread` reads nothing and leaves the buffer as it was; the engines read noughts.
- The mode a file is opened in reaches an image's file through DOS's 3Dh (and the Rust engine's 6Ch) alone; KERNEL's `_lopen` and `OpenFile` open it to read and write in both engines, where under DOSBox they too go through 3Dh with the mode.
- DOS's checks read out above (`PathExists` for 3Dh and 3Ch, file not found for 4300h of a path not there, 41h asking the drive first) are DOSBox's for every drive; the engines follow them on an image only, as they are recorded there. 3Ch with the folder's attribute (access denied, `dos_files.cpp` 490-494) and 5Bh of a folder's name are unrecorded.
