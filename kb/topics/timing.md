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
  ]
---

A program for Windows 3.1 sees time pass by `GetTickCount` and by its timers, and how much passes depends on what it did meanwhile: its own instructions, and the calls it made. A call to Windows is not a moment. Inside it Windows runs instructions of its own, hundreds for the quickest and hundreds of thousands for a large blit, and the time they take is time the program sees go by.

winbox.js keeps a virtual clock for its recordings: time passes by the instructions a program runs, at a fixed rate, so a run is the same every time. The recordings here are what that clock needs to keep time as Windows does: how fast Windows runs a program's own instructions, and how long each call takes, told as instructions at that rate.

Each function's page carries its own: how long each way it was recorded took, and the same as instructions. They are timings, not answers, kept in `oracle/fixtures/timings/`, not replayed. Each figure is the middle of three runs of at least two seconds each, by `GetTickCount`. Most were recorded with DOSBox as fast as the host allows (`cycles=max`), where they vary with the host and from run to run; some again at a fixed rate (`cycles=fixed 80000`), where they do not: see "At a fixed rate" below.

## How fast a program's own instructions run

[[measured]] [[probe:cpurate]] runs the workloads of winbox.js's own benchmark, the same instructions, each the body of a `LOOP` of 65,535, until two seconds pass. Under the recorder's DOSBox Windows runs between 260,000 and 430,000 of them a millisecond: register arithmetic fastest, loads and stores through memory slowest. Two recordings agree within 3%. The first run of each three is slower than the other two, by up to 27%.

[[measured]] The Rust engine's core runs the same workloads in `crates/winbox-cpu/examples/bench.rs` (`cargo run --release -p winbox-cpu --example bench`; `BENCH_MS` sets each run's length, 2,000 ms by default), each a straight run closed by a jump back to its top, in real mode and in protected mode with Win16-sized descriptors. On the development machine (a Ryzen 9 3950X), three runs on 2026-11-09: register arithmetic 33,400 to 35,200 instructions a millisecond, loads and stores 31,500 to 33,700, pushes and pops 59,700 to 63,300, arithmetic against memory 33,500 to 37,100; protected mode within a few percent of real mode. DOSBox's medians from `cpurate` beside them: 424,000, 329,000, 352,000 and 258,000, some 6 to 12 times as fast.

[[probe:callcost]] and [[probe:wingcost]] time the same register arithmetic in the run they measure, so their calls can be told as instructions at that run's own rate: about 405,000 a millisecond in `callcost`'s runs and 400,000 in `wingcost`'s, or 405 and 400 instructions a microsecond.

## How `GetTickCount` steps

[[measured]] [[probe:tickstep]] polls `GetTickCount` as fast as a program can for a second. Its answers step 55 milliseconds at a time, and 54 every thirteenth or fourteenth: whole ticks of the timer, the 8253's 1,193,180 Hz divided by 65,536, 54.9254 ms each, rounded down. A program sees nineteen different answers a second. `timeGetTime` steps a millisecond at a time ([[probe:mmtime]]).

## A journal playback's wait

[[read out]] A journal playback hook answers `HC_GETNEXT` with how many milliseconds to wait before its event is taken ([[topic:system-queue]]). USER keeps the wait beside its timers and counts it down on the same ticks of its own system timer, by the milliseconds `GetSystemMsecCount` says have passed since the last (`USER.EXE` seg1 `72c6`-`7365`). Within 5 ms of nought the wait is over, and the program that would take the event is woken; its look asks the hook again. The timer is set for whichever is due first, a timer or the wait, so the wait is kept to about the system timer's tick.

[[measured]] [[probe:jrnlplay]] asks for a wait of 200 ms before one key. From the hook's first `HC_GETNEXT` for it to the key's press being taken, `GetTickCount` counted at least 150 ms, and the hook was asked for it more than once. Both engines wait it on their own clocks: the host's, or, on a virtual clock, the instructions run.

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

[[inferred]] One for one, a blit is about 2,823 instructions and 31.7 a row, nothing to speak of a pixel: each row is a string copy, which DOSBox counts as one instruction however long. Not, it is about 11,002, 39.0 a row and 4.43 a pixel. A blit of the whole screen is 75 times as long, 17 ms at 80,000 a millisecond.

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

winbox.js on the development machine (a Ryzen 9 3950X), drawing a pixel through a window's view of the screen: the Rust engine's raster 6 ns with nothing to test, 8 with one test of the pixel -- today's, of the window's pixels, or a region's -- 9.5 with a region of eight holes, 11.3 with today's two tests, the window's pixels and the clip region; the TypeScript engine's about 570 ns, in which the tests do not show. A benchmark of the raster alone, not kept.

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

The faithful clock, `WINBOX_CLOCK=faithful` in the test harness, runs 80,000 instructions a millisecond, the fixed rate the calls were recorded at, and charges each call the instructions recorded for it, the same at any rate: a call recorded only in a pair, half the pair, and one not recorded, 154, the middle of those recorded alone [[inferred]]. `WinGBitBlt` is charged by its size, and by whether its bitmap's colours are the system palette's one for one. The rate is a choice, made to be one DOSBox can be held to: as fast as the host allows, DOSBox runs no one rate.

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
