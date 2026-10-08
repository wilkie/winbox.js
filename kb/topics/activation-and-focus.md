---
kind: topic
name: Activation and the focus
summary: Which messages Windows 3.1 sends as a window is shown, activated, given the focus and destroyed, and who moves the focus — USER, or the window procedures — measured, and read out of USER.EXE.
probes: [activate, minis, showseq, showsq2, actnext, comboact, filedlg, hidfocus]
---

One top-level window is active at a time: its caption is drawn active, and the keyboard focus is in it or nowhere. Activation and the focus are separate things in Windows 3.1. USER changes the active window and tells both windows. The window procedures then move the focus: `DefWindowProc` for an ordinary window, and the dialog manager for a dialog. A program that handles `WM_ACTIVATE` itself decides where its focus goes.

[[measured]] [[probe:activate]] makes two top-level windows, A and B, and in A a hidden child dialog D with two edit controls. It shows them, activates each in turn, moves the focus about and destroys them. At each step it records every activation and focus message A, B and D get, and then `GetFocus` and `GetActiveWindow`. winbox.js agrees with every record.

## Activation

- [[measured]] The window losing the activation gets `WM_NCACTIVATE` with 0 and then `WM_ACTIVATE` with `WA_INACTIVE`. Then the window gaining it gets `WM_NCACTIVATE` with 1 and then `WM_ACTIVATE` with `WA_ACTIVE`. Each message names the other window in its `lParam`'s low word, or 0 when there is none. That is documented for `WM_ACTIVATE`, and it holds for `WM_NCACTIVATE` too.
- [[measured]] `WM_ACTIVATEAPP` with 1 comes before all of them when nothing was active, with an `lParam` of 0. Moving the activation between two windows of one task sends none.
- [[measured]] `ShowWindow` with `SW_SHOWNORMAL` activates a hidden top-level window, and [[fn:USER.SetActiveWindow]] activates a shown one.
- [[measured]] [[fn:USER.DestroyWindow]] on the active window activates the next one first, while the window being destroyed can still take messages. It gets `WM_NCACTIVATE` and `WM_ACTIVATE` as it loses the activation, and `WM_KILLFOCUS` as the next window takes the focus. When nothing is left to activate, it gets none of these, and the focus and the active window are both 0.
- [[measured]] Which window that is: the destroyed window's owner, while it is still to be seen. [[probe:actnext]] has a window A, a pop-up E that A owns, and a pop-up P that A owns too, made after E and so active. Destroying P activates A, not E, though E is above A. The same happens if P was made before E and activated again, and when P owns an active pop-up of its own, which goes with it. Only a P that nobody owns gives the activation to the next window down, E. Bago destroys the pop-up it shows while it reads its dictionary. winbox.js gave the activation to its egg timer, the next window down, where Windows gives it to Bago's own window. Bago's screen now matches Windows' pixel for pixel.
- [[measured]] A press on an inactive window's caption, or on its icon, is not what activates it. [[probe:iconclk]] logs `WM_NCLBUTTONDOWN` first, then `WM_NCACTIVATE` and `WM_ACTIVATE` with `WA_CLICKACTIVE`, then the move's `WM_SYSCOMMAND`: `DefWindowProc` activates the window as it takes the press. A program that keeps `WM_NCLBUTTONDOWN` from `DefWindowProc` keeps its window inactive.
- [[read out]] A press activates nothing while a window has the mouse's capture, and nothing when the window at the top of the one pressed is the desktop window, as for a combo box's list dropped down (`USER.EXE` seg1 `2939`, `2998`). [[measured]] [[probe:comboact]]: with `Q` active and `H` given the capture, a press on `Q` goes to `H` and leaves `Q` active; and a combo box's list pressed is never made active ([[topic:combo-boxes]]).
- [[documented]] A press on an inactive window activates it with `WA_CLICKACTIVE`. `WM_ACTIVATEAPP` goes to both tasks when the activation moves from one to another, with 0 to the one losing it, and the other task in `lParam`. winbox.js does both. Neither is measured.

## The focus

- [[read out]] `DefWindowProc` answers `WM_ACTIVATE` with a nonzero `wParam` by giving the window itself the focus (`USER.EXE` seg1 `5e84`). [[measured]] That is why the focus follows the activation from window to window in [[probe:activate]], through `WM_KILLFOCUS` to the window that had it and `WM_SETFOCUS` to the new one. It goes to the window itself, not back to the control inside it that had the focus before.
- [[read out]] [[fn:USER.SetFocus]] refuses a window that is minimized or disabled, or is inside one that is (seg1 `3869`). That applies to programs marked for Windows 3.0 or later; for older ones only a disabled parent is checked.
- [[read out]] `SetFocus` given a window inside a top-level window that is not active makes that window active first, and then moves the focus (seg1 `3899`-`38b2`). [[measured]] In [[probe:comboact]], the window losing the activation gets `WM_NCACTIVATE` and `WM_ACTIVATE`, the window gaining it `WM_WINDOWPOSCHANGING` as it is brought to the top, then its own two. `DefWindowProc` gives it the focus, and then the focus moves on to the window asked for.
- [[measured]] `SetFocus(NULL)` sends `WM_KILLFOCUS` to the window that had the focus, naming no window, and leaves the focus at 0. The active window stays active.
- [[read out]] **The focus never names a window that is gone.** [[fn:USER.DestroyWindow]] takes it off each window it destroys, before and after that window's `WM_DESTROY`: to the window's parent for a child, and to none for a window at the top (`USER.EXE` seg8 `09e1`, `0a17`, calling seg2 `090a`-`0928`). A pop-up menu's window is destroyed the same way. winbox.js lets the focus go as a window is taken away where nothing has moved it. A random run gave the focus to a pop-up menu's window pressed while no menu had the mouse, and the Rust engine stopped on the focus naming it once it was gone.
- [[measured]] A child dialog made hidden, whose dialog procedure answers FALSE to `WM_INITDIALOG`, has no focus of its own. Showing its parent then gives the parent the focus, not a control. PIF Editor is made this way. It then asks for the client rectangle of the focus's parent, which is no window. [[fn:USER.GetClientRect]] of no window writes nothing: USER checks the window's class for its signature first (seg1 `1837`).

## Dialogs

A dialog keeps its focus across activations itself. `DefDlgProc` does not pass `WM_ACTIVATE` on to `DefWindowProc`, which would give the dialog's own window the focus (seg25 `050b`).

- [[read out]] **Losing the activation**, or being hidden with `WM_SHOWWINDOW`, the dialog keeps the window that has the focus if it is inside the dialog and nothing is kept already (seg25 `03a8`, `05ab`).
- [[read out]] **Regaining it**, the kept control gets the focus again, if it is still a window and the dialog is not minimized, and is kept no longer (seg25 `03e3`).
- [[read out]] **`WM_SETFOCUS`** to the dialog's own window sends the focus on to the kept control, or else to the first control with `WS_TABSTOP` (seg25 `0553`). A dialog that has ended does neither: [[fn:USER.EndDialog]] and `WM_NCDESTROY` mark it ended.
- Not followed: two calls the save and the restore make, seg1 `0ab2` and seg25 `0b5b`. They are likely to be the default push button's upkeep, which is not read out.

## Bringing a window to the top

- [[measured]] [[fn:USER.BringWindowToTop]] answers `TRUE`. For a top-level window, the window goes above the others and becomes the active one, with the focus. For a child, it goes above its siblings and the focus stays where it was. [[probe:minis]] records it over two top-level windows and two children.

- [[measured]] As a window is first shown, the activation messages come after `WM_SHOWWINDOW` and `WM_WINDOWPOSCHANGING`, and before its frame is drawn, `WM_WINDOWPOSCHANGED`, and the `WM_SIZE` and `WM_MOVE` it was owed ([[probe:showseq]]). A window not yet at the top is placed there between the two halves of its activation. `SW_SHOWNOACTIVATE` and `SW_SHOWNA` show a window without any of this ([[probe:showsq2]]). See [[topic:creating-and-showing]].
- [[measured]] A window made active while minimized is told so with 20h in the high word of `lParam`, in `WM_NCACTIVATE` as well as `WM_ACTIVATE`. `DefWindowProc` then gives the focus to none, and the window that had it is sent `WM_KILLFOCUS` with nought ([[probe:showmin]]).

## A press in the active window

- [[measured]] A press moves no focus as USER takes it from the queue. The window pressed takes the focus itself, as a control does as it takes the press, and the window that had it is told. [[probe:filedlg]]: a click on the Open dialog's directories, with the file name's edit focused, sends the dialog `EN_KILLFOCUS` from the edit and then `LBN_SETFOCUS` from the list, before the click's `LBN_SELCHANGE` ([[topic:list-boxes]]). winbox.js once moved the focus to a control pressed as the press was taken, telling no one; the control then found it had the focus already. COMMDLG's directory list draws its selection only while it has been told it has the focus, and showed none.

## Not yet measured

- A press that activates a window, and what the pressed control does with the focus after it activates one.
- Activation between tasks.

## The focus left behind

- [[read out]] After the activation messages, when the activation was not `SetFocus`'s and the focus is in another window at the top, USER moves it to the window made active, or takes it away if that is minimized, with `WM_KILLFOCUS` and `WM_SETFOCUS` (`USER.EXE` seg1 `37a3`-`37d4`, `3412`). A dialog that kept no focus and set none takes it so, and its `WM_SETFOCUS` gives it to its first control. Write's Save As, whose hook sets no focus, left the focus in Write's document, and what was typed for its name went nowhere.
- [[measured]] [[probe:hidfocus]]: `SetFocus` on a control in a hidden window at the top makes that window active first, though it stays hidden (seg1 `3899`, `3514`, which ask nothing of its showing). A dialog made hidden, as `DialogBox` and `MessageBox` make one, is so made active as the dialog manager gives its first control the focus: the window it covers is told while its focus is still in it, keeps it, and has it back when the box is gone. winbox.js agrees with all 46 records, on both engines.
- Notepad's Find box, after its "Cannot find" box, has its focus back in its field by `SetFocus` alone, the field's text as it was (seg25 `03e3`). winbox.js once made the box active only as it showed, its focus already in the box, so the Find box kept none. Made active again, the Find box was given the focus as a window and gave it to its first control as the dialog manager does, with its text selected, and what was typed next took the place of what was to be found.

## Active and hidden

USER's active window is a word of its own, and nothing in activation asks whether the window shows. [[fn:USER.GetActiveWindow]] answers that word as it is (`USER.EXE` seg1 `818d`).

- [[read out]] **Activating.** `ActivateWindow` (seg1 `3514`) refuses no window and the desktop window, a window while another task's system-modal window is up, the active window itself, and a window a `WH_CBT` hook refuses with `HCBT_ACTIVATE`. It notes the active window as the one before (`359e`) and sends it `WM_NCACTIVATE` and `WM_ACTIVATE`. Answered `FALSE`, `WM_NCACTIVATE` stops it, unless the window being activated is the system-modal one. Then it sets the active window, sends `WM_QUERYNEWPALETTE`, and brings the window to the top when the first window that shows is not it (`3674`-`3697`). A hidden window is always brought up so. Then it sends `WM_ACTIVATEAPP` when the task changes, notes the window as its root owner's last active pop-up (`3740`-`3769`), and sends the new window `WM_NCACTIVATE` and `WM_ACTIVATE`. Last, when asked to, it moves a focus left in another window to the new one (`37a3`).
- [[read out]] **Who calls it.** [[fn:USER.SetActiveWindow]] calls it for any window that is not a child, shown or hidden (`38c5`, `38f2`). `SetFocus` calls it for the window at the top that the focus is going into (`3899`). `ShowWindow` with `SW_SHOWNORMAL` or `SW_SHOW` calls it for some windows before it shows them (seg14 `0d0a`). `SetWindowPos` calls it for the first window it moves that lacks `SWP_NOACTIVATE` (seg7 `0ca3`, `0382`).
- [[read out]] **The active window hidden or destroyed.** `ShowWindow(SW_HIDE)` of the active window, after `SetWindowPos` has hidden it, asks for another window to activate (seg14 `0dc2`). So does `DestroyWindow` (seg8 `0b86`-`0bc0`), whether or not the window shows. `SetWindowPos` with `SWP_HIDEWINDOW` asks for none. When none is found, a destroyed window leaves no window active. A window hidden by `ShowWindow` stays the active window, hidden.
- [[read out]] **Which window is activated** (seg1 `38e4`). A window qualifies when it is still a window, shows, is enabled, and is not an icon's title (`34dc`, which compares the window's procedure with the title's, class `#32772`). USER tries these in turn:
  1. For a destroyed pop-up that has an owner, the owner (`392b`).
  2. A pop-up's owner (`3934`).
  3. The window that was active before (`395c`).
  4. The next window that qualifies after this one, in the order of the windows at the top, each followed by the windows it owns, wrapping round to the first (seg13 `0f2b`, `0edd`, `0eb2`). If that window's last active pop-up qualifies, USER activates the pop-up instead (`3984`-`3994`).

  `ShowWindow` and an unowned window start at step 2. [[probe:actnext]] agrees. The pop-up nobody owns gives the activation to `E`, which was active before it.
- [[read out]] `ShowWindow(SW_HIDE)` sets the focus to the window's parent, or to none, only when the focus is the window itself, not a window inside it (seg2 `090a`). winbox.js still lets go of a focus inside a window it hides, when no other window is activated.
- [[read out]] After `SetFocus` has activated a window, it gives the focus to the window asked for, whoever has it (seg1 `38b2`, `3842`-`3848`). That holds even when `DefWindowProc` has just given the focus to that same window on `WM_ACTIVATE`. Then the window gets `WM_KILLFOCUS` naming itself, and `WM_SETFOCUS` naming itself, and `SetFocus` answers the window itself. Bago calls `SetFocus` on its own hidden window before it shows it. That window is now made active there, hidden, and `SetFocus` answers its own handle where it answered 0.
- [[measured]] [[probe:hidfocus]]: the window made active hidden shows later with `WM_SHOWWINDOW` alone. It is active already, and no activation messages come.
- In winbox.js, both engines keep a window's `active` mark whether or not it shows. `Desktop.activate` (`activate` in `desktop.rs`) makes a hidden window active, and `#nextActive` (`next_active`) chooses the next window as above. The desktop also keeps the window that was active before (`previousActive`, `previous_active`).
- Not followed: `SetWindowPos` activating a hidden window that it moves without `SWP_NOACTIVATE`. winbox.js still activates only a window that shows there, and only `SetFocus` and `SetActiveWindow` make a hidden one active. No probe records it.

## In winbox.js

- `src/win16/user/activation.ts` sends the messages for a change of active window. The desktop (`Desktop.show` and `Desktop.destroy`) records where the activation came from. `ShowWindow`, `SetWindowPos`, `DestroyWindow` and `SetActiveWindow` deliver the messages at once. A press on an inactive window leaves them to the queue, before the press itself.
- `DefWindowProc` in `src/win16/user/DefWindowProc.ts` gives the focus on `WM_ACTIVATE`.
- `DefDlgProc`, `saveFocus` and `restoreFocus` in `src/win16/user/dialogs.ts` keep a dialog's focus.
