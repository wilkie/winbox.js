---
kind: function
module: GDI
name: MakeObjectPrivate
ordinal: 463
summary: Marks a GDI object private to the system, or takes the mark off; answers the mark as it was, 2000h or nought.
versions:
  '3.1': exact
probes: [gdimisc]
records: [private]
topics: [small-queries]
---

## Observed behaviour

- [[measured]] A new brush marked answers nought; marked again, 2000h; cleared, 2000h; cleared again, nought ([[probe:gdimisc]]).
- [[measured]] Any `fPrivate` not nought sets the mark: 2 sets it as 1 does.

## Inside Windows

[[read out]] `GDI.EXE` seg1 `0e68`: no handle is checked. The word at +2 of the object's header -- its type and flags -- has flag 2000h taken, then cleared, then set again where `fPrivate` is not nought; the flag taken is answered.

## Implementation

In both engines as read out, the mark kept with the object; a handle of no object answers nought. What the mark keeps the object from in Windows -- `DeleteObject` and the task's clean-up -- is not followed: WinBox does not free a task's objects as it ends. [[probe:gdimisc]] agrees in both.
