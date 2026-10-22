---
kind: format
name: WinBox layers
summary: WinBox's own format for a layer of drive C: — what an installer or a running program added, deleted or wrote, kept apart from the base and content-addressed — its manifest and id, how a stack of layers flattens to one drive and when a stack is refused, its exchange zip, and how the native build writes a layer to disk for its layered host drive.
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

## The rest of the design

Decided, and not built yet:

- **Page storage.** IndexedDB version 4 (`src/run/store.ts`): a `blobs` store by sha256, a `layers` store of manifests, and a `programs` store: each program's name, its base, its layers and EXEs, and its display. The user's layer is kept in `changes`, as `Kept` under a new key.
- **Native storage.** `winbox/blobs/<sha256>`, `winbox/layers/<id>.json`, the materialised `winbox/layer-<stack id>/`, `winbox/programs/<name>.json`, and the user's layer as `winbox/users/<program>/C/`, with its hidden paths in a `removed` file beside `C/` (`HostDrive::keeping_removed`).
- **Installing.** The page drops an archive. It is added as a program, laid at `C:\<NAME>` as today, and kept as a layer. Or it is installed: the base, the archive as media and an empty top; the installer runs; "Keep" makes the top a layer, its blobs hashed with `crypto.subtle`. The owner chose to discard the media after installing. Only the installer's top is kept, and its entries that name the media's paths are dropped. A program that later reads its setup folder will not find it. Native: `--install NAME`, `--program NAME [C:\PATH.EXE]`, `--layer-from DIR|ZIP`.
- **The user's layer.** One per stack, under `C:program:<name>`, kept with the stack's identity: base, display and layer ids. A lower layer changed: ask to apply or drop. Today's `C:assets:<id>:<display>` records become the user layer of a "loose programs" stack under the same key.
- **The owner's decisions (2026-10-21).** Layers are materialised on disk and stacked by the host drive, rather than read live from blobs or flattened into one folder per stack. The Rust engine has its own sha256. Installer media are discarded after installing. A program's layer is bound to its display. One user layer per stack. Programs sharing a machine are installed in turn, and a stack of layers made apart that touch one path is refused. Today's records are kept as the "loose programs" stack. Programs' archives are kept as layers. An installation may be a base. A layer is taken on an explicit "Keep".

## Not yet done

- Everything under "The rest of the design".
- The TypeScript engine's whole sweep on the layers: its file probes are run, and the rest are some hours of one CPU (`LAYERS_SWEEP_SHARD=k/n` shares them out). `verinst` alone is hours on the bundle's base ([[topic:asset-bundle]]).
- A sweep on a stack with a program's layer installed by its installer, rather than one cut from the base.
- Moving a program's layer between displays, by replaying its profile writes.
- An installer that restarts Windows (`ExitWindowsExec`, `_MSSETUP`).
- The stamps an installer gives its files. DOSBox fakes function 5701h, so installed files carry the time of installing, and a layer's id depends on the clock unless it runs on the virtual one.
