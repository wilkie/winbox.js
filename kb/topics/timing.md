---
kind: topic
name: Timing
summary: How fast Windows 3.1 runs a program's own instructions under DOSBox, how long its commonest calls take there and how many instructions each is, how GetTickCount steps, what a WinG blit costs by its size and its colours, and what that does to a game that paces itself by its work.
probes: [cpurate, callcost, wingcost, wingxlat, twrcost, twrcall, tickstep]
---

A program for Windows 3.1 sees time pass by `GetTickCount` and by its timers, and how much passes depends on what it did meanwhile: its own instructions, and the calls it made. A call to Windows is not a moment. Inside it Windows runs instructions of its own, hundreds for the quickest and hundreds of thousands for a large blit, and the time they take is time the program sees go by.

winbox.js keeps a virtual clock for its recordings: time passes by the instructions a program runs, at a fixed rate, so a run is the same every time. The recordings here are what that clock needs to keep time as Windows does: how fast Windows runs a program's own instructions, and how long each call takes, told as instructions at that rate.

Each function's page carries its own: how long each way it was recorded took, and the same as instructions. They are timings, not answers, kept in `oracle/fixtures/timings/`, not replayed. Each figure is the middle of three runs of at least two seconds each, by `GetTickCount`. Most were recorded with DOSBox as fast as the host allows (`cycles=max`), where they vary with the host and from run to run; some again at a fixed rate (`cycles=fixed 80000`), where they do not: see "At a fixed rate" below.

## How fast a program's own instructions run

[[measured]] [[probe:cpurate]] runs the workloads of winbox.js's own benchmark, the same instructions, each the body of a `LOOP` of 65,535, until two seconds pass. Under the recorder's DOSBox Windows runs between 260,000 and 430,000 of them a millisecond: register arithmetic fastest, loads and stores through memory slowest. Two recordings agree within 3%. The first run of each three is slower than the other two, by up to 27%.

[[probe:callcost]] and [[probe:wingcost]] time the same register arithmetic in the run they measure, so their calls can be told as instructions at that run's own rate: about 405,000 a millisecond in `callcost`'s runs and 400,000 in `wingcost`'s, or 405 and 400 instructions a microsecond.

## How `GetTickCount` steps

[[measured]] [[probe:tickstep]] polls `GetTickCount` as fast as a program can for a second. Its answers step 55 milliseconds at a time, and 54 every thirteenth or fourteenth: whole ticks of the timer, the 8253's 1,193,180 Hz divided by 65,536, 54.9254 ms each, rounded down. A program sees nineteen different answers a second. `timeGetTime` steps a millisecond at a time ([[probe:mmtime]]).

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

## What winbox.js does

winbox.js keeps two clocks. The survey's runs 3,000 instructions a millisecond and charges every call 15 instructions: it runs much faster than a faithful one, and the same every time. Most calls are charged less than they are -- a rectangle call about half, `PeekMessage` finding nothing a fourteenth -- and drawing far less: a twelve-hundredth of a WinG blit of the whole screen with its colours one for one, a ninety-thousandth of one without. Its `GetTickCount` steps by the tick, as Windows' does.

The faithful clock, `WINBOX_CLOCK=faithful` in the test harness, runs 80,000 instructions a millisecond, the fixed rate the calls were recorded at, and charges each call the instructions recorded for it, the same at any rate: a call recorded only in a pair, half the pair, and one not recorded, 154, the middle of those recorded alone [[inferred]]. `WinGBitBlt` is charged by its size, and by whether its bitmap's colours are the system palette's one for one. The rate is a choice, made to be one DOSBox can be held to: as fast as the host allows, DOSBox runs no one rate.

## A game that paces itself by its work

[[measured]] SimTower's game runs as fast as the machine lets it: its calendar 40 seconds after a new tower is begun, under DOSBox at fixed rates, is a weekend in the first quarter of its first year at 20,000 instructions a millisecond, and the third quarter at 80,000; with DOSBox as fast as the host allowed, the second quarter of the second year. A recording made as fast as the host allows says how fast that host was, not what Windows does, and such a game cannot be held to one. It does not follow `GetTickCount`'s steps: stepped by the millisecond or by the tick, winbox.js's SimTower is on the same day.

[[inferred]] On winbox.js's faithful clock at the same rates, SimTower is a quarter ahead at each: a weekday in the second quarter at 20,000, the fourth quarter at 80,000. Charging calls a flat amount, it was a year and more ahead; what brought it back was its blits, which it never makes with its colours one for one as winbox.js realizes its palettes, and which had been charged as WinG's fast copy. What the last quarter is, these recordings do not say. All but some 2,000 of the 548,000 calls SimTower makes in the survey are timed, alone or in a pair; but its blits into a window that its own floating palette covers part of, and what Windows does with the messages it is sent, are timed nowhere.
