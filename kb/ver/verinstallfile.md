---
kind: function
module: VER
name: VerInstallFile
ordinal: 9
summary: A file installed — copied, expanded, into a temporary file beside where it goes, compared with the file there by version, type and language, and renamed into its place -- or left in the temporary file with the differences answered.
versions:
  '3.1': exact
probes: [verinst]
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

[[probe:verinst]] installs copies of `SYSTEM.DRV` with their versions, types and languages changed, a copy in COMPRESS's format, and text, into a folder of its own, and lists the folder after each.

- [[measured]] Into a folder without the file, or over one of the same version, or an older one, or one with no version information: nought, the file in place, no temporary file left.
- [[measured]] Over a newer version -- later in `dwFileVersionMS`, or the same and later in `dwFileVersionLS` -- 7: `VIF_TEMPFILE`, `VIF_MISMATCH`, `VIF_SRCOLD`. The new file is left as `TEMP.000` beside the old, and its name given back as VER makes it, `temp.000`, its length 9.
- [[measured]] Another file type: 23h, `VIF_DIFFTYPE` with `VIF_MISMATCH` and `VIF_TEMPFILE`. Another language, or another code page: 0Bh, `VIF_DIFFLANG`. An installed code page of nought agrees with any but 1200.
- [[measured]] A new file with no version information over one with: 7, as an older one.
- [[measured]] `VIFF_FORCEINSTALL` with the temporary file's name: that file installed, nought, the name left in the buffer.
- [[measured]] `VIFF_FORCEINSTALL` with a temporary file not there: a new one made from the source and installed.
- [[measured]] Temporary names taken: the next, `temp.002` after `TEMP.000` and `TEMP.001`.
- [[measured]] A source not there: 10000h, `VIF_CANNOTREADSRC`, nothing made. A source in COMPRESS's format, asked for by its expanded name, is expanded into place.
- [[measured]] A buffer too small for the temporary file's name, 3 or 8 bytes: 40006h, `VIF_BUFFTOOSMALL` with the differences, the temporary file deleted and the length it needs, 9, given; 9 bytes is room.
- [[measured]] A copy in the current folder that is not the folder installed into is deleted, unless `VIFF_DONTDELETEOLD`; a current folder that is the same, by `lstrcmpi`, is left.
- [[measured]] Under another name, from and to folders ending in a backslash: installed as the new name.
- [[measured]] The file of a library loaded, `COMMDLG.DLL` in the system folder: 80h, `VIF_FILEINUSE`, nothing made.

## Nuances

- [[read out]] The arguments: the flags, far pointers to the source's name, the name installed as, the source's folder, the folder installed into, the current folder, the temporary file's buffer and its length's word; it pops 30 bytes and answers a doubleword.
- [[read out]] A read-only file is `VIF_WRITEPROT` (seg3 `0d37`), not recorded: DOSBox does not keep a file's attributes.
- [[read out]] The temporary name's digits are three hexadecimal ones, `temp.000` to `temp.FFF`; past them, `VIF_CANNOTCREATE`.
- [[read out]] [[fn:LZEXPAND.LZCopy]]'s errors become flags: -1, -3, -7 and -8 `VIF_CANNOTREADSRC`; -2 and -4 `VIF_OUTOFSPACE`; -5 and -6 `VIF_OUTOFMEMORY` (the table at seg3 `0e58`).
- [[read out]] DOS's errors 5 and 20h add `VIF_ACCESSVIOLATION` (200h) and `VIF_SHARINGVIOLATION` (400h) to `VIF_CANNOTCREATE`, `VIF_CANNOTDELETE`, `VIF_CANNOTDELETECUR` and `VIF_CANNOTRENAME` (seg3 `0b42`).

## Inside Windows

[[read out]] `VER.DLL` seg3 `0c9a`:

1. The source's folder and name joined (seg3 `1192`) and opened by [[fn:LZEXPAND.LZOpenFile]] to read; failing, `VIF_CANNOTREADSRC`.
2. The destination's path; where it is there (DOS 4300h on its OEM name), read-only is `VIF_WRITEPROT`, a module loaded from it `VIF_FILEINUSE`.
3. Forcing with a temporary name, and that file there: it is used. Otherwise `temp.` and three digits in the destination's folder, the first not there, made with `OpenFile`'s `OF_CREATE`, the source copied into it by [[fn:LZEXPAND.LZCopy]].
4. The destination there and not forcing: both files' version information read into VER's local heap, 800h bytes or as many as the block says (seg3 `0c34`), and compared (seg3 `0ea5`): versions, `dwFileType` and `dwFileSubtype`, and each of the installed file's translations looked for among the new one's.
5. No difference: the destination deleted (`OF_DELETE`), the copy in the current folder deleted unless `VIFF_DONTDELETEOLD` or in use, and the temporary file renamed into place (DOS 5600h on the OEM names).
6. A difference: the temporary file's name given back where it fits, with `VIF_TEMPFILE`; else `VIF_BUFFTOOSMALL` and the file deleted.

## Implementation

`VerInstallFile` in `src/win16/ver/ver.ts` and `ver_install_file` in `crates/winbox-win16/src/ver/mod.rs`, through WinBox's own LZEXPAND, KERNEL's `OpenFile` and `Dos3Call`, and USER's `lstrcmpi`. Not followed: VER's local heap for the version blocks, which are global blocks here, freed as VER frees its own. Both engines agree with [[probe:verinst]], with `VER.DLL` on the drive and without it.
