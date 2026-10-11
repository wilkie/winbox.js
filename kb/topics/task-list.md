---
kind: topic
name: Switching programs
summary: How Windows 3.1 moves between programs from the keyboard and the desktop -- Control and Escape and the Task List, TASKMAN.EXE; a double click on the desktop; the hot keys Program Manager gives the programs it starts; SwitchToThisWindow; Print Screen; Alt and Tab, its box, and Alt and Escape -- read out of USER and TASKMAN and recorded with keys put in as the keyboard driver puts them.
probes: [tasklist, hotkey, prtsc, alttab]
---

Windows 3.1 has no task bar. A program is switched to from the Task List, a dialog box of its own program, `TASKMAN.EXE`, which `DefWindowProc` starts when a window is sent `WM_SYSCOMMAND` with `SC_TASKLIST`. Control and Escape ask for it, and so does a double click on the desktop. A window may also be given a **hot key**, a key that switches to it from anywhere. Alt and Tab goes round the programs, showing each in a box while Alt is held, and Alt and Escape sends the active one to the back. Print Screen copies the screen to the clipboard.

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

Everything here is [[read out]] of `USER.EXE` unless marked; offsets are seg23's unless named. [[probe:alttab]] puts its keys and the mouse in through `KEYBD_EVENT` and `MOUSE_EVENT`, writes what seven windows at the top are handed, and reads the screen with [[fn:GDI.GetPixel]] from a message filter hook while the loop runs. Both engines agree with all 534 of its records.

### The command

`DefWindowProc` takes a system key with Alt down (seg1 `61be`, then `578d`). For Tab, Escape and F6 it **sends** the active window `WM_SYSCOMMAND` with the key in `lParam` (seg1 `57a7`-`57cc`): `SC_NEXTWINDOW` (`F040h`) with Shift held, as [[fn:USER.GetKeyState]] has it, and `SC_PREVWINDOW` (`F050h`) without -- the other way about from their names. A repeated press sends it too. [[measured]] Alt and Tab gives `F050h` and 9; Alt, Shift and Tab `F040h`.

`DefWindowProc` carries out both commands alike (seg1 `047d`): the loop below, with the key in `lParam`'s low word. While a window is system-modal it does nothing for either (seg1 `038c`-`03a5`, its table at `03aa`). [[measured]] With the probe's window system-modal, the command is sent and nothing else happens; the keys go on to the window as they would.

### The loop

The loop (`0932`-`0c3c`) is one call of `DefWindowProc`'s, in the active window's task:

1. In 386 enhanced mode, it calls seg1 `1799` with 1 (`0943`), and with nought as it ends (`0b5b`); not read further. It captures the mouse to the active window, USER's own way (seg1 `28cd` with 4, `0951`), and notes the window at `[1A8h]`, the active window's queue, and the count of changes of active window (`[112h]`, which seg1 `37ee` adds to once an activation's messages are sent and the focus has moved).
2. **Escape**: the window to go to is the next `0c58` finds from the active window, leaving out topmost windows, or the one before with Shift; with none, the active window (`0973`-`09a9`). Nothing is shown.
3. **F6**: the next window of F6's walk (below) that is the active window's task's (`09b2`-`09dd`). Nothing is shown.
4. **Tab**: `[1B0h]` set, and the next window `0c58` finds from the window it came to, topmost ones too, or the one before with Shift. Where it is another, it is shown (`052d`, below), and is the window come to (`09e5`-`0a21`).
5. Then the loop looks at each message where it waits, with `PM_NOREMOVE` (seg1 `2440`), waiting with [[fn:USER.WaitMessage]] for one. It hands it to the message filter hooks with code 6, `MSGF_NEXTWINDOW` ([[topic:hooks]]); one they take is looked at again. A change of active window meanwhile, the count moved, cancels (`0a45`).
6. A key pressed with Alt, `WM_SYSKEYDOWN`, other than Tab, Escape or Shift, once Tab was pressed, cancels, and is left where it is (`0a61`).
7. What the message is (`0a83`-`0bde`):
   - `WM_KEYDOWN`, `WM_KEYUP`, `WM_SYSKEYUP`, `WM_SYSCHAR`, `WM_MOUSEMOVE`: taken. A release of Alt ends the loop, at the window come to, once Tab was pressed; otherwise nothing. A release of Escape or F6 cancels once Tab was pressed; otherwise it ends the loop at the window come to, as a switch by Escape or by F6.
   - `WM_SYSKEYDOWN` of Tab, Escape, F6 or Shift: taken. Tab goes on to the next window, from the one come to, as in 4.
   - `WM_SYSKEYDOWN` of any other key, Tab not pressed: the loop ends at the window come to, as by Escape where Escape found one; the key is left where it is.
   - A button of the mouse pressed or let go: the loop ends at the window come to; the message is left where it is.
   - Anything else: taken, translated and dispatched ([[fn:USER.TranslateMessage]], [[fn:USER.DispatchMessage]]).
8. Cancelled (`0b46`): the active window is shown as Tab shows a window, and the loop ends at it.
9. At the end (`0b54`-`0c33`): the mouse let go of ([[fn:USER.ReleaseCapture]], which makes the mouse move where it is: [[topic:mouse-input]]); `[1B0h]` cleared; the window switched to (below). Where the active window is then the one come to and the current task runs a DOS program ([[fn:KERNEL.IsWinOldApTask]]), it is posted 29h, which nothing documents. Where the active window is minimized: posted `WM_SYSCOMMAND` with `SC_RESTORE` if Tab was pressed and the loop did not end by Escape or F6; otherwise its icon's title is shown again (seg1 `6de3`: `WM_SHOWWINDOW` to the title, and it drawn).

**The next window** (`0c58`), from the window at the top a window lies in (seg2 `0ab8`): front to back from it with [[fn:USER.GetWindow]], or back to front, round from the last to the first, until it comes back to where it started, which is none. A window is passed over that is USER's switch window (`[1AAh]`), or hidden, or topmost where topmost ones are left out, or whose last active pop-up (`[38h]` of its structure) is disabled. One owned by none is the next only if it is its own last active pop-up; one owned, only if its root owner's last active pop-up is it. So a window whose last active pop-up is a dialog box is passed over for the dialog box. Icons' titles are owned by their icons, and are passed over so.

**F6's walk** (seg13 `0f2b`, `0edd`, `0f07`) goes through the windows at the top in the order their owners make: each window, then the first window it owns, front to back; with none, the next owned by its own owner after it; with none, up to the owner, and so on, the windows owned by none being the top level of it, round from the last to the first. With Shift, it goes back. It passes over a window hidden, one disabled, and an icon's title, and gives none where it comes back to where it started. The loop goes on until a window of the active window's task.

[[measured]] [[probe:alttab]], `A` active at the front, then `P` (a pop-up owned by `B`, which was made active as it was made, so that `B`'s last active pop-up is `P`), `B`, `E` hidden, `F` disabled, `C` and `D`, an icon; the keys all put in before the loop runs:

- Alt, Tab, Tab let go, Alt let go: the loop sees `WM_SYSCHAR` for Tab (the program translated its press before `DefWindowProc` had it), `WM_SYSKEYUP` for Tab and `WM_KEYUP` for Alt, and switches to `P`, passing `B` over for it. `P` comes to the front and `B` with it.
- Tab twice: `C`, `E` and `F` passed over. Three times: `D`, which is posted `SC_RESTORE`, and restored.
- Alt, Shift and Tab: `D`, the one before `A` round the order.
- `B` made active before, and so its own last active pop-up: Alt and Tab goes to `B`, `P` coming to the front with it.
- Alt and Escape: `P` active, and `A` sent to the back after `D`. The loop sees `WM_SYSCHAR` and `WM_SYSKEYUP` for Escape, and the release of Alt goes to `P`. Alt, Shift and Escape: `D` active, `A` where it was, `D` not restored; Shift's and Alt's releases go to `D` as `WM_SYSKEYUP`.
- Alt, Tab, Escape: the loop takes Escape's press and cancels at its release; `A` stays active, and takes the release of Alt.
- Alt, Tab, X: the loop cancels at X's press, which goes on to `A`: `WM_SYSKEYDOWN`, `WM_SYSCHAR` and `SC_KEYMENU` with `x`.
- Alt, Tab, and the left button pressed and let go over `C`: the loop sees `WM_LBUTTONDOWN`, with a `wParam` of nought, and switches to `P`. The press is then `C`'s, hit-tested again: `C` is asked `WM_MOUSEACTIVATE`, made active and handed the press and the release.
- Alt and F6: `B`, the next of the walk, all seven windows being the probe's; `P` comes to the front with it. The loop sees only F6's release.

### The box

With `CoolSwitch` on (`[1AEh]`; [[topic:system-parameters]]), Tab shows the window it comes to in a box in the middle of the screen (`052d`, the box at `060e`-`0865`). The box is USER's **switch window**, `[1AAh]`, made as USER starts (seg3 `1a3a`-`1a74`): of class `8003h`, `#32771`, a pop-up made disabled, 10 by 10 at (0, 0), and topmost. Its class is `CS_SAVEBITS`, `CS_HREDRAW` and `CS_VREDRAW`, with the arrow (seg3 `198b`-`19c4`), and its procedure (seg1 `62d6`) answers `WM_ERASEBKGND` with nought and hands everything else to `DefWindowProc`: it draws nothing of itself. It is the `#32771` that [[probe:showseq]] and [[probe:showmin]] see windows put after at the front.

- **Its place**: 50 of the System font's average widths across (`[522h]`, as [[fn:USER.GetDialogBaseUnits]] has it), and down the larger of eight `SM_CYBORDER`s and `SM_CYICON`, and five of the font's heights (`[52Ah]`); in the middle of the screen, the halves rounded toward nought. The switch window is put there, topmost and not made active, while it is hidden.
- **Alt down**: the box is shown only while Alt is down as [[fn:USER.GetAsyncKeyState]] has it (`06ba`, again at `06f5` once the switch window is shown, before drawing). Keys put in all at once switch with no box: [[measured]] none of the probe's cases with Alt let go before the loop runs drew anything.
- **Shown**: with `SW_SHOWNOACTIVATE`, then [[fn:USER.UpdateWindow]]; drawn on a DC of it.
- **Its frame**, the first time in a loop only (`039a`): a pixel of `COLOR_WINDOWFRAME` round it (seg1 `8ca6`, with 30h: a frame `SM_CXBORDER` wide, the sixth system brush, copied); `COLOR_BTNFACE` within; and three borders in from that, a sunken edge a border wide -- the top and the left in `COLOR_BTNSHADOW`, the bottom and the right in `COLOR_BTNHIGHLIGHT`, drawn in that order, so that the right overlaps the top's last pixel.
- **The title**: the window text of the window's root owner, at most 48 characters (`071b`), in the System font, `COLOR_BTNTEXT` on `COLOR_BTNFACE`, by [[fn:GDI.ExtTextOut]] with `ETO_OPAQUE` and `ETO_CLIPPED` in the rectangle nine borders in from the box's edges. Its part for the icon is a quarter of that rectangle's width, or two borders and `SM_CXICON` where that is more. The text starts at the larger of that part's end and the place that centres it in the rectangle; its top is half of what the font's height leaves of the box's height.
- **The icon**: of the root owner's class, or the one `WM_QUERYDRAGICON` answers it (sent only where the class has none), or USER's Windows flag (`[528h]`, its icon `7F87h`), drawn with [[fn:USER.DrawIcon]] in the middle of its part and of the rectangle's height. A class's `IDI_APPLICATION` shows as the flag, as an icon does.

[[measured]] [[probe:alttab]], Alt let go from the hook only after the loop had looked at every Tab, the box from (120, 200) to (520, 280) on the VGA: a black frame; light grey within; the edge from (124, 204) to (516, 276), dark grey at the top and left, white at the bottom and right; the Windows flag at (160, 224), clipped at its transparent edge; the title in black from about (290, 232). For `C`, whose class has no icon, the loop sends `WM_QUERYDRAGICON` as the box is drawn, and `DefWindowProc`'s nought gives the flag. The switch window shown makes the mouse move where it is: a `WM_MOUSEMOVE` the loop takes after the keys put in before it, and before Alt's release put in after.

### CoolSwitch off

With `CoolSwitch` off (`000e`, `00c9`-`02ff`), Tab shows the window itself, over all the others:

- The switch window is hidden, and the window shown before -- the active one the first time -- drawn again as not active: its frame, through a DC of the whole window (seg1 `9f5c` with 3 and nought), or its icon's title (seg1 `6984`).
- What other windows cover of the window -- its rectangle on the screen, less the visible region of a DC of the whole window -- is worked out as a region; for an icon, of its title.
- The switch window is made topmost and put over the box about that region, not made active and not drawn, and shown.
- Through that region, the switch window is filled with the window's class brush ([[fn:USER.FillWindow]]; the brush at seg1 `6355`: a system colour's brush for 1 to 21). Then, through the window's whole rectangle on the screen, its frame is drawn as active -- or its icon's title as active -- with the DC's origin at the window's corner.

[[measured]] [[probe:alttab]], `CoolSwitch` set off with [[fn:USER.SystemParametersInfo]]: `B`, under `A` and `P`, shows whole, its caption active and its client area white where they covered it.

### The switch

- **By Tab** with the box (`0868`-`0915`): one set of moves ([[fn:USER.DeferWindowPos]]), the switch window hidden and the window brought to the front and made active. Where that cannot be begun, a beep and the switch window hidden.
- **By Tab** without (`0302`-`038e`): the window brought to the front and made active, and the switch window hidden, in one set; with flags of the windows' own set about it (`[24h]`, `[25h]` of their structures), not read further.
- **By Escape or F6** (`003a`-`00bd`): one set of moves, the window brought to the front and made active, and, by Escape without Shift, the window that was active sent to the back: after the last window at the top ([[fn:USER.GetWindow]] with `GW_HWNDLAST`), or, where its root owner is topmost, after the last topmost window (seg7 `02c9`); before that window, where it is the active window's root owner; not where it is the window switched to.

[[measured]] [[probe:alttab]], the messages of the switch, `WM_WINDOWPOSCHANGING` and `WM_WINDOWPOSCHANGED` with their flags:

- `P` brought up: `P` asked with `SWP_NOSIZE | SWP_NOMOVE`, then its owner `B` with `SWP_NOACTIVATE` besides; `A`'s `WM_NCACTIVATE` and `WM_ACTIVATE`, `P`'s, the focus moved; then `P` told, then `B`. `B` brought up: `P` first, then `B`, each asked twice -- again between `A`'s messages and `B`'s, `B` not being at the front with `P` above it -- and told once.
- `D`, an icon, brought up: asked twice too, its icon's title being above it. Then, at `SC_RESTORE`: `WM_QUERYOPEN`; asked with `SWP_FRAMECHANGED`, told with `SWP_NOZORDER` and `SWP_FRAMECHANGED`, and from that `WM_SIZE`; `WM_SETFOCUS`, then `WM_ACTIVATE` with 1 and nought.
- Alt and Escape: `P` and `B` asked, then `A` with `SWP_NOACTIVATE`; then the activation; then all three told. A cancel: `A` asked, and told nothing.
- A press on `C` after the loop: `P`'s `WM_NCACTIVATE` and `WM_ACTIVATE`, then `C` asked and told, then `C`'s own two.

### The page

On a page, Alt and Tab, and Alt and Escape, are the host's before they are the browser's: a desktop that switches its own windows with them takes them, and the page sees Alt pressed and then loses the keyboard. Where the browser does hand them to the page -- a desktop that does not take them, or a test driving the page -- the page hands them to Windows as it hands any key. When the page loses the keyboard with keys still down, it lets each go for Windows, as the keyboard would once they are let go, so that Alt is not left held and the loop ends. No other key stands in for them.

## In winbox.js

`src/win16/user/task-list.ts` and `crates/winbox-win16/src/task_list.rs` take the keys for the queue (`queueTakesKey`, `queue_takes_key`). They also carry out `SC_TASKLIST` and `SC_HOTKEY`, keep the hot keys, copy for Print Screen, and give the desktop window its procedure. `TASKMAN.EXE` is the installation's own, run as Windows runs it. The desktop window is the first program's; where that program has ended -- Windows itself would have ended with its shell -- it is no task's, and any task takes what comes for it. A page's Print Screen is `VK_SNAPSHOT`, with the scan code the keyboard driver would give.

`src/win16/user/switch-loop.ts` and `crates/winbox-win16/src/switch_loop.rs` run Alt and Tab's loop, show the box and the window itself, and make the switch. The switch window is a window of the raster desktop's own, with no handle, put up and taken away as a pop-up menu's is, keeping the screen under it (`openSwitch`, `open_switch`); it is in front of every window while it is up. The loop's capture is a kind of its own (`switch`, `CaptureKind::Switch`). `SetWindowPos` brings the family a window at the top heads to the front with it, each asked and each that moved told, and brings the window made active to the front again where it is not then the first at the top; a press that makes a window active does the same between the two windows' messages (`window-state.ts`, `position.rs`, `window_state.rs`).

Not yet followed:

- The palette put on the clipboard for Print Screen on a palette device, and the message box where the bitmap cannot be made.
- The hourglass while `TASKMAN.EXE` starts.
- For Alt and Tab: 386 enhanced mode's calls to seg1 `1799`; the CBT hook `DefWindowProc` asks before any `SC_` command (seg1 `03de`-`03fd`); the message posted to a DOS program's window, which winbox.js runs none of; the icon's title shown again for a minimized window not restored (seg1 `6de3`); the beep where the set of moves cannot be begun; and the flags of the windows' own that `CoolSwitch` off sets about its switch (`[24h]`, `[25h]`).
- The switch window has no handle: [[fn:USER.GetWindow]] and [[fn:USER.EnumWindows]] never come to it, where USER's is a window at the front, hidden, of every program's list. The box and the window drawn are drawn on the screen, not through a DC of it.
- A mouse message's `wParam` is the `MK_` flags of [[fn:USER.GetKeyState]]'s table as the message is made ([[topic:system-queue]]); a press looked at and left has not moved the table. winbox.js gives nought only for presses Alt and Tab's loop looks at, where [[probe:alttab]] measured it; a press another loop or `PM_NOREMOVE` looks at carries the flags the page gave it.
- The desktop window's procedure beyond the double click: it paints its own background for `WM_ERASEBKGND` and answers `WM_PALETTECHANGED` (`9e96`-`9f42`), which the raster desktop does in its own way.
