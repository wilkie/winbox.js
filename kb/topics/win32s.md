---
kind: topic
name: Win32s
summary: What Win32s 1.25 is made of and what Widget Workshop's 32-bit files need of it -- every file Win32s installs by format, the 16-bit modules and the Win16 functions they import, the 399 functions Widget Workshop's PE files import and the Win32s DLLs that export them, and which of the Win16 functions WinBox has -- read out of the files on Widget Workshop's disc; Win32s support itself is deferred.
probes: []
---

**Status: deferred by the owner, 2026-10-25.** WinBox does not run a Win32s program. This page is the inventory of what that would take, read out of the files on Widget Workshop's disc ([[topic:cd-rom]], "Installing from a disc"): `WIDGET.EXE` and its libraries are Win32 programs (PE) that need Microsoft's Win32s 1.25, which the disc carries as `WIN31\WIN32S\DISK1` and `DISK2`. Nothing here is behaviour: it is names, ordinals, counts and formats. What a function does inside Win32s was not read out.

The full lists are `kb/data/win32s-imports.json`; `scripts/kb/win32s-expand.py`, `scripts/kb/win32s-inventory.py` and `scripts/kb/win32s-coverage.ts` make it from the disc's folder (see "Making the lists" below). None of Microsoft's files is in the repository.

## What Widget Workshop's disc holds

[[read out]] Every EXE, DLL, DRV and `.386` of the disc's `WIN31` tree and the two tutorial programs, by header (`MZ` then `NE`, `PE` or `LE` at `e_lfanew`):

| Format | Files                                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PE     | `WIDGET\WIDGET.EXE`, `WWGADGET.DLL`, `WWINTRO.DLL`, `WWSOUND.DLL`, `COMDLL\CTL3D32.DLL`, `WING\WING32.DLL`, and the Windows 95 tutorial `TUTORIAL\WIDGET\WIN95.EXE`                                                            |
| NE     | `INSTALL.EXE`, `SETUP.EXE` (InstallShield 2), `SETUP.DLL`, `EREG.EXE`, `EREGLIB.DLL`, `CTL3D.DLL`, `D2HTOOLS.DLL`, the SVGA drivers and fonts, `WING.DLL`, `WINGDE.DLL`, `WINGDIB.DRV`, `STWDEMO\*`, the tutorial `WIN3_1.EXE` |
| LE     | `WING\DVA.386`, `SVGA\VDDSVGA.386` and `VDDTLI4.386` (WinG's and the display's virtual device drivers; `VDDTVGA.386` has no `MZ` header)                                                                                       |
| DOS MZ | `WIDGET\INFO.EXE`, `WIDGET\UNIVBE.EXE`                                                                                                                                                                                         |

[[read out]] The installer put these files of that tree on C: (`test/layers/widget-layer.json`): `WIDGET.EXE`, `WWGADGET.DLL`, `WWINTRO.DLL`, `WWSOUND.DLL`, the DOS `INFO.EXE` and `UNIVBE.EXE`, the tutorial `WIN3_1.EXE`, and in Windows' `SYSTEM` folder `CTL3D.DLL`, `CTL3D32.DLL` and `D2HTOOLS.DLL`. `WING32.DLL` is not among them: the 256-colour installation Windows was recorded on already has WinG's files. The disc's `WIN95` tree has a `CTL3D32S.DLL`, byte for byte the `COMDLL\CTL3D32.DLL` the Windows 3.1 setup installs.

## Widget Workshop's 32-bit files

[[read out]] All six are `PE`, Windows GUI subsystem, and name only these libraries in their import tables; none imports an MFC or C run-time DLL (`MFC*.DLL`, `MSVCRT*.DLL`, `CRTDLL.DLL`), by name or by ordinal, and none of their bytes names one. Every import is by name; none is by ordinal.

| File           | Bytes     | Imports | `KERNEL32` | `USER32` | `GDI32` | `WINMM` | `COMDLG32` | `LZ32` | `SHELL32` | `ADVAPI32` | Exports |
| -------------- | --------- | ------- | ---------- | -------- | ------- | ------- | ---------- | ------ | --------- | ---------- | ------- |
| `WIDGET.EXE`   | 684,032   | 383     | 87         | 151      | 107     | 20      | 5          | 3      | 3         | 7          | 1       |
| `WWGADGET.DLL` | 1,007,616 | 23      | 21         | 2        |         |         |            |        |           |            | 0       |
| `WWINTRO.DLL`  | 3,321,856 | 23      | 21         | 2        |         |         |            |        |           |            | 0       |
| `WWSOUND.DLL`  | 667,648   | 23      | 21         | 2        |         |         |            |        |           |            | 1       |
| `CTL3D32.DLL`  | 26,112    | 83      | 22         | 46       | 15      |         |            |        |           |            | 25      |
| `WING32.DLL`   | 12,800    | 25      | 7          | 4        | 14      |         |            |        |           |            | 10      |

- [[read out]] **Distinct functions, all six files together: 399.** `KERNEL32` 90, `USER32` 159, `GDI32` 112, `WINMM` 20, `COMDLG32` 5, `LZ32` 3, `SHELL32` 3, `ADVAPI32` 7. The three libraries' imports are all among `WIDGET.EXE`'s, so the program and its three libraries together need 383.
- [[inferred]] The MFC and the C library are linked into the files: no import names them, and `WIDGET.EXE` carries 20 strings naming `AFX` (`_AFX_WINGDIX_TERM`, among them) and `CWinGDib`, `CWinGInfo`.
- [[read out]] The header's subsystem version is 3.10 in `WIDGET.EXE`, the three libraries and `WING32.DLL`, and 4.0 in `CTL3D32.DLL`. What Win32s does with that field was not read out.
- [[read out]] `WIDGET.EXE` carries these library names as text and none in its import table beyond the eight above: `WING32.DLL`, `CTL3D32.DLL`, `WWGADGET.DLL`, `WWINTRO.DLL` and `WWSOUND.DLL`, with the strings `WinGBitBlt`, `WinGCreateBitmap`, `WinGCreateDC` and `WinGRecommendDIBFormat` and "Failed to load library WWGADGET.DLL": they are loaded at run time. `WING32.DLL` names `WING.DLL`, the 16-bit WinG library.
- [[read out]] `WING32.DLL` exports ten functions, `WinGBitBlt` to `WinGStretchBlt` (ordinals 1-10); `CTL3D32.DLL` 25 (`Ctl3dGetVer` 1 to `Ctl3dAutoSubclassEx` 27, ordinals 14 and 15 unused); `WWSOUND.DLL` `InstanceCount`; `WIDGET.EXE` `__GetExceptDLLinfo`.
- [[read out]] The smaller sets, in full: `WINMM` -- `sndPlaySoundA`, `timeGetTime`, `waveInAddBuffer`, `waveInClose`, `waveInGetNumDevs`, `waveInGetPosition`, `waveInOpen`, `waveInPrepareHeader`, `waveInStart`, `waveInStop`, `waveInUnprepareHeader`, `waveOutClose`, `waveOutGetDevCapsA`, `waveOutGetNumDevs`, `waveOutGetPosition`, `waveOutOpen`, `waveOutPrepareHeader`, `waveOutReset`, `waveOutUnprepareHeader`, `waveOutWrite`; `COMDLG32` -- `CommDlgExtendedError`, `GetFileTitleA`, `GetOpenFileNameA`, `GetSaveFileNameA`, `PrintDlgA`; `LZ32` -- `LZClose`, `LZCopy`, `LZOpenFileA`; `SHELL32` -- `DragAcceptFiles`, `DragFinish`, `DragQueryFileA`; `ADVAPI32` -- the registry's `RegCloseKey`, `RegCreateKeyExA`, `RegDeleteKeyA`, `RegDeleteValueA`, `RegOpenKeyExA`, `RegQueryValueExA`, `RegSetValueExA`.

## What Win32s 1.25 is made of

[[read out]] `32SINST.INF` lists what it installs; the disks' files are compressed with `COMPRESS` ([[format:szdd]], [[topic:compressed-files]]) and were expanded by a decoder of the format's own, every expanded size equal to the one the INF gives. The INF names 55 files for `WindowsSystemWin32s`, 4 for `WindowsSystem`, 3 for FreeCell, 14 for the setup program itself, and 45 obsolete files to remove.

| Section               | Files | PE  | NE  | LE  | Data              |
| --------------------- | ----- | --- | --- | --- | ----------------- |
| `WindowsSystemWin32s` | 55    | 14  | 2   | 1   | 38                |
| `WindowsSystem`       | 4     |     | 4   |     |                   |
| `Win32appFreecell`    | 3     | 2   |     |     | 1                 |
| `Files` (the setup)   | 14    |     | 9   |     | 4, and 1 DOS `MZ` |

- [[read out]] The 38 data files in `WindowsSystemWin32s` are National Language Support tables, `.NLS` (code pages `P_*`, `SORTKEY`, `SORTTBLS`, `UNICODE`, `LOCALE`, `CTYPE`, `L_INTL`). The setup's data are `SETUP.LST`, `32SINST.MST`, and the include files `SETUPAPI.INC` and `MSDETECT.INC`.
- [[read out]] `32SINST.MST` is a Microsoft Test script, in plain text. It puts Win32s in `SYSTEM\WIN32S\` (`DEST32S$ = DESTSYS + "WIN32S\"`), keeps its state in `WIN32S.INI` (`[Win32s] Setup`, `Version`; `[Nls] AnsiCP=1252`; `[OLE]`; `[Freecell]`), and stops with messages when paging is not enabled ("Win32s requires Virtual Memory") or `SHARE.EXE` is not loaded. [[inferred]] The sections for the system folder and for `WIN32S\` follow its section names; the script's copying was not read out.
- [[read out]] `INIUPD.DLL` (setup, 16-bit) rewrites `SYSTEM.INI`, keeping `SYSTEM.OLD`: it adds `device=\win32s\w32s.386` under `[386Enh]` and `winmm16.dll` to `drivers=` under `[Boot]`. Its exports: `MAKESYSTEMINI`, `ONWINDOWSNT`, `PAGINGENABLED`, `ISWIN32SLOADED`, `SHAREENABLED`, `ISRUNNINGAPP`, `SETFILEATTRIB`, `WRITELINE`.

### The 32-bit DLLs (PE)

[[read out]] Fourteen in `WindowsSystemWin32s`, with what each exports and imports:

| File           | Exports | Imports                                            |
| -------------- | ------- | -------------------------------------------------- |
| `W32SCOMB.DLL` | 2,123   | `W32SKRNL.DLL` 80 entries                          |
| `W32SKRNL.DLL` | 96      | none                                               |
| `CRTDLL.DLL`   | 512     | `NTDLL.DLL` 1, `KERNEL32.DLL` 88, `W32SCOMB.DLL` 4 |
| `WINMM.DLL`    | 163     | `CRTDLL.DLL` 8, `KERNEL32.DLL` 2, `USER32.DLL` 6   |
| `SHELL32.DLL`  | 108     | `KERNEL32.DLL` 2, `W32SKRNL.DLL` 3                 |
| `WINSPOOL.DRV` | 84      | `KERNEL32.DLL` 1                                   |
| `WSOCK32.DLL`  | 73      | `KERNEL32.DLL` 17, `W32SKRNL.DLL` 5                |
| `OLECLI32.DLL` | 56      | `KERNEL32.DLL` 1, `W32SKRNL.DLL` 3                 |
| `NETAPI32.DLL` | 243     | `KERNEL32.DLL` 5, `W32SKRNL.DLL` 3                 |
| `COMDLG32.DLL` | 27      | `KERNEL32.DLL` 2, `W32SKRNL.DLL` 3                 |
| `LZ32.DLL`     | 13      | `KERNEL32.DLL` 3, `W32SKRNL.DLL` 3                 |
| `OLESVR32.DLL` | 12      | `KERNEL32.DLL` 6, `W32SKRNL.DLL` 4                 |
| `VERSION.DLL`  | 11      | `KERNEL32.DLL` 2, `W32SKRNL.DLL` 3                 |
| `NTMSG.DLL`    | 0       | none (106,496 bytes; sections of resources)        |

- [[read out]] **There is no `KERNEL32.DLL`, `USER32.DLL`, `GDI32.DLL` or `ADVAPI32.DLL` in the list.** `W32SCOMB.DLL` (222,720 bytes) exports 2,123 names, among them the functions of those four and of `NTDLL.DLL` (`CreateProcessA`, `RegisterClassExA`, `GlobalUnlock`, `wsprintfA`, `Rtl*`, `Nt*`-style names, `WNet*`). The INF removes `kernel32.dll`, `user32.dll`, `gdi32.dll`, `advapi32.dll`, `ntdll.dll` and `mpr.dll` from the system folder (`Win32sSystemObsoleteFiles`). How Win32s' loader sends an import of `KERNEL32.DLL` to `W32SCOMB.DLL` was not read out; the cross-reference below assumes it does, and that is a mapping this page makes, not one it read.
- [[read out]] `W32SKRNL.DLL` exports 96, ordinals 1 to 608 with gaps, named from `_SzFromImte@4` to `_TlsNullSlot@4`, `_NtCreateSection@28` among them, and imports nothing. `W32SCOMB.DLL` and the thin `COMDLG32`, `LZ32`, `SHELL32`, `VERSION`, `NETAPI32`, `WSOCK32`, `OLE*32` DLLs import it (80 table entries; 3 to 5 in each of the others).
- [[read out]] FreeCell is `FREECELL.EXE` and `CARDS.DLL` (6 exports), PE files that import only from `KERNEL32`, `USER32`, `GDI32`, `SHELL32` and `CARDS`.

### The 16-bit modules (NE)

[[read out]] The ones installed as Win32s' own:

| File           | Module     | INF section           | Exports                                                                                                                                                                                           | Imports (distinct per module)                                                                                                                         |
| -------------- | ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WIN32S16.DLL` | `win32s16` | `WindowsSystem`       | 270 ordinals, 52 named (`BOOTTASK` 2 to `FINDGLOBALHANDLE` 52); 1.25.141.0                                                                                                                        | `USER` 262, `GDI` 166, `KERNEL` 73, `OLECLI` 55, `DDEML` 27, `SHELL` 15, `KEYBOARD` 11, `COMMDLG` 11, `OLESVR` 11, `LZEXPAND` 10, `VER` 5, `W32SYS` 3 |
| `W32SYS.DLL`   | `W32SYS`   | `WindowsSystem`       | 27 ordinals, 12 named (`ISPEFORMAT`, `EXECPE`, `GETPEEXEINFO`, `GETW32SYSVERSION`, `LOADPERESOURCE`, `GETPERESOURCETABLE`, `EXECPEEX`, `ITSME`, `W32SERROR`, `EXP1`, `GETWIN32SINFO`); 1.25.139.0 | `KERNEL` 24, `USER` 4                                                                                                                                 |
| `WINMM16.DLL`  | `WINMM16`  | `WindowsSystem`       | 14 ordinals, 9 named (`DRIVERPROC`, `W16MCIYIELDPROC`, `MM_UT_INIT`, `MM16WNDPROC`, `W16GETHWND`, `W16COMMONCALLBACKFUNCTION`, `W16TIMEFUNC`, `MM_UT_DISPATCH`)                                   | `MMSYSTEM` 93, `KERNEL` 15, `USER` 8                                                                                                                  |
| `OLECLI.DLL`   | `OLECLI`   | `WindowsSystem`       | 260; version 1.32.0.0, replacing Windows' older one (`OLDER` in the INF)                                                                                                                          | `USER` 49, `KERNEL` 38, `GDI` 38, `SHELL` 3                                                                                                           |
| `SCK16THK.DLL` | `sck16thk` | `WindowsSystemWin32s` | 15 ordinals, 2 named (`SCKTHKCOMMON`); 1.25.139.0                                                                                                                                                 | `WINSOCK` 47 (all by ordinal), `WIN32S16` 10, `USER` 8, `KERNEL` 3                                                                                    |
| `WIN32S.EXE`   | `W32Sxxxx` | `WindowsSystemWin32s` | none ("WIN32S - 16 bit loader", 880 bytes)                                                                                                                                                        | `WIN32S16` 1 (`BOOTTASK`)                                                                                                                             |

- [[read out]] `W32SYS.DLL`'s description is "Microsoft Win32S Interface Version 3.10". Its code carries the messages Win32s gives: "Win32s can run only in 386 enhanced mode", "Win32s requires Windows to run with virtual memory enabled", "Win32s requires W32S.386 in order to run", "Win32s requires WIN32S.EXE and WIN32S16.DLL to run", "DLL %s not found", "The procedure entry point "%s" could not be located in the Dynamic Link Library "%s"".
- [[read out]] `WIN32S16.DLL`'s exports begin with names of the NT debugging and process interface (`CREATEPROCESS`, `WAITFORDEBUGEVENT`, `READPROCESSMEMORY`, `GETTHREADCONTEXT`, `VIRTUALQUERYEX`), then selector and callback helpers (`ALLOCCLBKTO32BDLL`, `SELCBCS`, `GETCSALIAS`, `SELFLATCODE`, `ALLOCCALLBACK`, `LINEARTOHUGESELECTOROFFSET`, `CREATEPEHEADER`). Ordinals 53 to 270 have no name.
- [[read out]] Of the other installed 16-bit imports: `WINSOCK` is not a Win32s file nor a Windows 3.1 one; `OLESVR` is Windows 3.1's.

### The virtual device driver

[[read out]] `W32S.386` is an `LE` file, 36,583 bytes, five objects and nine pages; its module flags are 0x8020, the device-driver bit among them ([[documented]], the LE format). It carries "W32S_DDB" and the strings "Win32S Device (Version 1.0)", "Error loading W32S.386: device with same ID (2Dh) already loaded.", "Error loading W32S.386: device requires Windows 3.10" and "Error loading W32S.386: no memory". `INIUPD.DLL` names it in `SYSTEM.INI`'s `[386Enh]`, as above. What it does was not read out.

## Every function Widget Workshop needs, and who exports it

[[read out]] Each import of the six 32-bit files, looked up by name among the exports of every PE DLL of Win32s and of the disc's tree (`widgetCrossReference` in the JSON):

| Import library | Distinct functions Widget Workshop's six files need | Exported by                       | Found   |
| -------------- | --------------------------------------------------- | --------------------------------- | ------- |
| `KERNEL32.DLL` | 90                                                  | `W32SCOMB.DLL` (as above)         | 90      |
| `USER32.DLL`   | 159                                                 | `W32SCOMB.DLL`                    | 159     |
| `GDI32.DLL`    | 112                                                 | `W32SCOMB.DLL`                    | 112     |
| `ADVAPI32.DLL` | 7                                                   | `W32SCOMB.DLL`                    | 7       |
| `WINMM.DLL`    | 20                                                  | Win32s' `WINMM.DLL` (163 exports) | 20      |
| `COMDLG32.DLL` | 5                                                   | Win32s' `COMDLG32.DLL` (27)       | 5       |
| `LZ32.DLL`     | 3                                                   | Win32s' `LZ32.DLL` (13)           | 3       |
| `SHELL32.DLL`  | 3                                                   | Win32s' `SHELL32.DLL` (108)       | 3       |
| **Total**      | **399**                                             |                                   | **399** |

- [[read out]] **Every function is among the exports of a file Win32s installs: none is missing.** `CTL3D32.DLL` and `WING32.DLL` need only `KERNEL32`, `USER32` and `GDI32` names, all among those. (`WING32.DLL` and `CTL3D32.DLL` are the disc's own, not Win32s'; `WING32.DLL` also depends on the 16-bit `WING.DLL`, by a route that was not read out.)
- [[read out]] The Win32s DLLs' own imports are met the same way: all of them resolve among `W32SCOMB.DLL`, `W32SKRNL.DLL`, `CRTDLL.DLL` and the DLLs beside them (`win32sCrossReference`). An export being present says nothing of what the function does: Win32s' list of 2,123 names may hold stubs, and which was not read out.
- [[read out]] Widget Workshop imports nothing from `NTDLL.DLL`, `CRTDLL.DLL`, `NETAPI32.DLL`, `WSOCK32.DLL`, `WINSPOOL.DRV`, `OLE*32.DLL` or `VERSION.DLL`; those are Win32s' own, for other programs.
- [[read out]] The Windows 95 tutorial `WIN95.EXE` is the one PE file on the disc Win32s could not serve: it imports `OLE32.DLL` (3) and `MSVFW32.DLL` (3), which Win32s 1.25 does not install. The Windows 3.1 setup installs `WIN3_1.EXE`, a 16-bit program, instead.

## What Win32s asks of Win16

[[read out]] What the 16-bit modules above import from Windows 3.1's own modules (for the ones Win32s installs, "runtime"), and how many of those functions WinBox implements, by the `implemented` flag of `scripts/kb/exports.ts` against `kb/data/exports-3.1.json`, as the tree stood at commit `0e2f1daa` (`win16Needs` in the JSON):

| Imported module | Functions Win32s' installed modules need | WinBox implements | Missing from WinBox                                                                                                                           |
| --------------- | ---------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `USER`          | 269                                      | 259               | 10, among them `REPLYMESSAGE`, `GETDCEX`, `CREATECURSOR`, `SIGNALPROC`                                                                        |
| `KERNEL`        | 84                                       | 73                | 11, among them `GLOBALDOSALLOC`, `GLOBALDOSFREE`, `GETEXEPTR`, `THHOOK`, the data exports `__AHSHIFT`, `__AHINCR`, `__WINFLAGS`               |
| `GDI`           | 176                                      | 168               | 8: `SETBOUNDSRECT`, `GETBOUNDSRECT`, `GETCHARABCWIDTHS`, `GETOUTLINETEXTMETRICS`, `GETFONTDATA`, `GETKERNINGPAIRS`, `UPDATECOLORS`, `RESETDC` |
| `SHELL`         | 15                                       | 12                | `DRAGQUERYFILE`, `DRAGFINISH`, `DRAGQUERYPOINT`                                                                                               |
| `KEYBOARD`      | 11                                       | 7                 | `TOASCII`, `OEMKEYSCAN`, `GETKEYBOARDTYPE`, `GETKEYNAMETEXT`                                                                                  |
| `DDEML`         | 27                                       | 27                |                                                                                                                                               |
| `COMMDLG`       | 11                                       | 11                |                                                                                                                                               |
| `LZEXPAND`      | 10                                       | 10                |                                                                                                                                               |
| `VER`           | 5                                        | 5                 |                                                                                                                                               |
| `MMSYSTEM`      | 93 (all `WINMM16.DLL`'s)                 | 21                | 72: the `midiOut*`, `midiIn*`, `waveOutClose` to `waveOutMessage`, `waveIn*`, `joy*`, `aux*` and the rest                                     |
| `OLESVR`        | 11                                       | 0 (no module)     | all                                                                                                                                           |
| `WINSOCK`       | 47, by ordinal                           | 0 (no module)     | all                                                                                                                                           |
| **Total**       | **759**                                  | **593**           | **166**                                                                                                                                       |

- [[read out]] Besides, `WIN32S16.DLL` imports 55 functions of `OLECLI` and 3 of `W32SYS`; `SCK16THK.DLL` 10 of `WIN32S16`; `WIN32S.EXE` `BOOTTASK` of `WIN32S16`. These are met by Win32s' own files (`OLECLI.DLL` 1.32 is Win32s' replacement for Windows' `OLECLI`); WinBox has no `OLECLI` module.
- [[read out]] Win32s' setup runs 16-bit programs and DLLs of its own (`_MSTEST.EXE`, `SETUP.EXE`, the `MS*STF.DLL` toolkit, `INIUPD.DLL`): they need 189 functions of `KERNEL`, `USER`, `GDI`, `KEYBOARD` and `LZEXPAND`, 186 of them implemented (`KERNEL`: 56 of 59). Widget Workshop's install already starts that setup (it ends at the enhanced-mode check, [[topic:cd-rom]]).
- [[read out]] The count of what is implemented moves as the Win16 modules are completed; the JSON is regenerated rather than edited.

## Making the lists

```
python3 -I scripts/kb/win32s-expand.py DISC/WIN31/WIN32S OUT_EXPANDED   # a new folder, outside the repository
python3 -I scripts/kb/win32s-inventory.py DISC/WIN31 OUT_EXPANDED \
  DISC/INSTALL.EXE DISC/TUTORIAL/WIDGET/WIN3_1.EXE DISC/TUTORIAL/WIDGET/WIN95.EXE > inventory.json
npx tsx scripts/kb/win32s-coverage.ts inventory.json > kb/data/win32s-imports.json
```

`DISC` is the disc's files, as extracted (`corpus/cache/widget/widget.iso`). The scripts read nothing but the folders and files named, and the JSON keeps only names, ordinals, sizes and counts.

## Not yet done

- Win32s itself, deferred: a loader for PE files; `W32S.386`'s part in giving a 32-bit program its address space and selectors; the 16-bit side (`WIN32S16.DLL`, `W32SYS.DLL`) that starts a PE program (`EXECPE`, `BOOTTASK`); and `WinExec` of a PE file as Windows with Win32s does, not the DOS session of [[probe:winexpe]].
- None of Win32s' files has been disassembled. What the 2,123 exports of `W32SCOMB.DLL` and the 96 of `W32SKRNL.DLL` do, which are stubs, how an import of `KERNEL32.DLL` reaches `W32SCOMB.DLL`, how `WING32.DLL` reaches `WING.DLL`, and what Win32s does with a PE header's subsystem version are not read out.
- The Win16 functions above that WinBox lacks, and the two modules it has none of: `WINSOCK` (47 ordinals, whose names were not read out) and `OLESVR` (11), and `OLECLI` (Win32s' 1.32, 260 exports).
- Whether the 399 functions Widget Workshop needs work under Win32s as Windows runs them: not measured. Nothing was run.
