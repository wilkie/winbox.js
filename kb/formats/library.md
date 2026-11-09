---
kind: format
name: The native library
summary: WinBox's own folder of kept programs for the native front end — where it is on each host, what it holds (the page's KeptProgram records with a mode, layers, blobs, materialised stacks, user layers, where each base was read from), how --install --keep, --launch and --launcher use it, and how programs kept before it map to it.
---

The library is not a format of Windows'. It is the folder in which the native front end (`crates/winbox-native`) keeps programs, as the page keeps them in IndexedDB. It holds each program's layers ([[format:layer]]), its user's layer, and a record of it, laid out as the page's `KeptProgram` is (`src/run/store.ts`). The launcher reads the groups each install made from it, and `--launch` runs an item on its stack ([[guide:launcher]], step 5).

## Where it is

The library follows each host's convention for an application's data (`library::default_folder`, `crates/winbox-native/src/library.rs`):

| Host    | Folder                                                |
| ------- | ----------------------------------------------------- |
| Windows | `%APPDATA%\WinBox`                                    |
| macOS   | `~/Library/Application Support/WinBox`                |
| Others  | `$XDG_DATA_HOME/winbox`, else `~/.local/share/winbox` |

`--library DIR` names another, for every switch that keeps or reads programs: `--install`, `--keep`, `--program`, `--layer-from`, `--list`, `--launch` and `--launcher`. A relative `$XDG_DATA_HOME` is passed over, as the XDG specification asks.

What WinBox makes again from what it has stays in the host's cache folder (`winbox` in `%LOCALAPPDATA%`, or in `$XDG_CACHE_HOME` or `~/.cache`): the asset bundle's base for each display (`base-<assets id>-<display>`), and a `--drive` folder's deletes (`drives/`).

## What it holds

| Path                       | What                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `programs/<name>.json`     | A kept program: the page's `KeptProgram`, field for field (`name`, `base`, `display`, `layers` the lowest first, `exes`, `orders`, `kept`, and `media` where it has images, each with its file's path on the host), and `mode`. |
| `layers/<id>.json`         | A layer's manifest, byte for byte as its exchange zip holds it.                                                                                                                                                                 |
| `blobs/<sha256>`           | A file's bytes, kept once, held to its hash as it is read back.                                                                                                                                                                 |
| `layer-<stack id>/`        | A layer materialised as a folder for its stack (`materialise`), as `HostDrive::layered` and `--layer-from` read it ([[format:layer]], "On the native build's disk").                                                            |
| `users/<name>/C/`          | The program's user's layer: what it wrote, the writable top of its C:. Beside it, `removed` (what it deleted of its stack) and `identity` (the stack it was made on).                                                           |
| `users-aside/<name>-<ms>/` | A user's layer set aside, where the program's layers changed and the person chose not to put it on them.                                                                                                                        |
| `staging/<name>-<pid>/`    | An installer's run, let go of as it ends.                                                                                                                                                                                       |
| `bases.json`               | Each base a program was kept on, by its name (`base:<assets id>:<display>`, `folder:<id>`), and where on the host it was last read from: `{"assets": PATH}` or `{"windows": PATH}`, the path made whole.                        |

**`mode`.** The mode of Windows a program is run in: `standard`, which the engines run, or `enhanced` ([[guide:enhanced-mode]]). A record written before the field existed has none and is read as `standard`. Every record written now has it. `--install` and `--layer-from` write the mode given with `--mode` (standard where none is), and `--launch` and `--program` run the program in the mode its record keeps; the launcher passes `--mode` on to `--launch` for a program kept in enhanced mode. A reader built without modes (`Reader.modes` false, as the tests use it) lists such a program with its items disabled: "NAME was kept for Windows' enhanced mode, which this build does not run".

**`bases.json`.** A base given by `--assets` or `--windows` is remembered under its name each time a program is run, installed or given a layer on it. So `--program`, `--install` into a kept program, `--launch` and `--launcher` need neither switch: each reads the program's base from where it was last read. A base whose path is gone, or no longer gives the base of that name (a newer bundle, a changed installation), is not here, as on the page.

## Keeping an install

`--install NAME MEDIA --keep`, or the console's yes, adds what the installer left to the library: its layer, its blobs and its program's record (`Store::add_layer`). An install into a program kept already is made over its layers, and adds its layer above them. `--layer-from` adds a layer the same way.

## Programs kept before the library

Before the library, the native build kept programs in the cache folder's `winbox`, with the same layout. They are not moved. Where the library has no programs and the cache folder has, `--list`, `--program`, `--launch` and `--launcher` say so on the standard error, naming them. Each folder maps one to one: `blobs`, `layers`, `programs` and `users` move into the library as they are, and `layer-*` folders are made again as each stack is first run. `--library` naming the old folder uses it as it stands.

## Groups and items

A kept program's groups are `launch_groups`' (`crates/winbox-win16/src/launch.rs`, the page's `launchGroups`), over its whole stack: the base, from `bases.json` or the command line, then its layers, flattened. Its own groups are those whose `PROGMAN.INI` and group files its layers carry. A program kept loose has WinBox's own group of its `.EXE` files, named after it. Each item has its icon from its group file's bits, and, where it cannot run, why (`library::Reader::groups`), in the page's words (`launcherView`, `src/run/page/view.ts`):

- the program its command needs is not on the stack: "needs WRITE.EXE, which is not in this Windows";
- nothing opens its document: "nothing in this Windows opens .ZQX files";
- its program is a DOS program: "C:\GAMES\DOSPROG.EXE is a DOS program, which is not run here";
- its base is not here: "NAME was made on a Windows that is not here". The groups are then read from its own layers over nothing, so every item is still listed;
- it was kept for a mode the build does not run (above).

A group Program Manager would refuse says why: "Program Manager would not load it: …". One with no items says "No items". Two installs' groups of the same name are labelled with their install's name, as on the page: `Accessories (Maxis)`.

## `--launch`

`winbox-native --launch NAME ITEM [--group GROUP]` runs an item of a kept program as a process of its own (design A in [[guide:launcher]]). The item is found by its name, and by its group's where `--group` is given, each as Windows matches names, its case aside. Where several of the program's groups have an item of that name and no group is named, it is refused, and the groups are listed.

- **The machine.** C: is the program's user's layer over its stack, as `--program` makes it. Its images are mounted at their letters, and its display is its own. Seamless or desktop is as the switches say (`--seamless`), and so is `--sound`.
- **The start.** The item is started as the page's launcher starts it (`src/run/page/launcher.ts`), given what Program Manager's File Open gives it ([[topic:program-manager-dde]], "Running an item"; [[probe:pmitem]]). That is the program `item_run` finds for its command, a document's by its association, with the rest of the command line, its working directory made upper case as the current directory (the Windows directory where it has none), and show 7 where it starts minimized, else 1. It is the first program of the machine's run, started as `Session::start_item` starts the first (`library::start_item`).
- **A working directory that is not there.** The console asks Program Manager's question, "Invalid Path: The working directory is invalid.", and the default is no, Program Manager's Cancel. Yes, or `--directory-anyway`, runs the program in the Windows directory.
- **An item that cannot run** is refused, with its reason: `Missing cannot be run: needs NOSUCH.EXE, which is not in this Windows.`

## `--launcher`

`winbox-native --launcher` opens a small window of the front end's own, made with winit and softbuffer as its other windows are (`crates/winbox-native/src/launcher.rs`). It lists every kept program's groups, each opening to its items with their icons. An item that cannot run is shown in grey, and its reason is shown beneath the list as it is selected: `Cannot run: needs WRITE.EXE, which is not in this Windows.` Choosing an item starts `winbox-native --launch` for it, a child process given `--group`, `--library`, the launcher's own `--assets` or `--windows`, `--seamless` and `--sound` where the launcher was given them, and `--mode` for a program kept for another mode. The launcher holds no machine. Its groups stay in its window, and are never written into the host's start menu (the owner's decision).

- **Keys**, as the page's menu takes them: Up, Down, Home and End move; a letter moves to the next row that begins with it; Right, Enter or Space opens a group and selects its first item; Left goes back to the group, and closes it on the group; Escape on an item closes its group, and on a group closes the window. Enter or Space on an item runs it. A click opens or closes a group, and runs an item.
- **A working directory that is not there** is asked about in the launcher's own box, with Program Manager's words: "Invalid Path", "The working directory is invalid.", OK and Cancel, Cancel focused first. Left, Right or Tab move between the two, and Escape is Cancel.
- **How it draws.** It uses the system font of the Windows its programs are kept on (`SYSTEM.INI`'s `[boot] fonts.fon`, in `WINDOWS\SYSTEM`), with Windows 3.1's default colours. Each icon is drawn as `src/run/group-icon.ts` draws it on the page: the mask over the display's window colour, then the picture, in that display's colours. Where no base of a kept program is here, it has no font to draw in, so it prints the list (`--list`) and says why.
- **What it exposes.** Its title tells the row selected: `WinBox Launcher: Missing, unavailable. Cannot run: …`. It has no accessibility tree (below).
- **Why a window of its own and not a menu of the host's.** A native menu would be the host's own: `TrackPopupMenu` with `CreatePopupMenu` and `AppendMenu` on Windows (`windows-sys`, already a dependency of seamless mode), `NSMenu` on macOS (through `objc2`, not a dependency), and nothing common to Linux's desktops (a GTK menu, or a status notifier's D-Bus menu). Each would be a different body of code per host, and none draws Windows 3.1 icons from a group file's bits as they are. So the launcher draws its own list in a window, the same on every host.

## Tested

[[measured]] `crates/winbox-native/src/library/tests.rs` and `crates/winbox-native/src/launcher/tests.rs`:

- The library is the host's folder, or the one given.
- A record keeps `mode` (`standard` by default, `enhanced` read back), and a record without it reads as standard. `bases.json` is read back as written.
- Programs kept before the library are told of and not moved, and nothing is said once the library has its own.
- A stack is built from synthetic layers: an installation folder whose `WIN.INI` opens `.PMI` files, and a layer with `PROGMAN.INI` and a group file built as Program Manager's `CreateGroup` and `AddItem` build one (`GroupFile`), of [[probe:pmitem]]'s items and a DOS program's. Each item's reason is as listed above, and each runnable item's start is the program, command line, directory and show the probe recorded. A second install's group of the same name is labelled with its install's name. A program kept loose has its own group. Without its base every item is shown, none runnable; with `--windows` given, it is used. An enhanced-mode program's items are disabled until the build runs that mode. Nothing kept says how to keep one.
- `--launch`'s start, run headless on the asset bundle's base: [[probe:pmitem]]'s child, kept in a layer with the probe's group, is started for its Args, Dir, Low, Min and Bad (OK) items, each as a run of its own on the program's user's layer. The lines it writes are those `pmitem` recorded under Windows, word for word.
- The launcher's model: the rows, every key and click above, the reasons as the status line shows them, the confirmation (Cancel the default, OK running in the Windows directory, Escape Cancel), the arguments of the process started, an icon in the VGA's colours over the window colour, and the system font found through `SYSTEM.INI`.
- On a Windows host (2026-11-07), the Windows build kept the same layer with `--layer-from … --windows` in a library given by `--library`, its base remembered in `bases.json`. The path was kept in Windows' verbatim form, `\\?\C:\…`, which the library now writes without its prefix. `--launch Pmitem low` and `--launch Pmitem Bad --directory-anyway`, given no base, wrote `args=Low Case|cwd=C:\ORACLE\PMDIR|show=1|…` and `args=bad|cwd=C:\WINDOWS|show=1|…`. `--launcher` ran with its window open for six seconds without a fault, and was ended. Its pixels were not captured, so what it draws is not checked on a host.

## Not yet done

- The launcher window has no accessibility tree. AccessKit (`accesskit_winit`) would give one: a list of groups and items with names, states (disabled, expanded) and descriptions (each reason). It is not a dependency, and on Linux it brings in AT-SPI over D-Bus (`zbus`). For now the window's title tells the row selected, and `--list` and `--launch` serve on the console.
- The launcher is not given `--install`: an install is run from the console, `--install NAME MEDIA --keep`, and the launcher shows it once it is opened again. It does not watch the library for changes.
- A second item from an install whose machine is running starts a second process on the same stack, not a task on the running machine (design A says it joins it). Two processes on one user's layer write the same folder without knowing of each other.
- A host folder as a drive ([[guide:launcher]], step 6).
- Forgetting a program, collecting what no program names, and exporting a kept program, as on the page.
- An item on a drive of images is listed as not found, as the list sees only C: (`launch.rs`'s assumptions).
