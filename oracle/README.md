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
| 7. Replay    | two Jest suites       | pass or fail per function |

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

### 7. Replay, two ways

The **direct** replay calls our implementation of a function with the recorded
arguments. It measures the function and nothing else, which is what makes it
practical for a hundred of them at a time.

The **end-to-end** replay runs the probe's own binary: the loader parses it,
the linker relocates it, the CPU executes it, every API call arrives through a
thunk, and the results are written through our filesystem to a drive we
formatted. The file is then read back and compared with what the same binary
wrote under real Windows.

## Comparing what gets drawn

Recording return values covers a great deal, but not what a program actually
puts on the screen. The obvious next stage is to draw into a memory bitmap on
both sides and compare -- `CreateCompatibleDC`, `CreateCompatibleBitmap`, a
sequence of GDI calls, then `GetBitmapBits` -- which pins down glyph
rasterisation, line endpoints, fill boundaries and raster operations, all of
which are exactly the sort of thing that goes subtly wrong.

**Colour realisation is the part it does not pin down**, and the gap is worth
stating before the harness gets built around the assumption that it does.

A Windows 3.1 display driver has sixteen colours, and a program asks for
twenty-four bit ones. GDI resolves the difference by dithering: a
`CreateSolidBrush` for a colour that is not one of the sixteen becomes an eight
by eight pattern of colours that are, decided when the brush is realised for a
device. Nothing in the API reports this -- `GetObject` still gives back the
`lbColor` that was asked for -- so the only place the dither is visible is in
the pixels.

Where that leaves a bitmap comparison depends on where in the pipeline each
side dithers, and the two sides currently differ:

- Windows dithers at **draw** time, into the destination surface. For a
  device-compatible bitmap the pattern is therefore in the bits, and a
  comparison would see it.
- WinBox.js does not dither in the GDI path at all. `CreateSolidBrush` keeps
  the exact twenty-four bit colour, `Surface` sets it as a canvas fill style,
  and the fill comes out flat at full precision. The `Ditherer` that `Surface`
  builds in its constructor is used by one call, which is commented out; the
  only live dithering in the project is decoration on the desktop background.

So a fill with a colour outside the sixteen produces a dither pattern on one
side and a flat unavailable colour on the other, and a bitmap comparison would
report every pixel of it. That is a true difference rather than a false alarm
-- but it would swamp the geometry differences the comparison is for, and it
would keep reporting until the deeper question is settled.

**The client area is pixels.** That is settled, and it settles the rest: a
dither pattern is not something the DOM can express, so a window's contents
cannot be DOM if they are to look like what the guest drew. Chrome -- the
frame, the caption, the menus -- stays DOM, which is where the accessibility
argument applies anyway; everything a program draws inside its window goes
through a raster we own.

`src/raster/bitmap-context.ts` is the first piece of that: the operations
`Surface` reaches for, over a buffer rather than a canvas. `Surface` is
unchanged and the browser keeps the canvas it always had, so this adds a target
rather than replacing one. `Surface.offscreen(width, height)` makes one, and
real Windows glyphs rasterise into it with no browser present.

The deeper question is where WinBox.js should dither, if at all. Drawing at
full precision and quantising at paint time would look cleaner and would match
the project's aim of rendering through the DOM; dithering at draw time would
match what the guest actually saw, and is the only way a program that reads its
own pixels back gets the answer Windows would have given. The display modes
make this concrete rather than abstract, since a sixteen colour driver and a
256 colour one dither differently and now both exist.

None of this is settled here. What is settled is that a bitmap comparison
measures geometry and glyphs well, measures colour only as far as the two
pipelines agree about when to quantise, and should not be read as covering the
second until that is decided.

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

`test/win16/run_program_test.ts` does the end-to-end form. `strings`, `memory`
and `handles` all agree record for record. `text` and `devcaps` cannot run this
way: they ask for a device context, which means a display, so those two stay
with the direct replay.

Running the binaries found something calling the functions could not. Every
probe formats its records with `wsprintf`, but only a running program passes
arguments through it on a real stack -- and `wsprintf` was ending a conversion
at its own zero-padding flag, because the loop signalled "finished" by
assigning `0` to the character it was scanning and testing `chr == 0`, which is
true for the string `'0'` as well. `%04X` printed `4X` as literal text and
consumed no argument, so everything after it read from the wrong place: the
memory probe reported allocations of 65538 bytes where it meant 1.

`test/oracle/api_conformance_test.ts` does the direct form, reporting agreement
per function in the shape the CPU oracle reports per opcode. Four outcomes, one
of them good: **agreed**, **disagreed**,
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

### Display drivers

`GetDeviceCaps` answers are not properties of Windows. They belong to whichever
display driver was installed, and a program reads them and lays itself out
differently -- it asks how many colours it has, it sizes a font from
`LOGPIXELSY`, it draws a circle round only if it believed `ASPECTX` and
`ASPECTY`. So a fixture recorded against one driver says nothing about another,
and the oracle installs more than one.

`install-windows.mjs --display <name>` picks the profile out of the media's own
`[display]` table and installs into its own drive; `record.mjs --display <name>`
records against it. What three of them say:

|                              | VGA     | Super VGA | EGA         |
| ---------------------------- | ------- | --------- | ----------- |
| `HORZRES` x `VERTRES`        | 640x480 | 800x600   | 640x350     |
| `HORZSIZE` x `VERTSIZE` (mm) | 208x156 | 208x156   | 240x175     |
| `LOGPIXELSX` / `LOGPIXELSY`  | 96 / 96 | 96 / 96   | 96 / **72** |
| `ASPECTX` / `ASPECTY`        | 36 / 36 | 36 / 36   | 38 / 48     |
| `BITSPIXEL` x `PLANES`       | 1x4     | 1x4       | 1x4         |
| `NUMCOLORS`                  | 16      | 16        | 16          |
| `SM_CYCAPTION`               | 20      | 20        | 18          |
| `SM_CYMENU`                  | 18      | 18        | 16          |

EGA's pixels are not square, which is the interesting one: 96 dots per inch
across and 72 down. Everything that lays out in logical units has to know, and
the caption and menu bars come out shorter because the system font at that
resolution is smaller. The driver capability bits -- `RASTERCAPS`, `TEXTCAPS`,
`LINECAPS` -- are identical across all three, being the same generation of GDI
driver.

All three are implemented and all three agree, 37 records each.
`src/win16/display-modes.ts` holds them, `GetDeviceCaps` and
`GetSystemMetrics` answer from whichever is selected, and a machine picks one
when it starts. Fixing that also fixed the `text` probe's ten capability
records, taking it to 55/55: `GetDeviceCaps` used to report the browser it was
running in -- 32 bits per pixel, 256 colours -- which is something no 1992
driver could have said.

**256 colours cannot be recorded here yet.** Every 256-colour driver the
distribution ships is for a particular card -- Video 7, XGA, 8514/a -- and
DOSBox emulates none of them, so a Windows installed with one would not start.
Two are implemented anyway, marked `modelled` rather than `recorded` so the
weaker claim is visible in the source: their resolutions and depths come from
the driver descriptions in `SETUP.INF`, and their capability bits are carried
over from the recorded drivers, which is a guess that at least rests on those
bits being identical across all three of them. `test/win16/display_modes_test.ts`
checks what can be checked without a recording -- that a mode claiming 256
colours does not also claim four one-bit planes, that palette capabilities
appear only on palette devices, and that dot pitch and aspect agree about
whether pixels are square.

The probe is called `devcaps` rather than `display` because Windows already has
a module of that name: the display driver itself is `DISPLAY`. An application
whose module name collides with a system driver does not load, and it fails
before its first line of output, which is a confusing way to find out.

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

The replay needed more of a system than the earlier probes: a device context, a
handle table, and real fonts. All three turned out to be reachable now that the
filesystem works -- the fonts are `.FON` files on the drive the oracle builds,
`BitmapFont` reads them straight off it, and measuring a bitmap font is
arithmetic over its glyph table with no canvas involved.

**Text reads 45/55.** Every metric, every extent, every character width and
every face name agrees with real Windows. What is left is `GetDeviceCaps`,
which is not a defect (see below).

Getting there needed the mapping from stock fonts to files, and that was
derived by measurement rather than assumed: every `.FON` on the drive was
enumerated with its metrics and matched against what Windows reports.

| Stock font            | Face reported | File        | Entry      |
| --------------------- | ------------- | ----------- | ---------- |
| `SYSTEM_FONT`         | System        | VGASYS.FON  | 10pt, 16px |
| `SYSTEM_FIXED_FONT`   | Fixedsys      | VGAFIX.FON  | 12pt, 15px |
| `ANSI_VAR_FONT`       | Helv          | SSERIFE.FON | 8pt, 13px  |
| `ANSI_FIXED_FONT`     | Courier       | COURE.FON   | 10pt, 13px |
| `OEM_FIXED_FONT`      | Terminal      | VGAOEM.FON  | 12pt, 12px |
| `DEVICE_DEFAULT_FONT` | Courier       | COURE.FON   | 12pt, 16px |

Two of those would have been guessed wrong. `ANSI_VAR_FONT` asks for Helv,
which no installed file provides: `WIN.INI` carries a `[FontSubstitutes]`
section saying `Helv=MS Sans Serif`, whose eight point entry matches exactly --
and `GetTextFace` still answers "Helv", because the name belongs to the request
rather than to the file that satisfied it. And `DEVICE_DEFAULT_FONT` is Courier
at twelve points, not a system font at all, whatever its name suggests.

Five bugs came out of it:

- `Surface#measureText` asked for `fontFor(12)` with the size hardcoded, so a
  file holding several sizes returned whichever entry was nearest twelve rather
  than the one selected. Courier answered with its 15-point entry at 20 pixels
  where `ANSI_FIXED_FONT` is the 10-point one at 13.
- `GetStockObject` handed back the whole font _file_, so there was no size to
  select with. A stock font is a face **and** a size, and both halves matter.
- The font manager kept one file per face, last one winning. Several files
  carry a face called Terminal at unrelated sizes -- `DOSAPP.FON`'s smallest is
  six pixels tall -- so which file loaded last decided what Terminal meant.
- `tmDefaultChar` and `tmBreakChar` were reported raw. The file stores them
  relative to the first character it contains; the metrics report them as the
  characters they are.
- `GetTextExtent("")` returned zero by the font height. Windows returns zero by
  zero, and layout code divides by the result.

`FAT16File#read` also returned a `Uint8Array` where every consumer expects an
`ArrayBuffer` -- `Executable`, the loader and `_lread` all wrap the result in a
`DataView`, and `Stream#read` returns one. The method even returned an
`ArrayBuffer` on its own stream path a few lines above, so it disagreed with
itself. Nothing had used both paths before.

**`GetDeviceCaps` is a decision, not a defect.** The oracle recorded a VGA
driver: 640x480, one bit per pixel across four planes, sixteen colours, 96 dots
per inch. Ours reports the browser it is running in -- 32 bits per pixel, 256
colours -- and reads the desktop for its size. Which device WinBox.js should
present to a guest is a real question, since programs make layout and colour
decisions from the answer, and it is not one to settle by quietly matching a
fixture. Left unimplemented and recorded.

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

### The profile probe

The initialisation file calls are read by almost everything and were, until
now, a stub returning nothing and a function that opened a file and then
ignored it. That single gap is what stood between Clock loading and Clock
running: it asks `WIN.INI` for `[intl] s1159` to find out that noon is written
"PM", got an empty string, took the branch for a locale with no such marker,
and unwound into code that had nothing to draw.

The format has more corners than it looks, and five of the answers were not
what reading the documentation would suggest.

**A quoted value keeps its spaces and loses its quotes.** `quoted="  kept  "`
reads back as `  kept  `. Both quote characters work. Since the whitespace
around a value is otherwise trimmed away, quoting is the only way for a value
to have any, which makes it the mechanism rather than a nicety -- and it is
also what the *writer* does: a value written with spaces around it comes back
with them, which only works if `WritePrivateProfileString` adds the quotes.

**`GetProfileInt` is not the string call with a conversion on the end.** It
reads digits and stops at the first character that is not one, so `40two` is
40. It reads a leading minus and returns a `UINT`, so `-1` is 65535. And it
does *not* remove quotes, so `"7"` -- which the string form reads as `7` --
begins with a character that is not a digit and is therefore zero. Three
different rules, in one function, none of them `atoi`.

**A truncated answer reports one thing and a truncated list another.** Asked
for `value` with five bytes of room, the string form returns 4 and writes
`valu\0`: the count is the buffer less one. Asked to enumerate a section with
six bytes of room, the list form returns 4 and writes `onl\0\0`: the count is
the buffer less *two*, because the closing null needs room of its own, and the
name loses a character rather than its terminator. Guessing one from the other
gives the wrong answer, which is what this probe was written to catch.

**A comment is a semicolon at the start of a line and nowhere else.** `sList=;`
is a real entry in a real `WIN.INI` and its value is a semicolon. So is
`equals=a=b`: the first `=` divides the entry from the value and any later one
belongs to the value.

**Writing preserves order.** Replacing an entry leaves it where it was, and
adding one puts it at the end of its own section rather than at the end of the
file. Enumerating the section after five writes returns exactly the list it
returned before them, which is the check that says so.

### The font probe

A program does not choose a font. It describes one -- a name, a height, a
weight, a pitch -- and GDI answers with the closest thing installed. Almost
none of that matching is written down, and it is where an implementation
written from a manual goes quietly wrong: nothing crashes, the interface is
simply laid out slightly differently, and nothing points at the cause.

A hundred and thirty-three requests were recorded. Eight of the rules were not
what reading the documentation would suggest, and two of those only came apart
when the same question was asked at several sizes.

**The character set outranks the name, but only for OEM fonts.** Asking for
Terminal with `ANSI_CHARSET` does not give Terminal, it gives MS Sans Serif:
Terminal is an OEM font, and for this purpose that is the same as not being
installed. Asking for Symbol with `ANSI_CHARSET` *does* give Symbol, though its
character set does not match either. Probing only Terminal would have produced
the rule "the character sets must match", which is wrong; it took both to see
that only the OEM set disqualifies a face.

**An unknown name is answered with Times New Roman, an absent name with MS Sans
Serif.** These are different fallbacks for what look like the same failure.
`Nonesuch` and `MSSansSerif` -- the right name with its spaces removed -- both
land on Times New Roman, while an empty face name lands on MS Sans Serif by way
of the pitch and family. Names match without regard to case and with every
regard to spacing.

**A substituted name is echoed back; a name that merely failed is not.** A
program asking for Helv is told Helv by `GetTextFace`, though MS Sans Serif is
what gets drawn, because `WIN.INI` redirected the name and the redirect
succeeded. A program that asks for `ms sans serif` is told `MS Sans Serif` --
the installed spelling, not its own -- and a program that asks for Terminal in
the ANSI set is told MS Sans Serif. Only redirection preserves the request.

**Bitmap strikes are stretched by whole numbers, up to five times, and a size
is never overshot.** MS Sans Serif is installed at six sizes, the largest a
thirty-seven pixel cell; asked for a hundred pixels Windows answers a hundred,
the twenty pixel strike five times over and exact in every metric including the
internal leading.

Two rules that look like one. The first is that the answer is the largest size
obtainable that does not exceed what was asked for, rather than the nearest:
Courier is installed at 13, 16 and 20, and asked for 24 it answers 20 -- not
the 26 it could make by doubling the 13, though 26 is closer. Asked for 29 it
does double the 13, because 26 fits underneath and beats 20.

The second is that the factor stops at five. MS Serif is the case that shows
it: asked for a hundred it answers ninety-five, its nineteen pixel strike five
times over, and not the exact hundred its ten pixel strike would give at ten
times. Every other rule here would have chosen the hundred.

**A height is three different questions depending on its sign.** Positive is
the cell including its leading, negative is the characters within it, and zero
is the mapper's own default -- which is twelve points, not the smallest
installed size or the largest. A request smaller than anything installed is
clamped rather than stretched down.

**Weight, slant, underline and strikeout are synthesised, and reported
inconsistently.** No bold MS Sans Serif is installed, so bold is made by
widening every character a pixel. Slanting widens nothing and leans the cell
over instead. Any weight of 700 or more reports exactly 700 and anything less
reports what the file says -- which is not always 400, since the System font is
drawn bold and says so to a program that asked for nothing of the kind. And
`tmItalic` comes back as 1 while `tmUnderlined` and `tmStruckOut` come back as
255, so a program comparing any of the three against 1 is right about one of
them.

**The two overhangs behave differently, which one measurement cannot show.**
`tmOverhang` is what a synthesised style adds to a string beyond the characters
in it, and the first recording measured each style at a single size -- where an
emboldening that adds 1 and a slant that adds 7 both look like constants.
Measuring three faces at eight sizes each separates them: the bold overhang
really is 1 everywhere, and the slant's is `floor((height - 1) / 2)`, the cell
leaning over by half its own height. It follows the height being *drawn*, so a
strike stretched to a size it was never installed at leans further in
proportion -- which is the case that could not have been guessed from the
strike alone. Asking for both adds both.

**A face that is already bold is not emboldened again.** The System font is
drawn bold, so a request for bold has nothing to synthesise: no character
widens, nothing overhangs, and the metrics are the plain ones with a weight of
700. Only a face lighter than bold gets the extra pixel.

The probe also caught a defect in itself. Its first recording wrote the request
into the argument field without the underline and strikeout flags, so three
different requests recorded under identical arguments -- three answers to what
the fixture said was one question, with no way to tell afterwards which
belonged to which. The argument field is what identifies a record, and it has
to carry everything that was varied.

### The plotter fonts

Three of the installed faces -- Roman, Modern and Script -- are strokes rather
than pixels, and they are a different kind of thing from everything else in a
`.FON` however similar the container looks. There is one design apiece and GDI
draws it at whatever size is asked for, so nothing about choosing the nearest
strike and stretching it by a whole number applies. They are reachable only
through `OEM_CHARSET`, which is also what selects Roman when a request names no
face at all.

**Every vertical measure is the design's, scaled and rounded on its own.** The
height is exactly what was asked for. The ascent, descent and both leadings are
`round(design * height / designHeight)` -- each rounded separately, so the
ascent and descent need not add up to the height: a sixteen pixel Roman reports
thirteen and four. That fits all three faces at nine sizes each, including
Script, whose design is thirty-seven pixels rather than thirty-two. A request
for no height at all gives eighteen pixels, which is not the twelve points a
bitmap face gets.

**`tmPitchAndFamily` gains a bit the file does not have.** Roman's header says
17 and the metrics report 19: GDI adds `TMPF_VECTOR`, which describes how the
font is drawn rather than what it looks like.

**The widths are settled by a rounding that happens first.** They do not follow
the height, and for a while they looked like they followed nothing: the implied
scale ran from 0.53 to 0.66 of the vertical scale across nine sizes, and not
monotonically, which is not what any single multiplication does.

What happens is that GDI picks a whole number for the average character width
before it scales anything:

    average = floor(dfAvgWidth * height * dfVertRes / (dfPixHeight * dfHorizRes))

and then every other width is that proportion of its design value:

    width = round(designWidth * average / dfAvgWidth)

The design's own aspect -- three horizontal to two vertical for all three
plotter fonts -- is in the first line, but the `floor` around it is what makes
the resulting ratio jump about. A request that names `lfWidth` is stating the
same quantity from the other end, and the rest follows identically. Thirty-nine
of thirty-nine sizes, with no exceptions.

**Emboldening a stroke font thickens the pen with the font.** A strike is drawn
again exactly one pixel across at every size. Strokes are drawn again a scaled
pixel across: the offset is the width scale rounded to a whole number, which is
zero until the font is drawn at about half its design width, one from there to
about one and a half times, and three by the time it reaches three times. It
follows the *width* scale rather than the height, which is why Roman and Script
stop agreeing at the same requested height -- their designs are different sizes
and the same request produces different scales.

The reported overhang is that offset, and so is zero at small sizes. The ink is
not: drawing something again zero pixels across would not embolden it, so the
string still reaches one pixel further than a plain one at every size. Both are
true at once, which only shows up if the returned metrics and the measured
extent are recorded side by side. Forty-eight of forty-eight.

**A slant leans one pixel further than a strike does.** `floor(height / 2)`
against `floor((height - 1) / 2)` for the same cell. One pixel, and the only
way to know it is to measure both kinds.

Finding the character table needed the same discipline. It does not start where
a 2.x or 3.x font's does, and reading it two bytes out yields numbers rather
than an error -- just wrong ones. The check that settles it is the font's own
header, which states the average and maximum character widths: only an offset
of 119 makes the table agree with them, and it does so for all three faces.

### The TrueType metrics are in the font, not in the rasteriser

The obvious next step was to read the outline fonts for their metrics without
rasterising them: parse `head`, `hhea`, `OS/2` and `hmtx`, scale what they say
to the size asked for, and leave the outlines alone. Every layout decision a
program makes uses the metrics, the fixture is entirely metrics, and a
rasteriser is a much larger piece of work. Three faces were swept across
sixteen sizes to find the scaling rule.

There is no scaling rule. For twenty-four of the forty-nine sizes recorded,
**no single scale factor can produce both the reported ascent and the reported
descent by rounding** -- the intervals do not overlap. Arial at an eight pixel
cell reports an ascent of 7 and a descent of 1, which needs a scale of at least
0.00350 for the ascent and less than 0.00346 for the descent. The two numbers
are not a scaling of the font's own ascender and descender; they are arrived at
separately.

That is the signature of grid-fitting, and the first conclusion drawn from it
was that getting these numbers meant running the hinting bytecode -- the same
work as drawing the glyphs, and so no cheaper than a rasteriser.

That conclusion was wrong, and the thing that showed it was looking at what
else is in the file. Arial carries a `VDMX` table of six thousand bytes and an
`hdmx` of five thousand, and both are tables of *results*: `VDMX` states what
the whole face came out as at every pixel size once hinted, and `hdmx` states
what each glyph's advance came out as at a couple of dozen of them. They were
computed when the font was built, by whoever built it, precisely so that a
system can answer `GetTextMetrics` without rasterising anything. Windows reads
them, which is why its answers are grid-fitted numbers that no scaling
reproduces.

With those, the metrics fall out:

    ascent  = VDMX(ppem).yMax          descent = -VDMX(ppem).yMin
    height  = ascent + descent          internal = height - ppem
    external = round(lineGap * ppem / unitsPerEm)
    advance  = hdmx(ppem, glyph)

Arial asked for a sixteen pixel cell settles at thirteen pixels per em, where
`VDMX` says 13 and -3: ascent 13, descent 3, height 16, internal 3. Every
number Windows reports, from a table lookup.

The pixel size is the largest whose fitted height does not overflow the cell
asked for. Where two sizes come out the same height -- which happens, because
fitting quantises -- the choice between them changes nothing except the
internal leading, and which one Windows takes is not settled here. The smaller
is used, which is right more often than not.

Two things about the family are worth having found. All four files of a family
name themselves the same thing in the `name` table, so a request for Arial has
to pick the plain one deliberately rather than take whichever the directory
listed first -- otherwise about half the answers come from Arial Bold. And a
symbol outline is rejected by a request that did not ask for symbols, exactly
as an OEM strike is: WingDings asked for in ANSI comes back as MS Sans Serif.

What remains unresolved is `tmMaxCharWidth`, which comes back one pixel wider
than either the scaled outline maximum or the `hdmx` maximum at the sizes those
tables do not cover. It is one number in one record type, and it is recorded
rather than guessed at.

### What Windows actually draws

Everything above records numbers a program can ask for. `glyphs.c` records
pixels, which nothing can ask for: it draws into a monochrome memory bitmap it
owns and reads the bits back, so the record is the ink itself. That is the only
ground truth a rasteriser can have -- a glyph's shape is not derivable from
anything, and the whole question is what comes out.

The stock bitmap fonts are in there as a control, and they matter more than the
cases the probe was written for. **Every one agrees exactly**: every character
of the System, ANSI variable and ANSI fixed fonts, and of MS Sans Serif and
Courier asked for by name, pixel for pixel. That is what says the comparison is
sound rather than accidentally lenient, and it had to be established before any
of the outline numbers meant anything.

The outlines are filled without hinting, and the measurement is:

| face | exact | pixels differing, of ink |
| --- | --- | --- |
| Arial | 3 of 24 | 16 of 32 |
| Times New Roman | 0 of 12 | 15 of 33 |
| Courier New | 0 of 6 | 12 of 17 |

So the shape is right -- an unhinted Arial `A` is recognisably the same letter
in the same place at the same size -- and about half the ink is in a different
pixel. That is what hinting is worth at the sizes text is read at, and it is a
number rather than an intuition. A stem that falls between two columns is
pushed onto one of them by the font's own bytecode; drawn without it, the stem
is where the outline says and the outline was never meant to be believed
literally at thirteen pixels per em.

### The interpreter runs, and does not yet reproduce the pixels

The hinting interpreter is written: a stack machine with the graphics state,
the zones, the storage and control values, the function definitions, and about
ninety instructions. It works in the sense that matters least and not yet in
the sense that matters most.

What it demonstrably does: runs Arial's `fpgm`, which defines sixty-three
functions, then `prep`, which calls them and leaves the state each glyph starts
from; then runs each glyph's own program to completion -- two thousand two
hundred and forty-three instructions for a capital `A`, across a hundred and
fourteen function calls, a hundred and fifty-eight conditionals, and the whole
family of point-moving instructions. No exceptions, no stack underflows, no
unimplemented opcodes. Finding the last of those was its own small loop: the
census said the three fonts use a hundred and thirty distinct instructions, and
each missing one stops everything until it is written, so the work went
`GETINFO`, then `SROUND`, then the rest.

It first did all that and moved the outline by nothing at all -- points came
back within a hundredth of a pixel of where plain scaling put them. Every
instruction ran, thirty-four point moves were issued, eighteen of them by whole
pixels, and the glyph was untouched.

**The zone pointers.** `prep` builds its scratch points in the twilight zone
and leaves `zp0`, `zp1` and `zp2` pointing there, quite reasonably, because it
is finished. A glyph program that inherits them addresses the glyph's points by
number and writes every one of them into scratch space instead. Nothing is out
of place, nothing errors, and the outline comes out exactly as it went in.

Some of the graphics state belongs to the size and outlives the program that
set it -- the round state, the minimum distance, the control value cut-in --
and some of it is only about where a program had got to. The zone pointers, the
reference points, the loop counter and the vectors are the second kind and reset
before each glyph.

**The phantom points.** The origin is not the left side bearing. The outline's
own coordinates already start there; the origin is where the pen was before the
bearing was applied, `xMin - lsb`, which is nearly always zero. Putting the
bearing there shifts everything the program measures from it and the glyph
comes out a pixel narrow.

With both fixed the fitting takes hold, and the vertical direction comes out
right while the horizontal stays a pixel narrow. Three more followed from
chasing that.

**Auto flip.** A control value is a size, not a direction. A stem is a stem
whichever side of the reference point it lies on, and the table states its
width once; the sign has to come from the outline, and `MIRP` flips the value
to match before it uses it. Leaving that out barely shows vertically, where
nearly every distance is upward and positive anyway. It wrecks the horizontal
direction, where a glyph's points sit on both sides of the reference and half
the distances are negative -- half the points were being fitted to the wrong
side, which is exactly what "a pixel narrow" looked like.

**The control value cut-in only applies within one zone.** Comparing a distance
in the glyph against one in the twilight zone compares two different things.

**`MIAP` on a twilight point places it rather than moving it**, and sets both
the position it is at and the position it is remembered as starting from. The
second half is the one that matters: a later instruction measuring the original
distance from that point would otherwise measure from the origin, because that
is where an untouched twilight point has always been. Every reference the font
constructs is built this way, so getting it wrong misplaces everything measured
against them.

The glyph fixture goes 43.3% to 57.8% across the four fixes. Arial's `A` now
differs from Windows by two pixels, on one row where a diagonal edge crosses
near a pixel centre -- which is a scan conversion question rather than a hinting
one. Courier New averages 0.7 pixels of difference per glyph, against 11.7
unhinted.

One measurement is worth keeping in view: after the first two fixes the average
difference per glyph was *worse* than not hinting at all, while more glyphs were
exactly right. Only the exact count means anything. A glyph is either the pixels
Windows drew or it is not, and "closer on average" is what you measure when you
have not got there.

### The fill rule was not the problem

The two pixels left on Arial's `A` looked like a scan conversion question, so
the sampling position was swept against the fixture: sixteen combinations of
where in the pixel to test, then twenty-five more at a hundredth of a pixel
around the best. Sampling at the exact centre of the pixel wins outright, the
peak is sharp, and every other offset is worse in both directions. There is no
sub-pixel bias to correct. The fill rule was already right.

What the same investigation did find was that the errors are lopsided: we were
inking 84 pixels Windows does not and missing 191 that it does, and the worst
cases were all `weight=700` and `italic=1`. Arial's bold `W` missed
thirty-six pixels and added none, which is not a rounding disagreement. The
synthesised styles were not being drawn at all.

For the bitmap faces the cause was one line: `fillText` measured the text
through the logical font, which knows what was asked for, and then drew it
through the strike, which does not. A bold string came out the right width with
none of its characters emboldened. Passing the request through took the glyph
fixture from 57.8% to 64.4%.

For the outline faces the answer was that they should not be synthesised at
all. The recorded metrics say so plainly, and it took looking at them to see
it: a slanted outline reports an overhang of **zero**, and Arial's italic is
*narrower* than its regular at twenty-four pixels -- 101 against 106 -- which
no amount of shearing produces. Windows is not slanting anything. It is opening
`ARIALI.TTF`.

All four files of a family name themselves the same thing in the `name` table,
and they are four different fonts. Loading only the plain one and leaning it
over was answering a request for italic with an impersonation of one. Keeping
all four, keyed by the style bits each states about itself, and picking the one
asked for took the glyph fixture from 64.4% to 73.3% and the font fixture from
80.9% to 85.5% -- the second because the bold and italic metrics now come from
the file that has them.

Synthesis still exists for a family that genuinely lacks a style, and for the
bitmap strikes, which have no italic anywhere. That one is a real shear and its
anchor was the thing worth finding: **the bottom of the cell, not the
baseline**. Every row shifts right by `floor((rows below it) / 2)`, nothing
ever moves left, and the top row moves by `floor((cell - 1) / 2)` -- which is
exactly the overhang Windows reports for a slanted strike, at every size and on
every face. Anchoring at the baseline leaves descenders swinging out to the
left, and no angle recovers from it: the sweep just kept asking for a steeper
and steeper lean to make up the difference, which is what a wrong anchor looks
like from inside a search over angles.

The last of it was a clipping bug hiding behind the anchor. A slanted row is
drawn to the right of where an upright one would be, and the region the pixels
are written into was measured without the lean, so the top of every letter fell
off the end. It looked exactly like a glyph whose right-hand side was missing,
which is what it was. 74.4% to 80.0%.

A running interpreter that produces the wrong answer looks far more finished
than it is, and the only thing that said otherwise was the pixel comparison.

### Where the last eighteen are

Four fifths of the recorded glyphs come out exactly right. What is left is
almost all Times New Roman's `W` and `g`, and chasing them narrowed the problem
without solving it, which is worth writing down so the next attempt does not
start from the same wrong place.

It looked like the serifs were failing to snap: Windows draws the top of a `W`
as a clean three-pixel bar on one row, and ours scatters single pixels across
two. Reading the hinted coordinates says otherwise. They *are* snapping -- the
serif tops come back at exactly 10.00 and 11.00 pixels, whole numbers, which is
the interpreter doing its job.

The difference is one pixel of cap height. Windows puts the top of the `W` ten
pixels above the baseline and we put it eleven. Everything downstream follows
from that: a bar one row higher, and the serif spread over the two rows the
edge now straddles. So this is not a fill question, not a snapping question,
and not the anchor question that the italic work turned out to be.

Tracing it the rest of the way, one instruction at a time:

* `MIAP[round]` moves point 0 from 9.266 pixels to 10.000. That single move is
  the whole error -- every other point of the serif is placed relative to this
  one and inherits it.
* What it rounds is `cvt[2]`, which is 9.2656 in the font and which `prep`
  raises to **9.5313** before any glyph runs.
* That rise is not arbitrary and looks correct. `prep` rounds `cvt[0]` from
  9.7188 to 10.0000 -- a rise of 0.2656 -- and shifts the entries related to it
  by the same amount, which is how a font keeps a family of heights in step
  once the first of them has been fitted. `cvt[2]` gets 9.2656 + 0.2656.
* And 9.5313 rounds to 10. It is a thirty-second of a pixel above the halfway
  mark, and that is the entire difference: Windows' value must sit just under
  9.5 and round to 9.

So the residual is **one thirty-second of a pixel**, on the wrong side of a
rounding boundary. Not a missing instruction and not a misread table, but an
accumulated fraction somewhere in `prep`'s arithmetic.

The obvious suspect was the scaling: the interpreter kept its coordinates as
whole sixty-fourths of a pixel but arrived at them through a floating point
multiply, where the real thing works in fixed point throughout. That suspicion
was wrong, and provably so. These fonts have 2048 units to the em, which is a
power of two, so the factor `ppem * 64 / unitsPerEm` is exact in binary at every
size -- and not one of the two thousand three hundred and thirty-seven control
values across the three fonts differs between the two paths. Worth checking
before rewriting anything on the strength of it.

What *is* different is the sign. The format takes the sign off a value, does
the arithmetic on the magnitude, and puts it back, so a half rounds away from
zero in both directions. `Math.round` rounds a half upwards, which agrees for
positive values and disagrees for every negative one: -2.5 is -3 there and -2
here. Every distance measured backwards from a reference point goes through
that, which is not as rare as the phrasing makes it sound.

Converting the multiplications, divisions, projections and point moves to that
rule took the glyph fixture from 80.0% to 81.1%. One more glyph exactly right,
which is a modest return for the change and the right sort of return: the
scaling was already exact, so only the sign handling had anywhere to move.

Seventeen records still differ, and the shape of what is left has changed.
Eleven of them are out by one or two pixels. Three are substantial and they are
the same three -- Times New Roman's `W` at both sizes and its `g` at the
smaller -- still one pixel of cap height, still `cvt[2]` landing a thirty-second
of a pixel above the halfway mark.

Two spec omissions were closed while looking, neither of which these glyphs
touch. `MIRP` places a twilight point being measured *to*, the way `MIAP`
places one being measured *from* -- an untouched twilight point has always been
at the origin, so a distance measured from one is otherwise whatever the
reference happens to be. That one is correct and changed nothing here.

Which is the honest statement of where this stands: the interpreter fits both
directions, four fifths of the recorded glyphs are exactly right, and the last
of them differ by a single pixel of cap height in one face.

**What we do not do.** We do not hint. Of the font fixture's 2225 records, 1801 agree: the rest are the synthesised
styles on outline faces, the maximum character width, and the sizes the fitted
tables do not cover. Of the glyph fixture's 90, the 42 bitmap ones agree
exactly and the 42 outline ones do not.

## On the media

Windows 3.1 is thirty-four years old and has not been sold in this form since
the nineties, but it is still Microsoft's copyright. This repository contains
no part of it. What it contains is a script that fetches it, which the user
runs, which is the same arrangement the CPU conformance vectors use and the
same one every emulator project of this kind arrives at.
