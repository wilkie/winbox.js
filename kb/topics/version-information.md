---
kind: topic
name: Version information
summary: VER, Windows 3.1's version stamps and installer's helper — reading a file's resources and version block through LZEXPAND, finding a value in it, naming a language, and finding and installing a file with its comparisons and flags — read out of VER.DLL and recorded, and WinBox's own with no file.
probes: [verinfo, verinst]
---

`VER.DLL` reads the version resource Windows' programs and libraries carry ([[format:version-resources]]), and helps an installer put a file where it belongs: SETUP, Control Panel's driver and font installers, and programs' own installers call it. It is WinBox's own: with or without the file on the drive, a program's calls are WinBox's code ([[guide:without-windows]]).

## What the library holds

[[read out]] Six segments: four of code, two of data.

| Segment | What                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| seg1    | [[fn:VER.WEP]]                                                                                             |
| seg2    | the entry point, which calls `LocalInit` and `LibMain` ([[fn:VER.Ordinal 12]])                             |
| seg3    | every export but `WEP`, and their helpers                                                                  |
| seg4    | the string `w32sys.dll`, and the calls into Win32s ([[fn:VER.Ordinal 14]] to [[fn:VER.Ordinal 16]])        |
| seg5    | a second data segment of 16 bytes: Win32s's library and its three procedures                               |
| seg6    | the data segment: `KERNEL`, `\VarFileInfo\Translation`, `temp.`, and the instance, `IsRomModule`'s address |

[[read out]] Its resources are the names of languages, string tables 1, 65-67, 129, 130, 193 and 257, and its own version.

| Ordinal | Export                            | What                                                          | WinBox's own |
| ------- | --------------------------------- | ------------------------------------------------------------- | ------------ |
| 1       | [[fn:VER.WEP]]                    | the exit procedure                                            | yes          |
| 2       | [[fn:VER.GetFileResourceSize]]    | a resource's length and place in a file                       | yes          |
| 3       | [[fn:VER.GetFileResource]]        | a resource's bytes                                            | yes          |
| 6       | [[fn:VER.GetFileVersionInfoSize]] | the version resource's length                                 | yes          |
| 7       | [[fn:VER.GetFileVersionInfo]]     | the version resource's bytes                                  | yes          |
| 8       | [[fn:VER.VerFindFile]]            | where a file is, and where it should go                       | yes          |
| 9       | [[fn:VER.VerInstallFile]]         | a file installed, expanded and compared                       | yes          |
| 10      | [[fn:VER.VerLanguageName]]        | a language's name                                             | yes          |
| 11      | [[fn:VER.VerQueryValue]]          | a value in a version block                                    | yes          |
| 12-20   | [[fn:VER.Ordinal 12]] and on      | entries of its own far calls and data, not exported (flags 0) | no           |

[[read out]] 4 and 5 have no entry.

## Reading a file

[[read out]] VER reads every file through [[topic:compressed-files]]: [[fn:LZEXPAND.LZOpenFile]], [[fn:LZEXPAND.LZRead]], [[fn:LZEXPAND.LZSeek]], [[fn:LZEXPAND.LZClose]]. So a file COMPRESS made is read as the file it holds, and a name not there is found by its compressed name. [[measured]] `VCOPY.DRV`, which is only on the drive as `VCOPY.DR_`, answers as `SYSTEM.DRV` does, to every call ([[probe:verinfo]]).

[[read out]] A file is opened sharing it -- `OF_SHARE_DENY_NONE` -- and, that failing, in compatibility mode; its old header must say `MZ`, and the 40h bytes at the place it names `NE` (seg3 `0488`). Not followed: a ROM module's header where KERNEL's `IsRomModule` names one, which in Windows 3.1 answers nought. A file that is no Windows program would be handed to Win32s's `W32SYS.DLL`, where VER can load it (seg4); none is installed, and the call answers nought.

[[read out]] A resource is found by reading the resource table from the new header: the shift, then each type's number and count; a type and a resource are matched by their number alone, the top bit taken off, against the argument's low word (seg3 `05d2`). A named type or resource is matched by the place of its name in the table, never its name. [[measured]] Type 8010h does not find type 10h: the argument's top bit is kept ([[probe:verinfo]]).

## Finding and installing

[[fn:VER.VerFindFile]] tells an installer where a file is now and where it should go; [[fn:VER.VerInstallFile]] copies it there through a temporary file, expanding it, and compares it with the file it would replace. [[measured]] [[probe:verinst]] records both with their flags, answers and the files left behind.

## WinBox's code

`src/win16/ver/ver.ts` and `crates/winbox-win16/src/ver/mod.rs` follow each routine, calling WinBox's own `LZEXPAND` as VER calls it, and KERNEL, USER and KEYBOARD through the functions that answer a program's calls. What VER keeps on its stack is kept below the caller's stack, where the calls it makes can be given it. The names of languages are WinBox's data (`languages.ts`, `languages.rs`), copied from VER's string tables. With `VER.DLL` on the drive the file is loaded, and every import of an export is linked to WinBox's stub; with none, `LoadLibrary("VER.DLL")` finds WinBox's. Both engines agree with every record of [[probe:verinfo]] and [[probe:verinst]], with the files on the drive and without them.

## Not yet done

- A ROM module's header, from `IsRomModule`: no ROM Windows is followed.
- Win32s's `W32SYS.DLL`, which VER loads to read a file that is no Windows 3.1 program.
- `VIF_WRITEPROT`: [[fn:VER.VerInstallFile]] refuses a read-only file (seg3 `0d37`), but DOSBox does not keep a file's attributes, and the engines do, so it is not recorded.
- [[fn:VER.VerFindFile]] with no program folder for a file not shared: VER gives `lstrlen` and `lstrcpy` a null pointer; what KERNEL makes of it is not followed, and the probe does not ask.
- VER's version blocks for [[fn:VER.VerInstallFile]]'s comparison are kept in its local heap (seg3 `0c34`); WinBox's are global blocks, freed as VER frees its own.
