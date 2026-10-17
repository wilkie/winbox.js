---
kind: function
module: VER
name: GetFileResourceSize
ordinal: 2
summary: A resource's length in a file, and its place there given back, found by VER's own reading of the file's resource table through LZEXPAND -- types and resources matched by number alone.
versions:
  '3.1': exact
probes: [verinfo]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinfo]] asks for resources of several types and numbers in `COMMDLG.DLL`, Notepad, a copy of the probe and a copy of `SYSTEM.DRV` in COMPRESS's format, each with the place's doubleword set to DEADBEEFh first.

- [[measured]] The answer is the resource's length in bytes -- its length in the resource table, shifted by the table's shift -- and its place in the file is written: `COMMDLG.DLL`'s string table 17 is 128 bytes at 13B20h, its dialog 1536 352 bytes at 12E00h.
- [[measured]] A resource not there, a type not there, a file that is no program (`WIN.INI`) or is not there: nought, and the place is left as it was.
- [[measured]] Type 8010h and resource 8001h are not found where type 10h resource 1 is: the top bit of the argument is kept, and the file's taken off.
- [[measured]] A file in COMPRESS's format is read as the file it holds: `VCOPY.DRV`, there only as `VCOPY.DR_`, finds its version at 720h, as `SYSTEM.DRV` does.
- [[measured]] The probe's own program, running, is opened and read (`self`).

## Nuances

- [[read out]] The arguments, as pushed: far pointers to the file's name, the type, the resource and the doubleword for the place; it pops 16 bytes and answers a doubleword.
- [[read out]] A type or resource given by name (a far pointer) is matched by its pointer's low word against the number in the table, the top bit taken off: a named one is never found by its name, and may be found by accident.
- [[read out]] The place is written without looking at the pointer: a null one faults.

## Inside Windows

[[read out]] `VER.DLL` seg3 `0010`:

1. The file is opened and its headers read (seg3 `0488`): [[fn:LZEXPAND.LZOpenFile]] with `OF_SHARE_DENY_NONE`, then without, the old header's `MZ`, the 40h bytes of the new header at the place it names and their `NE`, and the file left at the new header. A ROM module from `IsRomModule` is copied from memory instead, not followed (it answers nought in Windows 3.1).
2. Not a program: Win32s's `W32SYS.DLL` is asked, where VER can load it (seg4 `003e`); with none, nought. The handle is closed with [[fn:LZEXPAND.LZClose]], even an error.
3. The resource table is read (seg3 `05d2`): [[fn:LZEXPAND.LZSeek]] by its offset from the new header, the shift (more than 12 fails), then each type's number and count and its 4 reserved bytes; for the type wanted, each 12-byte entry until one's number matches; for another, past its entries. A type whose resources do not hold the one wanted fails there.
4. The place is the entry's offset shifted, the answer its length shifted (seg3 `0150`, entry 13).

## Implementation

`GetFileResourceSize` in `src/win16/ver/ver.ts` and `get_file_resource_size` in `crates/winbox-win16/src/ver/mod.rs`, through WinBox's own LZEXPAND. Both engines agree with [[probe:verinfo]]'s records, with `VER.DLL` on the drive and without it.
