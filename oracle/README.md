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

### 7. Replay

`test/oracle/api_conformance_test.ts` runs the recorded calls against our
implementation and reports agreement per function, in the shape the CPU oracle
reports per opcode. Four outcomes, one of them good: **agreed**, **disagreed**,
**unimplemented** for a stub or a function no module exports, and
**unsupported** for a call the probes cover but the replay harness does not.
That last one is deliberately not silent -- probe coverage outgrowing replay
coverage would otherwise look like progress.

It replays the calls rather than the probe's own binary. Running the binary
would put the loader, the linker and the thunks under test as well, and is
where this should end up, but it needs a Win16 system far enough up to schedule
a task and it needs `_lcreat` and `_lwrite`, which are still stubs -- a probe
with nowhere to write its answers records nothing. Everything the fixtures
actually describe is measured either way: the arguments are marshalled the way
the thunk layer marshals them, and the implementation is called with them.

## What it has found already

The first probe covered nine string functions, and one of its 49 records
disagrees with our implementation:

```
lstrcmp  "Zebra","apple"  1
```

Windows returns a positive number, meaning "Zebra" sorts after "apple". Our
`lstrcmp` subtracted bytes, and `'Z'` is 0x5A against `'a'` at 0x61, so it
returned -7. `lstrcmp` on Windows 3.1 is not `strcmp`: it collates through the
language driver. The manual says the comparison is "based on the language
driver" and leaves it there, which is precisely why this had to be measured
rather than read.

The eleven recorded comparisons say exactly what the rule is. Collate on the
lowercased text, and fall back to character values only to break a tie -- which
is why `"a"` is greater than `"A"` but `"_"` is still less than `"a"`. Folding
to uppercase instead gets that second case backwards, since `'_'` at 0x5F sits
above `'A'` at 0x41 and below `'a'`. That is now what `lstrcmp` does, and all
eleven agree.

### Ordinals

`dump-exports.mjs` checks a different thing, and found the worst bug so far. An
ordinal is not ours to choose: a program imports USER.471, not `lstrcmpi`, and
the loader is expected to know which is which. A table that puts something else
at 471 sends every call to the wrong function, and nothing about the failure
points at the numbering.

The modules are a poor authority here -- `USER.EXE` names only a few dozen of
its exports and leaves the rest to be imported by number. The SDK's import
library is the complete record, since turning a name into a module and an
ordinal is the whole reason it exists, and it carries one IMPDEF record per
export to do it.

Checking 929 ordinals against it turned up **37 KERNEL exports sitting one slot
late**, every one of them downstream of a single surplus placeholder in a run
of unnamed entries. Also two names mistyped badly enough to matter:
`DefDriveProc` for `DefDriverProc`, and `'OpenJoba, 10'`, where a misplaced
quote had swallowed the argument byte count into the string -- so that thunk
would have unwound the wrong number of bytes off the stack on return. All 929
agree now, and `test/oracle/ordinals_test.ts` keeps them that way.

Where the string probe stands:

**57 of 57 records, 100%** -- `lstrlen`, `lstrcmp`, `lstrcmpi`, `lstrcpy`,
`lstrcat`, `AnsiUpper`, `AnsiLower`, `AnsiNext` and `AnsiPrev`. It started at
22 of 49: four of those were stubs, one was declared but never implemented, and
the recordings said exactly what all five had to do.

The accented range is where writing them from the manual would have gone wrong,
so the probe was extended to cover it before any of it was implemented. What
Windows actually does:

```
AnsiUpper  "aeu" with accents  ->  the uppercase accented letters
AnsiUpper  0xDF                ->  0xDF, no single uppercase form
AnsiUpper  0xF7 0xD7           ->  unchanged: arithmetic, not letters
```

Those last two are the trap. The division sign at 0xF7 and the multiplication
sign at 0xD7 sit in the middle of the accented letters, so a range check that
subtracts 0x20 across the block turns one into the other; and 0xDF sits just
below the lowercase run, where an off-by-one in the bound would convert it too.
Measuring first meant never writing the wrong version.

### The memory probe

A handle is not a comparable thing -- the allocator picks it, and two runs need
not agree -- so the probe records everything derived from one instead: the size
that came back, the flags reported, whether a locked block starts at offset
zero, whether a freed handle stays freed.

What Windows actually does with a global allocation:

```
GlobalAlloc(GMEM_MOVEABLE, 1)     GlobalSize -> 32
GlobalAlloc(GMEM_MOVEABLE, 100)   GlobalSize -> 128
GlobalAlloc(GMEM_MOVEABLE, 1024)  GlobalSize -> 1024
GlobalAlloc(GMEM_MOVEABLE, 0)     GlobalSize -> 0
```

Multiples of 32, minimum 32 -- which we already did, so fifteen of the
seventeen cases agreed straight away. The two that did not were the zero-byte
requests, which we refused outright and Windows honours: a request for nothing
gets a real handle whose size reports as zero, which is how software reserves a
handle without committing memory to it. That is fixed, and all seventeen agree.

Two findings the probe surfaced that are not one-line fixes:

- **A global handle is a selector with its privilege bits lowered.** This was
  the contradiction the memory probe left behind, and the handles probe settled
  it. The handle and the selector differ by exactly one, and their low three
  bits are 6 and 7: both name the same LDT entry, and what separates them is
  the requested privilege level, 2 against 3. So the folklore that a fixed
  handle "is" its selector was nearly right -- near enough to mislead. It holds
  for moveable and discardable blocks too, and `GlobalHandle` recovers the
  handle from either.

  Ours were selector _indices_, which was the same disagreement seen from
  another side: a pointer from `GlobalLock` could not be loaded into a segment
  register and shifted back into an index, which is exactly what `LocalAlloc`
  does with `DS`. The two halves of our own memory code disagreed about what a
  handle was.

  Windows also keeps these descriptors in the **local** table rather than the
  global one, which is why its selectors end in 7 and its handles in 6. Ours
  were in the GDT because that is what the code happened to do, and calling
  that a decision was a mistake: the table bit is part of every selector a
  program sees, part of what `AllocSelector` and `AllocDSToCSAlias` return, and
  part of any comparison of two selectors for identity.

  Both facts are stated once now, in `src/win16/selectors.ts`, and segments
  live in the LDT. The encoding used to be written out at fourteen call sites
  as `(index << 3) | 0x3`, which is how it came to disagree with Windows
  without anyone deciding that it should.

  **The local heap's rounding is now understood.** Seventeen measurements, nine
  of them chosen to refute a model rather than confirm one:

```
block    = max(8, roundup(request, 4))        allocation unit is four bytes,
                                              and no block is smaller than 8
fixed    LocalSize -> block
moveable LocalSize -> max(8, roundup(request + 2, 4)) - 2
```

A moveable block spends two of its bytes on the linkage back to its handle,
which is why `LocalSize` on one reports two less than the block it occupies,
and why requests of 15, 16, 17 and 18 bytes all report 18. The first reading of
that looked like an artefact of the probe freeing each block before measuring
the next -- a freed block can satisfy the next request without the allocator
rounding anything -- but holding every block until the end produced identical
numbers, so the flaw was imagined and the behaviour is real. The probe holds
them anyway; the original version was measuring something it did not intend to.

That model is implemented now -- `Heap.blockFor` rounds, `Heap#sizeOf` answers
for a handle or a pointer, and `LocalAlloc+LocalSize` reads 17/17. The rounding
was the easy part. Two things underneath it had to be fixed first, both
invisible because nothing had ever exercised them: `Heap#allocate` dropped its
options on the way to `insert`, so a moveable request never asked for a handle
and that path had never once run; and when it did run it threw, because `Heap`
declared `getUint16` and `setUint16` and nothing assigned them --
`heapInitialize` built a `DataView` for the heap's bytes and discarded it. The
heap owns its storage now, which is where handles belong in any case, a local
handle being an address the guest dereferences.

### The text probe

Every layout decision a Windows program makes runs through GDI's text metrics.
A dialog sizes its controls from `tmHeight` and `tmAveCharWidth`, a list box
decides how many items fit from the same, and anything that draws a string then
draws something after it asks `GetTextExtent` where the string ended. Wrong by
a pixel and nothing crashes; the interface is simply laid out slightly wrong,
in a way that is hard to trace back to its cause.

Metrics mean nothing without a font, so every measurement selects a stock font
first, and the device context is recorded too -- a disagreement about screen
resolution should show up as one disagreement rather than as a hundred
disagreements about text. The screen is 640x480, sixteen colours across four
planes, 96 dots per inch.

What Windows says about its stock fonts:

| Stock font          | Face     | Height | Ascent | Average | Max | Weight |
| ------------------- | -------- | ------ | ------ | ------- | --- | ------ |
| `SYSTEM_FONT`       | System   | 16     | 13     | 7       | 14  | 700    |
| `SYSTEM_FIXED_FONT` | Fixedsys | 15     | 12     | 8       | 8   | 400    |
| `ANSI_VAR_FONT`     | Helv     | 13     | 11     | 5       | 11  | 400    |
| `ANSI_FIXED_FONT`   | Courier  | 13     | 11     | 8       | 8   | 400    |
| `OEM_FIXED_FONT`    | Terminal | 12     | 10     | 8       | 8   | 400    |

The system font is bold, which surprises people. `"Hello, world"` is 77 pixels
in it, 55 in Helv and 96 in Courier; `GetCharWidth` gives `i` 4 pixels and `W`
14, and an empty string has an extent of zero by zero rather than zero by the
font height.

The replay for this is not written yet, and finding out why was the useful
part. These functions need a device context, a handle table and loaded fonts,
which is more of a system than the other probes needed -- so the question was
whether a font could be loaded at all outside a running Windows. It can, now
that the filesystem works: the fonts are `.FON` files on the drive the oracle
builds, `BitmapFont` reads them straight off it, and measuring is pure
arithmetic with no canvas involved.

Doing that turned up two things.

`FAT16File#read` returned a `Uint8Array` where every consumer expects an
`ArrayBuffer` -- `Executable`, the loader and `_lread` all wrap the result in a
`DataView` directly, and `Stream#read` returns one. The method even returned an
`ArrayBuffer` on its own stream path a few lines above. Fixed.

And the measurement is right while the font selection is not. `VGASYS.FON`
measures `"Hello, world"` at 77 pixels by 16, which is exactly what Windows
says, so the per-character summing and the metrics parsing are sound. But
`Surface#measureText` asks for `fontFor(12)` with the size hardcoded, so a
font file holding several sizes hands back whichever entry is nearest twelve
rather than the one that was selected: Courier answers with its 15-point entry,
20 pixels tall, where `ANSI_FIXED_FONT` is the 10-point one at 13. The stock
fonts are not yet mapped to the files that hold them either.

### The handles probe

Three more things came back, all of which bear on compatibility more than the
sizing does.

**Nothing moves.** A moveable block keeps its address across an unlock, eight
4 KB allocations, half of those freed, and an explicit `GlobalCompact`. Thirty
years of software has a latent bug where it locks a moveable block, allocates,
and keeps using the old pointer; on this evidence that bug stayed latent,
which means our never moving anything is not obviously wrong. It is the one
answer here we already agree with.

**`GlobalReAlloc` keeps both the handle and the address**, growing 256 bytes to
1024 as readily as shrinking back, for fixed blocks as well as moveable. In
protected mode that is what you would expect -- the descriptor's limit changes
and its base does not -- but expecting is not knowing, and now it is recorded.

**The lock count stays at zero** through two nested `GlobalLock` calls, on
fixed and moveable blocks alike, and both locks return the same pointer.

All of it is implemented now. `GlobalHandle` recovers a handle from a selector
by arithmetic rather than by searching, which is what the handle model bought.
`GlobalFlags` reports only `GMEM_DISCARDABLE` -- moveable and fixed both come
back as zero, which the fixtures are unambiguous about and no manual says.
`GlobalReAlloc` keeps the handle and the address, because a descriptor covers
the whole 64 KiB its selector can address, so a block that still fits behind
the selectors it has does not move and only the bookkeeping changes. And the
lock count stays where the recordings put it, at zero.

**Strings 57/57, memory 40/40, handles 16/16 -- 113 of 113.** Every recorded
call agrees with real Windows 3.1.

That is the point at which these probes stop being useful, not the point at
which the work is done. It says everything measured agrees, and what is
measured is nine string functions and the two heaps. The next probe should be
expected to lower it.

Getting there exposed two flaws in the replay harness, worth writing down
because nothing measures the harness. Arguments that were not numbers became
`NaN`, so a probe naming its cases -- `moveable`, `fixed`, `moveable
grow,256->1024` -- handed every adapter the same unusable value; the adapters
fell back to their defaults and agreed anyway. Two probes had been passing for
the wrong reason. And the known-gap list threw unconditionally, so an entry
stayed green whether or not its gap was still there. Both are fixed, and the
second earned its keep immediately: moving to the LDT made an entry stale, and
the suite said so rather than quietly continuing to excuse it.

`AnsiNext` has a quieter surprise: at the null terminator it returns the same
pointer rather than moving past it, so walking a string with it stops at the end
instead of running off.

Recording the first probe also found a flaw in the record format itself. The
fields are tab-separated, and one of the strings under test contains a tab, so
the record split in the wrong place and `lstrlen` appeared to disagree when it
did not. Probes now escape tabs, newlines and backslashes on the way out.

## On the media

Windows 3.1 is thirty-four years old and has not been sold in this form since
the nineties, but it is still Microsoft's copyright. This repository contains
no part of it. What it contains is a script that fetches it, which the user
runs, which is the same arrangement the CPU conformance vectors use and the
same one every emulator project of this kind arrives at.
