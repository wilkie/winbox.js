---
kind: function
module: KERNEL
name: LoadLibrary
ordinal: 95
summary: Loads a library, or finds one already loaded by its module's name — the file's name before the dot, whatever follows it.
versions:
  '3.1': exact
probes: [loadname, freelib, loadpath, search, execlib, krnlfile]
source: crates/winbox-win16/src/modules_kernel.rs
topics: [dynamic-link-libraries, finding-files]
---

## Observed behaviour

[[measured]] [[probe:loadname]] asks for GDI, which is always loaded, by eight names. It compares each answer with the instance `LoadLibrary("GDI.EXE")` gave, and frees each again.

- **By its module's name:** `GDI.`, `GDI`, `GDI.EXE`, `gdi.`, `gdi.exe`, `GDI.DLL` and `C:\WINDOWS\SYSTEM\GDI.EXE` all answer GDI. Only the name before the dot counts, in any case, whatever the extension or the directory. `USER.` answers USER.
- [[fn:KERNEL.GetModuleHandle]] is stricter. `GDI`, `GDI.EXE`, `gdi.exe` and the full path find GDI, but `GDI.`, `gdi.` and `GDI.DLL` find nothing. A name with a dot is taken as a file, and matched against the module's file.

A library that is not loaded is found as [[probe:loadpath]] and [[probe:freelib]] record. [[measured]] A name alone is looked for in the current directory, then Windows' directory, the system directory, the asking program's directory, and PATH's directories ([[probe:search]], [[topic:finding-files]]).

- [[measured]] **A program's file** answers 5 ([[probe:execlib]], both modes): `LoadLibrary("EXECLIBC.EXE")`, a program whose import names a library that is nowhere. [[read out]] `LoadModule` answers 5 for a module whose header's flags lack 8000h, a library's, when its parameter block is `LoadLibrary`'s FFFF:FFFF (`KRNL386.EXE` seg2 `17e5`-`1800`), once the module's database is made and before its imports are looked for (`1923`); nothing of it is left loaded. `WinExec` and `LoadModule` of the same program answer 2, the library's file not found, as `LoadLibrary("NOLIBQI.DLL")` does.
- [[measured]] **KERNEL's other file** answers nought ([[probe:krnlfile]], both modes). Windows runs `KRNL386.EXE` on a 386 in either mode, and `LoadLibrary("KRNL386.EXE")` answers KERNEL; `KRNL286.EXE`, by its name or its whole path, and a copy of `KRNL386.EXE` under another name, answer nought. A copy of another library loaded already (`VER.DLL` as `VERCOPY.DLL`) loads as a module of its own: the module's name in the file is not looked for among the modules loaded. [[read out]] Nought is `LoadModule`'s answer where linking the new database into the list of modules fails (seg2 `183a`-`1857`, through `0ba3`), which sizes the reserve for discardable code by the largest such segment of any module (seg3 `044e`, seg1 `2cd8`). [[inferred]] KERNEL's own database was never linked so, and the copy's segments raise the reserve past what can be had; why that fails is not followed further. InstallShield's `~TMPnnnn` setups load `KRNL286.EXE` in standard mode for three procedures (`GetProcAddress` of each, nought answered for each in Windows); WinBox loaded Windows' file as a second KERNEL, and its code faulted (`TRAINS_WIN`, `LAUGHS_WIN`; [[guide:compatibility]]).

## Why it matters

The Visual Basic runtime loads the library each `Declare` names, with a dot after it: `LoadLibrary("GDI.")`. winbox.js looked for a file `GDI.`, found none, and answered 2. StarMerc said "File not found". Found by its name, StarMerc runs on to the check Windows' own run stops at, a display driver that cannot stretch bitmaps, and its screen matches Windows' pixel for pixel.
