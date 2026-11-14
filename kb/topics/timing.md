---
kind: topic
name: Timing
summary: How fast Windows 3.1 runs a program's own instructions under DOSBox, how long its commonest calls take there and how many instructions each is, how GetTickCount steps, what a WinG blit costs by its size and its colours, and what that does to a game that paces itself by its work.
probes:
  [
    cpurate,
    callcost,
    wingcost,
    wingxlat,
    twrcost,
    twrcall,
    tickstep,
    adlibgap,
    jrnlplay,
    spiidle,
    viscost,
    cdread,
    hdtime,
    pgbig,
    wingsel,
    towrtick,
  ]
---

A program for Windows 3.1 sees time pass by `GetTickCount` and by its timers, and how much passes depends on what it did meanwhile: its own instructions, and the calls it made. A call to Windows is not a moment. Inside it Windows runs instructions of its own, hundreds for the quickest and hundreds of thousands for a large blit, and the time they take is time the program sees go by.

winbox.js keeps a virtual clock for its recordings: time passes by the instructions a program runs, at a fixed rate, so a run is the same every time. The recordings here are what that clock needs to keep time as Windows does: how fast Windows runs a program's own instructions, and how long each call takes, told as instructions at that rate.

Each function's page carries its own: how long each way it was recorded took, and the same as instructions. They are timings, not answers, kept in `oracle/fixtures/timings/`, not replayed. Each figure is the middle of three runs of at least two seconds each, by `GetTickCount`. Most were recorded with DOSBox as fast as the host allows (`cycles=max`), where they vary with the host and from run to run; some again at a fixed rate (`cycles=fixed 80000`), where they do not: see "At a fixed rate" below.

## How fast a program's own instructions run

[[measured]] [[probe:cpurate]] runs the workloads of winbox.js's own benchmark, the same instructions, each the body of a `LOOP` of 65,535, until two seconds pass. Under the recorder's DOSBox Windows runs between 260,000 and 430,000 of them a millisecond: register arithmetic fastest, loads and stores through memory slowest. Two recordings agree within 3%. The first run of each three is slower than the other two, by up to 27%.

[[measured]] The Rust engine's core runs the same workloads in `crates/winbox-cpu/examples/bench.rs` (`cargo run --release -p winbox-cpu --example bench`; `BENCH_MS` sets each run's length, 2,000 ms by default), each a straight run closed by a jump back to its top, in real mode and in protected mode with Win16-sized descriptors. On the development machine (a Ryzen 9 3950X), three runs on 2026-11-09: register arithmetic 33,400 to 35,200 instructions a millisecond, loads and stores 31,500 to 33,700, pushes and pops 59,700 to 63,300, arithmetic against memory 33,500 to 37,100; protected mode within a few percent of real mode. DOSBox's medians from `cpurate` beside them: 424,000, 329,000, 352,000 and 258,000, some 6 to 12 times as fast.

[[measured]] EIP whole ([[topic:win386]], "More than 64 KiB of code"), against the core before it, 2026-11-09 on the development machine with other work running (load average 9 to 11): `perf stat` of `examples/bench`, the host's instructions for each instruction the core runs, 248 before and 284 after the change as first made -- `fetch8` was no longer inlined into `step` and `modrm` -- and 247 to 249 before and 244 to 247 after it is inlined again (`#[inline(always)]`) and IP's wrap past FFFFh is noted off the common path. The two benches run side by side four times, each workload's median: within -5.5% and +7.4% of the core before, both ways, the noise of a busy machine; before the inlining, 4 to 18% slower.

[[measured]] A check of every access against a set of present pages, for paging in enhanced mode ([[guide:paging]], design (a)), prototyped and not committed: the same workloads in protected mode over WinBox's `Memory`, 2026-11-10 on the development machine with other work running (load average about 14), the median of five runs. A bitmap of present pages asked on every access, the instruction fetches included, cost 13% on register arithmetic, 11% on loads and stores, 33% on pushes and pops and 17% on the mix; a flat table of page translations, 11%, 18%, 29% and 20%. Both against `Memory` alone, which ran 39,000, 31,200, 60,000 and 36,300 instructions a millisecond.

[[measured]] Paging's first touch ([[guide:paging]], "Phase 3: first touch"): each segment's reach, kept beside its limit and compared in its place, 32 bits where the limit was 64. The bench against the commit before, the two side by side five times, 2026-11-11: each of the eight workloads 5% to 30% faster; `perf stat`, 248 and 249 host instructions an emulated instruction before, 247 and 246 after. The corpus's 38 programs took 102 to 105 seconds before and 98 to 103 after.

[[probe:callcost]] and [[probe:wingcost]] time the same register arithmetic in the run they measure, so their calls can be told as instructions at that run's own rate: about 405,000 a millisecond in `callcost`'s runs and 400,000 in `wingcost`'s, or 405 and 400 instructions a microsecond.

## How `GetTickCount` steps

[[measured]] [[probe:tickstep]] polls `GetTickCount` as fast as a program can for a second. Its answers step 55 milliseconds at a time, and 54 every thirteenth or fourteenth: whole ticks of the timer, the 8253's 1,193,180 Hz divided by 65,536, 54.9254 ms each, rounded down. A program sees nineteen different answers a second. `timeGetTime` steps a millisecond at a time ([[probe:mmtime]]).

## A journal playback's wait

[[read out]] A journal playback hook answers `HC_GETNEXT` with how many milliseconds to wait before its event is taken ([[topic:system-queue]]). USER keeps the wait beside its timers and counts it down on the same ticks of its own system timer, by the milliseconds `GetSystemMsecCount` says have passed since the last (`USER.EXE` seg1 `72c6`-`7365`). Within 5 ms of nought the wait is over, and the program that would take the event is woken; its look asks the hook again. The timer is set for whichever is due first, a timer or the wait, so the wait is kept to about the system timer's tick.

[[measured]] [[probe:jrnlplay]] asks for a wait of 200 ms before one key. From the hook's first `HC_GETNEXT` for it to the key's press being taken, `GetTickCount` counted at least 150 ms, and the hook was asked for it more than once. WinBox waits it on their own clocks: the host's, or, on a virtual clock, the instructions run.

## The screen saver's look

[[read out]] USER looks whether the screen saver is due every ten seconds, on a system timer of the task list's window, its own, that the first `InitApp` sets (`USER.EXE` seg5 `0470`-`047f`); the timer's message is in the first program's queue, and the look is made as that program dispatches it ([[topic:system-parameters]]). The delay is counted from the last input's time, so the screen saver starts between the delay and the delay and ten seconds after the last input.

[[measured]] [[probe:spiidle]], with a delay of 1 second, had `SC_SCREENSAVE` within ten seconds of the delay being set, and none in the next twelve without input. The Rust engine looks on its own clock, the instructions run. A run that waits with nothing due before its end or its step's -- the look ten seconds on -- goes on a frame at a time rather than skipping to it, so a step ends on time; and a step's key due within a frame of a timer goes in before the timer is looked at, as a look takes input before timers.

## How long a call takes

[[measured]] [[probe:callcost]] makes each call a hundred at a time until two seconds pass, on the VGA and on Microsoft's Super VGA 256-colour driver. A batch's own loop is in each figure, a few instructions a call.

| Call                                            | VGA, 16 colours | as instructions | Super VGA, 256 colours | as instructions |
| ----------------------------------------------- | --------------- | --------------- | ---------------------- | --------------- |
| `GetTickCount`                                  | 0.11 µs         | 47              | 0.11 µs                | 44              |
| `PeekMessage`, nothing there, `PM_NOYIELD`      | 0.84 µs         | 345             | 0.88 µs                | 356             |
| `PeekMessage`, nothing there                    | 1.51 µs         | 620             | 1.57 µs                | 634             |
| `SendMessage` to `DefWindowProc`                | 1.26 µs         | 515             | 1.31 µs                | 530             |
| `PostMessage`, then `GetMessage` taking it      | 3.07 µs         | 1,260           | 3.13 µs                | 1,270           |
| `GetDC` and `ReleaseDC`                         | 5.6 µs          | 2,300           | 5.9 µs                 | 2,370           |
| `SetPixel` in a window                          | 8.0 µs          | 3,300           | 4.2 µs                 | 1,700           |
| `TextOut` of eight characters                   | 38 µs           | 15,500          | 25 µs                  | 10,300          |
| `BitBlt` of 16 by 16 within a window, `SRCCOPY` | 267 µs          | 110,000         | 21.7 µs                | 8,800           |

What a call does with messages takes the same time whatever the display. What it draws does not. On the VGA a pixel is spread over four planes, and the display driver reaches each through the VGA's own registers, which DOSBox makes in software. The 256-colour driver writes a byte a pixel, straight. A small blit is twelve times as fast there.

## WinG

[[measured]] [[probe:wingcost]] times WinG on the 256-colour display, set up as WinG asks a program to be: a bitmap of 640 by 480, bottom-up, its colour table WinG's halftone palette's, and that palette realized in a window over the whole screen, so the bitmap's colours are the system palette's one for one ([[topic:wing]]).

| Call                                         | Time    | as instructions |
| -------------------------------------------- | ------- | --------------- |
| `WinGBitBlt` of 16 by 16                     | 29.8 µs | 11,900          |
| `WinGBitBlt` of 64 by 64                     | 45.2 µs | 18,100          |
| `WinGBitBlt` of 160 by 120                   | 75.8 µs | 30,300          |
| `WinGBitBlt` of 320 by 240                   | 177 µs  | 70,900          |
| `WinGBitBlt` of 640 by 480                   | 542 µs  | 216,700         |
| `WinGStretchBlt` of 160 by 120 to 320 by 240 | 333 µs  | 133,300         |
| `WinGSetDIBColorTable` of 256 entries        | 29.2 µs | 11,700          |
| `WinGSetDIBColorTable` of 16 entries         | 2.7 µs  | 1,070           |
| `SelectObject` into the WinG device context  | 1.1 µs  | 450             |
| `MoveTo` and `LineTo` of 10 pixels there     | 3.5 µs  | 1,390           |
| `Rectangle` of 10 by 10 there                | 17.2 µs | 6,890           |
| `GetNearestColor` there                      | 25.2 µs | 10,100          |
| `SaveDC` and `RestoreDC` there               | 8.2 µs  | 3,260           |

[[inferred]] **A blit's time, by its size.** A `WinGBitBlt` takes about 26.3 µs, and 0.19 µs a row, and 1.38 ns a pixel: about 10,500 instructions, 77 a row and 0.55 a pixel. The three terms come from the blits of 16 by 16, 160 by 120 and 640 by 480. They tell the other two within 2%: 44.2 µs for 64 by 64, which took 45.2, and 178 µs for 320 by 240, which took 177. A rate a pixel alone does not: from the smallest and the largest, it tells 64 by 64 as 36 µs. What would settle it is blits of one width and many heights, and of one height and many widths.

`GetNearestColor` is slow: a search of the system palette, it takes as long as a small blit. SimTower asks it ten thousand times in its first hundred thousand calls.

### WinG's slow path

[[measured]] [[probe:wingxlat]] makes the same blits with the bitmap's colour table the halftone palette's backwards, so that no colour is in its slot of the system palette: WinG then translates every pixel. At a fixed 80,000 instructions a millisecond:

| `WinGBitBlt` of | colours one for one ([[probe:wingcost]]) | not ([[probe:wingxlat]]) |
| --------------- | ---------------------------------------- | ------------------------ |
| 16 by 16        | 3,315 instructions                       | 13,184                   |
| 64 by 64        | 4,893                                    | 31,184                   |
| 160 by 120      | 6,633                                    | 100,098                  |
| 320 by 240      | 10,588                                   | 360,353                  |
| 640 by 480      | 18,660                                   | 1,387,898                |

[[inferred]] One for one, a blit is about 2,823 instructions and 31.7 a row, nothing to speak of a pixel: each row is a string copy, which DOSBox counts as one instruction however long ([[read out]] below, "How DOSBox counts"). Not, it is about 11,002, 39.0 a row and 4.43 a pixel. A blit of the whole screen is 75 times as long, 17 ms at 80,000 a millisecond.

### Colours matched in a WinG device context

[[read out]] WinG's device, `WINGDE.DLL`, matches a colour to a bitmap's colour table by a search (seg2 `029d`-`0352`): each entry in turn from the first, its distance from the colour worked out, 32 instructions an entry (36 where it is the nearest so far, seg2 `02c0`-`031a`), until an entry is the colour itself, where it stops; else every entry. `GetNearestColor` is one such search (`DIB_COLORINFO`, seg2 `000c`). So is each colour GDI sets again when a bitmap is selected into a context: GDI's `SelectObject` of a bitmap sets the context's background and text colours again (`GDI.EXE` seg1 `1d5e`-`1d80`, by `1476` and `14dc`, each a colour the device's `ColorInfo` matches).

[[measured]] [[probe:wingsel]], at a fixed 80,000 a millisecond, as instructions, each the middle of three runs:

| Call in the WinG device context                                       | Halftone table | The table backwards |
| --------------------------------------------------------------------- | -------------- | ------------------- |
| `GetNearestColor` of black                                            | 167            | 8,693               |
| `GetNearestColor` of white                                            | 8,647          | 167                 |
| `GetNearestColor` of RGB(1,2,3), in no entry                          | 8,601          | 8,693               |
| A bitmap selected and another, a white background and black text      | 18,902         | 18,902              |
| A bitmap selected and another, two colours in no entry                | 35,339         | 36,124              |
| The context's first bitmap selected and a bitmap, colours in no entry | 18,482         | 18,685              |
| A pen selected and the one before back                                | 435            | --                  |

Black is the halftone table's first entry and white its last. [[inferred]] A search is about 33.25 instructions an entry looked at; `GetNearestColor` 134 more, and selecting a WinG bitmap 899 more than its two searches, each figure within 1.5%; selecting the context's first bitmap, WinG's of 1 by 1, some 721, no search being long. The faithful clock charges so (`call_costs.rs`, `wing::wing_match`): each search by where the colour is in the table of the bitmap selected, which it reads -- the background colour and the text colour for a WinG bitmap selected, the colour asked for `GetNearestColor` -- less the 11 instructions of the probe's own loop in `GetNearestColor`'s. Where the bitmap's table, not the one before, is the one searched is [[inferred]]: the probe's two bitmaps had the one table. Before, `GetNearestColor` there was `wingcost`'s 8,595 whatever the colour, and selecting a bitmap the 217 of a pen.

### How DOSBox counts

[[read out]] The recorder's DOSBox (0.74-3, `core=auto`, built with the recompiling core `C_DYNREC`, `config.h`) runs Windows' protected mode on that core (`src/cpu/cpu.cpp` `1578`-`1582`). It counts a cycle for each instruction it translates (`core_dynrec/decoder.h`, `decode.cycles++`), and takes none more for `REP MOVS`, `STOS` or `LODS` however long, but where the run's slice ends first (`core_dynrec/operators.h`, `dynrec_movsb_word` and the rest: the count cut to the cycles left). `REP SCAS` and `CMPS` it does not translate: the plain core runs them (`core_dynrec.cpp`, `BR_Opcode`), a cycle an element (`core_normal/string.h`, `R_SCASB`). WinBox's processor counts each repeated string instruction as one, the compares too. SimTower's own code has 14 repeated compares and scans, all in its C library (seg1); how often its steps make them is not measured.

## At a fixed rate

[[measured]] Run with `cycles=fixed 80000`, DOSBox runs 80,000 instructions a millisecond: the same register arithmetic the probes time measures 79,947. A call's time there is the instructions Windows runs for it, whatever the host. [[probe:callcost]] (on both displays), [[probe:wingcost]], [[probe:twrcost]] and [[probe:twrcall]] are recorded so as well. As fast as the host allows, DOSBox runs most of their calls at 150,000 to 200,000 instructions a millisecond, not the 400,000 their own arithmetic runs at; and a blit of the whole screen slower again, 542 µs against 233 µs at the fixed rate, its time spent on the host's side. So a time recorded as fast as the host allows says only roughly how many instructions a call is.

A few of the calls at the fixed rate, as instructions: `GetTickCount` 11, `GetActiveWindow` 8, `SetRect` 28, `PeekMessage` finding nothing 206 (121 with `PM_NOYIELD`), `SendMessage` 206, `SetCursor` alone 40 (816 with `LoadCursor`), `SetWindowPos` moving nothing 1,076, `GetNearestColor` 8,595, `FrameRect` of 10 by 10 7,775, `AnimatePalette` 260 and 193 an entry. The rest are on each function's page.

## What a window's visible region costs

[[measured]] [[probe:viscost]] times `BitBlt` of 16 by 16 within a window, `SRCCOPY`, and `PatBlt` of 16 by 16, `PATCOPY`, at a fixed 80,000 instructions a millisecond, through a context got once, with other windows over the window or not. GDI draws through each rectangle of the window's visible region in turn ([[topic:visible-regions]]). As instructions:

| What lies over the window                    | `BitBlt` | `PatBlt` |
| -------------------------------------------- | -------- | -------- |
| Nothing                                      | 21,705   | 2,142    |
| A pop-up, clear of the drawing               | 21,716   | 2,154    |
| Eight pop-ups 10 by 10, clear of the drawing | 21,998   | 2,153    |
| A pop-up over the right half of the drawing  | 19,852   | 1,651    |

A region of many rectangles costs a call next to nothing: some 300 instructions for a `BitBlt` with eight windows over its window. What costs is the pixels drawn, and a drawing half covered has fewer.

winbox.js on the development machine (a Ryzen 9 3950X), drawing a pixel through a window's view of the screen: the Rust engine's raster 6 ns with nothing to test, 8 with one test of the pixel -- today's, of the window's pixels, or a region's -- 9.5 with a region of eight holes, 11.3 with today's two tests, the window's pixels and the clip region; the TypeScript engine's (retired 2026-11-08; the numbers of it on this page are history) about 570 ns, in which the tests do not show. A benchmark of the raster alone, not kept.

[[measured]] With drawing through the region alone ([[topic:visible-regions]], phase 3), on the same machine, through the whole engine: a program that fills its window's client area, 200 by 150, with `PatBlt` and `PATINVERT` a thousand times -- 30 million pixels -- run whole, less the same program filling nothing, so that only the pixels are left. Alone on the screen, and with eight pop-ups of 20 by 20 over the window:

| A pixel drawn                       | Rust, before | Rust, after | TypeScript, before | TypeScript, after |
| ----------------------------------- | ------------ | ----------- | ------------------ | ----------------- |
| The window alone                    | 6.8 ns       | 6.4 ns      | 42.5 ns            | 36.6 -- 39.2 ns   |
| Eight pop-ups over it (eight holes) | 11.2 ns      | 8.6 ns      | 74 ns              | 42.7 -- 43.9 ns   |

Before, a pixel was tested against the window's pixels and the region where the region did not take in the whole window; after, against the region alone, and not at all where it takes in every pixel there is. Each a mean of three runs (Rust) or two (TypeScript, the second warm); `PatBlt`'s own loop, not the 570 ns of a pixel drawn by way of a colour. The whole corpus, before and after: the TypeScript survey 807 s and 790 s, SimTower's at the faithful clock 68 s and 64 s, the Rust engine's corpus 106 s and 104 s; SimTower's summary is the same to the byte, its clock charging Windows' instructions whatever the engine does inside. A benchmark not kept.

[[measured]] Working a region out by USER's rule ([[topic:visible-regions]], phase 2), on the same machine, on a tree of 84 windows -- four at the top, one with 40 controls, another with 10 children of 3 each, all shown -- each window's `GetDC` region in turn: the Rust engine 2.7 µs a region, the TypeScript engine 22 µs. A region is worked out as a context is got, and again before it is next used where the windows changed since; a corpus program gets at most some 850 contexts in its run (SimTower), so some 20 ms at most on the TypeScript engine, and a little more where it keeps a context while its windows change. Nothing is charged for it on the faithful clock: Windows' own instructions for `GetDC` are what the call is charged. A benchmark not kept.

[[measured]] USER's entries ([[topic:visible-regions]], phase 4), on the same machine, through the whole engine: a program that asks for a window's context and gives it back, then the screen's, 20,000 times each, run whole, less the same program asking nothing. An entry still valid is taken as it is, where before each `GetDC` worked the region out again:

| A `GetDC` and its `ReleaseDC` | Before | After  |
| ----------------------------- | ------ | ------ |
| Rust                          | 1.5 µs | 1.3 µs |
| TypeScript                    | 32 µs  | 24 µs  |

Each the mean of three runs; the program's own instructions and the call's way in and out are in it. The whole corpus, after: the TypeScript survey 906 s (790 s before; 878 s and 1,053 s on other runs of the same day, the machine busier), SimTower's at the faithful clock 65 s (64 s), the Rust engine's corpus 107 s (104 s); SimTower's summary is the same to the byte. A benchmark not kept.

[[measured]] Scrolling, moving and locking through the region ([[topic:visible-regions]], phase 5), on the same machine, through the whole engine: a pop-up 200 by 150 with another over its corner, scrolled by `ScrollWindow` 2,000 times a pixel down and back, then moved by `SetWindowPos` 1,000 times a pixel right and back, less the same program doing neither -- 3,000 calls. Before, a scroll copied the client area's pixels by hand and a move tested each window's own update region; after, a scroll takes a common context, works the update out by regions and blits through what moves, made due through USER's walk, and a move tests the window's and its parents' update regions:

| 3,000 calls, run whole | Before | After  |
| ---------------------- | ------ | ------ |
| Rust                   | 0.63 s | 0.91 s |
| TypeScript             | 35.6 s | 37.5 s |

A call costs the Rust engine some 0.1 ms more, the TypeScript engine some 0.6 ms more, on some 12 ms. Each the mean of three runs, the load average 0.9 to 1.1 throughout. No program of the corpus scrolls, and its corpus and SimTower's summary are the same to the byte. A benchmark not kept.

## What winbox.js does

winbox.js keeps two clocks. The survey's runs 3,000 instructions a millisecond and charges every call 15 instructions: it runs much faster than a faithful one, and the same every time. Most calls are charged less than they are -- a rectangle call about half, `PeekMessage` finding nothing a fourteenth -- and drawing far less: a twelve-hundredth of a WinG blit of the whole screen with its colours one for one, a ninety-thousandth of one without. Its `GetTickCount` steps by the tick, as Windows' does.

The faithful clock runs 80,000 instructions a millisecond, the fixed rate the calls were recorded at, and charges each call the instructions recorded for it, the same at any rate: a call recorded only in a pair, half the pair, and one not recorded, 154, the middle of those recorded alone [[inferred]]. Calls that draw are charged by the display's driver: the Super VGA's on a display of 256 colours, the VGA's on any other. `WinGBitBlt` is charged by its size, and by whether its bitmap's colours are the system palette's one for one; `WinGSetDIBColorTable` and `AnimatePalette` by their entries; `GetNearestColor` and `SelectObject` of a bitmap in a WinG device context by WinG's search of the colour table (above); `timeGetTime` by the clock's rate (below). The rate is a choice, made to be one DOSBox can be held to: as fast as the host allows, DOSBox runs no one rate.

### Choosing the clock

One name for each clock, everywhere (`Clock::named`): `survey`, `faithful`, and, where a host runs a machine for a person and in the test harness, `host`, the host's own time.

- **The trace and the corpus** (`crates/winbox-win16/examples`): `trace --clock faithful`, the survey's clock by default. `corpus --clock faithful` runs each program so for its report's seconds, with no count of calls to stop at, and compares it with the survey's reports, which it will not write on any other clock; `--only ID` runs one. On a clock not the survey's a report's places -- its keys pressed and screens kept -- are come to by their time alone, the instructions and calls made by then being the survey clock's. `scripts/web/trace.mjs` takes the same `--clock`, and a survey asked of the WebAssembly engine (`machine.survey`) a `"clock"` among its options.
- **The native front end**: `winbox-native --clock faithful` (or `survey`), the host's own time by default; `winbox-native --launcher --clock faithful` passes it on to each program it starts. Natively a virtual clock is paced by the host's time (`Clock::paced`): while nothing runs it waits for the host's time to come to the machine's next timer, a frame at most, so a person waits as long as the machine says; while a program runs, the machine's time is its work, and falls behind the host's where the processor runs fewer instructions a millisecond than the clock -- on the development machine some 30,000 to 60,000 against 80,000 -- to catch up while nothing runs. A game that paces itself by its work, as SimTower does, goes at Windows' pace in the machine's time, and so slower than Windows on the host's.
- **The test harness**: `WINBOX_CLOCK=faithful` (or `survey`, `host`) runs every probe on that clock. `crates/winbox-win16/tests/timings.rs` runs each recording made at 80,000 a millisecond on the faithful clock and holds its times to the recorded ones (`cargo test --release -p winbox-win16 --test timings -- --ignored --nocapture`; slow, so not among the rest).
- **The page**: none. Its machine runs on the host's own time (`Clock::real_with`, the page's `performance.now()`), its frames given by the browser. A clock charging recorded instructions on top of the host's time would count each call twice -- the host's time already holds what the engine took over it -- and the paced faithful clock the native front end has would make every busy program run slower than Windows for the person using it, the WebAssembly engine slower again than the native one, with nothing to show for it on the page but a game's calendar. The faithful clock is for holding a run to Windows' pace -- a recording, or SimTower's calendar -- which the trace and the native front end do.

## Reading a disc

[[measured]] [[probe:cdread]], at a fixed 80,000 a millisecond, times `mmioRead` of 2, 16, 32 and 64 KiB from a file on a CD-ROM (`images/imgread.iso` as D:) and from the same bytes on the hard disk, by `timeGetTime`: one read at a time after a seek, and one read after another for a second. Bytes a millisecond, one after another:

| Size   | Disc, enhanced mode | Hard disk, enhanced mode | Disc, standard mode | Hard disk, standard mode |
| ------ | ------------------- | ------------------------ | ------------------- | ------------------------ |
| 2 KiB  | 16,652              | 71,004                   | 18,518              | 18,397                   |
| 16 KiB | 34,963              | 417,972                  | 35,586              | 35,635                   |
| 32 KiB | 45,711              | 618,397                  | 46,596              | 46,530                   |
| 64 KiB | 45,632              | 691,984                  | 46,726              | 46,595                   |

- In 386 enhanced mode a read of 64 KiB from the disc takes 1.4 ms, and one alone after a seek is timed at 0, 1 or 2 ms; the hard disk's takes 0.09 ms, timed at 0.
- In standard mode the two drives take the same, both what the disc takes in enhanced mode: DOSBox's charge for the bytes (see the next section). Why enhanced mode reads the hard disk without it is not read out.
- Told as instructions at the run's rate, a disc's read in enhanced mode takes 7,405, 33,777, 52,220 and 105,520 more than the hard disk's at the four sizes: about 5,459 and 1.517 a byte [[inferred]], each size within 3,500.

The faithful clock charges a read from a disc that much more in 386 enhanced mode, through `_lread`, `_hread` and DOS's function 3Fh alike (`call_costs::disc_read`), beyond the hard disk's read, and nothing more in standard mode. Lode Runner: The Legend Returns' setup rates the CD-ROM drive by such reads ([[topic:win386]]).

## Reading and writing the hard disk

[[measured]] [[probe:hdtime]], at a fixed 80,000 a millisecond in both modes, reads a file on C: (a folder DOSBox mounts) one read after another for half a second at ten sizes from 512 bytes to 64 KiB, through `_lread`, `_hread` and DOS's function 3Fh; writes one at five sizes through `_lwrite` and DOS's 40h; and seeks, and opens and closes. Each time as instructions at the run's rate, less the loop's own (`timeGetTime` and the loop: 428 in standard mode, 546 in enhanced mode). DOS's read and write, and `_lread`'s, `_hread`'s and `_lwrite`'s to 32 KiB, within 1% of each other:

| Size   | Read, standard mode | Write, standard mode | Read, enhanced mode | Write, enhanced mode |
| ------ | ------------------- | -------------------- | ------------------- | -------------------- |
| 512    | 2,779               | 2,705                | 1,114               | 3,003                |
| 1 KiB  | 4,830               |                      | 1,113               |                      |
| 2 KiB  | 8,347               | 8,305                | 1,380               | 8,998                |
| 4 KiB  | 14,905              |                      | 1,384               |                      |
| 8 KiB  | 24,736              | 24,657               | 1,653               | 24,505               |
| 16 KiB | 36,268              |                      | 2,189               |                      |
| 24 KiB | 55,645              |                      | 2,737               |                      |
| 32 KiB | 55,802              | 55,645               | 3,272               | 55,560               |
| 48 KiB | 55,566              |                      | 4,357               |                      |
| 64 KiB | 55,961              | 55,961               | 5,421               | 58,776               |

A seek takes 573 in standard mode and 496 in enhanced mode; an open and a close of the file together 1,723 and 1,505.

In standard mode, and for writes in enhanced mode, a fixed cost and a cost a byte do not fit: fitted to the reads, 13,417 and 0.884 a byte, off by 399% at 512 bytes and by 37% at 24 KiB. [[read out]] What DOSBox 0.74-3 does with DOS's read and write: after the bytes are moved, `modify_cycles` (`src/dos/dos.cpp`, under `DATA_TRANSFERS_TAKE_CYCLES`) takes 4 cycles a byte from the processor, but no more than are left before DOSBox's next event (`src/hardware/pic.cpp`, `PIC_RunQueue`): the millisecond's end, or sooner, the timer's or the display's, of which there are some 1,420 a second here (the reads past 24 KiB, each ending one, 711 in half a second). So a read is 4 instructions a byte to 1 KiB -- 512 bytes and 1 KiB both 728 more than that -- and from 24 KiB on some 55,000 whatever its size. The time is DOSBox's model of a disk, not Windows': it is the oracle's, which the faithful clock is held to.

[[read out]] `_hread` and `_hwrite` make DOS's call 32 KiB at a time (`KRNL286.EXE` seg1 `468c`, `KRNL386.EXE` seg1 `4dec`): each piece 8000h bytes, or to the end of the segment where the buffer's offset is past 8000h, until a piece makes fewer than it asked. So `_hread` of 48 and 64 KiB is two calls of DOS's, and takes 75,686 and 112,033 in standard mode, against `_lread`'s 56,040 and 55,881; in enhanced mode 1,119 and 1,130 more than `_lread`.

In enhanced mode the hard disk's read is not charged for its bytes: 1,116 and 0.0657 a byte [[inferred]], fitted to the three ways at the ten sizes, each within 130 (9% at 2 KiB, 0.3% from 4 KiB on). Why Win386's read of a DOSBox drive escapes `modify_cycles`, when its write and the disc's read do not, is not read out.

The faithful clock charges each of DOS's reads and writes (`call_costs::file_read`, `file_write`, and `huge_transfer` for `_hread`'s and `_hwrite`'s pieces) Windows' own part -- a read 728 in standard mode, a write 653 and 941 -- and DOSBox's for its bytes: 4 a byte under 512, then the reads' times above less 728, in a line between two sizes; in enhanced mode a read the fit. `_llseek` is charged 573 and 496. Against the recordings, each read or write within 1% in standard mode, and each in enhanced mode within 9% (reads) and 5% (writes), but `_hread` of 48 KiB in standard mode, charged 92,070 against 75,686: its second piece comes straight after a first that ended DOSBox's slice, and is cut sooner than a read alone [[inferred]]. `cdread`'s hard-disk reads, through `mmioRead`, come within 1.3% at each size in standard mode and 3.9% in enhanced mode, with a fixed 679 and 930 for the rest of its loop. The open and close are left as `adlibgap` timed them, 1,599 together, between the two modes'. On any other clock, and at the sound card's 3,000 a millisecond, these calls are charged as before.

Run on WinBox's faithful clock (`tests/timings.rs`), `hdtime`'s times come out as recorded: in standard mode each within 2.5% but `_hread` of 48 KiB (+22%, below) and the open and close (-5%); in enhanced mode each within 8%, the reads of 512 bytes to 2 KiB and the writes of 2 and 64 KiB furthest. The loop alone, `timeGetTime` and the probe's own, within 0.7% and 0.6% (next section).

## `timeGetTime`

[[read out]] In standard mode `timeGetTime` is a jump into the timer driver (`MMSYSTEM.DLL` seg1 `029a`-`02b8`: the caller's return address kept, and `TIMER.DRV`'s `DriverProc` jumped to with `TDD_GETSYSTEMTIME`, 0808h, and the driver's handle, 17 instructions). `DriverProc` (`TIMER.DRV` seg2 `0038`-`0061`, `0099`-`00b1`) finds the message in its table with `repne scasw`, and calls standard mode's function or enhanced mode's by `__WINFLAGS`' `WF_ENHANCED` (the far pointers at seg4 `01f4` and `020c`), 30 instructions about it. Standard mode's (seg3 `0216`) latches the 8253's count with `out 43h,al` and reads it with two `in al,40h` (`0417`-`0436`; two reads more where seg4 `01dc` is 1 or more, which it is not here), adds it to the ticks counted (`01f8`-`0215`, again if a tick came between), and makes the 48 bits milliseconds by a division by 1,193.18, kept as 16.16 (`024d`-`0262`, `0438`-`0586`, the divisor made to fill its word at `0587`-`05b0`): 158 instructions. In all 205, and 4 more for each step the division's correction takes.

[[read out]] DOSBox 0.74-3 takes cycles from the processor for each port read and written (`src/hardware/iohandler.cpp`, `IO_USEC_read_delay` and `IO_USEC_write_delay`): its cycles a millisecond over 1,024 for a read, a microsecond's, and over 1,365 for a write, three quarters of one; none where fewer than three times that are left in its slice. At 80,000 a millisecond a read is 78 instructions and a write 58; at 3,000, 2 and 2. So `timeGetTime`'s time grows with the rate it is recorded at: 205 and 2 reads and a write, 419 at 80,000 a millisecond and 211 at 3,000.

[[measured]] The recordings, each `timeGetTime` and the probe's loop of 8 instructions about it (`HDTIME.EXE` seg1 `030a`-`0320`: a long incremented, the call, a long subtracted and compared):

| Recording                               | Mode     | A pass       | Less the loop | 205 and the ports |
| --------------------------------------- | -------- | ------------ | ------------- | ----------------- |
| [[probe:hdtime]], 80,000 a millisecond  | standard | 427.3, 429.4 | 419.3, 421.4  | 419               |
| [[probe:hdtime]], 20,000 a millisecond  | standard | 266.7, 268.4 | 258.7, 260.4  | 257               |
| [[probe:adlibgap]], 3,000 a millisecond | standard | --           | 212           | 211               |
| [[probe:hdtime]], 80,000 a millisecond  | enhanced | 555.2, 555.4 | 547.2, 547.4  | --                |
| [[probe:hdtime]], 20,000 a millisecond  | enhanced | 291.2, 291.1 | 283.2, 283.1  | --                |

A pass is the half second's instructions over the passes made in it, two runs; the recordings at 20,000 are `oracle/fixtures/timings/hdtime-c20000.json` and `hdtime-enhanced-c20000.json`. Standard mode's agree with the read-out to 2.4 instructions at 80,000 and 3.4 at 20,000 (1.3%), the read-out the least of each: a step of the division's correction, or a tick come between and the count read again, is not in it.

[[inferred]] Enhanced mode's function (seg2 `0116`-`0121`) calls the virtual timer device's entry, got from Win386 (`call far [021c]`), whose code is Win386's and not read out here. Its time at the two rates fits 198 instructions and 3 reads and 2 writes of ports -- 548 and 283, each within 1 -- and no fewer: 2 reads and a write leave 333 at 80,000 and 231 at 20,000, no one count of instructions.

The faithful clock charges `timeGetTime` so, by the clock's rate (`call_costs::time_get_time`): in standard mode 206 -- the read-out's 205 and a step of the division's correction in some calls, which the three recordings less their ports put at 206.4, 207.6 and 206 [[inferred]] -- and DOSBox's charge for two reads and a write; in enhanced mode 198 and three reads and two writes. 420 and 548 at 80,000 a millisecond, where it charged `adlibgap`'s 212 before; 212 on the sound card's 3,000 a millisecond, as before. On it `hdtime`'s loop alone comes within 0.7% in standard mode and 0.6% in enhanced mode of the two runs recorded in each.

### The faithful clock against the other recordings

[[measured]] `tests/timings.rs`, 2026-11-13, each recording at 80,000 a millisecond run on the faithful clock, each time as instructions against the recorded:

- [[probe:cdread]]: within 3.1% in standard mode; in enhanced mode the hard disk's reads of 16 KiB and more within 0.4%, of 2 KiB 6.6%, and the disc's within 11% (2 and 16 KiB the furthest, the fit of `call_costs::disc_read` being a line).
- [[probe:wingcost]] and [[probe:wingxlat]]: each blit within 1% from 64 by 64 up, and within 4% at 16 by 16; `WinGStretchBlt`, `Rectangle`, `GetNearestColor` and `WinGSetDIBColorTable` of 256 within 0.7%. Before, on the Rust engine, WinG and the Super VGA's drawing were charged 154 each, as a call not recorded.
- [[probe:callcost]] on both displays, [[probe:twrcost]], [[probe:twrcall]]: calls of a thousand instructions and more within 2%; smaller ones 5 to 70% over, the more the smaller -- `GetTickCount` 17 for 11, `GetActiveWindow` 14.5 for 8.4 -- each charged the recorded figure, which has the batch's own loop in it, and WinBox's processor running that loop again: some 6 to 16 instructions a call. `SendMessage` (397 for 206) and `DispatchMessage` (585 for 385) charge the window procedure's `DefWindowProc` again, a call of its own on WinBox; `SetWindowPos` 18% over, `LockResource` and `GlobalUnlock` 14% under.
- [[probe:viscost]]: `BitBlt` within 1.4% with nothing over the drawing; over half of it 9% over, WinBox charging the whole. `PatBlt` was charged 154; it is now charged `viscost`'s 2,142 on the VGA.
- [[probe:wingsel]] (2026-11-13): each `GetNearestColor` and each selection of a bitmap within 2.3%, held within 5%; the pen and back 3% over, its 217 a call with the batch's loop in it.

## The Ad Lib driver's writes

[[measured]] Under DOSBox at a fixed 3,000 cycles a millisecond, each write of the Ad Lib driver's takes 90 instructions from the register's number to its value, and from 587 to 757 from the value to the next number, by caller: 618 on average over the 3,480 writes `adlibout`, `adlibmap` and `adlibseq` made back to back. A note that needs an instrument is about 20 writes, some 14,000 instructions. WinBox's synthesizer charges the clock 90 and 618 for each ([[topic:adlib]]).

## The time between MIDI messages

[[measured]] [[probe:adlibgap]] times calls another way: a read of the OPL's status port after each, which DOSBox's traced build gives to the microsecond, at a fixed 3,000 cycles a millisecond. A call's time is then its instructions, one by one rather than over a batch. As instructions: `timeGetTime` 212, `_lwrite` 582 and 3.9 a byte, `_lclose` 486, `_lopen` 1,113, `_llseek` 490, `wsprintf` 117 and 138 for each conversion, 20.5 for each digit and 13.8 for each character of a string (fitted to five, each within 2 [[inferred]]), `PeekMessage` finding nothing 193 (callcost's 207 has its batch's own loop in it), `midiOutPrepareHeader` 1,566. The program's own arithmetic runs 2,986 to 2,995 instructions a millisecond there, the timer's interrupt taking the rest.

[[measured]] Opening the MIDI Mapper grows with its setup: 1,146 instructions for each device it asks for its capabilities while it looks for the devices its setup names, from `adlibmap` recorded with "Ad Lib general" current (32 asks) against "Ad Lib" (8). Its first open's reset came 27,507 instructions later ([[topic:midi-mapper]]).

The Rust engine charges these, and callcost's, as recorded when a probe recorded on the installation with a sound card runs, at the survey's 3,000 a millisecond, which is the rate those recordings were made at. The Ad Lib driver's and the MIDI Mapper's own time is charged by WinBox's drivers whatever the clock ([[topic:adlib]]).

## WaveMix's ends

[[measured]] With the Sound Blaster at a fixed 3,000 cycles a millisecond, WaveMix tells a program that a half second of sound has ended 0.4 seconds after `WaveMixPlay`, the same for two played at once on two channels. Played twice over, it tells 0.7 seconds after. [[read out]] The end is told when WaveMix's own clock has passed the wave's last byte, looked at as each block the driver finishes comes back. That clock is the time since WaveMix set it, not the device's position ([[topic:wavemix]]). Why it is a tenth ahead is not pinned down. winbox.js tells the same tenths on its Sound Blaster and on its own card.

## A game that paces itself by its work

[[measured]] SimTower's game runs as fast as the machine lets it: its calendar 40 seconds after a new tower is begun, under DOSBox at fixed rates, is a weekend in the first quarter of its first year at 20,000 instructions a millisecond, and the third quarter at 80,000; with DOSBox as fast as the host allowed, the second quarter of the second year. A recording made as fast as the host allows says how fast that host was, not what Windows does, and such a game cannot be held to one. It does not follow `GetTickCount`'s steps: stepped by the millisecond or by the tick, winbox.js's SimTower is on the same day.

[[inferred]] On winbox.js's faithful clock at the same rates, SimTower is a quarter ahead at each: a weekday in the second quarter at 20,000, the fourth quarter at 80,000. Charging calls a flat amount, it was a year and more ahead; what brought it back was its blits, which it never makes with its colours one for one as winbox.js realizes its palettes, and which had been charged as WinG's fast copy. What the last quarter is, these recordings do not say. All but some 2,000 of the 548,000 calls SimTower makes in the survey are timed, alone or in a pair; but its blits into a window that its own floating palette covers part of, and what Windows does with the messages it is sent, are timed nowhere.

[[measured]] The Rust engine, 2026-11-13, SimTower as the corpus surveys it -- its question answered at 10 seconds, New Tower chosen at 40 and the screen kept at 80, 40 seconds into the tower -- by `trace --clock faithful` with the survey's report as its marks: at 10 seconds its question, at 40 its menu, at 80 the first weekday of the first quarter of its second year, "Santa Claus is coming to your tower!". On the survey's clock, the same places: the second weekday of the first quarter of its first year, night. So two quarters ahead of DOSBox at 80,000 a millisecond (a weekend in the third), where the TypeScript engine was one. Its calls in the tower's tenth second take three quarters of the clock's time: `WinGBitBlt` 46% of what is charged, all translated, `GetNearestColor` 25%, `WinGSetDIBColorTable` 8%, `Rectangle` 5%. It calls `GetTickCount`, not `timeGetTime`: the same day before `timeGetTime` was charged by the rate and after. Before WinG and the Super VGA's drawing were charged here, each such call was 154. The run took ten minutes of the host's for its 80 seconds.

### What moves SimTower's calendar

[[read out]] SimTower's main loop takes its messages with `PeekMessage` and, when there are none, makes a step of its game (`SIMTOWER.EXE` seg76 `00ac`-`0173`, `018e`-`02e9`). Where a tower is open and not paused (the words at 7842h, 1, and 2aah, nought: seg76 `024c`-`025a`), the step first asks its clock to tick (seg65 `0196`) and then runs its simulation and draws (seg19 `03ab`), more of each where the clock ticked. The clock is the tick of the day, a word at 0b3e2h, 0 to 2,599 (seg65 `01c5`-`01e4`); at tick 2,300 the day, a double word at 0b3e4h, is counted on (seg65 `04ab`-`04c3`). Three days are a quarter, the first two weekdays and the third the weekend, and twelve a year (seg36 `0510`-`06a9`, the date drawn). A new tower starts at tick 2,533 of day nought (seg65 `0008`-`0021`).

The clock waits for time only where the word at 0de38h is nought: then a tick comes no sooner than six sixteenths of a second -- 96 ms -- of `GetTickCount` after the last (seg65 `01a5`-`01c1`, seg66 `05e6`-`0602`, `GetTickCount` shifted down four). SimTower sets that word to 1 as it starts (seg38 `0551`) and an item of its Options menu turns it back and forth (seg44 `0793`-`07b6`). As it starts, then, every step ticks, and the calendar goes as fast as the steps: a tick a step, its pace the instructions a step takes, its own and Windows'. `GetTickCount` and its resolution have no part in it.

[[measured]] [[probe:towrtick]] starts SimTower as the corpus's launcher does and reads the tick and the day out of its data segment four times a second; under DOSBox at a fixed 80,000 a millisecond, recorded four times with New Tower chosen. And WinBox's faithful clock, the same corpus run, the counters read at each step:

| Into the tower | DOSBox, ticks | DOSBox, the date                                  | WinBox before, ticks | WinBox before, the date | WinBox now, ticks | WinBox now, the date   |
| -------------- | ------------- | ------------------------------------------------- | -------------------- | ----------------------- | ----------------- | ---------------------- |
| 20 s           | 10,189-10,251 | 2nd WD / 2Q / 1st year                            | 15,892               | 1st WD / 3Q / 1st year  | 11,544            | 2nd WD / 2Q / 1st year |
| 40 s           | 20,366-20,513 | 2nd WD / 3Q / 1st year, the weekend within 0.25 s | 31,911               | 1st WD / 1Q / 2nd year  | 23,114            | WE / 3Q / 1st year     |
| 60 s           | 30,667-30,790 | WE / 4Q / 1st year                                | --                   | --                      | 34,688            | 2nd WD / 1Q / 2nd year |
| 80 s           | 40,904        | 1st WD / 2Q / 2nd year                            | --                   | --                      | 46,281            | WE / 2Q / 2nd year     |

DOSBox makes some 511 steps a second, each some 156,500 instructions; the four recordings agree within 0.7%. WinBox made 799, each some 100,100 -- 23,800 SimTower's own and 76,400 charged for calls -- and now makes some 578, each some 138,000.

[[measured]] Where DOSBox spends a step: a build of DOSBox 0.74-3 of the recorder's own (not the oracle's: the scratch build writes CS, IP and the stack each millisecond, its ticks within 0.2% of the stock DOSBox's), with `towrtick`'s map of the code segments by module, sixty seconds of the tower. SimTower's own code 13% of the samples, some 20,500 instructions a step, as WinBox runs; WinG's device, `WINGDE.DLL`, 43%, nine in ten of them in its colour search (seg2 `02c0`-`031a`); the display driver 17%, its translating copy of a blit's pixels (seg9 `1496`-`14a2`); GDI 13%, KERNEL 4%, WinG 4%, USER 2%. By SimTower's call each sample is under: `SelectObject` 30%, some 46,000 instructions a step -- each of its four bitmap selections into its WinG context some 9,250 -- and `GetNearestColor` 12%, some 18,000. WinBox had charged the bitmap selections 217 each, a pen's.

So the first quantity that differs is a call's charge: SimTower's step selects a WinG bitmap into its WinG context and the one before back, twice, and GDI then has WinG's device match the context's background and text colours, two searches of the bitmap's colour table each. WinBox now charges that as `wingsel` times it (above, "Colours matched in a WinG device context"): 9,411 for each of the four, and `GetNearestColor` by where its colour is in the table. Neither the processor's count of instructions nor `GetTickCount` differs.

[[measured]] What is still not charged, some 18,500 instructions a step, 13% more steps than DOSBox: its selections of the pen and the brush it makes anew each step into the WinG context, some 1,300 and 4,700 instructions a step under DOSBox, where WinBox charges 217 each, WinG's device realizing each new one; and some 8,500 instructions a step of WinG's colour search under no call the stack tells.

## Several machines on one page

The run page runs a machine for each install, each a tab ([[guide:launcher]], step 4), and every machine shares the page's one thread. [[measured]] Headless Chromium on the development machine (a Ryzen 9 3950X), the asset bundle's base on the VGA, SkiFree -- which polls with `PeekMessage` and never waits -- run on one machine and then on two, ten seconds each, the main thread's busy share from the browser's own task time and each machine's progress as the calls its trace counted, and on the TypeScript engine the instructions its processor ran:

| Engine     | Machines running SkiFree | Main thread busy | Each machine's progress                |
| ---------- | ------------------------ | ---------------- | -------------------------------------- |
| Rust       | none (Windows up, idle)  | 1%               | --                                     |
| Rust       | one                      | 96%              | 149,000 -- 158,000 calls a second      |
| Rust       | two, one in a tab behind | 87 -- 97%        | 81,000 -- 90,000 calls a second each   |
| TypeScript | none (Windows up, idle)  | 1%               | --                                     |
| TypeScript | one                      | 96%              | 1,926 instructions a millisecond       |
| TypeScript | two, one in a tab behind | 87 -- 96%        | 597 and 865 instructions a millisecond |

A machine whose programs wait for messages costs next to nothing: the Rust engine steps it only when its next timer is due (`wake_at`), and the TypeScript engine's scheduler only when a task is woken. Two machines each kept busy share the thread: on the Rust engine each frame gives each machine the same slice (12 ms), so each runs at some 55 to 60% of its speed alone; on the TypeScript engine the two together run some 75% of one alone, the later-made machine the larger share. The machine in the tab behind runs as the one shown does. Closed, a machine runs no more: its TypeScript engine's processor ran 0 instructions in the ten seconds after.

[[measured]] Memory, the same runs: a Rust machine's WebAssembly instance is 18 MB with Windows up and nothing running, and 24 MB running SkiFree, steady over 40 s; the page's JavaScript heap grows by some 1 to 2 MB for each. A TypeScript machine adds some 6 to 12 MB to the heap. Before step 4 the Rust engine's call log kept every call a run made, and an instance running SkiFree grew to 101, 181, 341 and 661 MB at 5, 10, 15 and 30 s; the log now lets go of each call once the page's trace has read it (`System::forget_calls`). So no limit is set on machines at once: twenty busy machines are some 500 MB. An instance whose machine is closed is kept for the next machine made, as the page cannot let go of a WebAssembly instance's glue, and so of its memory. The script is not kept.

## Paging

[[measured]] [[probe:pgbig]], in 386 enhanced mode at a fixed 80,000 a millisecond (`oracle/fixtures/timings/pgbig-enhanced-c80000.json`), writes a byte to each page of a 0501h block of 24 MiB, 6,144 pages, on DOSBox's 16 MB machine with 3,718 pages free, then reads each back twice, by `GetTickCount`; each page through a selector based once a 64 KiB:

| Pass       | Milliseconds | A page  | As instructions |
| ---------- | ------------ | ------- | --------------- |
| Write      | 4,448        | 0.72 ms | 57,900          |
| Read       | 6,756        | 1.10 ms | 88,000          |
| Read again | 1,373        | 0.22 ms | 17,900          |

The block is more than is free, so WIN386 pages to its swap file as the passes go; the figures are the passes' whole time over the pages, the probe's own loop and 0007h's calls in them. With DOSBox as fast as the host allowed the same passes took 1,428, 1,593 and 1,154 ms. In standard mode DOSX has no pager: 24 MiB is refused, and the 14,544 KiB given are written and read in under a tick. WinBox does not page, and charges nothing for it ([[guide:paging]]).

## A compatibility run

[[measured]] 2026-11-14, the compatibility database's prototype ([[guide:compatibility]]): a program run by `trace` for ten seconds of the survey's clock, from its own folder on the installation's VGA, not held to a report. Ten games of archive.org's collection: 117 ms to 1.6 s of the host's time each, 555 ms on average over the nine that ran. The corpus's 36 programs run without steps or a disc, the same way: 34 s together, 944 ms each on average, `bubgirl` alone 18 s. A program waiting for messages takes some 100 to 300 ms, as idle time passes without instructions; a busy one, its 20 to 30 million instructions, about 1.5 s. Reading the metadata of archive.org's 2,284 Windows 3.x items, half a second between requests: 48 minutes.

[[measured]] 2026-11-14, the catalog's titles ([[guide:compatibility]], "Titles"): 534 items fetched (521 of them new, 77.6 MB, half a second after each request), read, and run five virtual seconds each by `trace --captions`, four at a time: 834 s in all, some 1.6 s an item, the downloads most of it. Reading the 567 items fetched so far again, without a run, the last runs' windows kept: under a second.

## Not yet done

- SimTower on the faithful clock: 13% more steps than DOSBox, some 18,500 instructions a step not charged ("What moves SimTower's calendar"): a new pen's and brush's selection into a WinG device context, WinG's device realizing each, charged 217 where DOSBox takes some 1,300 and 4,700 a step; and some 8,500 a step of WinG's colour search under no call the sampled stack tells. Why the Rust engine was a quarter further ahead than the TypeScript engine was is not looked into: the TypeScript engine is retired.
- WinG's search for a colour of a palette's (a `COLORREF` high byte of 1) is not followed: charged as in no entry. `SetTextColor` and `SetBkColor` in a WinG device context, a search each, are charged as recorded elsewhere; whether a bitmap's selection searches its own table or the one before is not told apart ([[probe:wingsel]]'s bitmaps had the one table).
- Why 386 enhanced mode reads a file of DOSBox's hard disk without DOSBox's charge for its bytes, when it writes one with it, and reads a disc with it ("Reading and writing the hard disk").
- `_hread`'s second piece, cut sooner than a read alone: the faithful clock charges `_hread` of 48 KiB 22% more than recorded.
- `timeGetTime` in 386 enhanced mode: the virtual timer device's code, Win386's, is not read out; its 198 instructions and five port accesses are a fit to two rates.
- A small call's charge has the recording's batch loop in it, which WinBox's processor runs again: some 6 to 16 instructions a call over, 50% and more of the smallest ("The faithful clock against the other recordings"). Reading each probe's loop out of its code would take it off.
- A call made inside another -- `DefWindowProc` from the window procedure `SendMessage` and `DispatchMessage` call -- is charged twice, inside the outer call's recorded time and again on its own.
- A call that reads or writes ports takes, as instructions, the more the faster DOSBox runs (`timeGetTime`); the recordings at 80,000 a millisecond hold at that rate, and the VGA's drawing, which writes the VGA's registers, is charged as at 80,000 on the sound card's 3,000 too.
- Sound on the native front end's paced clock, untried: the host's device plays at the host's time, and a machine whose time is behind it makes its samples slower than they are played [[inferred]].
- An open and a close timed apart at 80,000 a millisecond; and DOS's seek, open and close that a program asks for itself, which the faithful clock does not charge.
