---
kind: topic
name: Activation and the focus
summary: Which messages Windows 3.1 sends as a window is shown, activated, given the focus and destroyed, and who moves the focus — USER, or the window procedures — measured, and read out of USER.EXE.
probes: [activate, minis, showseq, showsq2, actnext]
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
- [[documented]] A press on an inactive window activates it with `WA_CLICKACTIVE`. `WM_ACTIVATEAPP` goes to both tasks when the activation moves from one to another, with 0 to the one losing it, and the other task in `lParam`. winbox.js does both. Neither is measured.

## The focus

- [[read out]] `DefWindowProc` answers `WM_ACTIVATE` with a nonzero `wParam` by giving the window itself the focus (`USER.EXE` seg1 `5e84`). [[measured]] That is why the focus follows the activation from window to window in [[probe:activate]], through `WM_KILLFOCUS` to the window that had it and `WM_SETFOCUS` to the new one. It goes to the window itself, not back to the control inside it that had the focus before.
- [[read out]] [[fn:USER.SetFocus]] refuses a window that is minimized or disabled, or is inside one that is (seg1 `3869`). That applies to programs marked for Windows 3.0 or later; for older ones only a disabled parent is checked.
- [[measured]] `SetFocus(NULL)` sends `WM_KILLFOCUS` to the window that had the focus, naming no window, and leaves the focus at 0. The active window stays active.
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

## Not yet measured

- A press that activates a window, and what the pressed control does with the focus after.
- Activation between tasks.

## In winbox.js

- `src/win16/user/activation.ts` sends the messages for a change of active window. The desktop (`Desktop.show` and `Desktop.destroy`) records where the activation came from. `ShowWindow`, `SetWindowPos`, `DestroyWindow` and `SetActiveWindow` deliver the messages at once. A press on an inactive window leaves them to the queue, before the press itself.
- `DefWindowProc` in `src/win16/user/DefWindowProc.ts` gives the focus on `WM_ACTIVATE`.
- `DefDlgProc`, `saveFocus` and `restoreFocus` in `src/win16/user/dialogs.ts` keep a dialog's focus.
