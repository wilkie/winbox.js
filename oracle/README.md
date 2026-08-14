# The API oracle

The CPU has an oracle: 1.4 million instruction tests captured from a real
80286, which turned "is our emulation right" from an opinion into a number and
found bugs that reading the code never would have. The Windows API has nothing
of the sort, and it is the larger and less certain half of the project — a
hundred-odd functions across KERNEL, USER, GDI and MMSYSTEM, none of them
covered by a test.

This is the machinery for building the equivalent. The principle is the same
one that made the CPU corpus worth having: **the expected answers come from the
real thing, not from another implementation that might share our
misconceptions.** So the pipeline installs an actual retail Windows 3.1, builds
real 16-bit probe programs, runs them under real Windows to record what the API
does, and then replays the identical programs against WinBox.js.

## The pipeline

Each stage is a script under `scripts/oracle/`, and each one is independently
runnable and cached, because some of them are slow and all of them are
occasionally worth redoing on their own.

| Stage        | Script                | Produces                  |
| ------------ | --------------------- | ------------------------- |
| 1. Media     | `fetch-windows.mjs`   | `.cache/floppies/*.img`   |
| 2. Toolchain | `fetch-toolchain.mjs` | `.cache/watcom/`          |
| 3. Install   | `install-windows.mjs` | `build/drive-c/`          |
| 4. Drive     | `build-drive.mjs`     | `build/win31.img`         |
| 5. Probes    | `build-probes.mjs`    | `build/probes/*.exe`      |
| 6. Record    | `record.mjs`          | `fixtures/*.json`         |
| 7. Replay    | a Jest suite          | pass or fail per function |

### 1. Media

`fetch-windows.mjs` pulls a distribution from WinWorld's library. Getting a
file there takes three hops — the product page lists releases, a release page
lists mirrors, a mirror redirects to the archive — so the script walks that
chain rather than hardcoding a URL that would rot. Editions are selected by
label, so `--edition "5.25"` works and the download id stays an implementation
detail. `--list` shows all 55 of them.

The default is the retail 3.5-inch set, which is version 3.10.103: the plain
product, without an OEM's driver substitutions.

### 2. Toolchain

`fetch-toolchain.mjs` pulls Open Watcom V2, the only maintained compiler that
still targets 16-bit Windows and the only one with a Linux-hosted build, so
probes cross-compile here instead of inside an emulated DOS. Its published
installer turns out to be an ordinary zip with an executable stub in front, so
it extracts without being run — no interactive setup, no GUI. The script keeps
`binl64`, `h` and `lib286` and discards the rest, which is the difference
between 92 MB and 300.

The release tag is pinned to a dated build rather than `Current-build`. An
oracle that changes underneath you is not an oracle.

### 3. Install

Windows 3.1 ships its files compressed (`GDI.EX_`, `KRNL386.EX_`) and decides
at install time which drivers land in `SYSTEM.INI`. Expanding the files by hand
would mean guessing at that configuration, so the install is done the authentic
way: Windows' own `SETUP.EXE`, driven by the unattended-install script format
it already supports, running under DOSBox against the floppy images. What comes
out is what a real installation produces, because it is one.

DOSBox writes into a mounted host directory, so the result is an ordinary tree
on disk that later stages can read without mounting anything.

### 4. Drive

`mkfs.fat` and `mcopy` turn that tree into a FAT16 image. WinBox.js has FAT16
support already (`src/file-systems/fat16.ts`), so the same image is what the
emulator boots and what the recording stage hands to DOSBox — one artifact,
both sides, no chance of the two diverging.

### 5. Probes

A probe is a small Win16 program that calls one area of the API with known
inputs and writes what it got back to a file. They live in `probes/` as C
source and are compiled to genuine NE executables — the same format and the
same import tables as any Windows 3.1 application, which means the loader,
linker and thunk machinery are all under test too, not just the functions
themselves.

### 6. Record

The probes run under real Windows 3.1 in DOSBox, writing their results to the
C: drive, which the host then reads straight out of the directory. That output
becomes a fixture: the arguments, the return value, and any structure or buffer
the call filled in.

Fixtures are committed. They are small, they are the whole point, and they are
the only part of this pipeline that cannot be regenerated without the media.

### 7. Replay

A Jest suite runs the same probe binaries against WinBox.js and compares
against the fixtures, reporting per-function agreement the way the CPU oracle
reports per-opcode agreement. That number is the thing to drive up.

## Running it

```shell
pnpm oracle:media       # WinWorld -> six floppy images
pnpm oracle:toolchain   # Open Watcom, Linux-hosted
pnpm oracle:install     # Setup under DOSBox -> a real installation
pnpm oracle:drive       # -> a FAT16 image
pnpm oracle:probes      # probes/*.c -> NE executables
pnpm oracle:record      # run under Windows -> fixtures/*.json
```

Everything is cached under `.cache/` and built into `build/`, neither of which
is committed. Re-running a stage is cheap; only the first pass downloads. The
install and the recording each need `dosbox`, and the drive image needs
`mtools` and `dosfstools`.

## What it has found already

The first probe covered nine string functions, and one of its 49 records
disagrees with our implementation:

```
lstrcmp  "Zebra","apple"  1
```

Windows returns a positive number, meaning "Zebra" sorts after "apple". Our
`lstrcmp` subtracts bytes, and `'Z'` is 0x5A against `'a'` at 0x61, so it
returns -7. `lstrcmp` on Windows 3.1 is not `strcmp`: it collates through the
language driver, where case is a tiebreak rather than the primary key. The
manual says the comparison is "based on the language driver" and leaves it
there, which is precisely why this had to be measured rather than read.

## On the media

Windows 3.1 is thirty-four years old and has not been sold in this form since
the nineties, but it is still Microsoft's copyright. This repository contains
no part of it. What it contains is a script that fetches it, which the user
runs, which is the same arrangement the CPU conformance vectors use and the
same one every emulator project of this kind arrives at.
