---
kind: topic
name: Switching programs
summary: How Windows 3.1 moves between programs from the keyboard and the desktop -- Control and Escape and the Task List, TASKMAN.EXE; a double click on the desktop; the hot keys Program Manager gives the programs it starts; SwitchToThisWindow; Print Screen -- read out of USER and TASKMAN and recorded with keys put in as the keyboard driver puts them.
probes: [tasklist, hotkey, prtsc]
---

Windows 3.1 has no task bar. A program is switched to from the Task List, a dialog box of its own program, `TASKMAN.EXE`, which `DefWindowProc` starts when a window is sent `WM_SYSCOMMAND` with `SC_TASKLIST`. Control and Escape ask for it, and so does a double click on the desktop. A window may also be given a **hot key**, a key that switches to it from anywhere. Print Screen copies the screen to the clipboard.

These are keys USER's system queue takes for itself ([[topic:system-queue]]): it looks at them as a program comes to them, before it gives them a window. Everything here is [[read out]] of `USER.EXE` unless marked; offsets are seg1's. [[probe:tasklist]], [[probe:hotkey]] and [[probe:prtsc]] put their keys in through `KEYBD_EVENT`, as the keyboard driver does, and both engines agree with all of their records.

## Keys the queue takes for itself

A look at the input comes to each key in the queue in turn (`2aa2`). For a press, `WM_KEYDOWN` or `WM_SYSKEYDOWN`, before the key is given a window (`3090`-`3178`):

- Any press but Alt's clears the flag that Alt was pressed alone (`30a5`). `DefWindowProc` opens the menu bar when Alt is let go with that flag still set ([[topic:keyboard-input]]), so Alt and Print Screen open no menu.
- **Escape with Control down**, as [[fn:USER.GetKeyState]]'s table has it (`30b0`-`30eb`). `WM_SYSCOMMAND` with `SC_TASKLIST` and an `lParam` of nought is posted to the active window, unless that is the system-modal window, or none is active, or USER's own system error box is up (`[0E0h]`). The key is taken and thrown away (`4e2d`), whether the look takes it or only looks. The release goes on to the window with the focus. Escape is made a system key as it is taken while Control is down (`3192`), so the release is `WM_SYSKEYUP`.
- **Print Screen**, `VK_SNAPSHOT`, is taken and thrown away first, and then copied (`30ee`-`311e`; below). The keyboard driver gives it scan code 1 for the key alone, and nought with Alt, when the key's scan code is SysRq's (`KEYBOARD.DRV` seg10 `00fa`-`013f`). USER copies the whole screen for 1, the desktop window's, and the active window for anything else.
- **A hot key**, when no window is system-modal and no system error box is up, and at least one window has one (`3121`-`3178`). The key and Shift, Control and Alt as the table has them make a word: the virtual key, with 100h for Shift, 200h for Control and 400h for Alt. Where a window shown has that hot key (seg14 `04e3`), `WM_SYSCOMMAND` with `SC_HOTKEY` and that window's handle in `lParam` is posted to the active window. The key is taken and thrown away.

[[measured]] [[probe:tasklist]], window `T` active with the focus, its window procedure keeping `SC_TASKLIST` from `DefWindowProc`:

- Control pressed, Escape pressed and let go, Control let go: `T` takes `WM_KEYDOWN` for Control, `WM_SYSKEYUP` for Escape, `WM_SYSCOMMAND` with `F130h` and nought, and `WM_KEYUP` for Control. The command comes after Escape's release. The look that threw the press away read on and found the release, and what was posted waits for the next look.
- Escape pressed with Control already taken, then [[fn:USER.PeekMessage]] with `PM_NOREMOVE`: it finds nothing. The press was thrown away and the command posted as the look read the input, and the look does not go back to what was posted. The command comes next, then the release.

The press of Control and Escape goes to the [[topic:hooks]] journal record hooks as it is thrown away, as any event taken does; the keyboard hooks never see it.

## The Task List

`DefWindowProc` carries out `SC_TASKLIST` (seg1 `050c`-`05f6`): with the hourglass showing, it starts `TASKMAN.EXE` in the Windows directory with [[fn:KERNEL.WinExec]], shown normally. The command line is the point in `lParam`, as `" %d %d"` writes its two words. Where that cannot be started, it starts `TASKMAN.EXE` wherever `WinExec` finds it.

The desktop window's procedure (seg1 `9e6b`) hands a double click on it, `WM_LBUTTONDBLCLK`, to `DefWindowProc` as `SC_TASKLIST` with the point. [[measured]] Its class's style is `CS_DBLCLKS`, and it belongs to the first program: [[fn:USER.GetWindowTask]] of it answers the probe's task, which runs as the shell. [[read out]] The first program to call `InitApp` takes the desktop window's queue as its own (seg5 `03ae`-`03d8`). A press over no window is the desktop window's, in its client area (seg1 `2cfd`-`2d29`), and is not made active (`2998`).

`TASKMAN.EXE` is read out here too (its seg1). It runs no second copy. It reads an x and a y from its command line, and shows its dialog box 10, "Task List", with [[fn:USER.DialogBox]]:

- **Its place.** For (0, 0), the middle of the screen. Otherwise across at x less half the dialog's *height*, and down at y less twice `SM_CYCAPTION`, each kept on the screen.
- **Its list**, `100`, not sorted: each window at the top shown, owned by none and with a caption, front to back as [[fn:USER.GetWindow]] goes, the dialog itself left out. Each item's data is the window's handle. The first is selected. The dialog is made topmost.
- **Switch To**, `IDOK`, or a double click in the list: the dialog ended, then the window chosen, or the pop-up it last had active ([[fn:USER.GetLastActivePopup]]), switched to with [[fn:USER.SwitchToThisWindow]] as by Alt and Tab, unless it is disabled, when a beep sounds.
- **End Task**, `101`: the dialog ended; the window switched to as Switch To would, unless [[fn:KERNEL.IsWinOldApTask]] says its task runs a DOS program; then `WM_CLOSE` posted to it, unless it is disabled.
- **Cancel**, `IDCANCEL`, and the dialog losing the activation, `WM_ACTIVATEAPP` with nought, which posts it `WM_USER+100`: the dialog ended.
- **Cascade** and **Tile**, `102` and `103`: the dialog hidden, then [[fn:USER.CascadeChildWindows]] or [[fn:USER.TileChildWindows]] of the desktop window -- the second side by side, or one above another with Shift held -- and the dialog ended.
- **Arrange Icons**, `104`: the dialog hidden, [[fn:USER.ArrangeIconicWindows]] of the desktop window, and the dialog ended.

[[measured]] [[probe:tasklist]], with `T`, "Probe T", at (40, 40) and `W`, "Probe W", at (360, 60):

- Control and Escape passed on to `DefWindowProc`: the Task List shows in the middle of the screen, from (175, 138) to (465, 341). It is active, another task's, and lists "Probe T" and "Probe W", the first selected.
- The desktop window sent a double click at (100, 100), `W` minimized: the Task List at (0, 60). Across, 100 less half its height of 203 is less than nought. It lists "Probe W" once: an icon's title is not a window [[fn:USER.GetWindow]] goes to. Switch To `W`: `W` is active, sent `SC_RESTORE`, and restored.
- End Task for `W`: `W` is active, and takes `WM_CLOSE`.
- Cascade: `W` at (0, 0) and `T` at (22, 22), each 486 by 326. Tile: `T` on the left half of the screen, `W` on the right.
- Arrange Icons, `W` minimized and moved to (300, 300): `W` back at (21, 408).
- The left button pressed and let go twice over the desktop at (630, 10): the Task List at (350, 0), kept on the screen.

A message sent from another program ends the dialog. The dialog's loop takes nothing in between, and finds the dialog ended once the message is answered. [[inferred]] The loop waits with `WaitMessage` (seg25 `0899`), and what makes the wait return then is not read out; both engines end their wait there.

## SwitchToThisWindow

[[fn:USER.SwitchToThisWindow]] (seg23 `0ceb`) brings the window to the top, made active, with the deferred [[fn:USER.SetWindowPos]]. A switch not by Alt and Tab, its second argument nought, also sends the window that was active to the bottom, without activating it, unless that window is topmost or no other window could be switched to. A switch by Alt and Tab sends a minimized window `SC_RESTORE`.

The window Alt and Escape would switch to next (seg23 `0c58`) comes from the active window's own at the top, front to back and round again. It is a window shown, and not topmost where topmost ones are left out. Its root owner must have last had it active, and that pop-up must not be disabled.

## Hot keys

[[fn:USER.DefWindowProc]] keeps a table of hot keys (seg14 `0544`; at `[174h]`, a word pair for each: the window and its key, with the count at `[176h]`).

- `WM_SETHOTKEY` (32h) gives the window in the message the key in `wParam`, in place of any it had. Nought takes its key away, the last pair moved into its place. It answers 1, or 2 where another window shown already had the key; both keep it. It answers nought for a child, and the low word -1 for Escape, Space or Tab.
- `WM_GETHOTKEY` (33h) answers the window's key, or nought.
- A window at the top destroyed loses its key (seg8 `0e09`).
- `SC_HOTKEY` (seg1 `068a`): the window in `lParam`, or the pop-up it last had active where that is a window, switched to with `SwitchToThisWindow` as by Alt and Tab.

Program Manager gives each program it starts with a shortcut key that key with `WM_SETHOTKEY` (`PROGMAN.EXE` seg5 `036e`-`037c`).

[[measured]] [[probe:hotkey]]: `T` given Control, Alt and K answers 1, and `WM_GETHOTKEY` answers `64Bh`; `W` given the same, 2. Escape, Space and Tab answer `FFFFh`, and leave `T`'s key as it was; a child, nought. Control, Alt and K pressed with `W` active: `W` takes Control and Alt, not K's press, then K's release and `WM_SYSCOMMAND` with `F150h` and `T`. `T` is then active and takes Alt's and Control's releases. With `T` hidden, the keys go to `W`, and Control, Alt and K types no character. J alone, given as a hot key, is one too. With `T` minimized, `T` is sent `SC_RESTORE`. A window destroyed has no hot key.

## Print Screen

USER copies a window, or the screen, to the clipboard as a bitmap (seg41 `06b0`):

- The window at the top the window lies in is copied. Nothing is done where any window has the clipboard open (`[16Ch]`).
- The clipboard is opened for the desktop window and emptied.
- As much of the window's rectangle as is on the screen is copied, with [[fn:GDI.BitBlt]] and `SRCCOPY`, from a DC of the whole window ([[fn:USER.GetWindowDC]]). It goes into a bitmap compatible with that DC, or into a monochrome one where that cannot be made.
- The bitmap is put on the clipboard as `CF_BITMAP`, and on a palette device the system palette as `CF_PALETTE`.
- The clipboard is closed and left with no owner (`08ec`). Where the bitmap could not be made, a message box says so (string `67h`).

[[measured]] [[probe:prtsc]]:

- Print Screen alone: the clipboard holds `CF_BITMAP` alone, 640 by 480, with four planes of one bit, of the screen as it shows; [[fn:USER.GetClipboardOwner]] answers nought. `T` takes only the release.
- Alt and Print Screen: a bitmap 300 by 200 of `T`, frame and all. `T` takes `WM_SYSKEYDOWN` for Alt, `WM_SYSKEYUP` for Print Screen and `WM_KEYUP` for Alt. No menu opens.
- `T` moved to (-50, -30): 250 by 170, of what shows.
- The clipboard held open by `T`: nothing is copied.
- A `PeekMessage` with `PM_NOREMOVE` that comes to the press copies the screen, and finds nothing.

## Alt and Tab, Alt and Escape

`DefWindowProc` sends the active window `WM_SYSCOMMAND` for a system key with Alt down (seg1 `57a7`): `SC_PREVWINDOW` with Shift held, else `SC_NEXTWINDOW`, with the key in `lParam`. This happens for Tab, Escape and F6. For both commands, `DefWindowProc` calls a loop of its own with the key (seg23 `0932`):

- It captures the mouse to the active window (`0951`), and notes that window at `[1A8h]`.
- For Escape, the window to go to is the next `0c58` finds, or the one before with Shift (`0973`-`09a9`). For Tab and F6 it starts from the active window; F6 moves among the windows of one task (seg13 `0f2b`).
- It then takes the keys itself with USER's own look (`0a2f`-`0b46`), until Alt is let go or another key ends it, and switches to the window it came to.
- Tab sets `[1B0h]` while the loop runs, and calls `052d` for each window it comes to. [[inferred]] That is where the box `CoolSwitch` asks for is shown ([[topic:system-parameters]]); `052d` is not read out.

Not yet followed by winbox.js: neither engine runs the loop. Alt and Tab and Alt and Escape do nothing beyond what any system key does.

## In winbox.js

`src/win16/user/task-list.ts` and `crates/winbox-win16/src/task_list.rs` take the keys for the queue (`queueTakesKey`, `queue_takes_key`). They also carry out `SC_TASKLIST` and `SC_HOTKEY`, keep the hot keys, copy for Print Screen, and give the desktop window its procedure. `TASKMAN.EXE` is the installation's own, run as Windows runs it. The desktop window is the first program's; where that program has ended -- Windows itself would have ended with its shell -- it is no task's, and any task takes what comes for it. A page's Print Screen is `VK_SNAPSHOT`, with the scan code the keyboard driver would give.

Not yet followed:

- The palette put on the clipboard for Print Screen on a palette device, and the message box where the bitmap cannot be made.
- The hourglass while `TASKMAN.EXE` starts.
- The loop for Alt and Tab and Alt and Escape, above.
- The desktop window's procedure beyond the double click: it paints its own background for `WM_ERASEBKGND` and answers `WM_PALETTECHANGED` (`9e96`-`9f42`), which the raster desktop does in its own way.
