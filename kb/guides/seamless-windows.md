---
kind: guide
name: Seamless windows
summary: The native front end's seamless mode — each top-level Windows 3.1 window shown as a window of the host, with the emulated desktop kept inside the engine and never shown — its design, what is built on Windows, what it gives up, and what each host allows.
---

This page is first a design: how the native front end (`crates/winbox-native`) shows each Windows 3.1 window as a window of its own on the host, the way a program of the host's would look, with no desktop behind it. The program still runs on the emulated machine, sees only its mounted drives, and is given nothing of the host. A first version is built, for a Windows host: `winbox-native PROGRAM.EXE --seamless` ([what is built](#what-is-built), below). Where this page says "is", it is the design; the last sections say what the build does and does not do yet.

## Two modes

- **Desktop mode** is what winbox.js does now: one host window holding the whole Windows screen, desktop and all. It stays the default, and it is what every probe, the corpus and the sessions run against.
- **Seamless mode** shows each top-level window as a host window and shows no desktop. It is a way of presenting the screen, not a change to the engines: the API behaves the same in both, except where this page names a difference.

A program that needs the desktop is run in desktop mode. That is the answer for everything seamless mode gives up below, rather than a special case for each.

## The emulated screen stays the truth

Windows 3.1 has one screen, and programs can see that it does. They draw on it through `GetDC(NULL)` ([[fn:USER.GetDC]]) and read it back with [[fn:GDI.BitBlt]] or [[fn:GDI.GetPixel]]. They are sent `WM_PAINT` for the parts of their windows that something stops covering ([[topic:painting]]). A class with `CS_SAVEBITS` has the pixels under its windows saved and put back ([[topic:menus]]). USER moves and sizes a window by drawing an outline across the screen.

So seamless mode keeps the engine exactly as it is. The desktop window, the z-order and the one frame buffer stay in the engine, with every window drawn into that buffer where Windows would draw it. Only the presenting changes. Giving each window a surface of its own, as a compositor does, would change what programs are sent and what they read back. That breaks the rule that nothing is invented, and the recordings would no longer apply.

## What is shown

- Each **top-level window** gets a host window with no decorations of the host's own: overlapped windows, pop-ups, owned windows and dialogs, and the menu windows of class `#32768`. Each shows its own rectangle of the frame buffer, at the scale the front end draws at. Only the rectangles that changed are copied.
- **Child windows**, MDI children included ([[topic:mdi]]), stay inside their top-level window, as they are drawn there.
- The **frame and caption** are USER's own, drawn as [[topic:window-frames]] describes. The host draws no title bar.
- The **desktop** is drawn into the frame buffer as now, and never shown.

## Keeping the two z-orders in step

A window's rectangle of the frame buffer holds whatever covers it in Windows' z-order. That is only right on the host if the host's windows are stacked the same way, so the two orders are kept in step both ways:

- When the host activates one of the windows, the engine activates it as Windows would ([[topic:activation-and-focus]]). The window is sent `WM_NCACTIVATE`, `WM_ACTIVATE` and `WM_ACTIVATEAPP`, and is brought to the front.
- When a program moves, stacks, shows or hides a window (`SetWindowPos`, `ShowWindow`; [[topic:creating-and-showing]]), the front end moves, raises, shows or hides the host's window to match.
- Owned windows stay above their owner through the host's own owner relation, where the host has one (see the table below).
- The host's windows of other programs can come between ours. That is harmless: each of our windows still shows its own rectangle, and what covers it in Windows' order is also above it on the host.

## Moving and sizing by the host

The caption and the sizing frame look like Windows 3.1's, but the host moves and sizes the window, so it moves like a window of the host's. A press still goes the whole way Windows sends it, because a program can step in anywhere on that way:

1. `WM_NCHITTEST` is asked of the program's own window procedure ([[topic:hit-testing]]).
2. `WM_NCLBUTTONDOWN` goes to the window procedure, then `DefWindowProc`, which sends `WM_SYSCOMMAND` with `SC_MOVE` or `SC_SIZE`.
3. Only where USER would begin its own loop of moving or sizing does the front end hand the drag to the host, through winit's `drag_window` or `drag_resize_window`.
4. When the host's drag ends, the engine places the window as the end of USER's loop does. The window is asked `WM_GETMINMAXINFO`, then is sent `WM_WINDOWPOSCHANGING` and `WM_WINDOWPOSCHANGED`, as [[topic:window-states]] describes.

This is a difference from Windows, and a deliberate one. While the host drags, the outline is not drawn and the loop's own messages are not sent. It is seamless mode's alone. Desktop mode keeps USER's own loop, as it is now.

## The screen's size and coordinates

The emulated screen is made the size of the host's desktop. A window's place on the host is its place in Windows' screen coordinates, offset by the front end's origin and divided by its scale. Windows 3.1 knows of one screen only, so a host with several monitors is shown as one rectangle around them all.

This needs a display driver that reports whatever size it is given. The Windows drivers (VGA, Super VGA, EGA, Hercules) each have fixed modes. WinBox's own display driver would report the host's size instead.

## Minimized windows

A window minimized in Windows is minimized on the host. Its host window takes the best icon the host lets it show: the class icon, or else the one `WM_QUERYDRAGICON` answers.

Programs that paint their own icon are not followed in seamless mode. Clock, for one, draws the time in its icon. Windows draws an icon as a small window on the desktop ([[topic:window-states]]), and with no desktop shown there is nowhere for it. Such a program runs in desktop mode.

## Nothing of the host is read

The engine never reads the host's pixels. Reading the screen, through a screen DC, the desktop window's DC or `GetPixel` on either, reads the emulated frame buffer and never the host's. Seamless mode shows nothing of the desktop, and draws nothing over the host outside the program's own windows. There is no overlay across the host's screen.

So these give up in seamless mode, and the program that needs them runs in desktop mode:

- Drawing on the desktop's DC outside every window: the outlines File Manager and Program Manager drag, `DrawFocusRect` on the screen, and programs that paint the desktop. They are drawn into the frame buffer, but nothing shows them.
- Programs that read the screen back to show it, such as a magnifier or a screen grab. They read only the emulated screen, which is the right answer but a strange one to show.
- Icons the program paints itself (above).

The drives, the clipboard and the profiles stay the emulated ones in both modes. Nothing of the host's files or clipboard is given to the program.

## Input

- The host's pointer and keys go to the window under them, turned from the host's coordinates into Windows' screen coordinates, and into the system queue as now ([[topic:system-queue]]).
- `SetCapture` with a button held follows the pointer outside our windows, on hosts that grab the pointer for a held button (Windows, X11, macOS). Capture with no button held cannot see the pointer outside our windows on most hosts.
- Alt+Tab, Alt+Esc and Ctrl+Esc are the host's ([[topic:task-list]]). In seamless mode the host's switching is the switching, and Windows' own switch loop does not run. Desktop mode keeps it.
- A system-modal window, and [[fn:USER.LockInput]], hold only the emulated windows, not the rest of the host.

## What each host allows

The front end uses winit 0.30 and softbuffer, one surface per host window.

| Host        | What it allows                                                                                | What seamless mode gives up there                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows     | Screen positions, owner windows, the host's drag and resize, windows without decorations      | Almost nothing.                                                                                                                                                                                                                                  |
| macOS       | Screen positions (with y turned over), child windows for owned ones, `drag_window`            | winit has no `drag_resize_window` there, so sizing sets the window's size from the engine's own loop instead. Spaces and full-screen behave as macOS's do.                                                                                       |
| X11         | Screen positions, transient-for for owned windows, the host's drag through the window manager | The window manager may place a window other than where it was asked. The engine then takes the place the host gave as the window's new place.                                                                                                    |
| Wayland     | Separate windows, the host's drag and resize                                                  | A client may not know or set where its windows are, or raise them, and winit 0.30 makes every window a top-level one, with no `xdg_popup`. Menus, drop-down lists and centred dialogs cannot be placed. Run under XWayland, or use desktop mode. |
| The browser | No windows of the host at all                                                                 | Seamless mode is not offered. `window.open` makes framed windows that browsers block, and Document Picture-in-Picture gives one window in Chromium only. The page keeps desktop mode.                                                            |

## The order of the work

1. **Presenting.** One host window for each top-level window, copying only the rectangles that changed. Both z-orders kept in step, and the host's pointer turned into Windows' coordinates. Windows and X11 first.
2. **The host's drag.** The hand-over at `SC_MOVE` and `SC_SIZE`, in seamless mode only.
3. **The screen's size.** WinBox's display driver reporting the host desktop's size.
4. **Minimized windows** as host icons.
5. **The choice of mode** per program, so a program that needs the desktop opens in desktop mode.
6. **macOS**, then **Wayland** under XWayland.

None of this changes either engine. What seamless mode does differently is the host's drag, the switching keys and the icons. Each is named above and is in seamless mode alone, so the probes, the corpus and the sessions keep running in desktop mode as they do now.

## What is built

The first version follows stages 1, 2 and 4 of the order above, on a Windows host. Desktop mode is unchanged and is still the default: every hook below does nothing unless the front end turns seamless mode on, and no probe, corpus run or session does.

### The engine's hooks

`crates/winbox-win16/src/seamless.rs` holds what the front end needs, in the Rust engine only. It is presenting, not Windows' API, so the TypeScript engine has no twin of it.

- **The windows at the top.** `System::top_windows` lists every window with no parent, front to back, the hidden among them. Each has its rectangle, its place where it goes back to when minimized or maximized, its owner, whether it is shown, its placement, its caption, whether it is active, and its kind. The kinds are an overlapped window, a pop-up, USER's `#32768` menu window, a `ComboLBox` dropped down, and Alt and Tab's switch window. Icons' titles (`#32772`) are drawn by the desktop and are left out. `System::top_windows_generation` counts the changes of that list.
- **The host's drag.** Where `DefWindowProc` would begin USER's loop of moving or sizing with the mouse (`track_loop.rs`), the loop is still entered. The window is asked `WM_GETMINMAXINFO` and the mouse is captured as USER's loop does (`USER.EXE` seg6 `145d`-`148e`, seg23 `0957`). Then, in seamless mode only, it hands the drag to the host (`System::take_host_drag`) instead of drawing the outline and following the mouse. The host reports where its drag has the window (`System::host_drag_to`). When the button is let go, the window is held to what it answered `WM_GETMINMAXINFO` and placed by the same `SetWindowPos` the loop ends with (`SWP_NOZORDER | SWP_NOACTIVATE`, with `SWP_NOSIZE` for a move), which sends `WM_WINDOWPOSCHANGING` and `WM_WINDOWPOSCHANGED` ([[topic:window-states]]). The press before it goes the whole way, as before: `WM_NCHITTEST`, `WM_NCLBUTTONDOWN`, `DefWindowProc`, and for the caption `WM_SYSCOMMAND` with `SC_MOVE`. A move or size from the keyboard (Alt and Space, then Move or Size) keeps USER's own loop, outline and all.
- **What the host asks** (`System::host_request`), carried out by the next task to look for a message while nothing has the mouse's capture. That is the rule a press follows, which activates nothing while a window has the capture (seg1 `2939`; [[topic:activation-and-focus]]). Nothing here is a message of its own. A window **activated by the host** is switched to as the end of Alt and Tab's loop switches to it ([[topic:task-list]]; seg23 `0868`-`0915`). It is brought to the top with `SetWindowPos`, which activates it. If it is minimized and the host restored it, it is then posted `WM_SYSCOMMAND` with `SC_RESTORE`, as the loop does for an icon it switched to. A disabled window passes the switch to the window that a press on it would bring up (`owned_to_bring_up`, seg1 `5745`). A window **minimized by the host** is sent `WM_SYSCOMMAND` with `SC_MINIMIZE`, as the system menu's Minimize sends it. **Closed** from the task bar, it is sent `SC_CLOSE`.
- **The icon.** `System::window_icon_rgba` gives the class icon the window was made with. A window with none is asked `WM_QUERYDRAGICON` once it is minimized, as Alt and Tab's box asks (seg23 `07f7`-`083a`). The icon is drawn with the engine's own `draw_icon_at` over black and over white. A pixel that comes out the same over both is the icon's colour. One that comes out black over black and white over white is clear. One that inverts what is under it is shown as it came out over black.

### The front end

`crates/winbox-native/src/seamless_host.rs`, with the reckoning in `seamless.rs` (unit-tested on Linux) and the calls winit has none for in `host_os.rs`.

- **One host window for each visible window at the top**, undecorated, made, moved, sized, shown and taken away as the list changes. Each shows its rectangle of the one frame buffer, nearest-neighbour at the scale. It is copied only when those pixels changed. The desktop is drawn as before and never shown. The engine's cursor is drawn into the frame while the host's pointer is over one of the windows or a button is held. Otherwise it is left out, and the host's own cursor shows outside the windows.
- **Owners.** An owned window is made with its owner's host window as its owner (winit's `with_owner_window`). The host then keeps it above its owner and off the task bar. USER's own windows that nothing owns, a list dropped down among them, are owned on the host by the active window. A window whose owner is hidden is made with no owner and made again when the owner shows, because the host takes owned windows away with their owner.
- **The task bar.** Only an overlapped window owned by nothing, or a pop-up owned by nothing that has a caption, is on the host's task bar. It carries its title and its icon.
- **Menus and lists dropped down** are never activated by a press on the host (`WS_EX_NOACTIVATE`). Their owner keeps the host's activation while one is open.
- **The two z-orders.** The emulated order is laid on the host's windows with `SetWindowPos`, none activated, whenever it changes. When the emulated active window changes, its host window is brought forward with `SetForegroundWindow`. When the host gives one of the windows the keyboard and no press on it came with that, the engine is asked to switch to it (above). A press goes into the engine as any press does, and the engine activates as it always does. The host is not asked about a window whose owned window, or the window itself, is already active, or about a menu, a list or the switch window.
- **Coordinates.** The emulated screen's top left lies at the corner of the primary monitor's work area. Each pixel is `--scale` of the host's square, by default the monitor's scale rounded. A point of a host window is its window's rectangle's corner plus the point divided by the scale. A pointer held outside the window, which Windows still sends to the window that has the capture, lands beyond the rectangle as it should.
- **Moving and sizing.** When the engine hands a drag over, the left button still held, the host's own loop runs: `drag_window` for the caption, `drag_resize_window` for an edge or a corner. Sizing is held to `WM_GETMINMAXINFO`'s least and most by the host window's least and most sizes for as long as the drag lasts. The host window's position and size are reported to the engine as they change. When the host's loop ends, winit posts a release (`WM_EXITSIZEMOVE`), which ends USER's loop, and the engine places the window.
- **Minimized.** A window minimized in the engine is minimized on the host, at the size it goes back to. Restored from the host's task bar, the engine is asked to switch to it and restore it. Minimized by the host (a press on the task bar's button for an active window), it is sent `SC_MINIMIZE`. A host change the engine does not follow within two seconds, as when a program refuses `SC_MINIMIZE`, is put back to the engine's state.
- **A window off the screen.** Windows 3.1 lets a window go past the screen's edge, and the host shows it there at full size. The screen has no pixels beyond its edge, so that part of the window shows black. A maximized window's frame lies four pixels off the screen on each side ([[topic:window-states]]), so a maximized window has a thin black edge.
- **`--seamless-shots DIR`** saves each host window's pixels, as this program last put them in it, and a `windows.json`. The JSON has each window's emulated rectangle, kind, owner, place in the order and state. It also has the host's own word on it: where the host has it and how large, whether it is minimized, its place in the host's z-order, its owner, whether it is a task bar window, whether it takes no activation, and whether it is in the foreground. Nothing is read of the host's screen. **`--script FILE`** plays steps at set times: the pointer and keys at points of the emulated screen, the host's minimize, restore and activate, and a drag that moves the host window instead of running the host's loop.

### What the runs showed

Runs on Windows 11 from WSL, `--windows` a local copy of the installation, scale 1:

- **Reversi**: one host window at (4, 0), 320 by 384, on the task bar with Reversi's icon and in the foreground. Game's menu opened as a `#32768` host window at (8, 41), 65 by 82, owned by Reversi's host window, in front of it in the host's order, off the task bar and taking no activation. A scripted drag of the caption by (50, 30) went through `SC_MOVE` and the host's hand-over, and Reversi was placed at (54, 30). The minimize box minimized the host window (to Windows' parked place, `-32000`). Restored by the host, it was switched to and restored at (54, 30), 320 by 384. Minimized by the host, the engine minimized it, with the icon at (21, 408). A scripted size from the bottom-right corner by (40, 20) made it 360 by 404, and both its window and its host window came out at that size. Help, About made an `About Reversi` pop-up owned by Reversi's host window. The host bringing Reversi's own window forward left the dialog active in the engine and in front on the host.
- **Hearts**: the maximized main window at (-4, -4), 648 by 488. The opening dialog and Hearts' own owned window were each owned by its host window and stacked as in the engine. After the dialogs, Game's menu opened owned by it. Minimized by its box and restored by the host, it came back normal at (0, 0), 636 by 408, not maximized. That is what the engine's `SC_RESTORE` does with an icon that was maximized. Windows' own restoring of such an icon is not measured, so it is noted here and left as it is.
- **Notepad**: typing went into the edit control. Alt and F, then O, opened the Open dialog, owned and in front. A scripted drag of its caption moved it by (30, 40). The drives' combo box dropped its list as a `ComboLBox` host window owned by the Open dialog's, off the task bar and taking no activation.
- **On X** (WSLg), Reversi and its menu show. The window manager places the windows where it chooses, and the front end does not fight it each frame.

### What winit and the host allowed, and did not

- winit 0.30's `focus_window` on Windows presses and lets go of Alt through `SendInput` to win the foreground. The emulated machine would be given that Alt, and Windows 3.1 enters its menu bar on Alt let go. The front end calls `SetForegroundWindow` itself instead. When the host does not let this program take the foreground, the task bar button flashes.
- winit gives every window owned by nothing `WS_EX_APPWINDOW`, so `with_skip_taskbar` only takes the button off with `ITaskbarList`. That is why USER's own unowned windows are given an owner on the host.
- winit sets a window's extended styles again as it shows it, which clears `WS_EX_NOACTIVATE`. The front end sets it again after each showing.
- An undecorated winit window keeps `WS_CAPTION` and `WS_SIZEBOX` and draws no frame (its `WM_NCCALCSIZE`). Without a least size of its own, `DefWindowProc` would hold such a window to the host's least tracking size. Every host window is therefore given a least size of one pixel.
- `drag_window` posts `WM_NCLBUTTONDOWN` to the window. The host's loop of moving and sizing then runs inside the next pump of events, and the engine does not run until it ends. The window shows its old pixels while it is dragged, stretched as it is sized, and is drawn again once the engine has placed it.
- winit has no owner and no stacking on X in 0.30, and on X the release that ends a drag of the window manager's goes to the window manager. On X the engine keeps USER's own loop, with its outline drawn into the frame buffer. The outline shows only where it crosses a window.

## Not yet done

- **Stage 3, the screen's size.** The emulated screen is still the display driver's fixed size, 640 by 480 on the VGA, laid at the corner of the primary monitor's work area. A maximized window fills that rectangle, not the host's screen. Windows dragged past it are drawn black past the edge. A display driver of WinBox's own that reports the host desktop's size is the stage that would end this.
- **Stage 5, the mode chosen per program**, and stage 6, macOS and Wayland. On Wayland a client cannot place or stack its windows, so seamless mode needs XWayland.
- Alt and Tab, Alt and Escape, and Ctrl and Escape are the host's. Windows 11 takes Alt and Tab before the program sees it, so USER's switch window never shows in seamless mode. It would be presented as a window owned by the active one if it did.
- Windows with capture and no button held cannot see the pointer outside the host windows.
- Icons a program paints itself (Clock's) are not followed: the host shows the class icon, or `WM_QUERYDRAGICON`'s, or none.
- A host window changed by the host outside a drag is put back where the engine has it, on Windows. That covers snapping with the Windows key and arrows, and the host's own maximizing. The host's maximize is not taken as `SC_MAXIMIZE`.
- A system-modal window and [[fn:USER.LockInput]] hold only the emulated windows.
- The host's drag itself, the part of a real move or size between press and release, is left to be tried by hand. A script moves the host window directly and checks the hand-over and the placing. It cannot hold the host's real mouse button through the host's modal loop.
