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

This needs a screen that is whatever size it is given. The Windows drivers (VGA, Super VGA, EGA, Hercules) each have fixed modes. A WinBox screen over the display mode's own driver is the host's size instead, divided by a whole scale ([below](#the-screens-size-as-built)).

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
3. **The screen's size.** A WinBox screen, the host desktop's size divided by a whole scale.
4. **Minimized windows** as host icons.
5. **The choice of mode** per program, so a program that needs the desktop opens in desktop mode.
6. **macOS**, then **Wayland** under XWayland.

None of this changes either engine. What seamless mode does differently is the host's drag, the switching keys and the icons. Each is named above and is in seamless mode alone, so the probes, the corpus and the sessions keep running in desktop mode as they do now.

## What is built

The first version follows stages 1 to 4 of the order above, on a Windows host. Desktop mode is unchanged and is still the default: every hook below does nothing unless the front end turns seamless mode on, and no probe, corpus run or session does.

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
- **The task bar.** Each program has one window on the host's task bar, carrying its title and its icon. Of the program's shown windows that no shown window owns, it is the first overlapped one, else the first pop-up (first by the window's index, which it keeps while it lives). Windows 3.1 has no task bar. A program's other windows are only kept off it, and are not owned on the host by the one on it, because the host would then hold them above it where Windows lets the program stack them as it will. SimTower's three palettes are pop-ups that nothing owns, and its main window may come in front of them. The front end takes the button away again each time it shows a window, since the shell gives a window shown its button back.
- **Menus and lists dropped down** are never activated by a press on the host (`WS_EX_NOACTIVATE`). Their owner keeps the host's activation while one is open.
- **The two z-orders.** The emulated order is laid on the host's windows with `SetWindowPos`, none activated, whenever it changes. When the emulated active window changes, its host window is brought forward with `SetForegroundWindow`. When the host gives one of the windows the keyboard and no press on it came with that, the engine is asked to switch to it (above). A press goes into the engine as any press does, and the engine activates as it always does. The host is not asked about a window whose owned window, or the window itself, is already active, or about a menu, a list or the switch window.
- **One program raised as a group.** When one of the windows gains the host's foreground (`WindowEvent::Focused`), by a press, by its task bar button, by the host's Alt and Tab, or by the front end bringing the active window forward, its program's windows are laid in front of every other window of the host's, in the emulated order: the frontmost at `HWND_TOP`, the rest each under the one before, none activated (`SWP_NOACTIVATE`, `SWP_NOOWNERZORDER`). The same is done when the emulated order or the active window changes while one of the windows has the foreground. The group is the windows of the focused window's task, which is the task whose one window is on the task bar, with every window owned on the host by one of them (its menus and lists dropped down). SimTower's three palettes are pop-ups its main window does not own; without this, activating the main window brought only it forward, and the palettes stayed behind whatever the user had used, with no task bar button to reach them by. Other programs' windows are left where the host has them. Windows 3.1 has all programs on one desktop, so one z-order would raise every program's windows together, but on the host the user picks one program at a time, as with the host's own programs. While none of the windows has the foreground, the order is laid among themselves only, with no window moved to the top, so nothing is put over the program the user is using. The emulated order itself is not changed by this, and no message is sent. The host's own activation still goes through the engine as before, and may put the main window above the palettes, as Windows 3.1 does when it is activated; the palettes then lie just behind it, above the host's other programs. `raised_group` in `seamless.rs` works the group out and is unit-tested with two programs.
- **Coordinates.** The emulated screen's top left lies at the corner of the rectangle around every monitor's work area ([below](#the-screens-size-as-built)). That corner is left of or above the primary monitor where another monitor lies there, so it may be negative in the host's coordinates. Each pixel is the scale's square of the host's pixels ([below](#the-screens-size-as-built)). A point of a host window is its window's rectangle's corner plus the point divided by the scale. A pointer held outside the window, which Windows still sends to the window that has the capture, lands beyond the rectangle as it should.
- **Moving and sizing.** When the engine hands a drag over, the left button still held, the host's own loop runs: `drag_window` for the caption, `drag_resize_window` for an edge or a corner. Sizing is held to `WM_GETMINMAXINFO`'s least and most by the host window's least and most sizes for as long as the drag lasts. The host window's position and size are reported to the engine as they change. When the host's loop ends, winit posts a release (`WM_EXITSIZEMOVE`), which ends USER's loop, and the engine places the window.
- **Minimized.** A window minimized in the engine is minimized on the host, at the size it goes back to. Restored from the host's task bar, the engine is asked to switch to it and restore it. Minimized by the host (a press on the task bar's button for an active window), it is sent `SC_MINIMIZE`. A host change the engine does not follow within two seconds, as when a program refuses `SC_MINIMIZE`, is put back to the engine's state.
- **A window off the screen.** Windows 3.1 lets a window go past the screen's edge, and the host shows it there at full size. The screen is now the host's desktop, so a window can be put anywhere a monitor shows and is drawn whole there. Only past the rectangle around the monitors, which no monitor shows, does the screen have no pixels; that part of a window is black, and is off every monitor too. A maximized window's frame lies four pixels off the screen on each side ([[topic:window-states]]); those pixels are beyond the work area as well.
- **Each window's pixels, and no more.** Each frame, the engine colours only each shown window's rectangle of the screen, with the cursor over it where it shows (`System::screen_rgb_cut`). It no longer colours the whole screen, which is now as large as the host's desktop.
- **`--seamless-shots DIR`** saves each host window's pixels, as this program last put them in it, and a `windows.json`. The JSON has each window's emulated rectangle, kind, owner, place in the order and state. It also has the host's own word on it: where the host has it and how large, whether it is minimized, its place in the host's z-order, its owner, whether it is a task bar window, whether it takes no activation, and whether it is in the foreground. Nothing is read of the host's screen. **`--script FILE`** plays steps at set times: the pointer and keys at points of the emulated screen, the host's minimize, restore and activate, and a drag that moves the host window instead of running the host's loop.

### The screen's size, as built

- **Sized from the host.** Before the program starts, the front end pumps winit's loop once, with no window made, to list the monitors (winit lists them only to a running loop). On Windows, each monitor's work area comes from `GetMonitorInfoW`'s `rcWork`, which leaves out a task bar; elsewhere it is the whole monitor. The screen is one rectangle around all of them, as Windows 3.1 knows of one screen only, divided by a whole scale and rounded down each way. A fraction would make the screen's pixels uneven on the host. 2560 by 1440 at 3 is 853 by 480; the host's column left over at the right, fewer pixels than the scale, is beyond the screen, and no window can be put there. A part of the rectangle no monitor covers, as between monitors of different sizes, is screen all the same: a window may be put there, and is not seen. Several monitors are divided by the same scale. The size is read once. A monitor added, taken away or changed later leaves the screen as it was (not yet followed).
- **The scale** (`seamless.rs`'s `choose_scale`) is the one control; the screen follows from it:
  - `--scale N` is taken as given.
  - `--resolution WxH` picks the scale whose width, the host's divided and rounded down, is nearest W, a tie going to the larger scale. The screen keeps the host's shape, and the program asks for the size it has. For an 8K monitor, 7680 by 4320, `1280x720` gives 7680 / 6 = 1280, scale 6, a screen of 1280 by 720. `1024x768` gives scale 8, 960 by 540, since 7680 / 8 = 960 is 64 short of 1024 and 7680 / 7 = 1097 is 73 over. On a 1920 by 1080 monitor, `1024x768` gives scale 2, 960 by 540.
  - Without either, the scale is the smallest that keeps the screen within 2048 a side (`SCREEN_TRIED`) and is at least the primary monitor's own scale factor, rounded. A 4K monitor, 3840 by 2160, is 2, which gives 1920 by 1080. An 8K monitor is 4, which also gives 1920 by 1080. A 1920 by 1080 monitor at 100% is 1.
- **Desktop mode** takes `--resolution WxH` as the screen's size exactly, through the same `System::set_screen_size`, and `--scale N` makes its window N of the host's pixels to each of the screen's. Without `--resolution` it is the display's own size, as always. Every probe, the corpus and every session run without it.
- **The most.** Each side is held to 16383 (`SCREEN_MOST`). A larger rectangle, as at a scale of 1 across three 8K monitors, is cut down to that around the primary monitor, starting at the primary monitor's left or top where it can, and the rest is off the screen. Past 2048 a side the front end warns on its standard error that programs of the time were rarely run so large. Why 16383:
  - Windows 3.1's coordinates are 16 bits, so nothing can lie past 32767.
  - Programs take a rectangle's middle as `(left + right) / 2` in 16 bits, which overflows when the sum passes 32767, past 16383 for a rectangle on the screen.
  - `MM_TWIPS` and `MM_HIMETRIC` reach as far in logical units as the millimetres the driver reports allow. Keeping the driver's 208 by 156 mm, as `SVGA256.DRV`'s own three tables do, keeps that reach the same at every size (below). A viewport that would pass 32767, the 8514/a's past 8255 across, has its window and viewport divided alike.
  - The drivers of the time stop at 1024 by 768 for Windows 3.1's own, and at 1280 by 1024 to 1600 by 1200 for others'.
- **What the program sees.** `System::set_screen_size` makes the display mode a WinBox screen of that size (`Display::at_resolution`). Its description says so: "WinBox screen, 1920x1080, over Super VGA, 640x480, 256 colours". Everything else stays the display mode's, its driver, fonts, metrics and colours included. Only what comes from the resolution changes, and the engine already takes all of that from the screen's size:
  - `GetDeviceCaps`'s `HORZRES` and `VERTRES`.
  - `SM_CXSCREEN`, `SM_CYSCREEN`, `SM_CXFULLSCREEN` and `SM_CYFULLSCREEN` (the height less a caption).
  - The desktop window's rectangle, USER's work area, a maximized window's size and place, `WM_GETMINMAXINFO`'s largest tracking size, and the cursor's bounds.
  - The centring of message boxes, the system error box and Alt and Tab's switch window, the placing of menus and lists dropped down at the screen's edge, and the wallpaper's centre.
  - The fixed mapping modes' viewports (below). Windows 3.1 has no `SM_CXMAXIMIZED`; a maximized window's size comes from the screen's.
- **The mapping modes, from the driver.** `SVGA256.DRV` holds three `GDIINFO` tables, for 640 by 480, 800 by 600 and 1024 by 768 (seg3 `06a2`, `0710` and `077e`, file offsets `4102h`, `4170h` and `41DEh`). [[read out]] They are static. As the driver loads (seg3 `00f1`-`012d`), it reads `[svga256.drv] resolution=` from `SYSTEM.INI`, keeps the low two bits in `[00FAh]`, and fails the load on nought. It also reads `dpi=`, 96 by default, into `[00FCh]`. `Enable` (seg3 `0800`), asked for the device's information, copies 6Eh bytes of the table that `[00FAh]` picks through the list at seg3 `07ee`. It then writes `[00FCh]` over `LOGPIXELSX` and `LOGPIXELSY` (`0876`-`087a`) and changes nothing else. The three tables differ only in `HORZRES` and `VERTRES` and in the mapping modes' viewports. The millimetres stay 208 by 156, the aspect 36, 36 and 51, and the windows' extents 2080 by 1560, 20800 by 15600, 325, 1625 and 2340. The metric viewports are the resolution itself. The English and twips viewports are 254, 318 and 407 for `MM_LOENGLISH`, and 127, 159 and 203 for `MM_HIENGLISH` and `MM_TWIPS`.
- [[inferred]] **At any other size**, by the same relation (`display::derived_extents`): each window's extent is kept, as the millimetres and the inch are kept. Each viewport across is scaled by the widths and each down by the heights, rounded to the nearest. From the 640 by 480 table, this gives the 800 by 600 table exactly, and the 1024 by 768 table but for `MM_LOENGLISH`: 254 scaled is 406.4, and the driver has 407. The driver's own table is taken wherever the size is one of its three (`Display::extents_at`), and the unit tests reproduce all three. Where the host's shape is not 4:3, the English viewports across and down differ, as the metric ones already do, because the millimetres stay 208 by 156. Pixels are then not square by those numbers, though the aspect still says they are. Each driver here keeps the relation of its own table. The VGA, the Super VGA, the EGA, the Hercules and the 8514/a each have one resolution and one table, and the XGA's viewports are the monitor's pixels an inch ([[topic:display-drivers]]). Each is scaled from its one table in the same way, which is beyond anything its driver does.
- **Maximize** fills the whole emulated screen, which is the rectangle around every monitor, as Windows 3.1 maximizes to its one screen. On several monitors, a maximized window spans them all. Filling only the monitor the window is on would change what `WM_GETMINMAXINFO` answers and where USER puts the window, which Windows 3.1 has no rule for, so it is not done.

### What the runs showed

Runs on Windows 11 from WSL, `--windows` a local copy of the installation, scale 1:

- **Reversi**: one host window at (4, 0), 320 by 384, on the task bar with Reversi's icon and in the foreground. Game's menu opened as a `#32768` host window at (8, 41), 65 by 82, owned by Reversi's host window, in front of it in the host's order, off the task bar and taking no activation. A scripted drag of the caption by (50, 30) went through `SC_MOVE` and the host's hand-over, and Reversi was placed at (54, 30). The minimize box minimized the host window (to Windows' parked place, `-32000`). Restored by the host, it was switched to and restored at (54, 30), 320 by 384. Minimized by the host, the engine minimized it, with the icon at (21, 408). A scripted size from the bottom-right corner by (40, 20) made it 360 by 404, and both its window and its host window came out at that size. Help, About made an `About Reversi` pop-up owned by Reversi's host window. The host bringing Reversi's own window forward left the dialog active in the engine and in front on the host.
- **Hearts**: the maximized main window at (-4, -4), 648 by 488. The opening dialog and Hearts' own owned window were each owned by its host window and stacked as in the engine. After the dialogs, Game's menu opened owned by it. Minimized by its box and restored by the host, it came back normal at (0, 0), 636 by 408, not maximized. That is what the engine's `SC_RESTORE` does with an icon that was maximized. Windows' own restoring of such an icon is not measured, so it is noted here and left as it is.
- **Notepad**: typing went into the edit control. Alt and F, then O, opened the Open dialog, owned and in front. A scripted drag of its caption moved it by (30, 40). The drives' combo box dropped its list as a `ComboLBox` host window owned by the Open dialog's, off the task bar and taking no activation.
- **On X** (WSLg), Reversi and its menu show. The window manager places the windows where it chooses, and the front end does not fight it each frame.

Runs of the screen's size, on Windows 11 with one 1920 by 1080 monitor at scale 1 (its work area the whole monitor), from WSL, with `--seamless-shots` (`--resolution` runs in `shots-s3c`; `C:\Users\Public\winbox-test\shots-s3a`, `shots-s3r`, `shots-s3n`):

- **SimTower** (`vga256`, sound): the screen was 1920 by 1080, origin (0, 0). SimTower's title picture is a pop-up the size of the screen, 1920 by 1080, with its box centred at (830, 481). After the box, the main window was 815 by 575 at (204, 53). At 640 by 480 it had been 436 by 424; SimTower sizes it from the screen. A scripted drag of its caption by (880, 440) put it at (1084, 493), its right edge at 1899 and its bottom at 1068. Its shot is drawn whole there, menus, sky, city and scroll bars, with no black past the old 640 by 480.
- **The group raised**: with the four windows put at the bottom of the host's order (the script's `lower`: host orders 276 to 279, behind every other program), the main window minimized and restored by the host brought all four back in front of the host's other windows (orders 27 to 30, with only the host's topmost windows in front), in the emulated order. Afterwards, palette 6 was the active window, both in the engine and on the host. The build before this change does the same after a minimize and restore, so it is not caused by the raising (see [Not yet done](#not-yet-done)).
- **Reversi**: its default size is now 960 by 864. Its maximize box made it 1928 by 1088 at (-4, -4), the whole screen and its frame beyond it. Help, About made the dialog at (32, 47), where its template puts it against its owner.
- **SimTower with `--resolution 1024x768`**: scale 2, a screen of 960 by 540, each pixel two of the host's. The main window was 756 by 484 at (204, 53), and its host window 1512 by 968 at (408, 106).
- **Desktop mode with `--resolution 800x600`** (Notepad on `vga`): the shot is 800 by 600, Notepad's window sized to it.
- **Notepad**: its default size is 1912 by 1008. Typing, then File, New, made the "save the changes?" box 364 by 153 at (776, 464), centred on the 1920 by 1080 screen.

### What winit and the host allowed, and did not

- winit 0.30's `focus_window` on Windows presses and lets go of Alt through `SendInput` to win the foreground. The emulated machine would be given that Alt, and Windows 3.1 enters its menu bar on Alt let go. The front end calls `SetForegroundWindow` itself instead. When the host does not let this program take the foreground, the task bar button flashes.
- winit gives every window owned by nothing `WS_EX_APPWINDOW`, so `with_skip_taskbar` only takes the button off with `ITaskbarList`. That is why USER's own unowned windows are given an owner on the host.
- winit sets a window's extended styles again as it shows it, which clears `WS_EX_NOACTIVATE`. The front end sets it again after each showing.
- An undecorated winit window keeps `WS_CAPTION` and `WS_SIZEBOX` and draws no frame (its `WM_NCCALCSIZE`). Without a least size of its own, `DefWindowProc` would hold such a window to the host's least tracking size. Every host window is therefore given a least size of one pixel.
- `drag_window` posts `WM_NCLBUTTONDOWN` to the window. The host's loop of moving and sizing then runs inside the next pump of events, and the engine does not run until it ends. The window shows its old pixels while it is dragged, stretched as it is sized, and is drawn again once the engine has placed it.
- winit has no owner and no stacking on X in 0.30, and on X the release that ends a drag of the window manager's goes to the window manager. On X the engine keeps USER's own loop, with its outline drawn into the frame buffer. The outline shows only where it crosses a window.

## Not yet done

- **The screen's size when the monitors change.** The screen is sized once, before the program starts. A monitor added, taken away or rescaled during the run is not followed, and Windows 3.1 has no message that would tell a program its screen changed. A window past the rectangle around the monitors, in the host's pixels left over by the rounding, or past the 16383 most, is black there.
- **Activation after the host restores a window.** After the host minimizes and restores SimTower's main window, one of its palettes ends up active, in the engine and on the host. This was so before the screen's size changed. Which of the host's activations goes to the engine there is not yet traced.
- **Stage 5, the mode chosen per program**, and stage 6, macOS and Wayland. On Wayland a client cannot place or stack its windows, so seamless mode needs XWayland.
- Alt and Tab, Alt and Escape, and Ctrl and Escape are the host's. Windows 11 takes Alt and Tab before the program sees it, so USER's switch window never shows in seamless mode. It would be presented as a window owned by the active one if it did.
- Windows with capture and no button held cannot see the pointer outside the host windows.
- Icons a program paints itself (Clock's) are not followed: the host shows the class icon, or `WM_QUERYDRAGICON`'s, or none.
- A host window changed by the host outside a drag is put back where the engine has it, on Windows. That covers snapping with the Windows key and arrows, and the host's own maximizing. The host's maximize is not taken as `SC_MAXIMIZE`.
- A system-modal window and [[fn:USER.LockInput]] hold only the emulated windows.
- The host's drag itself, the part of a real move or size between press and release, is left to be tried by hand. A script moves the host window directly and checks the hand-over and the placing. It cannot hold the host's real mouse button through the host's modal loop.
