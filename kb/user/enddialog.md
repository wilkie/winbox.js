---
kind: function
module: USER
name: EndDialog
ordinal: 88
summary: Ends a dialog at once -- its owner enabled, the dialog hidden and its owner made active -- and gives the value DialogBox answers.
versions:
  '3.1': exact
probes: [enddlg, comboesc, sysdlg]
source: src/win16/user/dialogs.ts
topics: [dialog-boxes, activation-and-focus]
---

## Observed behaviour

[[read out]] `USER.EXE` seg25 `2564` does everything at once, for a dialog run modal or modeless, and answers nothing:

1. A task locked with [[fn:USER.LockMyTask]] is let go, whichever locked it (`2579`).
1. The owner -- for a child dialog, its parent -- is enabled again, unless it was disabled before [[fn:USER.DialogBox]] disabled it. A modeless dialog notes nothing of that, so its owner is enabled whatever it was.
1. The dialog is marked ended, and the value written over the word that holds its default button's identifier. `DM_GETDEFID` answers 0 from then on, and `DM_SETDEFID` changes nothing.
1. Where the dialog is the active window and the focus is in one of its controls, the dialog itself is given the focus.
1. The dialog is hidden with [[fn:USER.SetWindowPos]], flags 97h, which makes no other window active.
1. A system-modal dialog makes the window system modal before it so again, none where that is gone, and that window is the one made active below (`25e8`-`260b`).
1. Where the dialog was the active window, its owner is made active, disabled, minimized or hidden as it may be, and takes the focus. With no owner, no window is left active and none has the focus, and nothing is told; destroying the dialog then makes the next window active.

`DialogBox`'s loop sees the mark, destroys the dialog and answers the value. Called again, `EndDialog` does it all again, and the last value is the one answered.

[[measured]] [[probe:enddlg]] ends a dialog at a timer's tick, twice, in `WM_INITDIALOG`, from its owner's procedure, over a disabled owner, a minimized one and none, under a dialog over it, and modeless. Both engines agree with all 499 records. [[topic:dialog-boxes]] lists what each case sends.

## Nuances

- [[measured]] [[probe:sysdlg]]: a system-modal dialog ended leaves no window system modal and no task locked; one run over another, owned by it, gives the system modality and the activation back to it, and the task stays let go.

- Ended in `WM_INITDIALOG`, the dialog is never shown or made active, even with `WS_VISIBLE`, and no control is given the focus.
- An owner disabled before `DialogBox` stays disabled, and is still made active; the focus is moved to it by USER, though [[fn:USER.SetFocus]] would refuse it.
- A dialog destroyed without `EndDialog` ends `DialogBox`'s loop with 0, and leaves the owner disabled.

## Implementation

`EndDialog` in `src/win16/user/dialogs.ts`, and `end_dialog` in `crates/winbox-win16/src/dialogs.rs`.
