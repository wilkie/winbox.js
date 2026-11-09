---
kind: topic
name: The order of windows
summary: Where Windows 3.1 puts a window among the windows at the top, and whether it is topmost -- as CreateWindow links it, as SetWindowPos lists, places and tells a window and its owner's family, as ShowWindow, activation, DestroyWindow, dialogs and message boxes call it -- read out of USER.EXE and recorded.
probes:
  [
    zorder,
    zcreate,
    zactive,
    zminim,
    zhidmin,
    zcbtins,
    zmark,
    mbseb,
    dlgfront,
    swporder,
    swpshow,
    sysdlg,
    enddlg,
  ]
---

Every window at the top is one of the desktop window's children, a list front to back that [[fn:USER.GetWindow]] walks with `GW_HWNDNEXT`. A window may be **topmost**, its extended style's `WS_EX_TOPMOST` (the byte at 2Ch of USER's window, bit 8). USER keeps the topmost windows at the front only as each placing puts them there; nothing else holds them together. USER's own `#32771`, hidden, disabled and topmost, lies among them, so that "after the last topmost window" -- where a window that is not topmost goes for `HWND_TOP` -- is after `#32771` where no program has a topmost window.

Six probes record what this page reads out, each logging the order of the windows at the top after every call (the probe's windows by letter, any other topmost or shown window by its class, `*` for topmost), the active window and the focus, and every `WM_WINDOWPOSCHANGING` and `WM_WINDOWPOSCHANGED` with the window it names to go after and its flags, with the activation and focus messages:

- [[probe:zorder]]: `SetWindowPos` asked for each place there is, on windows owned and owning, topmost and not.
- [[probe:zcreate]]: windows made of each kind, made visible and shown later, and `ShowWindow`'s commands on windows hidden and shown.
- [[probe:zactive]]: windows destroyed, hidden and disabled while active, a modal dialog, task-modal and system-modal message boxes, and `SetSysModalWindow`.
- [[probe:zminim]]: windows minimized and restored by `ShowWindow`.
- [[probe:zcbtins]]: a window made with a `WH_CBT` hook naming the window to put it after.
- [[probe:zmark]]: the mark to be made topmost or not that `SWP_NOOWNERZORDER` leaves on a window it does not place.

Both engines agree with every record of all six.

## The last topmost window

[[read out]] `USER.EXE` seg7 `02c9` answers the last of the topmost windows at the front: none where the desktop's first child is not topmost, else the last of the run of topmost windows from the front. A topmost window lying behind one that is not is not counted. That is where `HWND_TOP` puts a window that is not topmost, and what `CreateWindow` links a new one after.

## CreateWindow

[[read out]] (`USER.EXE` seg8 `036c`, the internal routine both exports call):

- **Topmost** is the extended style given (`0419`-`0422`), or the owner's: a window at the top given a parent is owned by the window at the top that parent is in (seg2 `0ab8`), and an owner that is topmost makes the window topmost (`067b`-`06ae`). A child is never topmost (`0751`).
- **Linked** only once `WM_NCCREATE` is answered (`07bb`, seg2 `093f`), after the `WH_CBT` hook's `HCBT_CREATEWND` (`046a`), `WM_GETMINMAXINFO` (`06d9`) and `WM_NCCREATE` (`0727`); before it, the window is in no list, its link to the next nought. A child is linked last among its brothers (`04ed`: the window to go after forced to `HWND_BOTTOM`). A window at the top is linked after the window the CBT hook's `CBT_CREATEWND` names, `HWND_TOP` where none (`0480`): for `HWND_TOP` a topmost window first and any other after the last topmost window (`0757`-`07af`); for `HWND_TOPMOST` made topmost and first; `HWND_NOTOPMOST` made not and after the last topmost; `HWND_BOTTOM` last; after a window, topmost as that one is but where it is the last topmost.
- **Shown** after `WM_CREATE` -- after `WS_MINIMIZE` or `WS_MAXIMIZE` is carried out and `WM_PARENTNOTIFY` is sent -- with `ShowWindow`'s own routine where the style had `WS_VISIBLE` (`0890`-`089b`), `SW_SHOW`, or for an overlapped window at `CW_USEDEFAULT` the `y` given (`0508`-`0519`). A window at the top so shown is made active, a child not (`ShowWindow` below).

[[measured]] [[probe:zcreate]]:

- In `WM_NCCREATE`, `GetWindow(GW_HWNDNEXT)` answers nought; in `WM_CREATE`, the window after it. (`GW_HWNDPREV` in `WM_NCCREATE` walks the brothers for a window that is not among them, and Windows does not come back.)
- A pop-up made `WS_VISIBLE` with a topmost window shown lies after `#32771`; one made with `WS_EX_TOPMOST` first, topmost from `WM_NCCREATE` on; one owned by a topmost window, hidden or not, topmost and first. An owned pop-up shown brings its owner up after it, and a hidden window owned by none, left behind, falls behind them.
- `CW_USEDEFAULT` with `y` `SW_SHOWNOACTIVATE` shows the window where it was linked, after `#32771`, with 57h; `SW_SHOWNA` with 53h, not made active; `SW_HIDE` and 12 leave it hidden; `SW_SHOW` shows it active.

[[measured]] [[probe:zcbtins]], a hidden window C made with two topmost pop-ups and two overlapped windows shown: the hook is handed nought, `HWND_TOP`. Answered `HWND_BOTTOM`, C is linked after USER's `#32768`, last of all, topmost still where it was made `WS_EX_TOPMOST`; `HWND_TOPMOST`, topmost and first; `HWND_NOTOPMOST`, after `#32771`, not topmost though made `WS_EX_TOPMOST` -- in `WM_NCCREATE` it is still topmost, in `WM_CREATE` no more; after A, after it and not topmost; after the topmost T, which is not the last topmost, after it and topmost; after `#32771`, the last topmost, after it, topmost only where it was made so. Both engines had linked it for `HWND_TOP` whatever the hook answered; `Desktop.linkMadeAfter` and `z_link_made_after` now follow it.

Both engines had linked a window as it was made, before `WM_GETMINMAXINFO`; had not made a window owned by a topmost one topmost; and had shown a window whose `y` was 12. [[read out]] `ShowWindow` takes a command whose high byte is set as `SW_SHOWMINNOACTIVE` from FF80h on and `SW_SHOW` below, and does nothing for 10 to FFh (seg14 `0c0e`-`0c2f`).

## SetWindowPos

`SetWindowPos` is `BeginDeferWindowPos` of one, `DeferWindowPos` and `EndDeferWindowPos` (seg7 `17ba`, `02f4`); [[fn:USER.BringWindowToTop]] is `SetWindowPos` after `HWND_TOP` with `SWP_NOSIZE | SWP_NOMOVE` (seg7 `1836`, `0077`). [[read out]] `EndDeferWindowPos` (seg7 `01fd`), for a list whose first window is at the top:

1. **The window to go after, and whether it is made topmost** (seg7 `1400`), for each window of the list:
   - Without `SWP_NOZORDER` or `SWP_NOACTIVATE`, a window that is not the active one (USER's `[108h]`) asked for anything but `HWND_TOPMOST` or `HWND_NOTOPMOST` goes to `HWND_TOP` (`1401`-`141b`). The active window asked to go after a window goes there.
   - `HWND_TOP`: a topmost window first; any other after the last topmost window (`146f`-`1481`). Topmost unchanged.
   - `HWND_BOTTOM`: last, and topmost no more (`1429`-`1433`).
   - `HWND_TOPMOST`: first, made topmost (`145f`-`146d`).
   - `HWND_NOTOPMOST`: a topmost window after the last topmost window, or, where it is that one, after the window in front of it; any other after the window in front of it (`GW_HWNDPREV`, seg2 `086f`), that is, where it lies. Made topmost no more either way (`1436`-`145d`).
   - After a window: where that window is the last topmost, topmost unchanged (`1486`-`148d`); after another topmost window, made topmost; after one that is not, made topmost no more (`148f`-`14a8`).
2. **The windows made so with it** (`137c`-`13a5`, `13be`): made topmost, the window and every window owned under it, at any depth; made topmost no more, the window at the end of its owners and every window owned under that. Each marked whose state is to change (its byte at 26h, bit 20h), the change made as it is linked.
3. **Its owner's family** (`12af`, `14ae`, `1606`): unless `SWP_NOZORDER` or `SWP_NOOWNERZORDER` (200h), or USER's system error box is up (`14c1`-`14d6`), a window owned or owning brings the family of the window at the end of its owners (`14fa`-`150f`). They are listed from that head: each window it owns, front to back, hidden or shown, with the windows it owns before it, listed the same way, and the head after them all (`1631`-`16c5`); the branch holding the window moved goes before the first window it lies in front of where it is to go, first for `HWND_TOP`, last for `HWND_BOTTOM` (`15d7`). Each is asked to go after the one before it (`16da`-`16ed`), the first after:
   - for `HWND_TOP` or `HWND_TOPMOST`, where the window was to go;
   - for `HWND_BOTTOM`, the last window not of the family -- with none, the window stays where it lies, `SWP_NOZORDER` (`151b`-`1548`);
   - for a window of the family, the last window in front of the family's first (`15a2`-`15c4`) -- but a window that owns nothing, asked to go after a window at or in front of its own owner, goes there alone, brought with nothing (`158b`-`159c`);
   - for any other window, that window.

   The family is neither sized, moved nor made active: flags 13h.

4. **Asked**, `WM_WINDOWPOSCHANGING`, each in the list's order, with the window to go after as worked out so far (`0ce9`-`0d35`).
5. **Already in place** (`0e09`-`0e38`): before anything moves, each window not `SWP_NOZORDER` and not marked is looked at while every one before it lay where it was asked; one that does is given `SWP_NOZORDER`. Whether it does is seg7 `1184`: for the bottom, last; for the top, first; after a window, right after it -- but asked to go after a window topmost where it is not to be, or not topmost where it is to be, it is to go after the last topmost window instead, the entry saying so, and the last topmost window itself lies where it is asked (`11ad`-`11d8`).
6. **Placed**, each in the list's order (`0a4f`-`0b71`): one with `SWP_NOZORDER` stays; one only to be put elsewhere -- `SWP_NOSIZE | SWP_NOMOVE`, nothing shown, hidden or framed, as the family always is -- not marked and lying where it is asked (`1184` again, as the windows lie now) stays, given `SWP_NOZORDER | SWP_NOREDRAW`; any other is unlinked and linked after the window it is to go after (seg2 `0972`, `093f`), and made topmost or not as marked.
7. **Made active**: the first window of the list without `SWP_NOACTIVATE`, where it is not active already (`0cda`-`0ce6`, `0382`; _Activation_ below). A child is sent `WM_CHILDACTIVATE` instead.
8. **Told**, `WM_WINDOWPOSCHANGED`, each in the list's order, unless it was put nowhere and nothing else was done to it (flags against 18E7h come to 1807h, `03f8`), with the window to go after as its entry has it now. Its flags: those asked, `SWP_SHOWWINDOW` taken off where it showed already, `SWP_HIDEWINDOW` where it was hidden, and `SWP_NOREDRAW` added where it is hidden and not being shown (`0de3`-`0e05`), with 1800h less what its client area did.

So the three rules [[probe:dlgfront]] recorded follow:

- A hidden dialog shown with `HWND_TOPMOST` is made topmost (steps 1, 2 and 6) as any window asked for `HWND_TOPMOST` is, shown or not.
- Its owner, brought with it after it (step 3), is to go after a topmost window and is not topmost: at step 6 it is to go after the last topmost window instead, so it goes in front of the windows that are not topmost, or stays where it lies already there.
- It is told it went after the window its entry names at the end: that last topmost window (step 8).

**The mark.** [[read out]] Step 2 marks each window it looks at afresh -- the mark taken off, then put on where the window's topmost is to change (seg7 `13c6`-`13de`) -- whether or not the window is in the list: with `SWP_NOOWNERZORDER` only the window itself is placed, and the others keep their marks. A window keeps its mark until it is next placed by a `SetWindowPos` that does more than leave it where it lies -- moved, sized, shown, hidden or put elsewhere -- and is then made topmost or not, wherever it goes (`0a4f`-`0a60` pass over an entry of `SWP_NOZORDER` and nothing else; `0b67`-`0b71` flip the mark's window even with `SWP_NOZORDER`); and a marked window is never left in place for lying where it is asked (`0a6e`, `0e20`), and is taken to be topmost as it is to be (`11b5`). [[measured]] [[probe:zmark]], O owning the pop-up P, which owns Q: P made topmost with `SWP_NOOWNERZORDER` leaves Q not topmost; Q asked for nothing stays so, Q moved with `SWP_NOZORDER` is made topmost where it lies, behind `#32771`; Q put at the top, or shown, is made topmost and first, P after it; P made topmost no more alone takes Q's mark off again, and Q moved stays as it was. Q made topmost no more alone, the family topmost, marks O and P: O moved is made topmost no more where it lies, in front of `#32771`. Both engines had changed no window outside the list; they now keep the mark (`topmostDue`, `topmost_due`).

[[measured]] [[probe:zorder]]:

- A window that is not topmost put after `#32771`, the last topmost, stays so, `*` nowhere; after a topmost window that is not the last, it is made topmost; a topmost window put after `#32771` stays topmost behind it.
- `HWND_NOTOPMOST` on a window that is not topmost is asked to go after the window in front of it and told nothing; at the bottom, after USER's hidden `#32768`, which lies last of all.
- An owner made topmost makes the windows it owns, and theirs, topmost with it, the most owned first: Q, P, A, each told after the one before. An owned window made topmost no more makes the whole family so, Q, P and A after `#32771`.
- An owned window made topmost makes itself and what it owns topmost and not its owner, which is told it went after `#32771`; put at the top again, it and its window are asked and not told, and the owner, which lay behind another window, is moved after `#32771` and told so. The owner put at the top is asked after `#32771`, and its topmost windows go after `#32771` with it, topmost still.
- A topmost owner's window put at the bottom takes the family there, all made topmost no more.
- A window owning nothing put after its owner goes behind it. A window put after one of its own family, or after a window in front of its family, leaves the family where it lies: each asked, none told.
- `SetWindowPos` without `SWP_NOACTIVATE`: the active window put after another goes there; another window asked for `HWND_BOTTOM` or after a window comes to the top, active; `HWND_NOTOPMOST` leaves it where it lies, active; `HWND_TOPMOST` makes it topmost and active.

Both engines had made a window put after `#32771` topmost, made only the window itself topmost or not, brought its family only for `HWND_TOP` and `HWND_TOPMOST`, and told each of the family that moved where it had come to lie. `crates/winbox-win16/src/z_order.rs` now work the list out as above.

## ShowWindow

[[read out]] (seg14 `0bf2`): the command's place in the table at `0c39`; `SetWindowPos` after `HWND_TOP` (`0d3a`), only where the window's parents show (seg2 `09ea`), else its `WS_VISIBLE` alone changed (`0d59`-`0d65`).

- `SW_HIDE`: nothing for a hidden window; 83h, with `SWP_NOZORDER | SWP_NOACTIVATE` unless it is the active window (`0c4d`-`0c61`). The active window is so put at the front as it hides, and then another window is made active (`0dbc`-`0dc5`, seg1 `38e4` with 3).
- `SW_SHOWNORMAL`, `SW_SHOWNOACTIVATE`, `SW_RESTORE`: a minimized or maximized window to `MinMaximize` (seg6 `1a72`); one that shows, nothing at all; else 43h, with `SWP_NOZORDER` -- and `SWP_NOACTIVATE` where a window is active -- for `SW_SHOWNOACTIVATE` (`0c67`-`0c92`).
- `SW_SHOW`: nothing for a window that shows; else 43h (`0c95`-`0c9e`).
- `SW_SHOWNA`: 43h, `SWP_NOACTIVATE` where a window is active -- for a window that shows too, so it is brought to the front (`0ca5`-`0cb1`).
- `SW_SHOWMINIMIZED`, `SW_SHOWMAXIMIZED`, `SW_MINIMIZE`, `SW_SHOWMINNOACTIVE`: `MinMaximize` ([[topic:window-states]]).
- A child: `SWP_NOZORDER | SWP_NOACTIVATE` (`0cfd`). A window at the top whose class has `CS_SAVEBITS`, for `SW_SHOWNORMAL` or `SW_SHOW`: made active first, then shown with them ([[topic:activation-and-focus]]).
- `WM_SHOWWINDOW` and message 9 go wherever `SetWindowPos` is reached: the test compares 1 or nought with the style's 10h (`0cb5`-`0ce1`), so a window that shows given `SW_SHOWNA` is told it shows again.

[[measured]] [[probe:zcreate]]: `SW_SHOW`, `SW_SHOWNORMAL` and `SW_SHOWNOACTIVATE` of a window that shows send nothing and make nothing active; `SW_SHOWNA` sends `WM_SHOWWINDOW` with 1, brings it after `#32771` with 53h and tells it 1813h. The active window hidden is asked and told 83h after `#32771`, put at the front; the window made active after is brought up between the activation's messages, asked and told 3. A hidden window put at the bottom is told 181Bh. Both engines had made a window that shows active again for `SW_SHOW`, left a window that shows where it was for `SW_SHOWNA`, and hidden the active window where it lay.

[[read out]] `MinMaximize` (seg6 `1a72`), after the `WH_CBT` hook's `HCBT_MINMAX` (`1ae0`-`1af5`), by the command (its table at `1b2b`): `SW_SHOWNOACTIVATE` adds `SWP_NOACTIVATE` where a window is active and goes on as `SW_RESTORE` (`1b3d`); `SW_RESTORE` of an icon that was maximized is `SW_SHOWMAXIMIZED`, else `SW_SHOWNORMAL` (`1b48`-`1b62`, `1c61`); `SW_MINIMIZE` and `SW_SHOWMINNOACTIVE` add `SWP_NOACTIVATE` where a window is active and go after the last window beneath of the same topmost owned by the same window (`1e58`), `SWP_NOZORDER` with none (`1b65`-`1b7d`); `SW_SHOWMINIMIZED` names nothing, `HWND_TOP`. Minimizing: nothing for an icon that shows; the focus taken from inside the window (`1bfa`-`1c25`); 120h, and `SWP_SHOWWINDOW` always (`1c59`, `1d4f`). Restoring or maximizing an icon: `WM_QUERYOPEN` first, nought keeping it an icon (`1caf`-`1cc1`), its title hidden (`1cdd`), 120h, `SWP_SHOWWINDOW` where it is hidden; after the one `SetWindowPos` (`1d56`-`1d81`), the focus given it (`1e2c`) and, at the top, `WM_ACTIVATE` with 1 (`1e3a`-`1e4b`). `SW_MINIMIZE` of a window at the top then makes another active by `ActivateWindow` (seg1 `38e4` with 1): a window that shows, is no icon and is enabled, looked for from USER's `[10Ah]` or the last topmost window (`1d96`-`1e11`), else none with 3; and the icon's title is shown last (`1e16`-`1e27`).

[[measured]] [[probe:zminim]]: an icon's title, `#32772`, is a window at the top like any other once made, linked just in front of its icon, and [[fn:USER.GetWindow]] walks find it, shown or hidden. `SW_SHOWMINIMIZED` of the active window lying after its hidden title asks it 160h after the title -- the title, a window it owns, listed first -- and tells it 124h, in place; `SW_SHOWNORMAL` of the icon then asks it 120h and tells it 124h, then gives it the focus and `WM_ACTIVATE`. Both engines had passed titles over in `GetWindow` and sent nothing for either command; `SW_SHOWNORMAL` of an icon is now restored as `SW_RESTORE` restores it, `SW_SHOWMINIMIZED` of a window that shows placed by the list (`minimizeToBottom`, `minimize_to_bottom`), and the window made active after `SW_MINIMIZE` is made so by `activateWindow` itself.

[[read out]] Hiding the title as an icon is restored, `ShowIconTitle` with nought makes the title first where the icon never had one (seg1 `6e3f`-`6e4e`, `6e9b`). [[measured]] [[probe:zhidmin]]: a window made hidden with `WS_MINIMIZE`, then given `SW_SHOWNORMAL` or `SW_RESTORE`, is sent `WM_QUERYOPEN`, asked 160h after its new title `#32772`, made active, told 160h, sent `WM_MOVE` and `WM_SIZE` from that, then `WM_ACTIVATE` -- no `WM_SHOWWINDOW`. Both engines had shown it as any hidden window, `WM_SHOWWINDOW` and 43h, asked and told twice more, and answered that it showed before; Brick's report in the corpus, started minimized, now has these messages.

## Activation

[[read out]] `ActivateWindow` (seg1 `3514`) moves nothing itself but through [[fn:USER.BringWindowToTop]]: once the window losing the activation is told, where the first window at the top that shows is not the window being made active, it calls it (`3674`-`3697`), a `SetWindowPos` of its own -- its family listed, asked, placed and told as above, before the new window is told. A hidden window is always brought up so. That `SetWindowPos`'s own activation finds the window active already and does nothing (seg7 `03ad`). So a window made active behind a topmost window that shows is asked again, `HWND_TOP` -- after the last topmost window -- with 3, and told nothing where it lies there already.

[[measured]] [[probe:zcreate]], [[probe:zactive]]: a window made visible, or shown, behind a topmost window that shows is asked again; one behind others is brought up and told 1803h; a dialog's owner, brought with its system-modal dialog made active, goes after `#32771` and is told so before the focus moves. Both engines had brought the window up in their own way and asked its family after; both now call the placing above. [[topic:activation-and-focus]] has which window is made active.

## Destroyed, hidden, disabled

[[read out]] `DestroyWindow` (seg8 `0a22`) hides a window at the top that shows with `SetWindowPos`, 97h -- `SWP_NOZORDER` among them, so it stays where it lies (`0b25`-`0b33`) -- destroys the windows it owns, and then, where it was active, makes another active (`0b86`-`0bce`): a pop-up's owner (seg1 `38e4` with 2, through the owner); any other window, the window active before it, else the next that can be (`38e4` with 3). Only `WS_POPUP` hands it to its owner (`3934`-`3944`, seg8 `0b95`): an overlapped window that is owned does not. [[fn:USER.EnableWindow]] with `FALSE` sends `WM_CANCELMODE`, takes the focus from the window itself, and changes neither the active window nor the order (seg1 `6f28`-`6fc3`).

[[measured]] [[probe:zactive]]: a pop-up destroyed hands the activation to its owner, though another window was active before; an overlapped window owned by A, destroyed, to the window active before it, B, which is brought up after `#32771`. A pop-up whose owner is disabled, destroyed, to the window active before it. The active window disabled stays active and loses the focus.

## Dialogs and message boxes

[[read out]] The dialog manager makes a dialog with `WS_EX_TOPMOST` for `DS_SYSMODAL` and `WS_EX_DLGMODALFRAME` for `DS_MODALFRAME` (seg24 `058a`-`05b4`), hidden; `DialogBox` disables its owner first (seg25 `0914`-`0930`) and moves nothing. The dialog made active as its first control is given the focus is brought up by `ActivateWindow`; its loop shows it with `SW_SHOWNORMAL`, after `SetWindowPos(HWND_TOPMOST, 1Bh)` for a system-modal one (seg25 `081b`-`0854`). [[fn:USER.EndDialog]] enables the owner before it hides the dialog with 97h (seg25 `2589`-`25e3`), then makes the owner active (`261a`-`261f`), which brings it up where it is not the first window that shows. [[fn:USER.SetSysModalWindow]] moves nothing (seg1 `19de`-`1a61`). [[fn:USER.MessageBox]] with `MB_SYSTEMMODAL` makes a dialog with `DS_SYSMODAL` and without `DS_MODALFRAME` (seg42 `06f6`-`070d`) -- but with no icon or the hand, `SysErrorBox` instead (seg1 `9bd2`-`9bfb`), no window at all, which moves nothing and makes nothing active ([[topic:message-boxes]]; [[probe:mbseb]]); with `MB_TASKMODAL` and no owner, the box's procedure disables every window at the top of the task that is enabled in its `WM_INITDIALOG`, front to back, and enables them again before it ends the box (seg42 `0134`-`0145`, `0000`-`006d`, `01c8`, `0073`-`00ad`).

[[measured]] [[probe:zactive]]: the dialog's owner is sent `WM_CANCELMODE`, loses the focus and is disabled before `WM_INITDIALOG`; made active, the dialog comes after `#32771` with its owner after it; ended, the owner is enabled first, the dialog asked and told 97h, then the owner made active. The task-modal box with no owner disables B then A, front to back, each sent `WM_CANCELMODE` -- B, which had the focus, losing it -- and enables them again before B is made active. The system-modal box is topmost and first, its owner after `#32771`, told so; `SetSysModalWindow` moved nothing. `GetWindowLong(GWL_EXSTYLE)` of a dialog with `DS_MODALFRAME` answers `WS_EX_DLGMODALFRAME`; both engines had answered nought, and disabled nothing for a task-modal box.

## Not yet done

- `MinMaximize` is followed step by step only where [[probe:zminim]], [[probe:minact]] and [[probe:showmin]] look: a window that shows minimized, an icon restored or maximized at the top, and the activation after `SW_MINIMIZE`. Maximizing, minimizing a hidden window or a child, and `ShowWindow` of a hidden window (but `SW_SHOWNA`) are still each engine's older paths in `showRaster` (`show_raster`): they list a window's family with `familyOf` and put it up through `Desktop.show`, which follow the records but not this page's steps. `ActivateWindow` puts the window up in the desktop's list (`Desktop.activate`) before its own `SetWindowPos`, and a press's bringing forward (`bringingForward`) asks and tells its family by hand. `DestroyWindow`'s hiding is `SetWindowPos`'s, 97h, in both engines.
- `MinMaximize`'s `SW_MINIMIZE` and `SW_SHOWMINNOACTIVE` add `SWP_NOACTIVATE` only where a window is active (`1b65`-`1b6c`); both engines always do.

## In winbox.js

`crates/winbox-win16/src/z_order.rs` work out a window at the top's list (`planZOrder`, `plan_z_order`), whether each lies in place (`liesWhere`, `stayRun`) and link it (`placePlan`, `Desktop.linkAfter`). `position_changing` and `position_changed` in `crates/winbox-win16/src/position.rs` ask, place and tell by it; `activateWindow` brings a window up with `positionRaster`. `CreateWindow` links a window with `Desktop.linkMade` after `WM_NCCREATE`.
