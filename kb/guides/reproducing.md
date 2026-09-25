---
kind: guide
name: Reproducing a measurement
summary: How to check a Measured or Read out claim on this site for yourself — read the recording, replay it against winbox.js, record it again under a real Windows 3.1, or disassemble the offset a page cites.
---

Every claim on this site carries a label saying how it is known. A **Measured** claim rests on a probe: a small Windows 3.1 program whose recording under real Windows is committed to the repository, and which the test suite replays against winbox.js. A **Read out** claim rests on an offset in a Windows binary. Both can be checked by anyone with a copy of Windows 3.1. This guide walks through the steps; each probe's own page, under [Evidence](../../evidence/index.html), gives the exact commands for that probe.

## Read what Windows returned

The recordings are in the repository under `oracle/fixtures/`, one JSON file per probe and display, and a probe's page links each one. You need no Windows media to read them. A file names the probe, the display, the Windows it was recorded on (with the media's SHA-256), and then every record the probe wrote. Each record has the function, its arguments and its result, all as text:

```json
{ "function": "lstrlen", "args": "\"hello\"", "result": "5", "section": "lstrlen" }
```

A probe's C source says how it turned each call into a record. The source is shown in full on its page.

## What you need to record or replay

- Node 22 and pnpm, and `pnpm install` in a clone of the repository.
- `dosbox`, which installs Windows and runs the probes under it.
- `mtools` and `dosfstools`, which build the drive image the replay reads fonts from.
- `ndisasm`, from NASM, only to check a Read out claim.

The Windows media is not in the repository and is never published. `node scripts/oracle/fetch-windows.mjs` downloads a distribution from WinWorld's library; the default is the retail 3.5-inch set, version 3.10.103, which is what every recording here was made with. `--list` shows the other editions. The compiler, Open Watcom V2 at a pinned release, comes from `node scripts/oracle/fetch-toolchain.mjs`. Both land in `oracle/.cache/`, and nothing under it or under `oracle/build/` is committed.

## Install Windows

```shell
node scripts/oracle/install-windows.mjs
node scripts/oracle/build-drive.mjs
```

The first command runs Windows' own `SETUP.EXE` unattended under DOSBox and leaves the installed tree in `oracle/build/drive-c/`. The second turns that tree into the FAT16 image, `oracle/build/win31.img`, that winbox.js boots and reads the VGA's fonts from.

A recording belongs to a display, because a display driver answers many questions itself and installs its own raster fonts. The displays are `vga` (the default), `svga`, `ega` and `hercules`. Install each one a probe was recorded on:

```shell
node scripts/oracle/install-windows.mjs --display ega
```

Each display is installed into its own tree, `oracle/build/drive-c-<display>/`, and the replay reads that display's fonts from there.

## Record a probe again

```shell
node scripts/oracle/build-probes.mjs smeargnd
node scripts/oracle/record.mjs smeargnd
node scripts/oracle/record.mjs smeargnd --display hercules
```

The first command compiles the probe to a real Windows 3.1 executable in `oracle/build/probes/`. The recorder copies the display's installation to a scratch drive, starts Windows in standard mode with the probe as its shell, and reads the probe's records back when Windows exits. It writes them to `oracle/fixtures/`, over the committed file, so `git diff` shows at once whether your Windows agrees with the one this site was built from.

Where the file lands depends on the probe:

- A probe whose answers belong to the display driver writes `<probe>-<display>.json`.
- Any other probe writes `<probe>.json` whatever the display, so the second command above overwrites the first's file. A second display's recording of such a probe is committed under a name of its own, here `smeargnd-hercules.json`: compare each recording before making the next.

## Replay it against winbox.js

```shell
npx jest test/oracle/api_conformance_test.ts -t "smeargnd against"
```

This calls winbox.js's implementation with every recorded argument and compares the answer with what Windows returned. The full suite, `npx jest`, replays every fixture. When every fixture has been replayed it rewrites `kb/data/conformance.json`, the report this site's counts and status badges are built from. A page may claim a function is exact only when every record of every probe it cites agrees.

## Recordings against fabricated fonts

Some questions have no answer a program can read, such as how the TrueType interpreter rounded a value. Those were asked with fonts built for the purpose: a font Windows installs, with only the bytes under test changed. `node scripts/oracle/fabricate.mjs` builds them all into `oracle/build/fonts/`, and `record.mjs <probe> --font <name>` records against one, into `oracle/fixtures/fabricated/`. A probe's page lists its fabricated recordings with the font each used. They are not in the conformance report. The tests under `test/raster/` and `test/oracle/` replay them.

## Check a Read out claim

A Read out claim cites a module, a segment and an offset: `GDI.EXE` seg1 `6fa3`. Segments are numbered from one, in the order of the NE segment table ([[format:ne]]), and offsets are from the start of the segment, in hexadecimal. For `GDI.EXE`, the repository's disassembler walks a segment by recursive descent from the offsets you give it, so data left between functions does not throw it off:

```shell
SCRATCH=/tmp node scripts/oracle/descend.mjs 1 0x6f63
```

It reads `GDI.EXE` from the VGA installation and prints each instruction reached from those entries, with its offset. For any other binary, `readNE` in `scripts/oracle/ne.mjs` gives each segment's position in the file, and `ndisasm -b 16` disassembles it from there. Where a driver is built twice, as `VGA.DRV` has a 286 and a 386 build of the same routines, the page says which segment it read.

## When your answer differs

Record the probe again before anything else, so you know the difference is repeatable. Then compare editions: every recording names the media it was made with, and a different edition or an OEM's drivers can answer differently. A difference that holds is worth reporting with the fixture you recorded, and the [[guide:contributing]] guide says how to add it.
