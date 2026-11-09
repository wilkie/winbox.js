# WinBox.js

This project is an ambitious clean-room implementation of the Windows 3.1 kernel
and userspace libraries. This provides an HTML-powered windowing engine that
mimics the Windows 3.1 interface to provide a preservation quality software
archival solution.

The goals are many but mainly focused around:

- High compatibility with many popular-in-their-time applications and games.
- Modern HTML accessibility, including support for screen-readers.
- Wrapping older win16 libraries and using them in your own modern web-applications.
- Support for building new, potentially anachronistic, pseudo-win16 applications using the 16-bit windows API.

## Development

WinBox's engine -- the processor, DOS, Windows' modules and the raster -- is
written in Rust, in the crates under `crates/`. The page that runs it in a
browser is written in TypeScript (React and MUI), built with
[Vite](https://vite.dev/) and managed with [pnpm](https://pnpm.io/), and so
are the scripts of the oracle, the knowledge base and the asset bundle.

You need a Rust toolchain (`rustup`; `rust-toolchain.toml` pins the version
and adds the `wasm32-unknown-unknown` and `x86_64-pc-windows-gnu` targets),
`wasm-bindgen-cli` 0.2.129 in `~/.cargo/bin` (`cargo install
wasm-bindgen-cli --version 0.2.129`), and **Node 22.12 or newer**; the Node
version is pinned in `.nvmrc`, so with `nvm` installed you can run:

```shell
nvm use
```

`pnpm` ships with Node via corepack. Enable it once, then install the
dependencies:

```shell
corepack enable pnpm
pnpm install
```

To run real Windows 3.1 programs in a browser, start the dev server, with hot
module replacement for the page:

```shell
pnpm dev
```

The page runs programs on the Rust engine built for WebAssembly
(`crates/winbox-web`). `pnpm dev` builds it first (`pnpm build:web`) where it
has not been built, or where the crates have changed since; `pnpm build:web`
alone builds it again. Where it is not built, the page says so on its status
line and runs nothing.

Then open `/run.html` on it and drop zip archives on it. Their files go onto a C: drive, a tree of files
held in memory with 8.3 names, which answers as a folder DOSBox mounts, and every Windows program on it gets a Run button. A zip
of your own Windows 3.1 directory gives the programs Windows' fonts: it is
recognised by its `SYSTEM` directory, placed at `C:\WINDOWS`, and remembered in
the browser so it is dropped once. In its place, drop the images of your
Windows 3.1 setup disks (and, for 256 colours, the Super VGA 256-colour
driver's files, unpacked from the Driver Library's `svga.exe`): the page makes
WinBox's asset bundle from them, in the browser, as `pnpm assets` does, keeps
it there, and puts on `C:\WINDOWS` the base it composes for the display
chosen, with no installed Windows at all; a `winbox-assets.zip` made already
can be dropped instead (see `kb/topics/asset-bundle.md`). With Windows there,
a zip of programs dropped is kept too, as a program of its own: a layer laid at
`C:\<NAME>` over Windows, for the display it was dropped on, listed under Kept
programs on every visit, where Open puts it on C: and Forget lets it go (see
`kb/formats/layer.md`); under each, the Program Manager groups its installer
made, each item with its icon from the group file and its command line. What programs write on C: -- changes to WIN.INI, a
game's high scores, a saved document -- is kept there too, as the changes
against what was dropped (each kept program's apart, and on the bundle's base
each display's), and put back each time the page is opened,
until Forget changes clears them. Disk and CD images (`.img`, `.iso`, or a
`.cue` dropped with the `.bin` files it names) dropped beside Windows become drives, in the Drives strip: floppies dropped together
are one set at A:, swapped with Next and Eject, a hard disk image D:, a CD the
letter after; programs on them run from there, an installer on a floppy
installs into a layer, what programs write to a disk is saved only as a new
file (Save image…), and a kept program remembers its CD (see
`kb/topics/drives-and-disks.md`). Nothing is uploaded. As a
program runs, the page lists every API function it called, marking the ones
that reach no implementation yet.

With an installation or the bundle present, the page draws windows as Windows
does, from the display driver's resources and Windows' fonts, on one
screen-sized canvas.
Without one there is nothing to draw them with: programs still run, but they
make no windows. A
screen reader is not given the pixels. It gets a mirror of USER's windows
beside the canvas: each window named by its caption, its menu bar and open
menus, and its controls as buttons, check boxes, text boxes and lists. The
mirror follows what has the keyboard. `crates/winbox-win16/src/accessible_tree.rs`
says what each window becomes.

## Building

To build the web version:

```shell
pnpm build
pnpm preview    # serves it, at http://localhost:4173/run.html
```

`pnpm build` builds the engine (`pnpm build:web`), then the page, `run.html`
and its scripts, bundled by Vite into `dist/web`, with the engine's module
(`winbox_web.js` and its `.wasm`) copied in at `target/winbox-web/`, where the
page loads it from. The folder is served as it is, from the root of a site;
`vite.config.ts` holds the configuration. Other builds write beside it
(`dist/kb`, `dist/assets`) and it leaves them alone.

### Native

`winbox-native` runs a program on the Rust engine in a window of the host's,
rather than in a page. Build it for Linux, or cross-build it for Windows 10
and 11 from Linux or WSL:

```shell
pnpm build:native            # target/release/winbox-native
pnpm build:native:windows    # target/x86_64-pc-windows-gnu/release/winbox-native.exe
```

The Windows build needs MinGW-w64's linker (`sudo apt install mingw-w64` on
Debian and Ubuntu); `rust-toolchain.toml` adds the target. The `.exe` stands
alone: it imports only DLLs that Windows itself ships, so it is copied to a
Windows machine as it is.

```shell
winbox-native PROGRAM.EXE --windows DIR [--drive DIR] [--path C:\FOLDER\PROGRAM.EXE]
    [--display vga|ega|hercules|svga|vga256|8514|8514s|xga256|xga256s|xga640] [--sound [--sound-dump FILE.wav]]
    [--shot FILE [--shot-seconds N]]
```

`--sound` installs WinBox's own sound card on the drive and plays it through
the host's default output device, which it names as it starts.
`--sound-dump` keeps what that device is handed, as a WAV file. A game's
own files decide whether it uses the card: SimTower plays nothing without
the `SIMTOWER.INI` its installer writes, and its mixer, WaveMix, needs
`WAVEMIX.INI` (`kb/topics/wavemix.md`).

`--windows` is an installed Windows 3.1, the directory holding `WINDOWS\`
(`oracle/build/drive-c`), read and never written. `--drive` is the host
directory that is drive C:, laid over it: what a program writes lands there,
the installation's files copied up first. Without `--drive`, a C: is made for
the run and removed after it, with the program's folder copied where `--path`
puts it. Nothing else of the host's files is given to the program. A
`--drive` laid over an installation or the asset bundle's base keeps what a
program deletes of it from run to run, in the cache folder's
`winbox/drives/<sha256 of the drive's path>.removed` (delete that file to
have the base's files back).

Programs can also be kept as layers of drive C:, as the page keeps them
(`kb/formats/layer.md`), in the host's cache folder (`winbox` in
`%LOCALAPPDATA%`, or `$XDG_CACHE_HOME`/`~/.cache`):

```shell
winbox-native --install NAME MEDIA [SETUP.EXE] (--assets FILE.zip|DIR | --windows DIR) [--display MODE] [--keep]
winbox-native --layer-from DIR|LAYER.zip NAME (--assets FILE.zip|DIR | --windows DIR) [--display MODE]
winbox-native --program NAME [C:\PATH.EXE] (--assets FILE.zip|DIR | --windows DIR) [and a run's switches]
winbox-native --list
```

`--install` runs an installer: its media, a folder or a zip archive (or the
installer's `.EXE` itself, its folder the media), are put at `C:\WBSETUP`
beneath an empty top over the program's base and layers. As the run ends, it
asks on the console, or `--keep` says, whether to keep what the installer left
as a layer of the program; the media, and anything the installer wrote into
their folder, are dropped from it, as on the page, and the lines it wrote that
name the media are told on the console. Programs meant to share
a machine are installed in turn under one name. `--layer-from` makes a layer
of your own files laid out as C: has them (SimTower's `WAVMIX16.DLL` in
`WINDOWS\SYSTEM`, `WAVEMIX.INI`, `SIMTOWER.INI`), or takes a layer's exchange
zip. `--program` runs a kept program on its stack, the `.EXE` named or its
only one; what it writes and deletes is kept for it in
`winbox/users/NAME/`. A program's layers are bound to the display it was
installed on, and to its base. `--list` prints the programs kept, and
under each the Program Manager groups its installer made: each item's name,
command line and working directory.

Floppy, hard disk and CD-ROM images are mounted beside C: for any run
(`kb/topics/drives-and-disks.md`, "The native build's drives"):

```shell
winbox-native ... --mount A:DISK1.IMG,DISK2.IMG --mount GAME.ISO|GAME.CUE|GAME.BIN [--write-back DIR]
winbox-native --install NAME A: [SETUP.EXE] --mount A:DISK1.IMG,DISK2.IMG,DISK3.IMG (--assets FILE.zip|DIR | --windows DIR)
```

An `.iso` is a CD-ROM, and so are a raw `.bin` and a `.cue` sheet, its
`.bin` files found as it names them, from the working folder or beside it, as
DOSBox finds them (a sheet DOSBox refuses is refused, its line and why said);
any other image a FAT floppy (2,880 KB or less) or hard disk. Without a letter, floppies take A: then B:, a hard disk the first
free from D:, a disc the first free after that. Several images for one letter
are a set, the first in the drive: type `a next`, `a 2` or `a eject` on the
console while the program runs (`drives` lists them), or press
Ctrl+Shift+F12 for each drive's next disk. The images are never written:
what a program writes to a floppy is kept apart for the run, and `a save
FILE` or `--write-back DIR` saves it as a new image, never over a file that is
there. `--install NAME A:` installs from the floppies at A:, putting nothing
of them on C:, and a program remembers the images it was installed or run
with, mounting them again at the same letters.

On Windows, give `--windows` a local copy of the installation. An installation read across
`\\wsl.localhost` works, but the program starts several seconds later.

```shell
winbox-native PROGRAM.EXE --windows DIR --seamless [--scale N | --resolution WxH]
    [--seamless-shots DIR [--shot-seconds N]] [--seamless-log FILE] [--script FILE]
```

`--seamless` shows each of the program's windows as a window of the host's,
with no Windows desktop behind them: dialogs, menus and lists dropped down
each get a window of their own, the program's main window is on the host's
task bar with its icon, and the host's drag moves and sizes a window by its
Windows 3.1 caption and frame. The emulated screen is the host's desktop:
one rectangle around every monitor's work area, divided by a whole scale
and rounded down, so a window can be moved anywhere and still draws. The
scale is `--scale N`, else the one whose width comes nearest
`--resolution WxH`'s (7680 by 4320 for `1280x720` is 6), else the smallest
that keeps the screen within 2048 a side and is at least the monitor's own
(a 4K monitor is 2, 1920 by 1080). The program sees a screen that size
(`HORZRES`, `SM_CXSCREEN`, maximizing), on the display's own driver
otherwise. In desktop mode, `--resolution WxH` makes the screen exactly
that size and `--scale N` enlarges the window; without them the screen is
the display's own size, as always. The default without it is desktop mode, unchanged. Built for
Windows first; on X it shows the windows, but USER's own loop moves them.
`kb/guides/seamless-windows.md` says what it does and gives up.
`--seamless-shots` saves each window's pixels and a `windows.json` of where
they are, and `--script` plays steps at set times; both are for trying it
without a hand on the mouse (`crates/winbox-native/src/script.rs`).
`--seamless-log` writes, frame by frame, which host windows were made,
shown and taken away and which rectangles each was shown.

### Commands

| Command                       | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                    | Dev server, with the page at `/run.html`, the engine built first where needed |
| `pnpm build`                  | The web version, engine and page, into `dist/web`                             |
| `pnpm preview`                | Serves `dist/web`                                                             |
| `pnpm build:web`              | The engine for WebAssembly, into `target/winbox-web`                          |
| `pnpm build:native`           | The native front end (`build:native:windows` for Windows)                     |
| `pnpm typecheck`              | `tsc --noEmit` over `src`, `test` and `e2e`                                   |
| `pnpm lint`                   | ESLint over the TypeScript sources                                            |
| `pnpm format`                 | Prettier over the repository                                                  |
| `pnpm test`                   | Jest: the page's tests, and the scripts' and the knowledge base's             |
| `pnpm test:e2e`               | Playwright browser tests of the page                                          |
| `pnpm test:conformance`       | The Rust core against the hardware vectors                                    |
| `pnpm kb`                     | The knowledge base's site, into `dist/kb`                                     |
| `pnpm assets`                 | WinBox's asset bundle, from the setup disks under `oracle/`                   |
| `pnpm test:rust`, `lint:rust` | `cargo test --workspace`; clippy and `cargo fmt --check`                      |

## Documentation

The engine's API documentation is Rust's own:

```shell
cargo doc --workspace --no-deps --open
```

What Windows 3.1 does, as measured and read out, is the knowledge base
(`kb/`): `pnpm kb` builds it into `dist/kb`, and
[KNOWLEDGE_BASE_SPEC.md](KNOWLEDGE_BASE_SPEC.md) says how.

## Testing

The engine's tests are Rust's:

```shell
cargo test --workspace
```

The oracle's replay runs every probe recorded under real Windows
(`oracle/fixtures`) on the engine and holds each function's records to
Windows' (`crates/winbox-win16/tests/conformance.rs`). It is a release-profile
run, its trials in parallel; a full run writes `kb/data/conformance.json`, the
report the knowledge base reads. Plain `cargo test --workspace` runs a sample
of it.

```shell
cargo test --release -p winbox-win16 --test conformance            # every fixture
cargo test --release -p winbox-win16 --test conformance -- strings # one probe
cargo test --release -p winbox-win16 --test probes -- --ignored --nocapture survey
```

The corpus of Windows programs (`corpus/README.md`) is run on the engine and
held to its reports:

```shell
cargo build --release -p winbox-win16 --example trace --example corpus
target/release/examples/corpus
```

The page has its own tests. Unit tests run in [Jest](https://jestjs.io/)
under Node:

```shell
pnpm test
pnpm test test/run/page_view_test.ts    # one file
pnpm test -t 'name'                     # one test by name
```

Browser-level tests run in [Playwright](https://playwright.dev/) against
`run.html` on the dev server, in both Chromium and Firefox:

```shell
pnpm exec playwright install    # once, to fetch the browsers
pnpm test:e2e
pnpm test:e2e --ui              # Playwright's UI mode
```

### CPU conformance

The processor is measured against hardware. The
[SingleStepTests 80286 suite](https://github.com/SingleStepTests/80286) records
the complete register, flag and memory state before and after each instruction,
captured from a real Harris N80C286, and the
[80386 suite](https://github.com/SingleStepTests/80386) does the same for the 386. The core is put into the recorded initial state, executes one
instruction, and is compared against what the silicon did
(`crates/winbox-cpu/tests/conformance.rs`).

The vectors are not committed, so fetch them first:

```shell
pnpm test:conformance:fetch                             # the 80286's, a representative subset
node scripts/fetch-cpu-tests.mjs --cpu 386 --all        # the 80386's
pnpm test:conformance
```

`node scripts/fetch-cpu-tests.mjs --all` fetches all of the 80286's, `--list`
shows what the suite publishes, and naming opcodes fetches only those.

Each file's count of vectors passed is held to a baseline from a full run,
`crates/winbox-cpu/tests/baseline286.json` and `baseline386.json`: passing
fewer than the recorded count fails the run. Re-record after an improvement:

```shell
CONFORMANCE_UPDATE=1 pnpm test:conformance
```

`CONFORMANCE_SAMPLE` changes how many vectors of each file are run; a run at
another sample than its baseline's is not held to it.

### Benchmarking

```shell
cargo run --release -p winbox-cpu --example bench
```

This runs four workloads through the core in both real and protected mode and
prints instructions a millisecond, beside DOSBox's for the same instructions
where its recording is there (`kb/topics/timing.md`). The absolute numbers
mean nothing on their own -- they move with the machine and what else is
running -- but the ratio between two runs tells you whether a change to the
core cost anything. Run it a few times and take the median; `BENCH_MS` sets
each run's length.

## Code style

Rust is formatted by `rustfmt` and linted by clippy, with warnings as errors
(`cargo fmt`, `pnpm lint:rust`). The TypeScript is formatted by
[Prettier](https://prettier.io/) (`pnpm format`, or your editor on save) and
linted by ESLint, which reports no warnings or errors on a clean tree.
`tsconfig.json` runs with `strict` and `noImplicitAny` off, left from the
page's conversion from JavaScript.

## History

WinBox's first engine was written in TypeScript. It was retired on 2026-11-08,
the Rust engine having taken over every check it held
(`kb/guides/retire-typescript.md`); its last form is kept on the branch
`typescript-engine`.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the engine is put together.
- [FONTS.md](FONTS.md) — what Windows 3.1 does with fonts, as measured against the real thing.
- [oracle/README.md](oracle/README.md) — the pipeline that measures it.
- [corpus/README.md](corpus/README.md) — the programs it is tried against.
- `kb/` — the knowledge base, built with `pnpm kb`.
