# Architecture

WinBox is a **high-level emulator**. It does not emulate a PC. It emulates
enough of a 286/386 to run a Win16 program's own machine code, and it takes
control the moment that program calls into the Windows API, where a JavaScript
implementation runs instead.

That split is the whole design:

```
   Guest program (real Win16 machine code)
        |
        |  far call into KERNEL/USER/GDI
        v
   Synthesized thunk segment  ......................  emulated x86
        |
        |  INT 0x80  -> trap
        v
   Win16 HLE layer (JavaScript)  ...................  native
        |
        |  argument marshalling off the guest stack
        v
   API implementation (JavaScript, often async)
        |
        |  may call back into guest code
        v
   Callback thunk -> CALLF -> guest WndProc -> INT 0x81
```

## Taking control

`ModuleManager` gives each Win16 module (KERNEL, USER, GDI, …) a real segment
of synthesized 16-bit code. Every exported ordinal gets an eight byte slot:

```asm
INT 0x80          ; CS identifies the module, IP identifies the ordinal
RETF imm16        ; pop the callee-cleaned arguments
```

A guest far-calls those slots believing they are the real libraries. Nothing
about the call is special from its point of view: it pushes arguments, does a
far call, and gets a result in AX/DX.

Offset 0 of the same segment is the callback thunk, used in the other
direction — when the host needs to run guest code (a window procedure, a dialog
procedure, an enumeration callback) and regain control when it returns:

```asm
CALLF seg:off     ; immediate patched by Scheduler#call before each use
INT 0x81          ; the callback returned
```

## The trap protocol

Interrupt dispatch is CPU behaviour: an interrupt pushes FLAGS, CS and IP and
vectors through the interrupt table, and guest code handles it. The exception
is the vectors the emulator claims for itself, which have to reach the host
instead. So the rule is: **a claimed vector latches for the host, everything
else dispatches in the guest.**

`CpuCoreHost#claimsInterrupt` answers which is which, backed by whatever has
been registered on `Machine#interrupts`. Today that is `0x1A`, `0x21` and
`0x31` for the DOS layer and `0x80` and `0x81` for the Win16 thunks.

For a claimed vector:

1. The guest executes `INT n`.
2. The core latches the vector on the CPU wrapper (`cpu.interrupt = n`) and
   returns. It does **not** vector through the IVT or IDT. CS:IP is left on the
   instruction after the `INT`, which is the `RETF` in the thunk.
3. `Scheduler#run` checks the latch after each `cpu.step()`, halts the task and
   breaks out of the frame loop.
4. It clears the latch and calls `machine.interrupts.dispatch(vector)`.
5. The handler returns `true` to resume immediately, a `Promise` to resume when
   it settles, or anything else to stay halted and resume itself later.

`Win16#syscallInvoke` takes the last option: it returns `false`, and
`Scheduler#interpretReturnValue` resumes the task once the API implementation
has produced a value for AX/DX.

An unclaimed vector instead dispatches the way the part would: push FLAGS, push
CS, push the return address, clear IF and TF, and load CS:IP from the four-byte
real-mode entry. Faults push the address of the offending instruction so it can
be restarted; traps such as `INT`, `INT3` and `INTO` push the address of the
instruction after. Protected-mode dispatch through IDT gates is not implemented
-- those vectors still latch -- because there are no protected-mode vectors
published to verify it against.

## Argument marshalling

There is no ABI helper. `Win16#syscallInvoke` reads arguments directly out of
the guest stack at `ss:sp`, using the export table's declared types to decide
how to interpret each slot: 16-bit values inline, `LPCSTR` read as a C string
through `translateAddress`, structures loaded via `Struct#loadFromMemory`,
variadics as a far pointer to the remaining stack.

This is why the CPU's registers and memory have to stay cheap to reach from
JavaScript, and why guest memory should live somewhere a JavaScript view can
address directly.

## The core boundary

Everything above the emulator is written against `src/emulator/cpu-core.ts`:

| Interface     | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `CpuCore16`   | The 286 surface. Implemented by `core/i286.ts`.            |
| `CpuCore`     | Adds 386 enhanced mode. Implemented by `core/i386.ts`.     |
| `CpuCoreHost` | What a core needs from its environment. Provided by `CPU`. |

`Machine#cpu` is typed, so the compiler checks both sides of the seam: a core
that fails to implement the contract, and host code that reaches for something
the contract does not promise.

### The four invariants

A replacement core must honour all four. They are documented in full in
`cpu-core.ts` and are tested in `test/emulator/cpu_core_conformance_test.ts`,
which any core must pass unchanged.

1. **Traps suspend at an instruction boundary.** The vector is latched and
   drained by the host between instructions; CS:IP, the stack and the segment
   registers are untouched.
2. **A trap may suspend the guest indefinitely.** API implementations are
   frequently async. A core that must run to completion, or cannot be re-entered
   exactly where it stopped, will not work.
3. **Execution re-enters from the host.** Host and guest frames interleave to
   arbitrary depth. There is no single linear instruction stream.
4. **Guest code is modified while it runs.** The callback thunk's `CALLF`
   immediate is patched before every use. A core that caches decoded
   instructions or compiles basic blocks must invalidate on writes to guest
   code — this is the constraint most likely to be missed by a recompiling
   core, and it fails as callbacks dispatching to the wrong procedure.

## Presentation

The whole screen is one raster, as it is on Windows: USER draws every window's
frame, caption, menus and controls itself, pixel for pixel, on USER's raster
desktop (`src/win16/user/desktop.ts`), from the installation's own display
driver and fonts, and each can be held to what Windows drew. A screen reader
is not given the pixels: beside the canvas is a mirror of USER's window tree
(`src/win16/user/accessible-tree.ts`, `src/run/aria-mirror.ts`), each window
named by its caption and each control by its role, following what has the
keyboard. The Rust engine makes the same tree, to the character
(`crates/winbox-win16/src/accessible_tree.rs`), held to the TypeScript
engine's at the same places of the same runs (`test/raster/accessible-trees`).

A GDI surface's pixels are not the canvas. Every device context -- a program's
window, a memory device context, the screen -- draws into a `DeviceBitmap` of
palette indices, one byte a pixel, and the screen is shown on its canvas by a
`Presenter` once a frame, only the rectangle written since the last one. See the oracle's README, "Comparing what gets drawn".

## The run page

`run.html`, served by `pnpm dev`, runs programs in the browser on either
engine. It is not part of the library bundle: `pnpm build` (`src/shim.ts` to
`dist/winbox.js`) reaches nothing under `src/run/page/` or `src/run/ui/`, and
holds no React or MUI. Everything around the Windows screen is React and MUI;
the screen itself is the engine's.

**State and actions** (`src/run/page/`, plain TypeScript, no React):

- `state.ts` holds what has been dropped and kept and the page's settings
  (`state`), what the actions share beside it (`session`), the machines
  (`machines`, each a `Machine`: a tab, on an engine instance of its own,
  with its stack -- the kept program it runs, or the base -- its display,
  coprocessor and sound card, its drives of images, the install under way on
  it, its plan, what it kept, its trace and its own screen's element; the
  one shown, `current()`), and three values the components read: `pageView`
  (everything but the trace and the status line, the side speaking for the
  machine shown, and the tabs), `traceView` (the machine shown's) and
  `statusLine` (the page's one; a line from a machine behind is named with
  it). `publish()` makes `pageView` afresh; every action calls it where the
  page's old `render` functions were called. No two machines run one stack
  (`runningOn`): each keeps what it writes by its stack.
- `view.ts` makes each panel's rows and words from the state, changing
  nothing (`windowsText`, `driveRows`, `installView`, `keptRows`, ...): what
  `test/run/page_view_test.ts` tests from jest.
- The actions, by concern: `machine.ts` (the engine chosen, a machine made
  with the `Page` its engine is given, shown and closed -- `addMachine`,
  `select`, `closeMachine` -- its trace, keeping what its programs write,
  `rebuild`), each taking the machine it acts on, `accept.ts` (files
  dropped or chosen), `images.ts` (the drives of images and a kept program's
  images), `install.ts` (installers and the kept programs), `groups.ts` (each
  kept program's groups, `launchGroups` over its stack, each item's icon
  with it), `launcher.ts` (a group's item run, as Program Manager runs it),
  `browse.ts` (the file browser's
  reading of the drives, and the folder browsed, `browsing`), and
  `actions.ts`, the surface the components call, and `start(desktop)`.
- `screen.ts`, the screen's shape and size (`screenScale`, the choice);
  `files.ts`, the drives' folders as DOS lists them: both tested from jest
  (`page_screen_test.ts`, `page_files_test.ts`).
- `observable.ts`, a value with listeners, read through
  `useSyncExternalStore` (`src/run/ui/use.ts`); `leave.ts`, the key that
  leaves the desktop.

**Components** (`src/run/ui/`, `.tsx`): `app.tsx` lays out the banner
(`header.tsx`), the side (`panels.tsx`, `drives.tsx`, `kept.tsx`), the main
content -- the desktop, `desktop.tsx` -- and the trace (`trace.tsx`); three
columns from 1100px, one beneath another below. `confirm.tsx` asks before
what cannot be undone; `files.tsx` is the file browser, rendered once and
opened by `actions.browse(letter)`. `launcher.tsx` is the launcher
(`kb/guides/launcher.md`): the banner's **Programs** menu button, beside the
heading, opening a menu of every kept program's groups (`launcherView`),
each a submenu of its items -- icon and name; one that cannot run disabled
but reachable, its reason in its words -- each run by `actions.launch`.
Where an item's working directory is not there it first asks, with
`confirm.tsx`, Program Manager's own question ("Invalid Path", "The working
directory is invalid."), OK not shown as destructive. It is added beside
Kept programs and the Programs list, which stay. The engines take an item's
command line, current directory and show command (`Engine.run`'s `item`:
`Win16.run`'s, `Session::start_item`). JSX is compiled by the bundler's own transform
(`"jsx": "react-jsx"` in `tsconfig.json`, which Vite's transform reads): no
plugin, nothing added to `vite.config.ts`.

**The drives** (`ui/drives.tsx`, `driveRows` and `cDriveView` in `view.ts`).
Each drive is a card (MUI `Card`, an icon from `@mui/icons-material` and its
kind in words): C:, the hard disk (Windows -- the installation's name or the
setup disks' and the display -- the kept program and its layers, or the
archives dropped, and the changes kept); each drive of images in `#drives`,
one `li` each, named `A: floppy drive, Disk 1 of 2, one.img`: what is in it,
a disc's volume label (`driveVolumes`, read with the page's own readers as its
programs are), read-only for a disc and "writes go to a copy" for a disk, its
set listed with the disk in the drive and those written to (the engine's
`diskChanged`, or `Disk.written` once carried), and how its images are had on
a later visit -- kept with the program on C: from a handle on the file, a copy
(`copies`, or "Keep copies"), or chosen again -- or not kept; and the images
still to be chosen again. A drive's actions keep their names ("Disk in A:",
"Next disk in A:", "Eject A:", "Save the image in A:", "Add images to A:",
"Install from A:", "Remove A:"); Remove asks first, saying what is lost.

**The file browser** (`ui/files.tsx`, `page/browse.ts`, `page/files.ts`). A
modal dialog ("Files"; the whole screen on a narrow one), reached from the
side's "Browse files…" (where "Files on C:" was) and each drive's card
("Browse the files on A:"). A drive picker (C: and each drive of images), the
folder's path as breadcrumbs, Up, Read again, and the folder as a grid: name,
size and date as DOS's `DIR` shows them (8.3 names, upper case, `<DIR>`,
`03-10-92  3:10a`), and a Changes column. C: is read from what the page has,
the same on either engine: the plan's folders, files and stamps, then the
engine's changes against it (`Engine.changes`), each marked "Kept" where it is
the change put back as C: was made (`session.given`), "Changed" where written
since; the folders on the way to a file the volume's own stamp, as both
engines' drives make them. A drive of images is read from its disk's image as
programs have written it (`Engine.diskImage`), with the page's readers
(`volumeOf`), each entry "Changed" where the disk as it was put in has none of
its name, size and stamp. Nothing is written to any drive. The grid follows
the WAI-ARIA data grid pattern: one Tab stop, arrows from cell to cell, the
column headers its first row (buttons that sort, folders always first,
`aria-sort`), Home/End, Ctrl+Home/End, Page Up/Down; selection follows the
focus, Enter opens a folder, Backspace and Alt+Up go up, onto the folder come
from. Beneath it, for the row selected: Open, Download (its bytes as the drive
holds them, by its 8.3 name) and, for an `.EXE`, Run (named as the Programs
list's, `Run C:\APPS\NOTEPAD.EXE`; the browser closes). What is done is said
in the dialog's own status line, the page's being hidden while it is open.

**The desktop.** `desktop.tsx` renders an empty `<section id="desktop">` and
hands it to `start`; each machine puts an element of its own in it, which
its engine fills (`makeScreen`, `screenNote`), the shown machine's alone not
`hidden`. React never renders into it, so the canvas, its host and the ARIA
mirror (`aria-mirror.ts`) are the engines' alone. Above it, the machines'
tabs (the WAI-ARIA tabs pattern: a tablist "Machines", a tab for each named
by its install, the arrows among them, the selection following; the section
the tab panel), and beside the tablist, outside it, the Close of the
machine shown (`Close pmitem`), which keeps what it wrote first and so
asks nothing; Delete on a tab closes it too. Machines behind keep running,
not heard (`Engine.heard`); an engine closed is ended (`Engine.dispose`). Its CSS (the canvas centred and
unbordered, the mirror read and not seen) is the section's `sx`.

**The screen's size** (`page/screen.ts`, `screenBox`, `displayAspect`). The
canvas holds the display's own pixels; the page draws it larger or smaller
with CSS. The section is as wide as its column and as tall as the display's
shape makes it, up to the window's height less the page's chrome; a
`ResizeObserver` on it, and an observer of the canvas's `width` and `height`
(the Rust engine sizes its canvas afresh), set the canvas's CSS size within it,
centred, the bands beside it black -- never per frame. Each display is shown as
a 4:3 monitor of its day showed it, DOSBox's way (`vga_draw.cpp`): 640x480 and
larger 4:3, square pixels; EGA 640x350 and CGA 640x200 stretched to 4:3, pixels
1.37 and 2.4 times as tall as wide; Hercules 720x348 at DOSBox's 1.5, a 1.38:1
picture. "Fit" fills the room at any scale; "Whole pixels" draws each pixel a
whole number of device pixels across and down, as near the display's shape as
whole numbers come (an EGA 1x1, then 2x3, then 3x4), and fits where even 1x1
is too large; "Actual size" one CSS pixel to the pixel, as before, shrunk where
it must be. Pixels are hard-edged (`image-rendering: pixelated`) where they are
whole, or two device pixels or more each way; smoothed under that, where hard
edges make one stroke of a letter twice as thick as the next (and, shrunk, drop
lines). The choice is remembered in `localStorage` (`winbox.screenScale`,
every access in `try`). The canvas has no border nor padding, so its box is its
pixels, and `attachInput` maps the mouse through `getBoundingClientRect` at any
size, the bands moving nothing. "Full screen" puts the screen, its toolbar and
the line beneath on the whole screen (the Fullscreen API, Escape locked to the
page with the Keyboard Lock API where the browser has it, so Esc is held to
leave), or on the whole window where the browser refuses; Meta+Escape leaves
either.

**Theme** (`ui/theme.ts`): MUI's own, light and dark following
`prefers-color-scheme` (a CSS-variables theme, `colorSchemeSelector:
'media'`), the system font, a focus outline on every control. MUI's dark error
red takes dark text on it, as white on it is under AA. With
`prefers-reduced-motion`, transitions and ripples are cut to nothing
(`app.tsx`).

**Accessibility rules**, which a change to the page keeps:

- Landmarks: the banner, two named asides ("Programs and files", "API
  trace") and `main`, the desktop; one `h1`, the panels' headings `h2`.
- Every control is a native control or MUI's (a `button`, a checkbox in a
  `label`, a native `select`: the platform's own list, typed into and read as
  every select is, and what the browser tests choose from with
  `selectOption`), and every one is named; buttons whose words are short
  ("Eject") are named in full ("Eject A:").
- Nothing only by mouse: the drop has "Choose files…", and each drive's card,
  which images are dropped on, has "Add…".
- Nothing by an icon or a colour alone: each drive's kind is said beside its
  icon ("A: floppy drive"), each disk's state in its words ("in the drive",
  "written to") beside its mark; a launcher item that cannot run says why
  ("Cannot run: needs WRITE.EXE, which is not in this Windows."), in its
  name as on the screen, not by its dimming.
- The status line (`#status`) is a live region, polite, assertive for an
  error; its words are written into it as each line is told, so a line told
  twice is announced twice.
- Forgetting Windows, a kept program or what programs wrote, discarding
  what an installer wrote, and removing a drive (what programs wrote to its
  disks this visit is lost), ask first in a modal dialog, Cancel focused.
- The desktop (role `application`, "Windows desktop") gives every key to
  Windows. **Meta+Escape** (the Windows logo key, Command on a Mac, with
  Esc) leaves it, to the line beneath it, which says so and describes the
  desktop (`aria-describedby`). Windows 3.1's keyboard has no Meta key and
  neither engine gives it a virtual key, so Windows sees nothing of it; the
  Escape is taken before the desktop has it (`page/leave.ts`).
- A skip link, first, goes to the desktop.

**Testing it.** `test/run/page_view_test.ts`, `page_screen_test.ts`,
`page_files_test.ts` and `page_machines_test.ts` (jest) hold the view's,
the screen's, the files' and the machines' rules. `e2e/run.spec.ts` drives the page by its ids and by roles and names --
the files on a drive through the file browser (`browser`, `listed`) -- and its
last describe, "the page, to a screen reader and the keyboard", runs axe
(`@axe-core/playwright`, WCAG 2.1 A and AA) on the page fresh, with Windows,
with a floppy set and a disc in their drives, with the file browser open on
C: and on the disc, with the screen on the whole screen, with a program kept
and running, with the launcher's menu open, a group's items open and an item
that cannot run focused, with the confirmation open and with an installer
offered, each in both colour schemes, and tries the skip link and the way out
of the desktop. Two installs on two machines, each a tab, are run on both
engines (`keepPmitem`, `keepStrings`), with axe on the two tabs. The
launcher's own test runs `pmitem`'s child from a kept
group (`keepPmitem`) on both engines, by the keyboard and the mouse, each
line it writes held to the probe's records. The components are linted with
`eslint-plugin-jsx-a11y` and `eslint-plugin-react-hooks`, each as it
recommends.

## Known gaps

Found while formalizing the boundary; recorded here rather than fixed silently.

**Where the 286 and the 386 differ.** The emulator is a 386, and for the HLE it
can be assumed to be a 386 already in protected mode. The conformance corpus is
an 80286 in real mode, so it is an oracle for the instruction semantics the two
parts share and for nothing else. The audit found four places that are
part-specific, and only one of them is a behaviour the two parts disagree on:

| Behaviour                                            | Status                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POPF`/`IRET` clearing FLAGS bits 12-15 in real mode | Diverges. The 386 is understood to permit IOPL and NT. Left as the measured 286 behaviour |
| Shift counts masked to five bits                     | Shared by both parts; the comment naming the 286 is about provenance, not divergence      |
| Undefined flags for the multiplies and divides       | Measured on a 286. Unverifiable for the 386 without a corpus                              |
| The `IDIV` quotient of -128 the part lets through    | Described as a bug in the reference. Unknown on a 386                                     |

The `POPF` divergence is deliberately not "corrected" to the 386 answer. The
branch is real-mode only and the HLE never reaches it, nothing published can
verify the 386 behaviour, and changing it would trade a measured behaviour for
an assumed one across five hundred passing vectors. It is marked in the source.

**What being a 386 in protected mode actually implies** is a different and
larger list, none of it reachable by the corpus. Protected mode is the only
mode the Win16 layer ever runs in, and no published corpus covers it, so
`test/emulator/protected_mode_test.ts` builds descriptor tables by hand and
serves as the oracle instead. Writing it turned up five decoding bugs at once,
all of which it now pins:

- **DPL was read out of the wrong byte.** `(flags >> 13) & 3` lands on byte 6,
  where the granularity bits are; DPL is bits 5-6 of the access byte.
- **The granularity bit was decoded and discarded.** A segment declared in 4 KiB
  units had a limit 4,096 times too small, which mattered not at all while no
  limit was enforced and would have been fatal the moment one was.
- **Segment limits were not enforced at all.** The `#GP` rule was real-mode only,
  where the limit is always 64 KiB; a descriptor's limit can be anything up to
  four gigabytes, and expand-down segments invert the comparison entirely.
- **A null selector loaded as present**, so using one addressed real memory at
  zero rather than faulting.
- **A selector past the end of the table threw the string `'F'`.** The bounds
  test was also off by one, rejecting the last descriptor that fits.

The limit check hangs off `requireWithinDescriptorLimit`, which the 386 core
overrides and the 286 core leaves empty -- a 286 in protected mode is a dead end
this project has no reason to emulate, so `I286#retrieveDescriptor` now decodes
real-mode selectors only and the 386 core owns the tables.

### Where the limit check lives

It began in the operand helpers, which was the wrong place: they cover the
ModRM forms and nothing else, so the `moffs` forms, the string operations,
pushes and pops, and instruction fetch itself all reached memory without being
checked. The check now sits in `translateAddress`, which every access goes
through, so those paths are covered by construction rather than by having been
remembered.

The two modes turned out to want the same comparison. A real-mode segment is
64 KiB, so the rule the corpus pins -- an access crossing the end of a segment
faults, where the 8086 wrapped -- is a limit check against 0xFFFF, and a
descriptor limit is that same check against a different number. Each descriptor
carries the bounds worked out once when it was loaded, including the inversion
for expand-down segments and an impossible pair for a segment that is not
present, so the check on the hot path is two integer comparisons and every
decision about which fault to raise happens in the slow path.

**It cost nothing.** Measured with `pnpm bench` over four workloads in both
modes, three alternating runs each, every change landed inside the ±6%
run-to-run spread, with medians between -0.5% and +3.5%. The check paid for
itself because it replaced a worse path: `translateAddress` used to call
`computeBase`, which did the same descriptor-cache lookup and then threw the
descriptor away to return one field, after which the operand helpers looked it
up a second time to check the limit. One lookup and two comparisons is less work
than that, and `computeBase` is gone.

Every descriptor is built with the same keys in the same order -- the real-mode
one, the null selector, and the decoded one all carry `nullSelector` and the
precomputed bounds whether they need them or not -- so the property reads on the
hot path stay monomorphic. That is worth 5.6% on fetch-heavy code in protected
mode and nothing anywhere else, which is about what a hidden-class miss is worth.

The benchmark also says protected mode runs fetch-heavy code about 30% slower
than real mode, and has since before any of this: the gap was 38% at the
baseline. It is not the limit check -- the memory-heavy workloads show no gap at
all -- and it has not been chased down yet.

Correctness moved the right way too: 96.4% to **96.5%** of the corpus, with all
326 forms still passing the no-regression gate. Widening the check exposed one
real bug behind it -- a fault raised from inside a memory access reported the
restart address from the core's own instruction object rather than the one in
flight, so it pushed a CS of zero. `decode` now records the instruction it is
given, which is what the corpus had been quietly failing on.

What is still missing:

- `cpl` is hard-wired to zero on the 386 core, so no DPL or RPL check can ever
  fire, and neither can a stack switch on a privilege change.
- A not-present segment faults when it is used rather than when its selector is
  loaded, which is where the part raises `#NP`.
- Offsets are masked to sixteen bits in `translateAddress`, so a 32-bit
  addressing mode cannot reach past 64 KiB into a larger segment. Nothing the
  Win16 layer does needs it yet.
- Faults latch rather than dispatch, because protected-mode dispatch reads a
  gate out of the IDT and none of that is written.
- The descriptor cache is loaded when a selector is loaded and is never
  invalidated otherwise, which matches the hardware. What it means is that the
  Win16 allocator must reload selectors after moving a segment, and that has
  not been checked. The cache is keyed by selector value rather than by segment
  register, so two registers holding the same selector share one entry.

The emulator unit suite passes in full. It spent a long time not doing so --
3,787 of its 3,823 tests failed -- because it had been written against an
earlier shape of the emulator: a segmented `Memory`, registers on the `CPU`
wrapper, and register index constants the wrapper never exposed. All of that
had since moved into the execution core. The suite now addresses memory
through the core, so tests and instructions translate addresses identically in
whatever mode the core is in.

- **`CpuState` omits FLAGS.** `Scheduler#call` snapshots state before entering
  a callback and restores it afterwards, so a callback's flag results leak back
  into the interrupted code. Survivable because flags are caller-saved by
  convention. Covered by a `.failing` conformance test.
- **`SIDT` reads a field that is never assigned.** `core/i286.ts` writes
  `this.idt` for `SIDT`, but nothing sets it, and the protected-mode table
  lives in `idtBase`/`idtLimit`. `SIDT` should also store six bytes (limit word
  plus base), not a single 16-bit operand.
- **The real-mode interrupt path in `raiseInterrupt` is unreachable.** Everything
  after the latch is dead code. If real-mode vectoring is ever needed, it needs
  writing rather than enabling.

## CPU accuracy

Accuracy is measured, not estimated. `pnpm test:conformance` runs our core
against instruction tests captured from a real 80286 and reports a per-opcode
pass rate; see the Testing section of the README for how to fetch the vectors.

Across all **326** instruction forms the suite publishes, **96.4%** of vectors
pass and 284 forms pass completely.

The target is a 386 with a 286 mode, so where the two parts differ the 386
behaviour is the correct one and the 80286 corpus is only an oracle where they
agree. That distinction has not yet been audited; see the known gaps.

Of what remains, the great majority is instructions never decoded at all:

| Family                     | Forms | Vectors |
| -------------------------- | ----- | ------- |
| Port I/O (`IN`, `OUT`)     | 4     | 1000    |
| String I/O (`INS`, `OUTS`) | 4     | 967     |
| `HLT`, `SALC`              | 2     | 500     |
| `BOUND`                    | 1     | 250     |

The rest is around 140 vectors spread thinly over the string, stack and
segment-register moves, all of it the segment-limit rule below reaching paths
that do not go through the operand helpers.

### Faults

A memory operand whose bytes run past the end of its segment raises `#GP`.
Real-mode segments are 64 KiB, and the parts from the 286 onwards fault where
the 8086 wrapped the offset silently.

Two details of that are easy to get wrong and are worth stating, because both
read the same in prose and differ by thousands of vectors:

- It is `#GP` even for an operand addressed through SS. `#SS` belongs to the
  stack operations proper, not to data that merely defaults to the stack
  segment, which is what `[bp+si]` is.
- The check is per access, not per operand. A far pointer read at offset
  0xFFFE does **not** fault: the offset word is read at 0xFFFE and the segment
  word comes from offset 0, wrapping inside the segment. Only an individual
  16-bit access that straddles the end faults, so 0xFFFD faults on its second
  word and 0xFFFE does not.

### Flag behaviour the manuals call undefined

Compatibility means matching the part, including where Intel documents nothing.
These rules were measured against the hardware vectors -- each holds for 100% of
the tests for the instructions listed -- and are why the flag failure count went
from 11,841 to 323:

| Instruction                  | Flag           | Behaviour                                                                    |
| ---------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `AND`, `OR`, `XOR`, `TEST`   | AF             | Always cleared                                                               |
| `SHL`/`SAL`                  | AF             | Bit 4 of the result                                                          |
| `SHR`, `SAR`                 | AF             | Always set                                                                   |
| `SHR`                        | OF             | Only meaningful for a count of 1; cleared beyond                             |
| `MUL`, `IMUL`, `DIV`, `IDIV` | SF, ZF, PF     | Describe the _high_ half of the result: AH for byte forms, DX for word forms |
| `MUL`, `IMUL`, `DIV`, `IDIV` | AF             | Always set                                                                   |
| `ROL`, `ROR`, `RCL`, `RCR`   | SF, ZF, PF, AF | Untouched                                                                    |

### Bugs the vectors caught that a reading would not

Several of these were invisible to inspection and to the unit suite, and only
appeared as a handful of failures out of thousands:

- `instruction.segment || this.ds` treated a segment override of **zero** as no
  override at all, silently falling back to the default segment. Segment 0 is
  perfectly legal, so any string operation or memory access under an override
  in a zero segment read from the wrong place. Twenty-five sites, now `??`.
- `CALL SP` pushed the return address before reading its target, so it jumped
  to the stack pointer as the push had left it, two bytes low.
- `JMP FAR m16:16` rejected the instruction outright unless a segment override
  was present, rather than defaulting to DS.
- `SUB` and `SBB` computed OF, like AF before it, from the negated operand.
- `DAS` dropped the borrow out of its first adjustment, which belongs in CF.
- `83 /r` sign-extended its immediate into a negative JavaScript number rather
  than the 16-bit operand it represents, so CF was computed against the wrong
  range for every negative immediate. `ADD`/`SUB`/`CMP` on a word with a byte
  immediate is about as common as instructions get, and 42% of its vectors
  failed.
- `ENTER` decremented `this.instruction.level`, which is an undeclared field
  rather than the decoded instruction, so every nested-level `ENTER` threw.
  Behind that, it never allocated the frame: `ENTER imm16, imm8` ends with
  `SP = SP - imm16`, and the immediate was decoded and then unused.
- `IMUL` with an immediate recomputed CF and OF after the ALU had already set
  them, comparing a 32-bit product against a 16-bit sign extension of itself.
  The right answer was there and was being discarded.
- `0x82` was not decoded at all. It is an undocumented alias of `0x80`, the
  byte-operand ALU group with a byte immediate, and assemblers of the era
  emitted it. Two case labels, 2,000 vectors.
- `POPF` and `IRET` let the popped word set IOPL and NT. On the 286 in real
  mode the top four bits of FLAGS are always clear after a pop -- a divergence
  from the 8086, where they read as one -- and the existing ring-0 guard never
  fired because real mode reports CPL 0. Both now share a `loadFlags` path.
  The protected-mode half of that path is unverified: the published corpus is
  real mode only.
- FLAGS bit 1 is reserved and reads as one; the packed word omitted it, so
  `PUSHF` stored and `LAHF` loaded a value two low. Flag comparisons were
  unaffected, which is why it survived so long -- the oracle masks that bit out
  deliberately, since the core does not model it. Only instructions that
  _store_ the word rather than test it could see the difference.

The `DIV`/`IDIV` and `AAD` flag rules, and the `CALL SP` ordering, came from
the `machinery` reference implementation, which passes the same suite.
