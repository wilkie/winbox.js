---
kind: guide
name: The launcher
summary: A design for WinBox's launcher, on the page and in the native front end — a pop-out menu of the Program Manager groups each install made, an item run on the stack its install was kept as, several programs at once each on a machine of its own, and folders shared with the host — with the decisions still open.
---

This page is a design. Nothing on it is built yet unless it says so. It follows [[guide:without-windows]] (step 5, after the PROGMAN stand-in) and builds on what the page and the native front end already keep: programs kept as layered stacks ([[format:layer]]), the groups their installers made ([[topic:program-manager-dde]], [[format:grp]]), and disk and CD images as drives ([[topic:drives-and-disks]]).

The launcher is WinBox's, not Windows'. Windows 3.1 has Program Manager, and WinBox keeps its stand-in for the installs, where installers talk to it. The launcher sits outside the emulated machine, in the host's interface, the way a host's own start menu does. So the fidelity rule applies to what a launched program sees, and not to how the launcher looks.

## What it is

A launcher button opens a menu. It lists the groups the installs made, one entry for each group, and each group opens to its items, with their icons. Choosing an item runs it.

- **Where the groups come from.** Each group comes from the kept program whose install made it. The page reads them from each kept program's stack: `PROGMAN.INI` and the `.GRP` files it names, its own layers' alone, through `launchGroups` (`src/run/page/groups.ts`, `src/layers/launch.ts`). The Kept programs panel and the launcher's menu show them.
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
4. **Command line, working directory and show state.** These come from the item, as Program Manager's File Open takes them ([[topic:program-manager-dde]], "Running an item"; [[probe:pmitem]]). The command's first word is the file and the rest its parameters, given to `ShellExecute` with the working directory made upper case, the Windows directory where the item has none, and `SW_SHOWMINNOACTIVE` for an item marked minimized, else `SW_SHOWNORMAL`. A document is opened by the program its association names. A working directory that is not there is asked about, and the program runs in the Windows directory if the person goes on.

The page runs a machine for each install, each a tab (step 4, below): choosing an item starts it on its install's machine, made where none runs.

## Several programs at once, each with its own drives

Two items from two installs are two stacks, so two different C: drives. Windows 3.1 has one file system, which every task shares. It also has one module table, so a second program that loads `WAVEMIX.DLL` is given the copy the first loaded. And it has one `WIN.INI` and one `SYSTEM.INI`. So there are two ways to run both at once.

### A. A machine for each stack (the owner's choice)

Each running stack gets a machine of its own: its own Windows, its own C:, its own screen. A second item from the same install runs on the machine already running that stack, so its programs share a Windows and can talk to one another (DDE, the clipboard, OLE), as they would under Windows.

- **Fidelity.** Each machine is a whole, consistent Windows, exactly as the probes and the corpus run it, so nothing new is invented inside the engine.
- **On the page.** Each machine is an engine instance of its own: a wasm instance, with a canvas of its own. Each machine's screen is a tab of its own, and the person switches between them. Later it may become a floating window, one for each top-level window of a machine's, which is [[guide:seamless-windows]] brought to the page.
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

- **Library** (built, step 5; [[format:library]]). The kept programs live in a folder, a library: each stack's layers materialised as folders (`--layer-from`, as P6 made them), its user layer, its images' paths, and a record of each kept program, laid out as the page's `KeptProgram` is. The library's place follows each host's convention: `%APPDATA%\WinBox` on Windows, `$XDG_DATA_HOME/winbox` on Linux, `~/Library/Application Support/WinBox` on macOS.
- **Launcher** (built, step 5). The launcher is a small window of the native front end's own, with the menu, and `winbox-native --launcher` opens it. Its groups stay in that window; they are not written into the host's start menu (the owner's decision). `winbox-native --launch <program> <item>` runs an item without the window.
- **Running an item.** Each item runs as its own process (design A). The launcher only starts processes and reads the library, so it holds no machine of its own.
- **Installing.** The launcher runs `--install`, as now, and adds the install to the library as `--keep` does.

## Write and Help of WinBox's own

The asset bundle has no `WRITE.EXE` or `WINHELP.EXE`, so an install's "Read Me" (a `.WRI`) and "Help" (a `.HLP`) items cannot run, and neither can a program's own Help menu, which calls [[fn:USER.WinHelp]]. WinBox could have programs of its own for both, under its own names, as its other stand-ins are. Each is a project of its own, after the launcher:

- **Help.** A program calls [[fn:USER.WinHelp]], and USER passes the request to the Windows Help window, starting `WINHELP.EXE` if it is not running. WinBox's Help would answer as that window does, which is to be read out of `USER.EXE` and `WINHELP.EXE` and recorded first. It would show the `.HLP` file: its topics, its contents, its links and pop-ups, and searching by keyword. The `.HLP` format would be a new page under kb/formats/, read out of `WINHELP.EXE` and checked against real help files.
- **Write.** It would at least open a `.WRI` file and show it as Write lays it out, with its fonts, its paragraphs and its pictures. The `.WRI` format would also be a new kb/formats/ page.
- **How each is built** (the owner's decision, 2026-11-06). Each is a Win16 program written in C with the probe toolchain. It runs unchanged on both engines, with no twin to keep, and is held to the oracle like any program. It is not an engine task, as the PROGMAN stand-in is.
- **The launcher.** Once they exist, items that need them are no longer disabled. Until then, the launcher's reason says what is missing.

## The order of the work

1. **A stack's groups in one place** (done, 2026-11-06). `launchGroups` in `src/layers/launch.ts` and its twin `launch_groups` in `crates/winbox-win16/src/launch.rs` list every kept program's groups, in Program Manager's start-up order. Each install's groups come from the `PROGMAN.INI` its own layers keep. A program kept loose gets WinBox's own group of its `.EXE` files, marked as WinBox's. Each item has its name, command line, working directory, icon, hot key and minimized flag. Each item also says what running it does: the program found as Program Manager and SHELL find it, or why there is none, such as "needs WRITE.EXE, which is not in this Windows" or "nothing in this Windows opens .ZQX files". The twins are held to one file, `test/layers/launch.json`, made from built-up group files, a `WIN.INI` and a registration database. Caribbean Treasure's install is tested (`crates/winbox-win16/tests/install_caribb.rs`). The page and the native library are yet to call them.
2. **An item run as Program Manager runs it** (done, 2026-11-06). It was read out of `PROGMAN.EXE` (seg5 `05cc`, `067d`, `03e7`, `01b3`; seg1 `00ec`), recorded by [[probe:pmitem]], and followed by WinBox's own Program Manager in both engines. That probe agrees whole with WinBox's Program Manager and with Microsoft's ([[topic:program-manager-dde]], "Running an item").
3. **The page's launcher menu** (done, 2026-11-06). A **Programs** button in the page's banner, beside its heading, opens it: in the banner it is in the same place at every width, the first control after the skip link, as a host's start menu is (`src/run/ui/launcher.tsx`). It is a WAI-ARIA menu button and menu, with a submenu for each group (MUI `Menu`s). The arrows, Home, End and a letter move in a menu; Right, Enter or Space opens a group's items; Left or Escape goes back to the group; Escape again closes the menu, the focus back on the button. The groups are `launchGroups`' for every kept program, read by `src/run/page/groups.ts`: each stack is its base, from the Windows dropped, then its layers' manifests, and only the files the list reads -- `PROGMAN.INI`, its group files, `WIN.INI` and `REG.DAT` -- are taken from the store's blobs. The Kept programs panel shows the same groups, but not WinBox's own. A group whose name another install's group has too is labelled with its install's name, `Accessories (Maxis)`. Each item has its icon from the group file's bits (`src/run/group-icon.ts`) and its name. An item that cannot run is disabled but reachable by the arrows, its reason shown and read with its name: `Cannot run: needs WRITE.EXE, which is not in this Windows.` So is every item of a program made on a Windows that is not here, or on a display this Windows does not offer. With nothing kept, the menu says how to keep a program.
   - **Running an item** (`src/run/page/launcher.ts`). Choosing an item makes its install's stack C:, as Open in Kept programs does (`choose`: its images mounted or asked for again), on the display its install is bound to. Where C: is that stack already, the machine running it is kept, and the item starts beside what runs there (design A). The program is then started given what Program Manager's File Open gives it, as [[probe:pmitem]] recorded: the program `itemRun` finds for the command (a document's by its association), the rest of the command line, the working directory made upper case as the current directory (the Windows directory where the item has none), and show 7 for a minimized item, else 1.
   - **Which route.** The run entry takes the three: the Rust engine's `Session::start_item` and `System::launch_item`, under `start_item` in `winbox-web`. Calling SHELL's `ShellExecute` inside the machine was the other route. It was not taken because `ShellExecute` is a call a task makes: the engine cannot make it before the first task exists. The Rust `ShellExecute` is an API answered as the processor runs a task. A task made only to call it would be one the program could see, as its parent and in the task list, where under Windows the parent is Program Manager. What `ShellExecute` and `WinExec` decide is `itemRun`: SHELL's and KERNEL's read-out, twinned and held to `test/layers/launch.json`. The engine is given its answer exactly as `WinExec` gives `LoadModule` its parameters. [[measured]] In a browser test (`e2e/run.spec.ts`, "runs a kept group's items from the launcher"), the `pmitem` probe's child is run from a kept group made by `GroupFile` with the probe's items. It writes the same line `pmitem` recorded under Windows for each of its args, directory, lower-case directory, bare name, minimized and document items, and for the item whose working directory is not there once OK is chosen. `crates/winbox-web/tests/item.rs` holds the Rust session to four of them.
   - **A working directory that is not there.** Program Manager asks "The working directory is invalid." in its own box, captioned "Invalid Path", with OK and Cancel, Cancel the default ([[topic:program-manager-dde]], "Running an item"). The launcher is not Program Manager, so it asks the same question with the same words in a dialog of WinBox's own, Cancel focused first. Cancel starts nothing. OK starts the program in the Windows directory, as `ShellExecute` given a directory that is not there does.
4. **Several machines on the page** (done, 2026-11-07; design A). The page holds machines (`src/run/page/state.ts`, `Machine`): each a stack -- a kept program's, or the base with what was dropped loose -- on an engine instance of its own, with its own screen (an element of its own in the desktop, hidden while another is shown), input, mirror, drives of images, display, coprocessor and sound card, install under way, trace, and keeping (`keep`, `hold` and `rebuild` take the machine). The page opens with one, on the base.
   - **Which machine.** An item chosen in the launcher runs on its install's machine: the one running its stack, shown, the item started beside what runs there; else a machine of its own made in a tab after the others, on the display its install is bound to, and shown (`open`, `src/run/page/install.ts`). Open in Kept programs does the same, and Show shows the tab of one running behind. What the side's other controls do -- a drop, a drive's actions, Install, the Programs list, the display and the coprocessor -- they do to the machine shown, taken as each begins. An installer into a kept program runs on that program's machine where one runs. No two machines run one stack: what each keeps is kept by its stack (`changesKey`), so one that would be made on a stack another runs shows that one instead (`runningOn`, `remake`). A Windows dropped or forgotten closes every other machine.
   - **Tabs** (`src/run/ui/desktop.tsx`). The WAI-ARIA tabs pattern: a tablist, "Machines", above the screen, a tab for each machine named by its install (`pmitem`; `Windows` for the base; `Installing instlay`; with its display where two share a name), the arrows moving among them with the selection following; the desktop the tab panel, labelled by the tab shown. The Close of the machine shown is beside the tablist, named with it (`Close pmitem`), and Delete on a tab closes that tab's machine, as the pattern offers. The button is not in the tablist, which may hold tabs alone (axe's `aria-required-children`), nor in its tab, whose children are presentational (`nested-interactive`). Close keeps what the machine wrote first, as `keepNow` keeps it, then ends it (`Engine.dispose`), so it asks nothing: nothing is lost but what runs, its windows and its programs' memory, as when the page is left. Closing the last tab makes a machine on the base in its place.
   - **What follows the machine shown.** Windows, Changes kept, Display, Machine, Drives, Install, Programs, the Files dialog (which browses the drives of the machine shown as it was opened), the C: card, and the trace. Kept programs and the launcher are the page's. The screen's size is chosen once for every machine. The status line is the page's one, in the banner; a line a machine in a tab behind tells is named with it (`pmitem: The program has ended, with exit code 0.`).
   - **Machines behind keep running.** Their clocks are the host's time, on both engines, as Windows' would be on a computer whose screen shows something else: paused, time would jump as the tab is shown again, timers come late, and nothing Windows does would explain it. A machine whose programs wait costs next to nothing; two kept busy share the page's thread ([[topic:timing]], "Several machines on one page").
   - **Sound.** Only the machine shown is heard (`Engine.heard`): what the others' cards play is let go of as it is made, and each machine's audio context is closed with it. Two Windows sounding at once over one another, one unseen, would be a noise nothing on the screen accounts for.
   - **What stopped two running side by side**, and what was done. The Rust engine's glue keeps one instance a module, so each instance already imported it afresh; the speaker, and its listeners on the page for a click or a key to wake it, were its own but never let go, and now are (`dispose`). The glue, once imported, is never let go by the page, nor the instance's memory with it, so an instance whose machine is closed is kept for the next made (`spare`, `src/run/engines/rust.ts`). The Rust engine's call log kept every call a run made, hundreds of megabytes in a minute of a busy program; it now lets go of what the trace has read (`System::forget_calls`). The Rust engine has no value shared by every machine (each system has its display).
   - **Tested.** `test/run/page_machines_test.ts` (the machines' stacks, names, tabs and which is shown after a close); in a browser on both engines (`e2e/run.spec.ts`, "runs two installs on two machines"): `pmitem`'s and `strings`' items make two tabs, each program writing on its own C: and not on the other's (the Files dialog), the drives panel and the trace following the tab, an item of `pmitem`'s joining its tab, Close keeping what `strings` wrote (opened again, it is there), Delete and the last tab, and axe with two tabs.
5. **The native library and launcher window** (done, 2026-11-07), with `--launcher` and `--launch` ([[format:library]]).
   - **The library** (`crates/winbox-native/src/library.rs`). The native front end's programs are kept in the host's folder for an application's data -- `%APPDATA%\WinBox`, `~/Library/Application Support/WinBox`, `$XDG_DATA_HOME/winbox` or `~/.local/share/winbox` -- or the one `--library` names: a record of each kept program as the page's `KeptProgram`, with a `mode` (`standard` where none is given; the enhanced mode's `--mode` will fill it), its layers and blobs, each stack's layers materialised as folders, its user's layer, its images by their paths on the host, and `bases.json`, where each base was last read from, so that a kept program runs without `--assets` or `--windows` given again. `--install … --keep` and `--layer-from` add to it. Programs kept before, in the cache folder's `winbox`, are not moved: where the library has none, the console names them and says how their folders map, one to one.
   - **Groups natively.** Each kept program's groups are `launch_groups`' over its whole stack, its base then its layers flattened (`FlatFiles`), each item with its icon from its group file's bits and, where it cannot run, why, in the page's words. A program whose base is not here has its groups read from its own layers and every item disabled: "NAME was made on a Windows that is not here". A DOS program's item is disabled: "C:\GAMES\DOSPROG.EXE is a DOS program, which is not run here".
   - **`winbox-native --launch NAME ITEM [--group GROUP]`** runs an item as a process of its own: C: its stack under its user's layer, its images mounted, its display, desktop or `--seamless`; started as `Session::start_item` starts the first program, given the program `item_run` found, the rest of the command line, the working directory as the current directory and the show command ([[probe:pmitem]]). A working directory that is not there is asked about on the console, Program Manager's words and Cancel the default; `--directory-anyway` is OK.
   - **`winbox-native --launcher`** is a small window of the front end's own, winit and softbuffer as the rest: the groups, each opening to its items with their icons, an item that cannot run in grey with its reason beneath the list, the keys of the page's menu, and the working directory's question in a box of its own. Choosing an item starts `winbox-native --launch` for it, with `--group`, `--library`, the launcher's `--assets` or `--windows`, `--seamless` and `--sound`; the launcher holds no machine. It draws in the system font of the Windows its programs are on. Its title tells the row selected; it has no accessibility tree yet. Why a window of its own rather than a menu of each host's is in [[format:library]].
   - **Tested** without a window: the library's records and `bases.json` read back, the groups and reasons over synthetic layers and group files, `--launch`'s start running `pmitem`'s child for five items with the lines the probe recorded under Windows, and the launcher's keys, clicks, confirmation, arguments, icons and font (`library/tests.rs`, `launcher/tests.rs`).
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

Steps 6 and 7.

- Machines in Web Workers: every machine shares the page's thread, so two busy ones each run at about half speed.
- A machine's tab cannot be moved, nor its screen floated. The screens of the machines behind are kept as they are, not shown smaller.
- The page's machines are not remembered: opened again, the page has one, on the base, and each install's machine is made as its item is chosen.

- An item on the page runs with what `itemRun` worked out from outside the machine. No environment variable is put into its command, and its program is not looked for on a drive of images. A running program does not see Program Manager either, as one started from Windows' Program Manager would: no `PROGMAN` module, and no shell window. Its parent is the task that held the processor as it started, or none.
- An item that starts a DOS program says so on the status line and is not run, as the Programs list does. Program Manager would start it through `WINOLDAP`.
- Natively, a second item from an install starts a second process on the same stack and user's layer, not a task beside the first on its machine as design A asks; the processes do not know of one another. Joining a running machine needs the launcher, or the first process, to be asked across processes.
- The native launcher window has no accessibility tree (AccessKit is not a dependency, and on Linux brings in AT-SPI over D-Bus), runs no installer, and does not see the library change while it is open. A program kept for enhanced mode is listed but not run until the native build runs that mode and `--mode` is passed ([[format:library]], "Not yet done").
- The launcher's list assumes what a stack seen from outside a machine cannot know. No environment variable is put into a command (`DoEnvironmentSubst`). `PATH` is what the caller passes. Only drive C: is there, so an item on an image's drive is listed as not found.
- SimTower's install, whose "Read Me" and "Help" need `WRITE.EXE` and `WINHELP.EXE`, is not in the repository, so no test holds its group.
