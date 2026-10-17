---
kind: function
module: VER
name: GetFileVersionInfoSize
ordinal: 6
summary: The length of a file's version information — its version resource's root block's length, where that is no more than the resource and FEEF04BDh is where VS_FIXEDFILEINFO's signature goes; the resource's place given back as the handle.
versions:
  '3.1': exact
probes: [verinfo]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinfo]] asks it of Windows' libraries, drivers, a font and programs, of files that are not programs, of names alone, of a copy in COMPRESS's format and of a copy of the probe, with the handle set to DEADBEEFh first.

- [[measured]] Windows' own answer between 444 and 484 bytes, the handle the resource's place: `COMMDLG.DLL` 472 at 14CA0h, `USER.EXE` 480 at 40570h, `SYSTEM.DRV` 480 at 720h, `VGASYS.FON` 480 at 1A90h.
- [[measured]] `KRNL386.EXE` and `WIN87EM.DLL`, which have no version resource, `WIN.INI`, `ARIAL.TTF`, a folder, a file not there, and files too short to be programs answer nought, the handle as it was.
- [[measured]] A name alone, `COMMDLG.DLL` or `commdlg.dll`, is found where `OpenFile` looks.
- [[measured]] A copy in COMPRESS's format answers as the file it holds, asked for by its own name or its expanded one.
- [[measured]] A resource whose root block says 150h bytes in a resource of 148h answers nought, its handle written: the resource is found, and refused after (`OWNCOPY.EXE`).

## Nuances

- [[read out]] The arguments: a far pointer to the name and one to the handle's doubleword; it pops 8 bytes and answers a doubleword.
- [[read out]] The handle is written as soon as the resource is found, before the block is checked.

## Inside Windows

[[read out]] `VER.DLL` seg3 `086e`: [[fn:VER.GetFileResourceSize]] of type 16 number 1, writing the handle; then [[fn:VER.GetFileResource]] of 48h bytes at that place into the stack; the root's `wLength` must be no more than the resource's length, and the words at 14h and 16h BDh 04h and EFh FEh. The answer is the root's `wLength` ([[format:version-resources]]).

## Implementation

`GetFileVersionInfoSize` in `src/win16/ver/ver.ts` and `get_file_version_info_size` in `crates/winbox-win16/src/ver/mod.rs`. Both engines agree with [[probe:verinfo]], with `VER.DLL` on the drive and without it.
