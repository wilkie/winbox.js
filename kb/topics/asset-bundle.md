---
kind: topic
name: Asset bundle
summary: WinBox's asset bundle — the fonts, data files, sounds and the resources of USER, SHELL and the display drivers that programs see, made from the user's own Windows 3.1 disks with no code in it — its format, where each item comes from, and the base of drive C that Setup's own layout composes from it for each display, byte for byte what Setup wrote on the oracle's installations.
---

The asset bundle is step 2 of [[guide:without-windows]]. It holds what programs see of an installed Windows 3.1, and none of the code. It is made from the user's own setup disks and is never shipped. With it, WinBox can lay out a base for drive C: for any display it serves, as Windows' own Setup laid one out.

Both engines start from it alone, as below: the native build, the probe harnesses, and the page, which makes the bundle from the user's disks in the browser and keeps it there.

## The format

`winbox-assets.zip` is a zip archive with every entry **stored**, not compressed, so the same files always make the same bytes. `pnpm assets` writes it to `oracle/build/winbox-assets.zip`, and the same files unpacked to `oracle/build/assets/`. Both are gitignored.

```
winbox-assets.json        the manifest
pool/<8.3 NAME>           fonts, MIDIMAP.CFG, SETUP.REG, the sounds
modules/<8.3 NAME>        USER.EXE, SHELL.DLL, the display drivers, code taken out
```

The manifest, `winbox-assets.json`:

| Field      | What                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`   | 1. An engine refuses a number it does not know.                                                                                                                                                                                     |
| `id`       | The sha256 of the files' sha256s, sorted, one to a line. Two bundles made from the same media have the same id.                                                                                                                     |
| `made`     | The maker, WinBox's version and commit.                                                                                                                                                                                             |
| `sources`  | Each file of the media used: its name on the disk (`ARIAL.FO_`), the disk by the marker file Setup looks for (`disk5`), its size and sha256, and `known`, whether `scripts/assets/known-media.json` lists that file with that hash. |
| `files`    | Each file of the bundle: its path, sha256 and size, the DOS date and time of its file on the disk, and where it came from (`disk5:ARIAL.FO_`).                                                                                      |
| `displays` | The display modes the bundle serves: those whose driver was among the media.                                                                                                                                                        |

**Known media.** `known-media.json` holds the sha256 of every file on the six retail disks of Windows 3.1 (3.10.103, 3.5", 1.44 MB) and of the Driver Library's Super VGA 256-colour driver: only names, sizes and hashes. The hashes are per file, not per disk image, for two dumps of a disk can differ between its files and still hold the same files. Media it does not list are taken all the same, and their files are marked `known: false`.

## What is in it

The maker (`src/assets/make.ts`) takes floppy images, zips of them, the disks' files, or the files of an installed Windows, and picks the files by Setup's own lists in `SETUP.INF`, which it reads from the first disk:

| Item                                                                                                                   | Where it comes from                                                                                                                                 | Kept as                       |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| The System, Fixedsys and Terminal fonts of every resolution (`EGASYS`, `VGASYS`, `8514SYS`; `…FIX`; `…OEM`)            | `[sysfonts]`, `[fixedfonts]`, `[oemfonts]`                                                                                                          | the file, expanded            |
| The raster faces at the EGA, VGA and 8514/a resolutions, Arial and Times New Roman at the EGA's, and the plotter fonts | `[fonts]`                                                                                                                                           | the file, expanded            |
| The 13 TrueType faces: the `.FOT` header files and the `.TTF` files                                                    | `[ttfonts]`, both files of each line                                                                                                                | the file, expanded            |
| The DOS window fonts: `CGA40WOA`, `CGA80WOA`, `EGA40WOA`, `EGA80WOA`, `HERCWOA`, `DOSAPP`                              | the first column of the grabbers' sections (`[VGA.3gr]` and the rest), and `[codepages]`' line for 437, the code page of the oracle's installations | the file, expanded            |
| `MIDIMAP.CFG`, `SETUP.REG`                                                                                             | `[win.other]`; the rest of that list is code                                                                                                        | the file, expanded            |
| `DING.WAV`, `CHORD.WAV`, `CHIMES.WAV`, `TADA.WAV`                                                                      | `[win.bmps]`, its `.WAV` lines                                                                                                                      | the file, expanded; pool only |
| `USER.EXE`                                                                                                             | `[windows.system]`                                                                                                                                  | segments nought               |
| `SHELL.DLL`                                                                                                            | `[win.other]`                                                                                                                                       | segments nought               |
| `VGA.DRV`, `SUPERVGA.DRV`, `EGA.DRV`, `HERCULES.DRV`, `8514.DRV`, `XGA.DRV`                                            | `[display]`, the line of each display's profile                                                                                                     | segments nought               |
| `SVGA256.DRV`                                                                                                          | the Driver Library's `OEMSETUP.INF`, `[display]` `8et4480`; only where its files are given, for no browser unpacks `svga.exe` (PKZIP's implode)     | segments nought               |

[[measured]] Made from the retail disks and the Driver Library's files, the bundle is 78 files, 3,066,639 bytes:

| Part          | Files | Bytes     |
| ------------- | ----- | --------- |
| Raster fonts  | 37    | 933,648   |
| TrueType      | 13    | 1,034,508 |
| `.FOT` files  | 13    | 18,494    |
| Sounds        | 4     | 80,304    |
| `MIDIMAP.CFG` | 1     | 34,522    |
| `SETUP.REG`   | 1     | 3,508     |
| Modules       | 9     | 920,288   |
| The manifest  | 1     | 32,907    |

**Reading the disks.** The images are read by WinBox's own FAT12 reader (`src/file-systems/fat12.ts`), and the compressed files expanded by its own expander (`src/assets/szdd.ts`), which follows `LZEXPAND.DLL`'s decoder as [[format:szdd]] and [[topic:compressed-files]] read it out: the header (seg8 `00aa`), the decoder (seg9 `0000`), and `LZCopy`'s limit and check of the length (seg7 `00f4`). [[measured]] Every file on the six disks reads as `mtools` reads it, and every file expanded is the file Setup put on the oracle's installations, byte for byte, but two: `USER.EXE`, below, and the `SETUP.INF` of the 256-colour installation, to which the oracle added the driver disk's display.

## The modules

`USER.EXE`, `SHELL.DLL` and the display drivers are kept with every segment's bytes made nought, and the relocation records after each segment too (`src/assets/ne.ts`, `zeroSegments`). Everything else stays at its own offset: the DOS stub, the NE header, the segment, resource, name, module and entry tables, and the resources' data. Of the 920,288 bytes of the nine modules, 633,951 are nought; `USER.EXE` keeps 26,800 of its 264,016.

WinBox reads only their resources: the display driver's bitmaps, icons, cursors and `OEMBIN` ([[topic:display-driver-resources]]), USER's flag icon and cursors, and SHELL's logo. Their exports are WinBox's own table, not the file's ([[topic:dynamic-link-libraries]]). [[measured]] Each module read from the bundle gives the same resource table as the whole file, entry for entry and offset for offset, so the same resource handles; the same bytes for every resource; the same `DriverResources::read` and `read_oem`; and the same `OEMBIN` values (`crates/winbox-win16/tests/asset_modules.rs`).

[[measured]] Setup writes the user's name and company into `USER.EXE`: into one of its string tables, a resource, not a segment. The bundle's is the disk's, which says "Unknown User" and "Unknown Organization". Both engines take those strings from their own table, so nothing drawn changes.

The modules are not files on C:. A program that looks for `USER.EXE` or `VGA.DRV` in the system directory does not find them, as with WinBox's own COMMDLG.

## The base of C:

For each display, `crates/winbox-win16/data/setup.json` says what Setup put on C: on the oracle's installation for it ([[guide:reproducing]] has how they are made). It is written by `scripts/assets/survey-installs.mjs` and never by hand. `composeBase` (`src/assets/compose.ts`) and `assets::compose` (`crates/winbox-win16/src/assets.rs`) lay it out from the pool:

- **The folders**: `WINDOWS`, `WINDOWS\SYSTEM` and `WINDOWS\TEMP`.
- **The files**: every file of the installation that is in the pool, where Setup put it, each with the `SETUP.INF` line that names it. The 8514/a and XGA installations were made by running Setup again on the VGA's, as no DOSBox card is either, and that run left the VGA's fonts behind; the base has them too, marked so. The sounds are not placed: the oracle's installations answer Setup's `[dontinstall] bitmaps`, and `[win.bmps]` is where the sounds are, so `WIN.INI`'s `[Sounds]` names files that are not there, as on the oracle.
- **`WIN.INI` and `SYSTEM.INI`**: line for line as Setup wrote them on the oracle's installation for that display, comment lines, `[Compatibility]` and `[embedding]` included. Each line is kept with what grounds it: a section of `SETUP.INF` (the display's line and its work section, the fonts of its resolution, the grabber's fonts, the code page, a line `SETUP.INF` writes into a profile itself, or the line of one of the oracle's answers -- `[machine] ibm_compatible`, `[pointing.device] ps2mouse`, `[network] nonet`, `[keyboard.types] t4s0enha`, `[language] enu`), the driver disk's `OEMSETUP.INF`, the templates `WIN.SRC` and `SYSTEM.SRC` from the first disk, or, for the rest, the oracle's installation itself: what Setup wrote given the oracle's answers, and what drivers wrote as they first ran (`svgamode=`, the 256-colour driver's `ChipSet=`, WinG's `[WinG]`).
- **`REG.DAT`**: made from the pool's `SETUP.REG` as Setup makes it, by `SETUP.INF`'s `[data]` `register = "regedit /s /u setup.reg"`. `REGEDIT`'s import is read out of `REGEDIT.EXE` seg1: `HKEY_CLASSES_ROOT` opened with `RegCreateKey` and held open while the script is read (`4357`, closed at `442d`); each line held to the prefixes `HKEY_CLASSES_ROOT\` and `\.classes\` by USER's `lstrcmp`, any other line passed over (`4370`-`43be`); the key up to the first space, then the spaces, an `=` and one space passed over, and the value the rest of the line (`43c0`-`440e`); and `RegSetValue` of the key, `REG_SZ`, the value (`0010`). The database is WinBox's own writer ([[topic:registration-database]]).

The pool's files keep the date and time of their files on the disk, as `LZCopy` gives an expanded file its compressed file's stamp. The profiles and `REG.DAT` are stamped as the page's drive stamps what it makes, 10:20:40 on 6 January 2020.

[[measured]] For each of the ten displays -- `vga`, `svga`, `ega`, `hercules`, `vga256`, `8514`, `8514s`, `xga256`, `xga256s`, `xga640` -- every file the base places is the installation's file byte for byte: the fonts, `MIDIMAP.CFG`, `SETUP.REG`, both profiles and the 2,556 bytes of `REG.DAT`. No file of the installation's that is in the pool, nor a profile, nor `REG.DAT`, is left out. The two engines' bases are the same listing, path, size, CRC and stamp (`test/assets/composed.json`).

What the base lacks of an installation is its code and what only code reads: `WIN.COM`, the accessories, `TASKMAN`, `WINHELP`, `CONTROL.EXE`, every `.DRV`, `.DLL`, `.386` and grabber, the help files, the groups, `PROGMAN.INI`, `CONTROL.INI` and the `.PIF` files.

## Starting from the bundle

An engine started from the bundle has two things where it would have an installation:

- **Drive C:'s base**: the base the bundle composes for the display, laid out as above, beneath C: as an installation is: read, and never written; what a program writes goes above it.
- **The module store**: the bundle's `USER.EXE`, `SHELL.DLL` and display drivers, behind C: and never on it. Where WinBox reads a kept module's resources -- the display driver's bitmaps, icons, cursors and `OEMBIN`, USER's flag icon and cursors, SHELL's logo, and `FindResource` on a kept module's handle (the display driver's alone in the TypeScript engine) -- it takes the file in `C:\WINDOWS\SYSTEM` first, and the store's of the same name after. An installation on C: still wins; with neither, there is nothing to read, as before.

| Engine     | The store                                                                                                                                                                   | Reading it                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust       | `System.assets`, an `Assets` (`assets.rs`): read from `winbox-assets.zip`, a zip of stored entries read by the engine's own reader, or from the folder it was unpacked into | `System::kept_file`, the `read` of `read_drivers`, and SHELL's `about::logo`                                                                                               |
| TypeScript | `options.assets`, anything with `module(name)`; `src/assets/bundle.ts`'s `Assets` is one, read from the zip or the folder                                                   | `Win16.displayResources` and SHELL's logo (`shell/about.ts`), through `Win16.assetModule`; and the raster desktop's driver and USER where `options.raster` hands over none |
| wasm       | `Machine.add_module(name, bytes)`, a file at a time, before the first program starts                                                                                        | as the Rust engine                                                                                                                                                         |

**How each is run from it:**

- **Native**: `winbox-native PROGRAM.EXE --assets winbox-assets.zip` (or the unpacked folder) `--display <mode>`. It is refused with `--windows`, and for a display the bundle does not serve. The base for the display is written once into the host's cache folder, `winbox/base-<id>-<display>` (`%LOCALAPPDATA%` on Windows, `$XDG_CACHE_HOME` or `~/.cache` elsewhere), each file last written when the base says and each folder at the page's stamp, and is then what the `--windows` folder would be: the drive above it is `HostDrive::over` it, and `--sound` installs the sound driver into the drive's `SYSTEM.INI` from the base's, as from an installation's.
- **The page** (`run.html`, either engine): the user drops the disks' images, and the bundle is made there (On the page, below).
- **The probe harnesses**: `WINBOX_BASE=assets`. The Rust harness (`tests/support`, `Setup::of`) writes the base into the host's temporary folder, `winbox-bases/base-<id>-<display>`, and mounts it as it mounts an installation; the TypeScript harness (`test/win16/run-probe.ts`) makes a FAT16 volume in memory, as the page makes its drive, and puts the base's files on it. Either refuses to run when `oracle/build/assets` is not made. Without the switch nothing changes.

  `WINBOX_BASE=assets cargo test --release -p winbox-win16 --test probes -- --ignored --nocapture survey`

[[measured]] On the bundle's base, `drvres` on the VGA, EGA, Hercules and Super VGA, `chrome` on the same four, `fontboot` with its three presets and `about` write the same records as on the oracle's installation, in both engines; and SHELL's logo read from the bundle is the installation's, pixel for pixel, on all four displays (`tests/asset_base.rs`, `test/assets/base_test.ts`).

## On the page

The page (`src/run`) takes the user's Windows 3.1 in either of two forms: an installation's directory, zipped, as before, or the setup disks.

**What is dropped.** Each file is told by what it holds (`src/run/media.ts`, `classify`):

- A zip with `winbox-assets.json` at its root: a bundle made already, taken as it is.
- A zip with a `SYSTEM` folder of fonts: an installation, as before.
- A zip with a disk's image, a `SETUP.INF` or `OEMSETUP.INF`, or a file `COMPRESS`ed for a disk (its name ending in `_`), and any file that is not a zip: the media.
- Any other zip: programs.

The media are made into a bundle by the maker `pnpm assets` runs (`makeAssets`), unchanged, told against `known-media.json`; media it does not know are taken all the same, and the page says how many of the files were not known. The maker keeps the first file it finds of each name, and the Super VGA driver's files hold fonts of the disks' names, the same bytes with none of the disks' stamps, so the page gives the maker the images first, then zips, then loose files, by name, as the script gives it the images before the driver's files (`orderMedia`). No browser unpacks `svga.exe` (PKZIP's implode), so the 256-colour display is served only where its unpacked files -- `OEMSETUP.INF` and `SVGA256.DRV` -- are dropped too: with the disks, or after them while the page is open, when they are made into a bundle with the disks dropped before. [[measured]] The bundle the page makes from the six disks' images and the driver's files, given in any order, is the script's: the same id, and every file of the manifest the same, its hash, size, stamp and source (`test/run/media_test.ts`).

**Where it is kept.** The bundle, as `winbox-assets.zip`'s bytes, is kept in the browser's IndexedDB, in a store of its own, `assets`, beside the installation's `archives` (`src/run/store.ts`), and read again on the next visit. It never leaves the browser. The page has one Windows at a time: dropping a bundle forgets an installation kept, and dropping an installation forgets the bundle.

**C: on its base.** `planDrive` puts the base the bundle composes for the display chosen where the installation would go: its folders first, at the page's stamp, then its files, each last written when the base says, then the programs' archives, each in a folder of its own. The TypeScript engine is given the bundle as `options.assets`, and its driver for the display and its `USER.EXE` as `options.raster`; the Rust engine has each of the bundle's modules put in its store with `add_module` before the machine's first program. The display list offers only the displays the bundle serves.

[[measured]] What a program sees of the page's base is the harnesses' base. The TypeScript engine's drive on the base alone is the TypeScript harness's volume, sector for sector, on the VGA, EGA and 256-colour displays (`test/run/media_test.ts`). The Rust engine's machine, filled as the page fills it, reports what the trace example does with `--assets` -- the base written to a host's folder, as the Rust harness and the native build mount it -- call for call and screen for screen, for `drvres` on the VGA, EGA and 256-colour displays, `chrome`, `about`, `sysdirs`, `fontboot` and `diskfree` (`crates/winbox-web/tests/assets_base.rs`).

**What programs write.** The changes on C: are kept against the bundle's id and the display (`assets:<id>:<display>`), each display's in a record of its own, as each display's base has its own profiles and fonts: a `WIN.INI` written on one display is not put on another's base, and is there again when its display is chosen again. Changes on an installation are kept as before, against its archive's hash. Forgetting the bundle forgets every display's.

`e2e/run.spec.ts` drops the disks' images and the driver's files on each engine, checks the bundle's id and the displays offered, runs the `chrome` probe to its window on the screen, reloads to the bundle remembered and forgets it; and drops a `winbox-assets.zip` made already and keeps what the `strings` probe writes apart for the VGA and the EGA. Both are skipped where the media, the bundle or the probes are not there.

## What a program sees differently

Every probe was run on the installation and on the bundle's base, in both engines, and their records set side by side, each occurrence of a call against the same occurrence in the other run. `test/oracle/assets-differences.json` lists each record that differs, by fixture, with its reason, and each engine's sweep holds the runs to it: a difference it does not list fails, and so does one it lists that no longer comes.

```
ASSETS_SWEEP=1 cargo test --release -p winbox-win16 --test assets_sweep -- --nocapture
ASSETS_SWEEP=1 npx jest test/assets/sweep_test.ts
```

Neither runs without `ASSETS_SWEEP=1`. [[measured]] The Rust engine's sweep, every fixture run twice, takes some 100 seconds on eight threads. The TypeScript engine's runs the 529 fixtures whose probe and installation image it has, all but those recorded with a sound card (it has no sound),, in some five hours of one CPU, shared out with `ASSETS_SWEEP_SHARD=k/n`; nearly three of them are `verinst` on the base, which, with no `SYSTEM.DRV` to find its version block in, writes its sources at an offset of some 400 MB and copies them, a read at a time.

[[measured]] 23 fixtures differ in the Rust engine and 21 in the TypeScript engine (it runs no `vgasound` fixture: not `mapcpl`, `mplopen-vgasound`, `sndrec-vgasound`; and `diskfree` differs in it alone). All but `diskfree` are a file the base does not have: each claim checked against what the probe or the program it starts opens, and that the file is on the installation and not on the base.

| Fixture                                  | The file the base does not have                                                                                             | What comes of it                                                                                                                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cardview`, `notepos`, `prnote`, `tutor` | `CARDFILE.EXE`, `NOTEPAD.EXE`, `NOTEPAD.EXE /p`, `WINTUTOR.EXE`                                                             | `WinExec` answers 2; nothing to read or print                                                                                                                                                                                                      |
| `mplopen`, `mplopen-vgasound`            | `MPLAYER.EXE`                                                                                                               | the same                                                                                                                                                                                                                                           |
| `sndrec`, `sndrec-vgasound`, `sndbig`    | `SOUNDREC.EXE`                                                                                                              | the same; the files are never edited or saved                                                                                                                                                                                                      |
| `tasklist`                               | `TASKMAN.EXE`                                                                                                               | `DefWindowProc`'s `SC_TASKLIST` starts no Task List; Control and Escape reach the probe's window                                                                                                                                                   |
| `ddeinst`, `pmatom`, `progdde`           | `PROGMAN.EXE`; for `progdde` also `PROGMAN.INI` and the groups                                                              | no Program Manager to start, or to answer DDE                                                                                                                                                                                                      |
| `shellex`, `shell2`, `associco`          | `NOTEPAD.EXE` (the program `.TXT` files are associated with), `PROGMAN.EXE`, `MORICONS.DLL`, `WIN.COM`, `SYSTEM\USER.EXE`   | `ShellExecute` and `FindExecutable` answer 2; `ExtractIcon` finds no icon; `ExtractAssociatedIcon` gives SHELL's own icon 6, as for `C:\NOPE.EXE`, which is on neither                                                                             |
| `freelib`, `sysdirs`                     | `SYSTEM\MAIN.CPL`                                                                                                           | `LoadLibrary` answers 2                                                                                                                                                                                                                            |
| `mapcpl`                                 | `SYSTEM\MIDIMAP.DRV`                                                                                                        | WinBox's mapper has no applet without it: `CPL_INIT` answers nought, and no setup is chosen                                                                                                                                                        |
| `verinst`                                | `SYSTEM\SYSTEM.DRV`, of which the probe makes every source it installs; `USER.EXE`, `GDI.EXE`, `NOTEPAD.EXE`, `COMMDLG.DLL` | `VerFindFile` and `VerInstallFile` find nothing to compare                                                                                                                                                                                         |
| `verinfo`                                | `COMMDLG.DLL`, `USER.EXE`, `GDI.EXE`, `SHELL.DLL`, `MMSYSTEM.DLL`, `SYSTEM.DRV`, `NOTEPAD.EXE`, `PROGMAN.EXE`, `CALC.EXE`   | no version information; the probe's own sum then reads 0CCCCh bytes of its 4100-byte block, left as it filled it: a general protection fault, and the run ends there (the Rust engine's sweep, with no hand at the fault's box, stops on its time) |
| `filedlg`                                | `SETUP.TXT` and `BOOTLOG.TXT` (which `WIN.COM` writes as Windows starts), the only `.TXT` files of `C:\WINDOWS`             | the dialog's list of files is empty, so no file is clicked                                                                                                                                                                                         |
| `filedlg`, `comboesc`                    | `COMMDLG.DLL`: the dialog is WinBox's own                                                                                   | its drives' combo box tells the hook `CBN_SELENDOK` (9) or `CBN_SELENDCANCEL` (0Ah) before it closes up, and in the Rust engine its directories' list `LBN_SELCHANGE` once on a double click where `COMMDLG.DLL`'s tells it twice                  |

The last row is no fault of the base: [[measured]] the same records come on the installation with `COMMDLG.DLL` taken off. It is a gap of WinBox's own COMMDLG against Windows', which the file's presence on the installation hides.

`diskfree` differs in the TypeScript engine alone: its harness puts the base on a FAT16 volume it makes in memory, as the page makes its drive, where the installation is its own disk image, and `GetDiskFreeSpace` answers that volume's clusters. A matter of the volume, not of the files on it.

Nothing else moves: not the display driver's resources, the fonts, the profiles, the registration database, `AccessResource` (`accres` reads its own resources), the search for a file (`search`, `loadpath`, `loadname`) or the file dialogs' directories (`ofnopen`).

**The corpus.** `examples/corpus.rs --base assets` runs each program on the bundle's base and holds it to the TypeScript engine's reports made on the installation, and lists each program that differs against `corpus` in the same file. [[measured]] 29 of 37 programs agree to their stop, 30 run whole alike and 36 leave alike screens. The 8 that differ each load a library on the installation that the base has not, and whose code runs there before the program's: `COMMDLG.DLL` for `wslam`, `hanoi`, `fibsw`, `wordsrch`, `champ`, `bg` (by `LoadLibrary`) and `simtower`; `VER.DLL`, the `LZEXPAND.DLL` it imports, and `DDEML.DLL` for `caribb`. Its `LibEntry`'s calls come first, and its segments take selectors and handles the program's take on the base, so the calls part at the first. [[measured]] `hanoi` on the installation with `COMMDLG.DLL` taken off, and `caribb` with those three taken off, run call for call as on the base. The TypeScript corpus survey takes `WINBOX_BASE=assets` too, and `CORPUS_REPORTS=DIR` writes its reports elsewhere, to set beside `corpus/reports`: [[measured]] on the base the same 8 programs' calls differ from its own on the installation, and every screen is alike, byte for byte.

## The files' stamps

The base gives each file from the disks the date and time of its file on the disk -- for every file of the retail disks, 3:10 on 10 March 1992 -- and the oracle's installations have another: when Setup ran, all within the same few seconds. The base is right, and the installations' stamps are the recorder's.

- [[read out]] Setup gives each file it copies its compressed file's stamp. `SETUP.EXE`'s DOS program copies through its own expanding copy (load-module offset `1e186`), which once the file is written calls `1ecba`: the source's stamp read (`39cc`, INT 21h AX=5700h) and set on the file written (`6772`, INT 21h AX=5701h). Its Windows program, `WinSetup` (the NE file inside `SETUP.EXE`), does the same in seg7 `0e3b`-`0e4d`: 5700h on the file opened first, 5701h on the file opened second. `LZEXPAND.DLL`'s `LZCopy` does likewise ([[topic:compressed-files]]).
- [[measured]] DOSBox 0.74-3, under which the oracle installs Windows into a folder of the host's, does not keep a stamp set with INT 21h AX=5701h on such a folder: a program that makes a file and sets its stamp to 3:10 on 10 March 1992 leaves it stamped when it ran.

So a new installation's files from the disks keep the disks' stamp, and those of `oracle/build/drive-c*` are an artefact of installing under DOSBox. The profiles and `REG.DAT`, which Setup writes rather than copies, are stamped when it ran on Windows too; the base stamps them as the page's drive stamps what it makes. [[measured]] No probe writes the stamp of a file of Windows': the sweep finds no record that differs by one.

## Not yet done

- WinBox's own COMMDLG against Windows': its drives' combo box's `CBN_SELENDOK` and `CBN_SELENDCANCEL`, and the Rust engine's directories' list's `LBN_SELCHANGE` on a double click (`comboesc`, `filedlg` with no `COMMDLG.DLL`).
- Native's `--assets` has not been run with a window yet.
- The page reads no folder dropped on it: the driver's files are chosen or dropped one by one, or zipped.
- A bundle the page makes from media `known-media.json` does not list is taken, and said to be so, but nothing measures what programs see on it.
- `PROGMAN.INI`, which only Program Manager reads.
- An oracle installation with Setup's `bitmaps` installed, which would ground placing the sounds and wallpapers.
- What `REGEDIT`'s `/U` does is not read out; with it, the database made from nothing is the installation's byte for byte.
