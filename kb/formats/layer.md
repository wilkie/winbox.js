---
kind: format
name: WinBox layers
summary: WinBox's own format for a layer of drive C: — what an installer or a running program added, deleted or wrote, kept apart from the base and content-addressed — its manifest and id, how a stack of layers flattens to one drive and when a stack is refused, its exchange zip, how the page keeps programs as layers in the browser, and how the native build writes a layer to disk for its layered host drive.
---

A layer is not a format of Windows'. It is WinBox's way of keeping what a program put on drive C: apart from the base the asset bundle composes ([[topic:asset-bundle]]), so that programs can be installed once and run over the base in any visit, on the page or in the native build. The design it follows is in [[guide:without-windows]], under "Drives from layers".

Whatever the stack, C: must look as one folder of what the stack holds does. The oracle's C: is one DOSBox `localDrive` over one folder of the host's, and what a program sees of a folder is that drive's ([[topic:drives-and-disks]]). Layering must never show.

Both engines read and write the format: `src/layers/layer.ts` and `crates/winbox-win16/src/layers.rs`. They give the same ids, the same flattened drive and the same zip bytes (`test/layers/stack.json`, held by `test/layers/layer_test.ts` and `crates/winbox-win16/tests/layers.rs`).

## The manifest

`winbox-layer.json`:

| Field     | What                                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`  | 1. An engine refuses a number it does not know.                                                                                                                                               |
| `id`      | The sha256 of the entries' lines, below.                                                                                                                                                      |
| `over`    | The stack it was made on: the base's name first, then the ids of the layers that were beneath, the lowest first. Empty for a layer made over nothing, such as a program's archive as dropped. |
| `made`    | `by`, the part of WinBox that made it; `version` and `from`, where known.                                                                                                                     |
| `entries` | What the layer does to the stack beneath it, in the canonical order below.                                                                                                                    |

Each entry has a `kind` and a `path`, DOS's beneath the drive's root, upper case, with back slashes: `WINDOWS\WIN.INI`. Stamps are seconds since 1970, local time read as universal, as DOS keeps it and as the page's changes have them.

| `kind`    | Fields                               | What                                                                                 |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `removed` | `path`                               | A file or folder of the layers beneath that is gone, a folder with everything in it. |
| `folder`  | `path`, `modified`                   | A folder made, or one whose stamp moved: an entry made, deleted or renamed in it.    |
| `file`    | `path`, `sha256`, `size`, `modified` | A file made or written, as it stands; its bytes the blob named by `sha256`.          |

The stamp is in the entry, not the blob, so two files of the same bytes share one blob whatever their stamps.

**The canonical order.** What is removed comes first, by path; then the folders, the shallowest first and each depth by path; then the files, by path. Paths are compared byte by byte. It is the order a drive takes them in: the page's `orderChanges` and `MemoryDrive::changes_from` tell changes removed, folders, files. A path named twice by one kind is refused.

**The id.** Each entry is one line: `removed PATH`, `folder PATH MODIFIED`, `file PATH SHA256 SIZE MODIFIED`. The lines in canonical order, joined by line feeds with none after the last, encoded as UTF-8, are hashed with sha256 and written in lower-case hex. This follows the asset bundle's id, the sha256 of its files' hashes one to a line. `over` and `made` are not part of the id: the same entries made over two stacks are one layer. The TypeScript engine takes the hash from `crypto.subtle`; the Rust engine has its own small sha256 (`crates/winbox-win16/src/sha256.rs`), held to FIPS 180-4's vectors and to `crypto.subtle`'s hashes in the fixture.

**A layer from a drive's changes.** `layerFromChanges` / `Layer::from_changes` take the `Change` list each engine tells of its drive ([[topic:drives-and-disks]]; `src/run/changes.ts`, `MemoryDrive::changes_from`): each file's bytes become a blob, and each change an entry. `changesFromLayer` / `Layer::changes` give the list back in canonical order, ready for `applyChanges` / `MemoryDrive::apply`.

## The base

The base of C: is the lowest layer of every stack. It is not stored: it is composed again from the asset bundle (`composeBase`, `assets::compose`) and named, not hashed: `base:<assets id>:<display>`. As a layer it has a `folder` entry for each folder it names and each folder above its files, stamped `STAMP` (10:20:40 on 6 January 2020) as the page's drive and `write_base` stamp them, and a `file` entry for each placement. An installation used as a base is named `install:<sha256 of its archive>`.

## A stack, flattened

A stack is the base and layers over it, the lowest first. `flattenStack` / `flatten` give what C: holds as one flat drive: a list of folders with their stamps and a list of files with their bytes and stamps, each sorted by path. Each layer's entries are put on what is beneath, in order, as a drive made afresh takes changes:

- `removed`: the path is let go of, with everything beneath it.
- `folder`: the folder is made where it is not there, and the folders above it too, each stamped with its stamp; where it is there, its stamp moves.
- `file`: the file is put there, replacing one there, and the folders above it made as for a folder, stamped with the file's stamp. A folder in its place keeps its place.

So a folder removed and made again in the same layer is opaque: nothing beneath it shows. That is how the native build's `HostDrive::layered` reads a layer's hidden paths too.

### When a stack is refused

The owner chose "install in turn": programs meant to share a machine are installed one after another into one stack, each over those before it. A stack is refused, by `stackRefusal` / `stack_refusal` and by flattening, where:

- a layer's `over` names a base other than the stack's. A program's layer is bound to the display it was installed on, for Setup writes each display's profiles differently;
- a layer's `over` names a layer that is not beneath it in the stack;
- two layers touch the same path and the higher was not made over the lower. Two layers touch where an entry of each has the same path, a folder's stamp included, or where an entry of one is beneath a path the other removes. The base counts as a layer here: a layer made over nothing that touches a path of the base is refused.

A layer made over nothing touches nothing of what is beneath it, so it can go on any stack, in any place.

## The exchange zip

A layer is exchanged as a zip archive of **stored** entries, the asset bundle's writer's format (`writeStoredZip`; the Rust engine's `write_stored_zip`, byte for byte the same):

```
winbox-layer.json       the manifest, JSON.stringify(manifest, null, 2) and a line feed
blobs/<sha256>          each blob a file names, once, in order of hash
```

Every entry is dated 1 January 1980 at midnight (`0021h`, `0`), for a blob has no stamp of its own. The same layer always makes the same bytes. Read back, a zip is refused if it has no manifest, a format the engine does not know, a blob missing or not the bytes its name says, or an id that is not its entries'.

## On the native build's disk

The native build keeps each layer as a folder of the host's, and `HostDrive::layered` puts the folders together under a writable top (`crates/winbox-machine/src/files/host.rs`).

`materialise` / `materialise_stack` write a layer of a stack into `layer-<stack id>` in a cache folder. Written beside and renamed into place, it is made once, as `Assets::base_in` makes the base: a run beside another never finds half of one. The layer's whiteouts, its `removed` paths, become its `HostLayer`'s hidden paths.

The folder is named by the stack through the layer, not the layer alone. The stack id is the sha256 of the ids of the base and of each layer up to it, one to a line. A host drive of layers takes a folder's stamp from the highest layer that has the folder. A layer that writes `WINDOWS\WIN.INI` holds a `WINDOWS` folder without a stamp of its own, so that folder must carry the stamp the stack beneath gives it. Each folder of the layer is stamped as the flattened stack through it has it. A stack materialised this way, under an empty top, lists and reads, stamps included, as the flattened stack held in memory does; `crates/winbox-win16/tests/layers.rs` holds it to that.

## The probe harnesses on layers

`WINBOX_BASE=layers` runs every probe on the asset bundle's base split into a stack of layers, as `WINBOX_BASE=assets` runs it on the base in one folder ([[topic:asset-bundle]]). The split is the same in both engines (`crates/winbox-win16/tests/support/layered.rs`, `test/layers/split.ts`), and each layer is made over all those beneath it, so the stack passes the stacking checks. The layers, lowest first:

1. The base's folders and files outside `WINDOWS\SYSTEM` that are not fonts or profiles: `WINDOWS`, `WINDOWS\TEMP`, `REG.DAT`. It is named by its id, not `base:…`, so its cache folder is never a whole base's.
2. `WINDOWS\SYSTEM`, and its files that are not fonts or profiles.
3. The fonts: `.FON`, `.FOT`, `.TTF`.
4. The profiles: `.INI`.
5. A decoy. It adds a folder at the root, a folder in `WINDOWS`, and a file in each of them and in `WINDOWS\SYSTEM`, all stamped 1 January 2021.
6. The decoy's whiteout, removing each of those.
7. The profiles, `MIDIMAP.CFG` and the first font again, and `WINDOWS\SYSTEM`'s folder entry, all as the base has them. A file is shadowed by the same bytes and stamp, so a read takes the highest layer and a write copies up from it.

The Rust harness materialises the stack into the host's temporary folder, `winbox-layers/layer-<stack id>` (`materialise_stack`). It mounts the layers with `HostDrive::layered` under the run's own writable folder, where the run puts the probe and its files. The TypeScript harness flattens the stack (`flattenStack`) and puts the flat drive on its FAT16 volume, as `bundleDrive` puts the base: each folder stamped as the stack has it, then each file.

[[measured]] Every probe's records and stop on the layers are what they are on the base in one folder, exactly, in each engine:

- **Rust:** all 552 fixtures, in 670 seconds on eight threads (`LAYERS_SWEEP=1 cargo test --release -p winbox-win16 --test layers_sweep -- --nocapture`).
- **TypeScript:** the file probes (`LAYERS_SWEEP=1 LAYERS_SWEEP_PROBES=… npx jest test/layers/sweep_test.ts`). These were `curdir`, `dirorder`, `diskfree`, `filecdr`, `filedlg`, `loadpath`, `lzfiles`, `ofnopen`, `openfile`, `profhold`, `profile`, `profnew`, `search` and `sysdirs`, each run in under 40 seconds.

The sweep found no difference, so the layering needed no fix. To check that it can see one, the whiteout was taken out of the stack. Both the drive's listing and `filedlg`'s record of `C:\WINDOWS` then showed the decoy: five folders where there are four.

On every run, without the switch, `tests/layers_sweep.rs` and `test/layers/base_test.ts` check that the stack lists and reads, stamps included, as the base in one folder does on each display. They also run `dirorder`, `filecdr`, `openfile`, `profile`, `loadpath` and `verinst` (Rust), or `dirorder`, `diskfree`, `filecdr`, `loadpath`, `openfile`, `profile` and `profnew` (TypeScript), on both.

## On the page

The page (`run.html`, either engine) keeps programs as layers ([[topic:asset-bundle]] has the rest of the page).

**Storage.** IndexedDB `winbox-run`, version 4 (`src/run/store.ts`). Version 3's stores, `archives`, `assets` and `changes`, are kept as they are, and three are added:

| Store      | Key            | What                                                                                                                                                                           |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blobs`    | sha256         | A file's bytes. Kept once, whichever layers name them.                                                                                                                         |
| `layers`   | the layer's id | Its manifest.                                                                                                                                                                  |
| `programs` | its name       | `KeptProgram`: its name, its base (`base:<assets id>:<display>` or `install:<sha256>`), its display, its layers' ids, the lowest first, its EXEs, and each layer's file order. |

A program is written in one transaction over the three stores. Forgetting one deletes its record and its user layer, then deletes every layer no program names and every blob no layer kept names (`collect`). The page asks `navigator.storage.persist()` once, as the first program is kept, without waiting: Firefox asks the user. A write that fails, for want of room say, is said on the status line, and the archive is put on C: loose for the visit.

**A program dropped.** With Windows there, an installation or the asset bundle, a zip of programs is made into a layer over nothing (`programLayer`, `src/run/drive.ts`). Its files are where `planDrive` lays the archive over the base, `C:\<NAME>` and beneath, under the same 8.3 names and with the archive's stamps. Each folder it makes has a `folder` entry at the page's stamp, 10:20:40 on 6 January 2020, which is what the TypeScript engine's volume gives a folder it makes for a file. Its program record keeps the order the archive gave its files, so its drive is filled in the order the loose drive is. The program is chosen at once and its EXEs listed, so dropping and running is still one step. Without Windows, an archive is put on C: loose for the visit, as before.

**C: from a stack.** `planDrive`'s `stack`, the base's name and the layers over it, puts each layer's entries on the plan of the base, as `flattenStack` puts them on what is beneath. A file removed is taken out of the plan. A file written is placed after what is placed already, in the order the program record keeps, else the layer's. The folders the layers make or stamp go in the plan's `stamps`, which each engine sets once the files are placed: `fat16Drive`'s `folder` on the TypeScript engine, `add_folder` on the Rust engine. The stack is refused as `stackRefusal` refuses it, with the base's plan counted as the lowest layer. Each engine marks its drive as planned from that plan (`Fat16Changes`, `mark_planned`), so what a program writes is told against the stack.

[[measured]] On the TypeScript engine, a single program's stack is the drive of its archive dropped loose, sector for sector, on a synthetic base, on an installation and on the asset bundle's base for the VGA (`test/run/layers_test.ts`). The volume filled from `stack.json`'s first stack holds what the stack flattened holds. A FAT entry keeps its stamp to two seconds, so an odd second shows as the even one before it. The Rust engine's drive, filled from that plan as the page fills it (`test/run/stack-plan.json`), holds the flattened stack exactly. On the asset bundle's base, the `strings` probe run from a program's layer tells only what it wrote, and its changes put back on the same stack made afresh are told the same (`crates/winbox-web/tests/layers_page.rs`).

The Rust engine's page drive used to give a program's folder, `C:\GAMES`, the stamp of the first file put in it, where the TypeScript engine's gave the page's stamp. The two engines disagreed, and a layer must name one stamp, so both now give the TypeScript engine's.

**The user's layer.** What a program writes is kept in `changes` under `C:program:<name>`. It is told against the stack's identity, `programIdentity`: the name, the base, the display and the layers' ids. It is put back only on that stack. When a program of the same name is dropped again with other files, the page asks whether to put what it wrote on the new one or forget it.

**The loose stack.** Version 3's records, `C` and `C:assets:<id>:<display>`, are the "loose programs" stack: the base alone, with archives dropped loose on it. They are read and kept as before. This is C: whenever no kept program is open, as on every visit until one is opened.

**What the user sees.** The Kept programs list, above Programs, shows each program kept. A program made on another display is named with that display and opened only there. Open puts its stack on C: and lists its EXEs under Programs. Close goes back to the loose stack. Forget lets the program go with what it wrote. A program stays bound to its Windows: dropping another installation or bundle, or forgetting the one there, forgets every program kept.

## An installer into a layer

A program's installer runs over a stack, the base alone or a kept program's layers, with its media placed on C: and an empty top above. What it writes is the top's changes. These are kept as a layer over that stack, and the media are discarded, as the owner chose: `installedLayer` (`src/layers/install.ts`) and `Layer::installed` (`crates/winbox-win16/src/layers.rs`) do this. `install_into_layer` is the Rust helper for any front end that runs the installer on a drive held in memory.

- **The media dropped.** Every entry whose path is a path of the media, or lies beneath a folder of the media, is dropped: the media's files, their folder's stamp, and anything the installer wrote into that folder (`dropMedia` / `drop_media`). On the page the media are put in a folder of their own, `C:\WBSETUP`, so nothing the installer installs can be taken for media.
- **What still names the media.** What the installer wrote that refers to its setup files is told, not rewritten. These are the lines of its text files that name a media path with the drive's letter, in any case (`mediaReferences` / `media_references`). A file with a nought byte is not text and is passed over, since a program's own code names paths too. A program that reads such a line later will not find what it names.
- **Stamps.** Each stamp is kept to the two seconds a DOS directory entry keeps (`dosStamp` / `dos_stamp`) [[documented]]. The TypeScript engine's FAT volume keeps no more. The Rust engine's drive held in memory keeps the second DOS's clock gave.
- **Folders' stamps.** A folder's stamp is the one DOS's clock gave the programs that listed it (`Files::folder_stamp`, `changes_seen`). The Rust engine's drive held in memory stamps a folder by its own clock. In a probe run that is the host's, beside a virtual DOS clock. On the page it is universal time, where DOS's is local time read as universal, so the two are hours apart outside Greenwich. A folder whose stamp, as DOS gave it, is the one it had is not a change.

[[measured]] [[probe:instlay]] is an installer made the way real ones are. It makes a folder of its own and unpacks two files in COMPRESS's format into `WINDOWS\TEMP`. It expands them with `LZCopy` into its folder and with `VerInstallFile` into `WINDOWS\SYSTEM`, and copies its program from its media with `VerInstallFile`. It writes `WIN.INI`'s `[InstLay]` (its folder, and the program on its media) and an `INSTLAY.INI` in its folder and in Windows' folder. It deletes `SYSTEM\SETUP.REG` and makes and removes a folder in its own folder and in Windows'. Then it starts the program it installed, `INSTLAYC.EXE`, from `C:\INSTLAY`. That program reads all of it back: the listing, the bytes, the profiles, and each file's and folder's stamp as `README.TXT`'s or not. Both programs were recorded in one DOSBox session.

In each engine, the installer runs on the base under an empty top, with its media where the recorder put them, `C:\WINDOWS\INSTLAY.EXE` and `INSTLAYC.EXE`, and writes what Windows wrote. Its layer holds what was removed (`SETUP.REG`), four folders' stamps and six files. It holds nothing of the media or of the harness's `C:\ORACLE`. `WIN.INI`'s `Media=C:\WINDOWS\INSTLAYC.EXE` is told as naming the media. The installed program, run alone on the base and that layer, reads back record for record what it read back on Windows. This holds on the installation, the asset bundle's base and its layers (`test/layers/install_test.ts`, `crates/winbox-win16/tests/install_layer.rs`).

The probe found three things in the TypeScript engine, each now as DOSBox and the Rust engine have it:

- A file made by DOS has its archive bit, 20h. DOSBox lists every file of its host folder so (`localDrive`). A file put back from a layer, or placed on the page's drive or the harness's, has it too.
- `_lcreat` into a folder that is not there fails, as DOS's 3Ch does. It used to make the folder.
- A path's drive letter is read in either case, and each name is made upper case, as DOSBox's `DOS_MakeName` does. Caribbean Treasure's installer makes `c:\windows\games\carrib.exe`.

**Caribbean Treasure.** The corpus's `caribb` is an installer: `SETUP.EXE`, `SETUP.BIN` and `CARRIB.DAT`. Its media are placed at `C:\CARIBB` on the asset bundle's base for the VGA, on the virtual clock, and it is clicked through as a person would: "Install Caribbean Treasure", OK to `c:\windows\games`, Yes to make it, and Enter on the last page. Its layer holds its seven files in `WINDOWS\GAMES`, `KNPS.DLL`, `KNPG.DLL`, `DIB.DRV` and `IBMJOY.DRV` in `WINDOWS\SYSTEM`, a new `KNP.INI`, and `SYSTEM.INI` with `joystick=IBMJOY.DRV` added to `[drivers]`. Nothing is dropped and nothing names the media. The Rust engine's run, with its clicks and key when the TypeScript engine's clock made them, makes the same manifest, id included (`test/layers/caribb-layer.json`, `caribb_test.ts`, `tests/install_caribb.rs`). There is no Program Manager on the base, so its three `DdeConnect`s to `PROGMAN` fail. It goes on without making a group and says nothing of it.

**On the page.** A zip with `SETUP.EXE` or `INSTALL.EXE`, and no `SETUP.INF` or disk image beside it, is a program's even where its files are COMPRESSed for a disk (`classify`). Dropped over Windows, the page offers two choices. **Install** runs the installer from `C:\WBSETUP` over the stack of the program chosen to install into, or over the base alone for a program of its own, with nothing kept written on it. **Keep as a program** keeps the archive as before. The page offers **Keep** once the installer's task has ended: a program has ended, or asked Windows to end, and none is left running. A program the installer started and waits for does not count. **Discard** lets it go. Keep makes the layer over the stack the installer ran on. It keeps a new program, or adds the layer over the chosen program's others, as programs sharing a machine are installed in turn. What that program wrote before goes onto its new stack, except where the installer wrote. Its blobs and manifest are kept as any program's are. The status line names what the installer wrote that still names its setup files. [[measured]] `e2e/run.spec.ts` installs the `instlay` probe as `SETUP.EXE`, keeps it, installs it again into it, runs the installed program, discards a third and forgets it, on both engines.

**The native build.** Its `installed()` (`crates/winbox-native/src/programs.rs`) puts the media at `C:\<NAME>` and drops only the folder and removed entries that name media paths. Files the installer wrote, in the media's folder too, are kept. The page and the harnesses drop the media's whole folder instead. Their media are in a folder no installer installs into, and an installer's log or scratch file in its setup folder belongs to the media. The two rules drop the same entries wherever the installer writes nothing into its setup folder, as for `instlay` and `caribb`.

## The rest of the design

Decided, and not built yet:

- **Native storage.** `winbox/blobs/<sha256>`, `winbox/layers/<id>.json`, the materialised `winbox/layer-<stack id>/`, `winbox/programs/<name>.json`, and the user's layer as `winbox/users/<program>/C/`, with its hidden paths in a `removed` file beside `C/` (`HostDrive::keeping_removed`).
- **Installing.** Done on the page and in the probe harnesses (An installer into a layer, above). Native: `--install NAME`, `--program NAME [C:\PATH.EXE]`, `--layer-from DIR|ZIP`.
- **The user's layer, natively.** One per stack, as on the page.
- **The owner's decisions (2026-10-21).** Layers are materialised on disk and stacked by the host drive, rather than read live from blobs or flattened into one folder per stack. The Rust engine has its own sha256. Installer media are discarded after installing. A program's layer is bound to its display. One user layer per stack. Programs sharing a machine are installed in turn, and a stack of layers made apart that touch one path is refused. Today's records are kept as the "loose programs" stack. Programs' archives are kept as layers. An installation may be a base. A layer is taken on an explicit "Keep".

## Not yet done

- Everything under "The rest of the design".
- The TypeScript engine's whole sweep on the layers: its file probes are run, and the rest are some hours of one CPU (`LAYERS_SWEEP_SHARD=k/n` shares them out). `verinst` alone is hours on the bundle's base ([[topic:asset-bundle]]).
- A sweep on a stack with a program's layer installed by its installer, rather than one cut from the base.
- Exporting a kept program's layer as its exchange zip from the page, and taking one dropped.
- An archive whose name is not an 8.3 name, `Ski Free.zip`, is laid on C: with each of its files in a folder of its own, `SKIFRE~1` to `SKIFRE~6`, by `planDrive` as before and so in the layer kept of it: a folder's long name is not remembered once shortened.
- Moving a program's layer between displays, by replaying its profile writes.
- An installer that restarts Windows (`ExitWindowsExec`, `_MSSETUP`).
- The stamps an installer gives its files. DOSBox fakes function 5701h, so installed files carry the time of installing, and a layer's id depends on the clock unless it runs on the virtual one. A layer installed on the page takes the stamps of the host's clock, so two installs of one program are two layers.
- A Program Manager stand-in for installers' DDE: `caribb`'s `CreateGroup` goes nowhere on the base.
- One rule for the media between the page and the native build: what an installer writes into its setup folder is dropped on the page and kept natively.
- The page offers Keep once no program is running: an installer that leaves running a program it does not wait for is offered Keep only once that program ends.
