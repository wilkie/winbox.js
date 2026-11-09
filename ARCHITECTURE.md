# Architecture

WinBox is a **high-level emulator**. It does not emulate a PC. It emulates
enough of a 386 to run a Win16 program's own machine code, and it takes
control the moment that program calls into the Windows API, where WinBox's
own implementation, in Rust, runs instead.

That split is the whole design:

```
   Guest program (real Win16 machine code)
        |
        |  far call into KERNEL/USER/GDI
        v
   Stub segment of the module  ......................  emulated x86 (winbox-cpu)
        |
        |  INT 80h -> the core stops, Exit::Unimplemented(CDh)
        v
   The run loop (winbox-win16 run.rs)  ..............  native or wasm
        |
        |  arguments read off the guest stack (call.rs, Args)
        v
   The export's function: at once (Sync), or a future (Async)
        |
        |  may call back into guest code (Engine::call_with)
        v
   Callback thunk -> CALLF -> guest WndProc -> INT 81h
```

The engine is a set of crates:

| Crate            | What it holds                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `winbox-cpu`     | The x86 core: real and protected mode, 16- and 32-bit operands, the x87; held to hardware vectors                                   |
| `winbox-machine` | Memory, the descriptor tables and the selectors given out of them, the global and local heaps' blocks, the clock, the drives' files |
| `winbox-ne`      | New Executable files read: headers, segments and relocations, entry points, names and resources                                     |
| `winbox-raster`  | Windows' pixels: palettes, device bitmaps, blits and raster operations, lines and curves, bitmap fonts, the TrueType scaler         |
| `winbox-opl`     | The Ad Lib's OPL2, DOSBox 0.74-3's `dbopl` ported                                                                                   |
| `winbox-win16`   | Windows itself: the loader and linker, the tasks, DOS and DPMI, and the modules -- KERNEL, USER, GDI, MMSYSTEM and the rest         |
| `winbox-web`     | The engine built for WebAssembly, run a step at a time by the page                                                                  |
| `winbox-native`  | The engine in a window of the host's (winit and softbuffer), with sound through cpal                                                |

## Taking control

Each module WinBox keeps (KERNEL, USER, GDI, …) is given a real segment of
16-bit code, its stubs (`System::stubs`, `crates/winbox-win16/src/system.rs`).
Every exported ordinal gets an eight-byte slot:

```asm
INT 80h           ; CS names the module, IP the ordinal (IP / 8 - 1)
RETF imm16        ; pop the callee-cleaned arguments
```

The export table is `crates/winbox-win16/src/kept.rs`: by ordinal, each
export's name, the bytes of arguments it pops, the bytes it answers in, and
whether only a stub answers it. The linker (`linker.rs`) points a program's
imports of those modules at the stubs, so a guest far-calls them believing
they are the real libraries: it pushes arguments, does a far call, and gets a
result in AX and DX. A module WinBox keeps beside its own file (COMMDLG, VER,
LZEXPAND, DDEML, OLECLI, OLESVR) links each export WinBox answers to its stub
and the rest to the file (`own_modules.rs`).

Offset 0 of USER's stub segment is the callback thunk, used in the other
direction -- when Windows calls guest code (a window procedure, a dialog
procedure, an enumeration callback) and takes control back when it returns:

```asm
CALLF seg:off     ; the immediate written before each use (Engine::call_with)
INT 81h           ; the callback returned
```

USER's own window procedures, whose addresses a program can be handed, are
`MOV AX, n; INT 84h; RETF 10`: the token in AX names the procedure
(`call.rs`, `user_procedure_call`).

## The trap protocol

The core (`winbox_cpu::Cpu::run`) runs up to a budget of instructions and says
why it stopped (`Exit`): the budget spent, `HLT`, a fault, memory or a segment
load only the host can answer for (`Exit::Host`), or an opcode it leaves to
the host (`Exit::Unimplemented`). An instruction that stops the run is not
counted and changes nothing -- registers, flags and segments as they were, IP
at its start -- so the host can run it whole; a repeated string instruction
keeps the elements it got through.

In protected mode, which is where Windows runs a program, every `INT` stops
the run as `Exit::Unimplemented(CDh)`, and the run loop
(`System::run_until_event`, `crates/winbox-win16/src/run.rs`) answers it by
vector:

- `80h`, a call: `System::api_call` (`call.rs`) finds the module by CS and
  the export by IP, charges the clock, logs the call, and runs its function;
- `81h`, a callback returned, ending the call into the guest that made it;
- `84h`, a USER procedure called through its address;
- `21h`, `2Fh`, `31h`, `1Ah`, `25h`/`26h`, `12h`: DOS, the multiplex
  interrupt, DPMI, the clock, absolute disk reads and writes and the memory
  size, answered by the engine; a vector a program hooked through DPMI goes
  to its own handler first (`dpmi.rs`);
- any other stops the run, named (`Stop::Interrupt`).

A program's `IN` and `OUT` stop the run too, and are run by the engine
(`ports.rs`). A fault goes to KERNEL's handling of it (`fault.rs`, from
`KRNL386.EXE` seg1 `5e1b`) or to a handler the program set through DPMI. In
real mode, given an interrupt table, the core dispatches interrupts itself,
as the part does: FLAGS, CS and IP pushed, IF and TF cleared, CS:IP from the
four-byte entry (`winbox-cpu/src/interrupt.rs`).

A few calls a program polls with -- `GetTickCount`, the rectangle functions,
a `PeekMessage` that finds nothing -- are answered inside the core, which
reads their arguments, charges the clock and logs them as the engine would
(`winbox-cpu/src/quick.rs`), so a polling loop does not leave the core on
every call.

## Argument marshalling

There is no ABI layer. A function is given `Args` (`call.rs`), a cursor over
the guest stack above the far return address, and reads its arguments in the
order it declares them, as Pascal-convention code pushed them: first
deepest, each `word`, `signed` or `dword` (a far pointer is a doubleword, the
selector pushed first). The bytes popped come from `kept.rs`, so a function
reads exactly the arguments its stub's `RETF` will remove. Pointers are read
and written through the machine's memory by selector and offset
(`pointers.rs`); structures are laid out field by field from their bytes.

A function answers `Answer::Nothing`, `Word` or `Dword`, put in AX, or DX:AX.
It is either `Sync`, run at once with the system borrowed, or `Async`, a
future on the `Engine`.

## The engine and its tasks

`Engine` (`crates/winbox-win16/src/engine.rs`) holds the `System` -- the
processor, memory, the modules' state -- and runs the program as a future, on
one thread, in the browser as natively. A call that must call back into the
guest, or wait for a message while time passes, is an `Async` function: it
awaits `Engine::call_with`, which saves the processor, lays the arguments
below the stack, writes the thunk's `CALLF` and runs the guest until its
`INT 81h`, then puts the processor back. Host and guest frames interleave to
any depth.

Tasks take turns as Windows gives them the processor (`scheduler.rs`): one
runs at a time and gives it up only where it waits -- for a message, in
`Yield`, or for another task to answer what it sent. Procedures due at
interrupt time, MMSYSTEM's timer events, come between two slices of the
task's instructions (`interrupts.rs`).

Time is the machine's clock (`winbox-machine/src/clock.rs`). Virtual, it is
the instructions run at a fixed rate, with instructions charged for each call
the program's processor did not run, so a run does the same whatever the
host's speed: the replay and the corpus run on it. Real, it is the host's
milliseconds. The engine's `Pace` says how it waits: `Blocking` sleeps, as
the native front end may; `Yielding` hands the thread back to its caller
until the host's time comes, as a browser's page must.

## Memory and the core boundary

The core reaches memory through a `Bus` (`winbox-cpu/src/lib.rs`): byte and
word reads and writes by linear address, any of which may answer that only
the host can say (`Exit::Host`). `winbox_machine::Memory` is the machine's:
four GiB of linear addresses, made a mebibyte at a time as each is first
written. Segments are mapped one to one: a descriptor index names the 64 KiB
from the index times 64 KiB, and a task's segments are in the local
descriptor table, as Windows puts them, their selectors ending in 7
(`winbox-machine/src/descriptors.rs`). GDI's data segment is made byte by
byte as a program reads it (`Exit::Host`, `gdi/heap.rs`).

The core decodes every instruction each time it runs it and computes flags
eagerly; it caches nothing decoded, so code written while it runs -- the
callback thunk's `CALLF`, patched before each use -- is read afresh. It
reports the selectors loaded since the host last asked (`Exit::Loads`), for a
host that keeps copies of their descriptors.

## CPU accuracy

Accuracy is measured, not estimated. `pnpm test:conformance`
(`crates/winbox-cpu/tests/conformance.rs`) runs the core against instruction
tests captured from real parts, the
[SingleStepTests](https://github.com/SingleStepTests) 80286 and 80386 suites,
and holds each file's count of vectors passed to a baseline
(`baseline286.json`, `baseline386.json`); see the README for fetching the
vectors.

On the 80286's 326 files, 250 vectors of each, 77,239 of the
79,507 compared pass (97.1%), and 298 files pass whole. Most of the rest is
instructions the core leaves to its host: the port instructions (`IN`, `OUT`,
`INS`, `OUTS`), which a Windows program's engine runs, and `HLT`, which stops
the run. On the 80386's 941 files, 100 of each, 91,537 of 91,600 pass
(99.9%), and 913 pass whole; the rest are a few vectors each of the multiply
and divide group (`F6`, `F7`), `AAM` and `FF /0`, `/1`.

Where the two parts differ, the vectors decide which is which; the core takes
the 80286's answer in real mode where its suite pins it -- `POPF` and `IRET`
clear FLAGS bits 12 to 15 in real mode, and load every flag in protected mode
(`load_flags`, `interrupt.rs`). The flags the manuals call undefined are the
parts' as the vectors record them (after `MUL`, `IMUL`, `DIV` and `IDIV`, SF,
ZF and PF follow the high half and AF is set, for instance), and so are the
faults: an access whose bytes run past the end of its segment raises `#GP`,
checked per access rather than per operand.

Known gaps, each kept as an ignored test with its evidence
(`kb/guides/retire-typescript.md`, "Not yet done"): an expand-down segment
read above or below its limit, and an instruction fetched past CS's limit,
stop the core where the 80386 reads or raises `#GP`; WIN87EM's emulator is
not there, so a program with the coprocessor switched off stops at its first
floating-point interrupt.

## Presentation

The whole screen is one raster, as it is on Windows: USER draws every window's
frame, caption, menus and controls itself, pixel for pixel, on USER's raster
desktop (`crates/winbox-win16/src/desktop.rs`, `desktop_paint.rs`), from the
installation's own display driver and fonts, and each can be held to what
Windows drew. A screen reader is not given the pixels: beside the canvas is a
mirror of USER's window tree (`accessible_tree.rs`, mirrored by the page's
`src/run/aria-mirror.ts`), each window named by its caption and each control
by its role, following what has the keyboard.

A GDI surface's pixels are not the canvas. Every device context -- a
program's window, a memory device context, the screen -- draws into a
`DeviceBitmap` of palette indices, one byte a pixel
(`crates/winbox-raster/src/device_bitmap.rs`; where each context's drawing
lands, `surface.rs`), and the screen is turned into colours for its host,
with the cursor drawn over a copy, by `present.rs`. See the oracle's README,
"Comparing what gets drawn".

## The engine in a page

`crates/winbox-web` is the engine built for WebAssembly (`pnpm build:web`,
wasm-bindgen's glue in `target/winbox-web`). Its `Machine` (`lib.rs`; the work
is in `session.rs`, Rust alone, so it is tested natively) takes the page's
drives, filled in memory before the program starts, starts a program, a
group's item or an installer, and runs a step at a time between the page's
frames, on the host's own clock, never blocking (`step`, `Pace::Yielding`). It
hands over the screen as the RGBA bytes a canvas takes, the sound card's
events, the calls made, the window tree, and the changes to each drive, and
takes the mouse and keyboard. The page loads it at run time
(`src/run/engines/rust.ts`); `pnpm build` copies it into `dist/web` beside
the page.

## The native front end

`crates/winbox-native` runs the engine in a window of the host's: winit for
the window and input, softbuffer for the pixels, cpal for WinBox's sound card.
Desktop mode shows the whole screen in one window; `--seamless` shows each
top-level window as a host window of its own (`seamless_host.rs`,
`kb/guides/seamless-windows.md`). Its drives are host folders laid over an
installation or the asset bundle's base, programs kept as layers
(`programs.rs`), and images mounted (`mounts.rs`). The README lists its
switches.

## The run page

`run.html`, served by `pnpm dev` and built by `pnpm build` into `dist/web`,
runs programs in the browser on the engine in a page (above). Everything
around the Windows screen is React and MUI; the screen itself is the
engine's. `src/run/engines/rust.ts` is the page's side of the engine
(`Engine`, `engine.ts`).

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
- The actions, by concern: `machine.ts` (a machine made
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
Kept programs and the Programs list, which stay. The engine takes an item's
command line, current directory and show command (`Engine.run`'s `item`,
`Session::start_item`). JSX is compiled by the bundler's own transform
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
the plan's folders, files and stamps, then the
engine's changes against it (`Engine.changes`), each marked "Kept" where it is
the change put back as C: was made (`session.given`), "Changed" where written
since; the folders on the way to a file the volume's own stamp, as the
engine's drives make them. A drive of images is read from its disk's image as
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
mirror (`aria-mirror.ts`) are the engine's alone. Above it, the machines'
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
(the engine sizes its canvas afresh), set the canvas's CSS size within it,
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
  the engine gives it no virtual key, so Windows sees nothing of it; the
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
of the desktop. Two installs on two machines, each a tab, are run
(`keepPmitem`, `keepStrings`), with axe on the two tabs. The
launcher's own test runs `pmitem`'s child from a kept
group (`keepPmitem`), by the keyboard and the mouse, each
line it writes held to the probe's records. The components are linted with
`eslint-plugin-jsx-a11y` and `eslint-plugin-react-hooks`, each as it
recommends.
