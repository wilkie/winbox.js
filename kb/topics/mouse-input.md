---
kind: topic
name: Mouse moves USER makes
summary: When Windows 3.1 sends a window a mouse move nobody made — after a window is shown or moved, and after SetCursorPos — and why a program that waits for its first message before it draws needs one.
probes: [mousemv, iconclk]
---

A window is told the mouse moved when the mouse moves. It is also told when the mouse has not moved, but what is under it has.

[[probe:mousemv]] sets the cursor with [[fn:USER.SetCursorPos]], shows windows under it and clear of it, and moves one under it. After each step it takes what is waiting with [[fn:USER.PeekMessage]] before it does anything else. [[measured]]

- **After `SetCursorPos`**, a `WM_MOUSEMOVE` waits, at the cursor's new place.
- **After a window is shown**, a `WM_MOUSEMOVE` waits, for whatever is under the cursor, whether or not the window shown is. A window shown clear of the cursor leaves the move for the desktop, at the point on the screen. A window shown under it gets the move itself, at the point in its client area: (116, 67) for a window at (200, 150) and a cursor at (320, 240), its frame four pixels wide and its caption below that.
- **After a window moves under the cursor**, the moved window gets one, in its own client area.
- **When nothing has changed**, nothing waits.
- With no window of the program's there yet, the move goes to the desktop, whose queue is the shell's: the probe runs as the shell, and took it.

## The mouse put in by a program

[[fn:USER.Mouse_Event]] is how the mouse driver tells USER what the mouse did, and a program can call it too. [[measured]] [[probe:iconclk]] does, and Windows' own loops take what it puts in as they take the mouse. Presses queued before the move loop starts are still the loop's: USER keeps the mouse in one queue for the system and hit-tests each event when it is taken. winbox.js posts each event as it happens, hit-tested then. So it gives what follows a press on a caption to that caption's window until the button is let go, which is where Windows' move loop would take it.

## Why it matters

[[measured]] SkiFree fills its window white in its first paint and draws its skier, its signs and its logo in its game loop, which starts only when its first `GetMessage` returns. Under DOSBox the cursor rests in the middle of the screen, over SkiFree's window, and the move USER makes as the window is shown wakes it. With no such move, it waits for ever and shows an empty slope. SkiFree is one of the programs of the corpus in `corpus/manifest.json`.

[[documented]] The mouse driver's reset leaves the cursor in the middle of the screen. winbox.js starts it there.

## In winbox.js

`RasterInput.nudge` in `src/win16/user/raster-input.ts` makes the move, as the mouse moving to where it already is would. It is called as `ShowWindow`, `SetWindowPos` and `CreateWindow`'s showing end, and from `SetCursorPos`.

Not measured: whether a window hidden or destroyed from under the cursor makes one, and whether `WM_SETCURSOR` comes with it.
