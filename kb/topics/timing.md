---
kind: topic
name: Timing
summary: How fast Windows 3.1 runs a program's own instructions under DOSBox, and how long its commonest calls take there — told as the instructions that would have run in the same time — on the VGA and on the 256-colour display with WinG, with a WinG blit's cost against its size.
probes: [cpurate, callcost, wingcost]
---

A program for Windows 3.1 sees time pass by `GetTickCount` and by its timers, and how much passes depends on what it did meanwhile: its own instructions, and the calls it made. A call to Windows is not a moment. Inside it Windows runs instructions of its own, hundreds for the quickest and hundreds of thousands for a large blit, and the time they take is time the program sees go by.

winbox.js keeps a virtual clock for its recordings: time passes by the instructions a program runs, at a fixed rate, so a run is the same every time. The recordings here are what that clock needs to keep time as Windows does: how fast Windows runs a program's own instructions, and how long each call takes, told as instructions at that rate.

Each function's page carries its own: how long each way it was recorded took, and the same as instructions. They are timings, not answers. They vary with the host and from run to run, and are kept in `oracle/fixtures/timings/`, not replayed. Each figure is the middle of three runs of at least two seconds each, by `GetTickCount`, under the recorder's DOSBox at `cycles=max`.

## How fast a program's own instructions run

[[measured]] [[probe:cpurate]] runs the workloads of winbox.js's own benchmark, the same instructions, each the body of a `LOOP` of 65,535, until two seconds pass. Under the recorder's DOSBox Windows runs between 260,000 and 430,000 of them a millisecond: register arithmetic fastest, loads and stores through memory slowest. Two recordings agree within 3%. The first run of each three is slower than the other two, by up to 27%.

[[probe:callcost]] and [[probe:wingcost]] time the same register arithmetic in the run they measure, so their calls can be told as instructions at that run's own rate: about 405,000 a millisecond in `callcost`'s runs and 400,000 in `wingcost`'s, or 405 and 400 instructions a microsecond.

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

## What winbox.js does

winbox.js keeps two clocks. The survey's runs 3,000 instructions a millisecond and charges every call 5 µs, 15 instructions at its rate, from the `speed` probe's timings: it runs about a hundred times faster than a faithful one, and the same every time. Against these recordings, a program's own instructions pass about 100 times the time they take Windows, and most calls are charged more than they take: the calls a program makes most -- `SetRect`, `IsIconic`, `GetActiveWindow` -- take a tenth to a fortieth of 5 µs, `PeekMessage` finding nothing a third. A blit or a line of text is charged less: a fifth of a small one on the 256-colour display, a hundredth of a WinG blit of the whole screen.

The faithful clock, `WINBOX_CLOCK=faithful` in the test harness, runs 258,269 instructions a millisecond, `cpurate`'s `mixed` workload, and charges each call recorded here the time it took, and 5 µs any other. The rate is a choice: the recorder runs DOSBox as fast as its host allows, and `cpurate`'s workloads run from 258,000 to 425,000 a millisecond there, so no one rate is Windows' own.

[[inferred]] **A game's clock does not follow from the rate.** SimTower, shown 40 seconds after a new tower is begun, is in the second quarter of its second year in Windows' recording. On the survey's clock it is in the first quarter of its first; on the faithful clock, the second quarter of its fourth, and at 405,000 a millisecond, the third quarter of the fourth. A rate a third lower moves it a quarter of a year, and charging its calls as recorded moves it further ahead, not back: what sets its pace under DOSBox is something these recordings do not have yet. What would settle it is SimTower's screen taken at several times in DOSBox, against the same here.
