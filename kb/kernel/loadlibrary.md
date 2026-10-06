---
kind: function
module: KERNEL
name: LoadLibrary
ordinal: 95
summary: Loads a library, or finds one already loaded by its module's name — the file's name before the dot, whatever follows it.
versions:
  '3.1': exact
probes: [loadname, freelib, loadpath, search]
source: src/win16/library.ts
topics: [dynamic-link-libraries, finding-files]
---

## Observed behaviour

[[measured]] [[probe:loadname]] asks for GDI, which is always loaded, by eight names. It compares each answer with the instance `LoadLibrary("GDI.EXE")` gave, and frees each again.

- **By its module's name:** `GDI.`, `GDI`, `GDI.EXE`, `gdi.`, `gdi.exe`, `GDI.DLL` and `C:\WINDOWS\SYSTEM\GDI.EXE` all answer GDI. Only the name before the dot counts, in any case, whatever the extension or the directory. `USER.` answers USER.
- [[fn:KERNEL.GetModuleHandle]] is stricter. `GDI`, `GDI.EXE`, `gdi.exe` and the full path find GDI, but `GDI.`, `gdi.` and `GDI.DLL` find nothing. A name with a dot is taken as a file, and matched against the module's file.

A library that is not loaded is found as [[probe:loadpath]] and [[probe:freelib]] record. [[measured]] A name alone is looked for in the current directory, then Windows' directory, the system directory, the asking program's directory, and PATH's directories ([[probe:search]], [[topic:finding-files]]).

## Why it matters

The Visual Basic runtime loads the library each `Declare` names, with a dot after it: `LoadLibrary("GDI.")`. winbox.js looked for a file `GDI.`, found none, and answered 2. StarMerc said "File not found". Found by its name, StarMerc runs on to the check Windows' own run stops at, a display driver that cannot stretch bitmaps, and its screen matches Windows' pixel for pixel.
