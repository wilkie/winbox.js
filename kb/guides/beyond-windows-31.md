---
kind: guide
name: Beyond Windows 3.1
summary: An overview of taking WinBox past Windows 3.1 — Win32s, Windows 95 and OS/2 — what each brings for archival and for play, with archive.org's counts; the order recommended (Win32s, the second oracle, Windows 95, OS/2 1.x, OS/2 2.x) and why; what changes in the crates, the knowledge base, the catalog and the compatibility table; and the owner's decisions.
---

This page is a design, not built. On 2026-11-15 the owner asked for high-level emulation of the systems after Windows 3.1, for software archival and for recreation. Three pages hold the detail: [[guide:win32]] (Win32s, then Windows 95), [[guide:os2]] (OS/2 1.x, then 2.x and later) and [[guide:oracle-next]] (how each is recorded). This one sets them side by side. It follows the model of [[guide:enhanced-mode]] and [[guide:compatibility]].

## What each brings

[[measured]] archive.org's counts, metadata only (`scripts/catalog/other-systems.mjs`, written to `catalog/other-systems.json` on 2026-11-16). archive.org has a curated software library for Windows 3.x and none for the systems after it: no Windows 95 or OS/2 collection exists. Their software is spread over the CD-ROM and vintage-software collections (`vintagesoftware`, `cd-roms`, `cdromsoftware`, `open_source_software` and the like), so each count below is a search of the items' subjects and titles: what uploaders called them, some items counted that are the system's own media or about it, and items missed that name no system. Bytes are archive.org's `item_size`, which counts every file of an item, derived files and screenshots among them, and disc images whole.

| Group               | Items  | Bytes (`item_size`) | Run in archive.org's browser emulators | Search                                                |
| ------------------- | ------ | ------------------- | -------------------------------------- | ----------------------------------------------------- |
| Windows 3.x library | 2,706  | 48.1 GB             | 2,672 in DOSBox                        | the collection `softwarelibrary_win3`, for comparison |
| Windows 95          | 7,656  | 10.9 TB             | 48 in DOSBox, 1 in v86                 | subject or title "Windows 95" or "Win95"              |
| Windows 98          | 4,378  | 8.8 TB              | 4 in DOSBox, 1 in v86                  | "Windows 98" or "Win98"                               |
| Windows 95 and 98   | 11,427 | 13.7 TB             | 56 in DOSBox, 2 in v86                 | the two above and "Windows 9x", each item once        |
| Win32s              | 34     | 6.3 GB              | 1 in DOSBox                            | "Win32s"                                              |
| OS/2                | 1,342  | 1.0 TB              | 9 in DOSBox                            | "OS/2", "OS2", "OS/2 Warp", "eComStation" or "ArcaOS" |

[[measured]] For comparison, the Windows 3.x catalog's 2,284 programs hold 36.4 GB in the downloads that carry a program (`catalog/catalog.json`'s `size`); its library's `item_size` is 48.1 GB.

[[measured]] **Win32s in the Windows 3.x catalog itself** (`catalog/results.json`, counted by the same script): 19 of its 2,284 items need Win32s, 11 games and 8 applications. 3 run a PE program (status `win32s`); the other 16 carry Win32s' files in their download, of which 4 are `idle` today, 6 `not-windows`, 3 `installer`, 2 `fault` and 1 `fetch`.

| System            | For archival                                                                                                                                                                               | For play                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Win32s**        | The first 32-bit Windows programs (1992-1996), many shipped for Windows 3.1 and Windows NT together; Widget Workshop's `WIDGET.EXE` among the catalog's                                    | a few games (the catalog's 11), FreeCell                                                      |
| **Windows 95**    | The largest body of software after DOS's: items naming Windows 95 are nearly three times the Windows 3.x library on archive.org, and with Windows 98 some four times; most of it on CD-ROM | the games of 1995-1999, most of them DirectX                                                  |
| **OS/2 1.x**      | A small, poorly preserved body: early PM programs, Family API tools                                                                                                                        | little                                                                                        |
| **OS/2 2.x-Warp** | Business and banking software, ports, the period's shareware                                                                                                                               | a few native games; most OS/2 users played DOS and Windows games, which DOSBox and WinBox run |

The archival and play columns are [[inferred]]: they are the period's reputation, not counts. The counts that matter are taken from the programs' headers once each system has a catalog (below).

## The order recommended

1. **Win32s.** It is Windows 3.1: the oracle already runs it (386 enhanced mode, [[guide:enhanced-mode]]), WinBox's USER and GDI are what it thunks to, DPMI and paging are built, and the catalog has programs waiting. What is new is a PE loader and Win32's 32-bit faces of modules WinBox already has. Every part of it is needed again for Windows 95.
2. **The second oracle.** QEMU on instruction counts ([[guide:oracle-next]]). Nothing about Windows 95 or OS/2 is built before it records, as nothing about Windows 3.1 was. Its trials (does Windows 95 install and run deterministically in QEMU 8.2.2) decide whether the next two steps can be measured at all.
3. **Windows 95.** The largest audience, and the most reuse after Win32s: the PE loader, the Win32 modules begun, USER and GDI as machinery. Win16 programs on Windows 95 come first, as a system of their own, then Win32's processes, threads, virtual memory and exceptions, then DirectX.
4. **OS/2 1.x.** It reuses WinBox's NE reader, selectors and calling convention, but needs threads (built for Windows 95 by then), a text session and a second window system, Presentation Manager, whose semantics carry little from USER. Few programs.
5. **OS/2 2.x and later.** A new loader (LX), 32-bit PM, and the conventions between 16- and 32-bit code: the furthest from what WinBox has.

[[inferred]] Why not OS/2 1.x earlier: its reuse of the NE path is real, but its audience is the smallest, and the threads and the second oracle it needs are built for Windows 95 anyway. If the owner wants OS/2 for its own sake, 1.x can move before Windows 95 without changing anything else (the open question of [[guide:os2]]).

## What changes in the project

### The crates

- **Readers beside `winbox-ne`.** `winbox-pe` (headers, sections, relocations, imports, exports, the resource tree) and later `winbox-lx` (objects, pages, fixups). Both, like `winbox-ne`, read files and know nothing of a system.
- **Win32s inside `winbox-win16`.** Win32s is part of Windows 3.1's machine: its modules (`KERNEL32`, `USER32`, `GDI32` and the rest) share the `System`, the tasks and the Rust behind USER and GDI. They start as a module tree of the crate's own, as `commdlg/`, `ddeml/` and `mmsystem/` are.
- **A shared engine before Windows 95 or OS/2.** [[inferred]] `winbox-win16` holds both the engine (the run loop, the trap protocol, the scheduler, the virtual clock's charges, the window machinery) and Windows 3.1's modules: 241,951 lines of Rust today, against 7,437 in `winbox-cpu` and 15,407 in `winbox-raster` (counted 2026-11-15). Windows 95 can grow from it (its USER is 3.1's grown). OS/2 cannot: PM is not USER. Before OS/2, the engine and the window machinery move to a crate both use (`winbox-engine`, say), and `winbox-os2` is a crate beside `winbox-win16`. That move is a phase of its own, measured by the replay and the corpus being unchanged.
- **The front ends.** `winbox-web` and `winbox-native` choose a machine's system as they choose its mode ([[guide:enhanced-mode]], phase 1): per install, kept with it.

### The knowledge base

- **Modules per system.** Pages are `kb/<module>/<function>.md` today, for Windows 3.1's modules. Win32's and OS/2's module names do not clash with them: `kb/kernel32/`, `kb/user32/`, `kb/gdi32/`; `kb/doscalls/`, `kb/pmwin/`, `kb/pmgpi/`. Each system's survey of exports is `kb/data/exports-<system>.json`, as `exports-3.1.json` is, made from the owner's files and holding names and ordinals only.
- **Versions.** The spec versions pages by Windows release (3.0, 3.1, 3.11; `KNOWLEDGE_BASE_SPEC.md`). Windows 95 is a version of the Win16 modules' pages too: `USER.CreateWindow` on 4.0 is a section of the same page, as 3.0's would be. OS/2's modules are pages of their own, with their own versions.
- **Evidence.** A [[measured]] claim names the system and mode it was measured on wherever they differ, as enhanced mode's do now ([[guide:enhanced-mode]], "The corpus and the probes"); probes' fixtures sit in a folder per system (`oracle/fixtures/win95/`, `os2/`).

### The catalog and the compatibility table

- **A catalog per system.** `catalog/catalog.json` stays Windows 3.x's. Windows 95's and OS/2's are catalogs of their own, made by the same scripts, from the searches above (no curated collection to start from). Their `needs` read a PE or LX header and its imports, as Windows 3.x's read NE ([[guide:compatibility]], "What a program needs").
- **The first pass per system,** on the system's machine, once it runs anything.
- **The table** gains a system column, and a program known on two systems (a Win32s program also sold for Windows 95) is one row with a status per system.

## The owner's decisions

From the three pages, each in its own words there:

1. **The order** above: Win32s, the oracle, Windows 95, OS/2 1.x, OS/2 2.x. Or OS/2 earlier.
2. **The oracle's emulator** for Windows 95 and OS/2 ([[guide:oracle-next]]): QEMU on instruction counts, DOSBox-X as a second witness; whether a patched Windows 95 is a reference; whether OS/2 1.x recorded without determinism (86Box) is accepted.
3. **The reference releases and their media,** the owner's own: Win32s 1.25 or 1.30c; Windows 95 retail or OSR2, with which DirectX; OS/2 1.3, 2.1, Warp 3 or 4, with which FixPak.
4. **Win32s' design** ([[guide:win32]]): WinBox's own Win32 modules, held to Win32s on the oracle (recommended), or Microsoft's Win32s run on WinBox.
5. **A machine's system** as a third choice beside its display and mode, per install.
6. **Threads** preempted at instruction counts on the virtual clock: deterministic, and not the oracle's interleaving.
7. **The shells** (Explorer, the Workplace Shell) out of scope; DirectX and Direct3D in or out.
8. **The engine's split** into a shared crate before OS/2.
9. **Catalogs for Windows 95 and OS/2:** fetching archive.org's items to read their headers (thousands of items, many of them disc images of hundreds of megabytes), as the Windows 3.x first pass fetched its 2,284, or the metadata alone for now.

## Not yet done

Everything but the counts: no phase of any system is begun, and no emulator was run for these pages ([[guide:oracle-next]], "What must be tried first").
