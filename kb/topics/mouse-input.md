---
kind: topic
name: Mouse moves USER makes
summary: When Windows 3.1 sends a window a mouse move nobody made — after a window is shown or moved, and after SetCursorPos — and why a program that waits for its first message before it draws needs one.
probes: [mousemv, iconclk, setcur, nudges, quitin, curerr]
---

A window is told the mouse moved when the mouse moves. It is also told when the mouse has not moved, but what is under it has.

[[probe:mousemv]] sets the cursor with [[fn:USER.SetCursorPos]], shows windows under it and clear of it, and moves one under it. After each step it takes what is waiting with [[fn:USER.PeekMessage]] before it does anything else. [[measured]]

- **After `SetCursorPos`**, a `WM_MOUSEMOVE` waits, at the cursor's new place.
- **After a window is shown**, a `WM_MOUSEMOVE` waits, for whatever is under the cursor, whether or not the window shown is. A window shown clear of the cursor leaves the move for the desktop, at the point on the screen. A window shown under it gets the move itself, at the point in its client area: (116, 67) for a window at (200, 150) and a cursor at (320, 240), its frame four pixels wide and its caption below that.
- **After a window moves under the cursor**, the moved window gets one, in its own client area.
- **When nothing has changed**, nothing waits.
- **Moves not yet taken become one**, sent to the window under the cursor when it is taken. [[probe:setcur]] sets the cursor and then shows a window under it, and only that window hears of the move. Each move also asks the window for its cursor first ([[topic:cursor]]).
- With no window of the program's there yet, the move goes to the desktop, whose queue is the shell's: the probe runs as the shell, and took it.

[[probe:nudges]] and [[probe:quitin]] place these moves among the messages around them. [[measured]]

- **They are input, not messages posted.** [[probe:nudges]] posts a message, shows a window clear of the cursor, posts another and shows a second. Both posted messages come first, then the one move, for the desktop or for the window under the cursor.
- **Several become one** whether or not messages were posted between them: two windows shown, or two shown and one hidden, leave one move.
- **They come after `WM_QUIT`.** [[probe:quitin]] destroys a window from under the cursor and then calls [[fn:USER.PostQuitMessage]]. The quit is taken first, then the move, for the desktop or for the window left under the cursor. A move put in through [[fn:USER.Mouse_Event]] comes after the quit too, whether it was put in before the quit or after it. A message posted comes before the quit ([[topic:task-startup]]).

## The mouse put in by a program

[[fn:USER.Mouse_Event]] is how the mouse driver tells USER what the mouse did, and a program can call it too. [[measured]] [[probe:iconclk]] does, and Windows' own loops take what it puts in as they take the mouse. Presses queued before the move loop starts are still the loop's: USER keeps the mouse in one queue for the system and hit-tests each event when it is taken. winbox.js posts each event as it happens, hit-tested then. So it gives what follows a press on a caption to that caption's window until the button is let go, which is where Windows' move loop would take it.

## Why it matters

[[measured]] SkiFree fills its window white in its first paint and draws its skier, its signs and its logo in its game loop, which starts only when its first `GetMessage` returns. Under DOSBox the cursor rests in the middle of the screen, over SkiFree's window, and the move USER makes as the window is shown wakes it. With no such move, it waits for ever and shows an empty slope. SkiFree is one of the programs of the corpus in `corpus/manifest.json`.

[[documented]] The mouse driver's reset leaves the cursor in the middle of the screen. winbox.js starts it there.

[[measured]] Mynes and Cell Wars are built with Borland's ObjectWindows, which frees a window's object as the window is destroyed. Their message loop reads the main window's object again for any message but `WM_QUIT`. When the main window is destroyed from under the cursor, Windows hands them the quit before the move that follows. winbox.js handed them the move first, and they read the freed object and faulted.

## In winbox.js

`RasterInput.nudge` in `src/win16/user/raster-input.ts` makes the move, as the mouse moving to where it already is would. It is called as `ShowWindow`, `SetWindowPos` and `CreateWindow`'s showing end, and from `SetCursorPos`. It puts the move in the queue's input, where a move not yet taken is replaced by it, as the mouse's own moves are.

The move is hit-tested as the mouse's own moves are, the window under it asked with `WM_NCHITTEST` ([[topic:hit-testing]]) and then for the cursor with `WM_SETCURSOR` ([[topic:cursor]]). A menu's pop-up taken off the screen as the menu ends is a window hidden too: [[probe:curerr]]'s window, its menu bar pressed and the menu cancelled, was sent a move on the bar after. winbox.js makes the move as its menu loop ends, if a pop-up was put up.
