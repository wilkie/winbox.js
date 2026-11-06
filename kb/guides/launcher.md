---
kind: guide
name: The launcher
summary: A design for WinBox's launcher, on the page and in the native front end — a pop-out menu of the Program Manager groups each install made, an item run on the stack its install was kept as, several programs at once each on a machine of its own, and folders shared with the host — with the decisions still open.
---

This page is a design. Nothing on it is built yet unless it says so. It follows [[guide:without-windows]] (step 5, after the PROGMAN stand-in) and builds on what the page and the native front end already keep: programs kept as layered stacks ([[format:layer]]), the groups their installers made ([[topic:program-manager-dde]], [[format:grp]]), and disk and CD images as drives ([[topic:drives-and-disks]]).

The launcher is WinBox's, not Windows'. Windows 3.1 has Program Manager, and WinBox keeps its stand-in for the installs, where installers talk to it. The launcher sits outside the emulated machine, in the host's interface, the way a host's own start menu does. So the fidelity rule applies to what a launched program sees, and not to how the launcher looks.

## What it is

A launcher button opens a menu. It lists the groups the installs made, one entry for each group, and each group opens to its items, with their icons. Choosing an item runs it.

- **Where the groups come from.** Each group comes from the kept program whose install made it. The page reads them already, from each kept program's own layers: `PROGMAN.INI` and the `.GRP` files it names (`src/run/page/groups.ts`, `programGroups` in `src/layers/groups.ts`). The Kept programs panel shows them today.
- **What an item is.** An item is a `.GRP` file's item: its name, its command line, its working directory, its icon (path and index, drawn by `src/run/group-icon.ts`), its hot key, and whether it starts minimized ([[format:grp]]).
- **Groups with the same name.** Two installs can both make a group called, for example, "Accessories". Their groups are kept apart and labelled with their install's name; they are never merged.
- **Items that cannot run.** Some items name a program the stack does not have. SimTower's "Read Me" opens WRITE.EXE and its "Help" opens WINHELP.EXE, and neither is in the asset bundle. Such an item is shown but disabled, with the reason given: "needs WRITE.EXE, which is not in this Windows".
- **Programs not installed.** Programs kept loose, dropped as an archive and never installed, have no groups. The launcher lists them in a group of their own, made by WinBox from the kept program's `.EXE` files, as the Programs panel lists them now.

The menu is a WAI-ARIA menu button and menu, with submenus. It is keyboard navigable and its items are named. On the page it is an MUI `Menu` and nested menus. Natively it is a menu of the host's own, for which see [The native front end](#the-native-front-end).

## Running an item

An item runs on its install's stack:

1. **The C: drive.** C: is the base the install was made on, then the install's layers, then the program's user layer, which holds what it writes as it runs ([[format:layer]]).
2. **Images.** The install's kept images are mounted at the letters they were pinned to. Those it cannot find are asked for again, as choosing a kept program does today (`choose`, `src/run/page/install.ts`).
3. **Display.** The display the install is bound to is used. That binding is the owner's decision of 2026-10-21.
4. **Command line, working directory and show state.** These come from the item. This is what Program Manager does when an item is opened, and it is the question "running group items (args/dir/show)" left open on 2026-10-23. Program Manager's run of an item is to be read out of `PROGMAN.EXE` (seg:off) before it is built, as everything is.

Today the page runs a single machine, and choosing a kept program rebuilds it on that program's stack (`rebuild`, `src/run/page/machine.ts`). Choosing an item can begin as exactly that, plus the item's command line. Running items from two different installs at once needs the decision in the next section.

## Several programs at once, each with its own drives

Two items from two installs are two stacks, so two different C: drives. Windows 3.1 has one file system, which every task shares. It also has one module table, so a second program that loads `WAVEMIX.DLL` is given the copy the first loaded. And it has one `WIN.INI` and one `SYSTEM.INI`. So there are two ways to run both at once.

### A. A machine for each stack (the owner's choice)

Each running stack gets a machine of its own: its own Windows, its own C:, its own screen. A second item from the same install runs on the machine already running that stack, so its programs share a Windows and can talk to one another (DDE, the clipboard, OLE), as they would under Windows.

- **Fidelity.** Each machine is a whole, consistent Windows, exactly as the probes and the corpus run it, so nothing new is invented inside the engine.
- **On the page.** Each machine is an engine instance of its own: a wasm instance, or the TypeScript engine, with a canvas of its own. Each machine's screen is a tab of its own, and the person switches between them. Later it may become a floating window, one for each top-level window of a machine's, which is [[guide:seamless-windows]] brought to the page.
- **Natively.** Each machine is a process of its own (`winbox-native --program … --seamless`), started by the launcher. Seamless mode already shows each top-level window as a host window, so programs from different machines mix on the host's desktop as host programs do.
- **What it gives up.** Programs on different machines cannot talk to each other through Windows. The host's clipboard can be bridged later, in each machine, as host programs share it: CF_TEXT and CF_BITMAP at first. That bridge is WinBox's own and sits outside Windows' behaviour, and would be documented as such.
- **Cost.** Each machine's memory: a few tens of megabytes for each wasm instance. And each machine's CPU: on the page, every machine shares the page's one thread until machines move into Web Workers, which the engines' interfaces allow but nothing does yet.

### B. One machine, each task with its own C:

One Windows runs every stack. DOS answers each task's file calls from that task's own C:. WinBox owns DOS, so routing by the current task is possible.

The design does not recommend this. It is a behaviour Windows does not have, so it has to be invented, and programs could see it:

- **Modules.** A second install's `WAVEMIX.DLL` is never loaded, because the first's is already in the module table.
- **Profiles and system folders.** `WIN.INI` and `SYSTEM.INI`, and `C:\WINDOWS\SYSTEM`, would each need a single answer for every task. That would mean either one merged view or each task's own, and both would be invented.
- **Shared names.** A file name passed from one task to another, by DDE, by OLE, or on a command line, would name a different file in each.

It may be reconsidered later, for a case A cannot serve, with each of these questions answered from a probe. Until then the engines keep one file system for each machine, as Windows does.

## Sharing a folder with the host

A machine can be given a host folder as a drive, beside its stack, so that files can come in and go out without the file browser's upload and download.

- **Natively.** `--mount` mounts images today, and a host folder would be a new kind. Its drive behaves as DOSBox's `localDrive`, a host folder seen by DOS. The oracle's own C: is one of these, so how it lists, stamps and answers is already measured ([[topic:drives-and-disks]], "A folder as DOS lists and keeps it", and the `rootattr` records). Names on the host that are not valid 8.3 names are left out or shortened, as DOSBox does; which of the two is to be measured first.
- **On the page.** A folder is opened with the File System Access API's directory picker. This exists in Chromium only, so elsewhere sharing is the file browser's upload and download. The folder's handle is kept in IndexedDB, as image handles are, and permission is asked again on each visit. It is read-only unless the person grants writing.
- **Two machines sharing a folder.** Each machine keeps no cache of the folder, so a file one machine writes is read by the other when the file is next opened. Two machines writing the same file at once are not locked against each other. DOS's sharing modes (`SHARE`) hold within a single machine only. This is stated, not solved.
- **Where the drive goes.** A shared folder is never C:, and it is never written into a layer. It is the first free letter after the images, or one the person picks, kept with the kept program like an image's pinned letter.

## The page

The launcher is a view over the page's state and actions, which are kept apart from the components (see the "The run page" section in `ARCHITECTURE.md`). Three improvements to the page, which the owner asked for on 2026-11-06, are being built now, and the launcher reuses them:

- **Screen scaling.** The screen stretches to fit its space. Each machine's panel uses the same scaling.
- **Drives view.** The view of drives shows floppy, CD and hard disk images distinctly, with their state: which disk is inserted, overlays written, handles kept. Each machine's drives are shown with that machine.
- **File browser.** A dialog for browsing the file system. It browses a single machine's drives, and the launcher opens it on the machine an item runs on.

These are the page's own requirements:

- **Storage.** It stores in IndexedDB, as now: kept programs, their layers and blobs, and handles on images and folders. It keeps no copy of an image unless asked to.
- **Startup.** It opens with the launcher shown and no machine running. Choosing an item starts one.
- **Several machines.** Several machines fit within one tab. Each has a Close action, which first keeps what its programs wrote, as `keepNow` does.

## The native front end

The native front end has the same model, with these differences:

- **Library.** The kept programs live in a folder, a library: each stack's layers materialised as folders (`--layer-from`, as P6 made them), its user layer, its images' paths, and a record of each kept program, laid out as the page's `KeptProgram` is. The library's place follows each host's convention: `%APPDATA%\WinBox` on Windows, `$XDG_DATA_HOME/winbox` on Linux, `~/Library/Application Support/WinBox` on macOS.
- **Launcher.** The launcher is a small window of the native front end's own, with the menu, and `winbox-native --launcher` opens it. Its groups stay in that window; they are not written into the host's start menu (the owner's decision). `winbox-native --launch <program> <item>` runs an item without the window.
- **Running an item.** Each item runs as its own process (design A). The launcher only starts processes and reads the library, so it holds no machine of its own.
- **Installing.** The launcher runs `--install`, as now, and adds the install to the library as `--keep` does.

## Write and Help of WinBox's own

The asset bundle has no `WRITE.EXE` or `WINHELP.EXE`, so an install's "Read Me" (a `.WRI`) and "Help" (a `.HLP`) items cannot run, and neither can a program's own Help menu, which calls [[fn:USER.WinHelp]]. WinBox could have programs of its own for both, under its own names, as its other stand-ins are. Each is a project of its own, after the launcher:

- **Help.** A program calls [[fn:USER.WinHelp]], and USER passes the request to the Windows Help window, starting `WINHELP.EXE` if it is not running. WinBox's Help would answer as that window does, which is to be read out of `USER.EXE` and `WINHELP.EXE` and recorded first. It would show the `.HLP` file: its topics, its contents, its links and pop-ups, and searching by keyword. The `.HLP` format would be a new page under kb/formats/, read out of `WINHELP.EXE` and checked against real help files.
- **Write.** It would at least open a `.WRI` file and show it as Write lays it out, with its fonts, its paragraphs and its pictures. The `.WRI` format would also be a new kb/formats/ page.
- **How each is built.** Each could be a Win16 program written in C with the probe toolchain. It would then run unchanged on both engines, with no twin to keep, and be held to the oracle like any program. Or it could be an engine task, as the PROGMAN stand-in is, written once in each engine. The first is the lighter of the two to keep.
- **The launcher.** Once they exist, items that need them are no longer disabled. Until then, the launcher's reason says what is missing.

## The order of the work

1. **A stack's groups in one place.** The groups of every kept program and their items, as one list each front end reads (TypeScript: from the page's store; Rust: from the library). Unit tests on caribb's and SimTower's group files, as the corpus keeps them.
2. **An item run as Program Manager runs it.** Read it out of `PROGMAN.EXE`: the command line split into program and arguments, the working directory, the show state, the minimized flag, and what it does when the program is not found. Record it with a probe that runs items of a group made for it, in both engines.
3. **The page's launcher menu.** It runs a single machine, as now: choosing an item rebuilds on its stack and runs it.
4. **Several machines on the page** (design A): an engine instance and a tab for each machine, Close and keep on each, and the trace panel following the machine in focus.
5. **The native library and launcher window,** with `--launcher` and `--launch`.
6. **Host folders as drives,** natively first (DOSBox's `localDrive`, measured), then the page's directory handle.
7. **Later:** WinBox's own Write and Help, the shared clipboard between machines, machines in Web Workers, and floating windows on the page.

## The owner's decisions

Decided on 2026-11-06:

- **A machine for each install.** Design A is the model: each install runs on an emulated Windows of its own, and a second item from the same install joins the machine already running it.
- **Tabs on the page.** Machines running at once are tabs, and the person switches between them.
- **The native launcher keeps its groups to itself.** They are shown in the launcher's own window and never written into the host's start menu.
- **Shared folders are read-only by default,** on both front ends. Writing is granted by the person for each folder.
- **Each install keeps its own `PROGMAN.INI`** in its layers. There is no base copy shared between installs.

## Not yet done

All of it. The page's three improvements are being built (2026-11-06). Program Manager's running of an item has not been read out.
