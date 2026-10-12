---
kind: guide
name: Seamless windows (design)
summary: A design for the native front end — each top-level Windows 3.1 window shown as a window of the host, with the emulated desktop kept inside the engine and never shown, what it gives up, and what each host allows.
---

This page is a design, not a description of what winbox.js does today. Nothing on it is built yet. It states how the native front end (`crates/winbox-native`) could show each Windows 3.1 window as a window of its own on the host, the way a program of the host's would look, with no desktop behind it. The program still runs on the emulated machine, sees only its mounted drives, and is given nothing of the host.

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
