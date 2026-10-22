---
kind: guide
name: Running without Windows (design)
summary: A design for running programs with no installed Windows 3.1 — an asset bundle of only the fonts and resources programs see, drives built from copy-on-write layers, and WinBox's own COMMDLG and the other DLLs whose Microsoft code still runs — what each needs, and the order of the work.
---

This page is a design. Nothing on it is built yet, except where it says what winbox.js does today.

Today a run mounts an installed Windows 3.1 read-only beneath drive C: (`--windows` in the native build; the drive the page is given). Most of it is never used. The engines are their own KERNEL, USER, GDI, MMSYSTEM, SHELL, KEYBOARD, SOUND, WIN87EM, WING, TOOLHELP, TIMER and MCI drivers, with their own strings and their own message box and About box ([[topic:dynamic-link-libraries]]). The goal here is to need no installation at all: a small **asset bundle** of what programs see, and **WinBox's own** versions of the few libraries whose Microsoft code still runs.

## What a run takes from Windows today

### Code that still runs

These are Microsoft's own code, loaded from the installation when a program imports them or asks for them with [[fn:KERNEL.LoadLibrary]]:

| Library                | Who needs it                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COMMDLG**            | 16 of the accessories, WinHelp, Program Manager's Browse, SETUP; in the corpus fibsw, hanoi, champ, wslam, wordsrch, SimTower and its EREG, and bg (through CTL3D). The file dialogs, Find, Replace, Color, Font and Print are WinBox's own, with or without the file ([[topic:common-dialogs]]). |
| **DDEML**              | SETUP programs (caribb's), champ. WinBox's own, every export, with or without the file ([[topic:dynamic-data-exchange]], [[topic:ddeml-transactions]]).                                                                                                                                           |
| **VER**, **LZEXPAND**  | SETUP programs, Control Panel's MAIN.CPL and DRIVERS.CPL. WinBox's own, with or without the files ([[topic:version-information]], [[topic:compressed-files]]).                                                                                                                                    |
| **OLECLI**, **OLESVR** | Cardfile and Write (objects in a document); Packager, Paintbrush and Sound Recorder (as servers)                                                                                                                                                                                                  |

Programs that winbox.js starts are run from disk as well, as Windows would run them: TASKMAN, a screen saver, the accessories themselves, `.CPL` applets. Those are the user's programs, not part of the system.

### Files read as data

Nothing else from the installation is run. These are read as data:

| What                                                                                                                                                                                              | For                                                                      | Without it                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| The display driver's resources: frame and arrow bitmaps, `OEMBIN`, icons and cursors ([[topic:display-driver-resources]])                                                                         | Frames, scroll bars, menus, check marks; the metrics and default colours | `CreateWindow` answers nought: no windows at all                                 |
| The boot fonts: `fonts.fon`, `fixedfon.fon`, `oemfonts.fon` (System, Fixedsys, Terminal)                                                                                                          | Dialog units, and anything that measures text                            | Dialogs and the system error box cannot be laid out                              |
| The faces `WIN.INI` `[fonts]` names: MS Sans Serif, MS Serif, Courier, Small Fonts, Symbol, and the TrueType Arial, Times New Roman, Courier New, Symbol and Wingdings ([[topic:font-resources]]) | Programs' own text                                                       | Those faces are missing and the mapper picks others                              |
| `USER.EXE`'s Windows flag icon and cursors                                                                                                                                                        | A minimized `IDI_APPLICATION`; cursors the driver lacks                  | No flag icon                                                                     |
| `SHELL.DLL`'s logo bitmap                                                                                                                                                                         | [[fn:SHELL.ShellAbout]]                                                  | No logo                                                                          |
| `WIN.INI`, `SYSTEM.INI`                                                                                                                                                                           | Settings, fonts, drivers, MCI devices, the screen saver                  | USER's defaults; no drivers                                                      |
| `[sounds]` `.WAV` files, `REG.DAT`, `MIDIMAP.CFG`, a wallpaper                                                                                                                                    | System sounds, the registry, MIDI setups, the desktop                    | Silence; registry errors as recorded; the MIDI setups kept in code; no wallpaper |

## The asset bundle

The bundle holds only what programs see, and no code:

- **Fonts**: the boot fonts for each display, and the faces Setup puts in `[fonts]`, raster and TrueType.
- **Display resources**: for each display winbox.js offers, its driver's bitmaps, icons, cursors and `OEMBIN` resources, kept in the `.DRV` file with every segment's bytes made nought: its tables and resources where they were, and no code. GDI and USER already read them as data and never run the driver.
- **USER's and SHELL's pictures**: the flag icon, the cursors, the logo.
- **System sounds**: the `.WAV` files `[sounds]` names.

The profiles are not in the bundle. WinBox writes `WIN.INI` and `SYSTEM.INI` itself for the display chosen, line for line as Windows' own Setup wrote them on the oracle's installation for that display, each line kept with what grounds it in `SETUP.INF`, the templates on the first disk, or the installation. `REG.DAT` is not empty in a new installation: Setup runs `regedit /s /u setup.reg` (`SETUP.INF` `[data]` `register`), and the oracle's is 2,556 bytes. WinBox makes it from the bundle's `SETUP.REG` the same way, byte for byte ([[topic:asset-bundle]]).

**Whose assets they are.** The fonts, bitmaps and sounds are Microsoft's. The bundle is made from the user's own Windows 3.1 media, as the oracle's installations are now (`scripts/oracle`), and is never shipped. A bundle free of Microsoft's files would need replacements drawn to the same metrics, cell for cell. Programs whose layout depends on those metrics would notice anything else. That is a separate project, and the rule of this one still holds: nothing about Windows' behaviour is invented.

## Drives from layers

A drive is a stack of folders, the top one writable, each below it read-only. A read takes the first layer that has the name. A write to a file only a lower layer has copies it up first, and a delete in a lower layer is recorded as hidden. The Rust engine's host drive does this for any number of layers (`HostDrive::layered`, `crates/winbox-machine/src/files/host.rs`; `HostDrive::over` is the one-layer case). The stack must look as one folder of what it holds does, because the oracle's C: is one DOSBox `localDrive` over one folder:

- [[read out]] A rename is the host's `rename()` (`localDrive::Rename`, `drive_local.cpp`), so a folder renamed keeps everything in it and a file keeps its stamp. The stack copies a lower folder up with everything in it, and a lower file with its stamp, before it renames.
- [[read out]] A folder's stamp is the host's `st_mtime` (`localDrive::FindNext`). It moves when an entry is made, deleted or moved in it, and not when a file already in it is written. The folders the stack makes only to hold a copied-up file take the lower folders' stamps and keep them; a delete that only hides a lower file still moves its folder's stamp.
- Each layer hides paths of the layers below it, kept as DOS paths. A folder made again over a hidden one shows nothing of the hidden one. The top's hidden paths can be kept in a file beside the top, outside the drive (`HostDrive::keeping_removed`); the native build does not use that yet, so it forgets deletes from one run to the next.

The design builds the drive from three kinds of layer:

1. **Base**: the asset bundle, laid out as `C:\WINDOWS` and `C:\WINDOWS\SYSTEM` would be, with the profiles WinBox writes. It is read-only and shared by every program.
2. **Programs**: what an installer added, as a layer of its own, read-only once installed. It holds the program's folder, the DLLs it put in `SYSTEM`, and its own `.INI` files. SimTower needed `WAVMIX16.DLL` in `SYSTEM`, `WAVEMIX.INI` and `SIMTOWER.INI`, and its installer would have put them there.
3. **The user's**: what a program writes as it runs. That covers saved games, changed settings and the profiles' changes. It is writable, one per user and program, or per group of programs.

Layers are content-addressed, so two programs that install the same DLL, `CTL3D.DLL` or `VBRUN300.DLL` say, share one copy. A program's layer is made by running its installer over the base, with an empty layer on top, and keeping that layer.

**The format.** Both engines read and write a layer as [[format:layer]] has it (`src/layers/layer.ts`, `crates/winbox-win16/src/layers.rs`). A manifest lists what the layer removes, the folders it makes or stamps, and the files it writes, each file's bytes a blob named by its sha256. Its id is the sha256 of those entries, and its `over` names the stack it was made on. The base is the stack's lowest layer, composed again from the bundle and named `base:<assets id>:<display>`. A stack flattens to one drive as the page puts changes back on a drive, and the two engines give the same ids, the same flattened drive and the same exchange zip. Programs that share a machine are installed in turn: a stack of layers made apart that touch one path is refused. The native build writes each layer of a stack into a cache folder once, for `HostDrive::layered`.

**The work, in phases.** First, C: was grounded as one DOSBox folder ([[probe:dirorder]], [[topic:drives-and-disks]]). Then came the host drive in layers, then the layer format. Then the probe harnesses ran on layers: `WINBOX_BASE=layers` splits the base into a stack with a decoy and its whiteout, and every probe writes on it what it writes on `WINBOX_BASE=assets`, in both engines ([[format:layer]]). Then the page's stack: programs dropped on the page kept as layers in IndexedDB, C: planned from a program's stack on either engine, and its user's layer kept with it ([[format:layer]], On the page). Next:

- **An installer into a layer.** A probe pair, an installer and a child that reads back what it installed, run as one DOSBox session against each engine's installer-into-a-top and then the child on base and layer. Then caribb's installer end to end, the two engines' manifests the same under the virtual clock.
- **Native.** `--install`, `--program`, `--layer-from`, and the user's layers kept from run to run.
- **Later.** Moving a program's layer between displays by replaying its profile writes. The TypeScript engine answering function 36h for C: as the Rust engine does.

The storage, the installing and the owner's decisions are in [[format:layer]].

**What installers tell Program Manager.** An installer adds its group and items by DDE to the `PROGMAN` service: `[CreateGroup(...)]`, `[AddItem(...)]`, `[ShowGroup(...)]`. Some write `.GRP` files or `PROGMAN.INI` instead. A WinBox stand-in for that service, under its own name, would collect the groups, items and icons for a launcher instead of drawing them. For a launcher, these become the program's entries. That stand-in needs DDEML-level DDE as Windows does it, read out and recorded like the rest.

## WinBox's own COMMDLG

COMMDLG is the largest piece of Microsoft's code that still runs. It is done as the rest of the API is: what COMMDLG.DLL does is read out and recorded by probes, then followed in both engines, under WinBox's name, with no file of Windows'.

**What it must do**, by use:

| Function                               | Used by                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetOpenFileName`, `GetSaveFileName`   | Nearly every accessory; fibsw, hanoi, champ, SimTower. Media Player's Open uses a hook; Control Panel's Add Fonts uses a hook and its own template. |
| `FindText`                             | Notepad, Cardfile                                                                                                                                   |
| `ChooseFont`                           | Write, Paintbrush, File Manager, Clock; fibsw                                                                                                       |
| `PrintDlg`                             | Notepad, Cardfile, Write, Paintbrush, Calendar, Terminal, WinHelp; wordsrch, SimTower's EREGLIB                                                     |
| `ChooseColor`                          | fibsw, champ, wslam                                                                                                                                 |
| `CommDlgExtendedError`, `GetFileTitle` | Most of the above                                                                                                                                   |
| `ReplaceText`                          | Nothing in the installation or the corpus; done for completeness                                                                                    |

**What has to be faithful:**

- The dialogs' own templates and procedures: layout, control ids, the default button, what each control does.
- The hooks and custom templates a program passes, which run inside the dialog's procedure.
- The `commdlg_*` registered messages (`FILEOKSTRING`, `LBSELCHSTRING`, `SHAREVISTRING`, `HELPMSGSTRING`, `COLOROKSTRING`, `SETRGBSTRING`, `FINDMSGSTRING`).
- The extended error codes.
- What the file dialogs ask of KERNEL and USER: the drive list, `DlgDirList`, the directory and file lists ([[topic:directory-lists]]), the path `OpenFile` leaves behind.
- Behaviour the engines already follow for COMMDLG's sake: its owner-drawn lists, the combo box's extended UI, `CBN_SELENDOK` for a 3.10 instance, the bold MS Sans Serif 8 of the Find dialog, its hook thunks, `SetProp` A000h ([[topic:list-boxes]], [[topic:combo-boxes]], [[topic:standard-controls]]).

**How it slots in.** It is done a function at a time ([[topic:common-dialogs]]). With the file present, it is loaded as before, and each import of a function WinBox answers is linked to WinBox's code; a function not yet followed stays Microsoft's. Without the file, every function is WinBox's, and one not yet followed answers nought.

**Where it stands.** `GetOpenFileName`, `GetSaveFileName`, `GetFileTitle` and `CommDlgExtendedError` are WinBox's own, recorded by [[probe:ofnopen]], [[probe:ofnerr]] and [[probe:ftitle]] ([[topic:file-dialogs]]). Notepad's Open runs with no `COMMDLG.DLL` on the drive. `FindText`, `ReplaceText` and `ChooseColor` are WinBox's own too, recorded by [[probe:findrepl]] and [[probe:choosclr]] ([[topic:find-and-replace]], [[topic:choose-color]]), and Notepad's Find runs with no `COMMDLG.DLL` on the drive. `ChooseFont` is WinBox's own, recorded by [[probe:chfont]] and [[probe:chfont2]] ([[topic:choose-font]]), and Write's, Paintbrush's, File Manager's and Clock's fonts are chosen with no `COMMDLG.DLL` on the drive. `PrintDlg` is WinBox's own as well, recorded by [[probe:prdlg]] and [[probe:prdlgx]] ([[topic:print-dialogs]]): Notepad's, Write's and Paintbrush's Print Setup and Write's Print dialog run with no `COMMDLG.DLL` on the drive. Every export, with what it is and whether it is WinBox's own, is listed in [[topic:common-dialogs]].

**Probes.** Each dialog is driven by a probe that records the messages, the controls, what the hook is sent, and what the call answers, on DOSBox. The accessories' sessions (Notepad's Open and Find, Write's Font, Write's Print and Print Setup) show the result as a user sees it.

## The other libraries

- **DDEML**: needed by installers and by the `PROGMAN` stand-in. WinBox's own, every export, read out of `DDEML.DLL` and recorded by [[probe:ddemgmt]], [[probe:ddexact]], [[probe:pmatom]], [[probe:progdde]], [[probe:ddefail]], [[probe:ddemon]], [[probe:ddeterm]], [[probe:ddelist]], [[probe:ddenest]], [[probe:ddeheap]], [[probe:ddehsz]], [[probe:ddewep]] and [[probe:ddeinst]] ([[topic:dynamic-data-exchange]], [[topic:ddeml-transactions]]). It is kept as COMMDLG is, and the probes write what Windows wrote with the file and without it. With no file it is counted as the file would be, loaded with a program that imports it and let go, its data with it, as that program ends ([[topic:dynamic-link-libraries]]); Program Manager takes an installer's `CreateGroup`, `AddItem` and `ShowGroup` through it with no `DDEML.DLL` on the drive.
- **VER** and **LZEXPAND**: needed by installers, to compare file versions and to expand compressed files. Both are WinBox's own, every export, read out of `VER.DLL` and `LZEXPAND.DLL` and recorded by [[probe:verinfo]], [[probe:verinst]] and [[probe:lzfiles]] ([[topic:version-information]], [[topic:compressed-files]]). They are kept as COMMDLG is: with the files on the drive, each import of an export is linked to WinBox's stub; with none, `LoadLibrary` finds WinBox's, and the probes write what Windows wrote either way. VER reads files through WinBox's LZEXPAND, so a compressed file's version is read as Windows reads it.
- **OLECLI** and **OLESVR**: needed for objects in documents (Write, Cardfile) and by the servers (Paintbrush, Sound Recorder, Packager). They are large, and only those programs need them, so they come last.

Until each is WinBox's own, a run with an installation keeps loading Microsoft's, as now.

## The order of the work

1. **COMMDLG's file dialogs** (`GetOpenFileName`, `GetSaveFileName`, `GetFileTitle`, `CommDlgExtendedError`), then `FindText` and `ReplaceText`, `ChooseFont`, `ChooseColor`, `PrintDlg`.
2. **The asset bundle**: made from the user's media, with the profiles written by WinBox, and the engines able to start from it alone.
3. **Layered drives**: the stack of layers with content-addressed sharing, and a program's installer run into a layer of its own.
4. **VER**, **LZEXPAND** and **DDEML** (done), which installers need; then the `PROGMAN` stand-in that collects groups and items.
5. **OLECLI** and **OLESVR**.

A launcher, native and on the page, sits on top of steps 3 and 4. It shows the groups and items installers made, runs each program on its layers, and uses seamless mode in the native build ([[guide:seamless-windows]]).

## Not yet done

All of it but COMMDLG's file dialogs, Find, Replace, Color, Font and Print, VER, LZEXPAND and DDEML, and the asset bundle's making and composing: the bundle is made from the user's disks, and the base of C: composed from it for every display is the oracle's installation's data byte for byte, and both engines start from it alone -- native with `--assets`, the probe harnesses with `WINBOX_BASE=assets` -- reading USER's, SHELL's and the display drivers' resources from its store ([[topic:asset-bundle]]); every probe and the corpus have been run on it in both engines, and each record that differs from the installation's is listed with its reason -- a program, library or driver of Windows' the base does not have, but for a gap of WinBox's own COMMDLG the file had hidden. The page takes the disks too: it makes the bundle from their images in the browser, keeps it there, and runs programs on its base, on either engine, with what they write kept for each display apart. Of the layered drives, the host drive in layers and the layer format are built ([[format:layer]]), and the page keeps each program dropped as a layer and runs it on its stack. The probe harnesses run on the base split into a stack of layers, and every probe writes what it writes on the base in one folder. Nothing is installed into a layer yet. What winbox.js does today is in the first section.
