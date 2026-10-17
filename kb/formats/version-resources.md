---
kind: format
name: Version resources (VS_VERSION_INFO)
summary: A Windows 3.1 file's version resource as VER reads it — the tree of blocks, each a length, a value's length, a key and a value, aligned to four bytes; VS_FIXEDFILEINFO at its root, StringFileInfo's strings and VarFileInfo's Translation below — and what VER takes from it.
---

A program, library, driver or font made for Windows 3.1 may carry a resource of type 16, `RT_VERSION`, number 1. [[fn:VER.GetFileVersionInfoSize]] and [[fn:VER.GetFileVersionInfo]] read it, [[fn:VER.VerQueryValue]] finds a value in it, and [[fn:VER.VerInstallFile]] compares two of them ([[topic:version-information]]).

## A block

[[read out]] Each block, the root and every child, is laid out as `VerQueryValue` walks it (`VER.DLL` seg3 `0943`):

| Offset                       | What                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| 0                            | `wLength`: the block's length, its children's with it                               |
| 2                            | `wValueLength`: its value's length                                                  |
| 4                            | its key, a string and its nought                                                    |
| 4 + ((key length + 4) & ~3)  | its value: the key's end rounded up to four bytes from the block's start            |
| the value's end rounded to 4 | its first child; each child after the last, at its own `wLength` rounded up to four |

[[read out]] There is no type word: a string's value and a number's are told apart by what the key is, not by the block. A string value's length counts its nought.

## What it holds

[[measured]] Every Windows 3.1 file that has one ([[probe:verinfo]]: USER, GDI, SHELL, MMSYSTEM, COMMDLG, `SYSTEM.DRV`, `VGASYS.FON`, Notepad, Program Manager, Calculator) has a root keyed `VS_VERSION_INFO` with a value 52 bytes long, the length `GetFileVersionInfoSize` answers between 444 and 484 bytes. [[measured]] `KRNL386.EXE` and `WIN87EM.DLL` have none.

- The root's value is `VS_FIXEDFILEINFO`, at offset 14h. [[read out]] VER checks only its signature, FEEF04BDh at 14h (seg3 `08ee`), and reads `dwFileVersionMS` at 1Ch and `dwFileVersionLS` at 20h, `dwFileType` at 38h and `dwFileSubtype` at 3Ch, when it installs a file (seg3 `0ea5`).
- `StringFileInfo`, whose children are named by a language and code page in hexadecimal, `040904E4`, each holding the strings: `CompanyName`, `FileDescription`, `FileVersion` (`3.10`), `InternalName`, `LegalCopyright`, `OriginalFilename`, `ProductName`, `ProductVersion`.
- `VarFileInfo`, whose child `Translation` is a list of words in pairs, a language and a code page: 0409h and 04E4h (1252) in Windows' own.

## What VER asks of it

[[read out]] `GetFileVersionInfoSize` answers the root's `wLength`, but only where it is no more than the resource's length in the resource table, and the signature is there (seg3 `08d7`). [[measured]] A version resource Open Watcom's resource compiler wrote, whose root says 150h bytes in a resource of 148h, answers nought, though `GetFileResourceSize` finds the resource ([[probe:verinfo]], `OWNCOPY.EXE`).

[[read out]] `VerQueryValue` finds a child only where its `wLength` is more than five and no more than what is left of its parent; a block whose children start past its own end is no block. [[measured]] In the same Watcom resource `StringFileInfo` is found, and in it `CompanyName` and `FileVersion`, but not the strings after them, nor `VarFileInfo`: the lengths Watcom wrote leave the walk short of them ([[probe:verinfo]]).
