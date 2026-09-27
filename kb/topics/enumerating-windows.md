---
kind: topic
name: Enumerating windows and properties
summary: How USER hands a program's procedure each window at the top, each child, each of a task's windows and each property in turn — the order, the answers, the hidden windows of USER's own that come along, and why a procedure not made with MakeProcInstance finds nothing through EnumTaskWindows.
probes: [minis3]
---

USER has four calls that pass a program's procedure one thing at a time. [[probe:minis3]] calls each on a window of its own, with two children, a grandchild and properties. It records the procedure's visits in order, and the call's answer.

## Windows

- [[read out]] [[fn:USER.EnumChildWindows]] takes a list of the window's descendants first (`USER.EXE` seg1 `657c`), then calls the procedure for each. Windows destroyed in the meantime are passed over.
- [[measured]] The order is depth first: a child, then that child's own children, then the next child. For the probe's children that is `C`, `E`, `D`.
- [[measured]] The answer is 1 once every window has been visited, or nought when the procedure stops the walk by answering nought. A window with no children at all answers nought.
- [[measured]] [[fn:USER.EnumWindows]] does the same for the windows at the top, front to back.
- [[measured]] **USER's own hidden windows come along**:
  - the task list's `#32771`, above the program's window;
  - a `#42`;
  - the menus' `#32768`, below it.

  The probe is the shell, so all three are its task's.
- [[read out]] [[fn:USER.EnumTaskWindows]] is `EnumWindows` with a filter of USER's own (seg1 `1ad0`), which passes over another task's windows.
- [[read out]] **USER calls the program's procedure with AX set to 1.** KERNEL turns a program's exported prologue into three `nop`s, so an exported function takes its data segment from AX ([[topic:dynamic-link-libraries]]).
- [[measured]] So a procedure passed straight to `EnumTaskWindows` runs with a data segment of 1, and records nothing. The same procedure passed through `MakeProcInstance` visits the four windows `EnumWindows` does.
- [[measured]] A window's task, from [[fn:USER.GetWindowTask]], is the task that made it. The desktop's task is the shell's: [[read out]] the shell's `InitApp` takes the desktop's queue as its own (seg5 `03ac`).

## Properties

- [[read out]] [[fn:USER.EnumProps]] walks the window's list of properties (seg13 `114a`). `SetProp` adds to the end of the list, or replaces the data in place, and `RemoveProp` closes the gap. USER's own properties, `SysCP` and `SysBW`, are never passed to the procedure.
- [[measured]] The procedure is given the window, the name and the handle kept, in the order the properties were first set. A string name arrives as a string. An atom arrives as nought and the atom: `#4660` for `MAKEINTATOM(1234h)`.
- [[measured]] **The answer is not the procedure's.** It is -1 for a window with no properties, nought once all have been visited, and 1 when the procedure stopped the walk.

## The last active pop-up

- [[read out]] [[fn:USER.GetLastActivePopup]] answers a field of the window's, or the window itself when the field is empty (seg2 `09a0`). Nothing else is checked: not whether the window is visible, enabled, or still there.
- [[read out]] Making a window active sets the field on the window at the root of its owners (seg1 `3740`). Destroying a window sets its owner's field back to the owner, if the field named the window destroyed (seg8 `0caa`).
- [[measured]] The recording shows each step:
  - A pop-up shown with `WS_VISIBLE` is active at once, so its owner answers the pop-up.
  - Making the owner active again answers the owner.
  - A second pop-up made hidden changes nothing until it is shown.
  - Destroying the pop-ups gives the owner back.

## In winbox.js

`src/win16/user/enumerate.ts` has these calls. The desktop tells `enumerate.ts` of each window it makes active, and `DestroyWindow` tells it of each window destroyed.

Not followed, and known gaps:
- USER's three hidden windows are not modelled.
- A program's exported prologues are not patched, so a procedure passed to `EnumTaskWindows` without `MakeProcInstance` finds its own data here.
