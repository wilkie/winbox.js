---
kind: function
module: USER
name: WindowFromPoint
ordinal: 30
summary: Answers the window at a point of the screen, passing over hidden and disabled children, static controls and group boxes.
versions:
  '3.1': exact
probes: [winpoint]
source: src/win16/user/window-from-point.ts
topics: [mouse-input, standard-controls]
---

## Observed behaviour

[[probe:winpoint]] makes a window holding one child of each kind: shown, hidden, disabled, a static control, a group box, and one with a child of its own. A second window covers part of it. The probe asks for points on each, as Championship Slots of the corpus asks where the mouse is.

- [[measured]] The answer starts from the top-level window that shows at the point. Its caption and frame count as the window, and a disabled top-level window is still answered.
- [[measured]] The answer then goes down to the child under the point, and to that child's child, and so on.
- [[measured]] A hidden child, a disabled child, a static control and a group box are passed over, and what lies beneath them answers. Nothing inside a disabled window is looked at, a top-level one included.
- [[measured]] Where no window shows, the answer is the desktop window, from [[fn:USER.GetDesktopWindow]]. A point off the screen answers nought.

[[fn:USER.ChildWindowFromPoint]] looks only at one window's own children:

- [[measured]] It answers the first child whose rectangle holds the point, whether hidden, disabled, static or not. The point is in the parent's client area.
- [[measured]] A point of the client area that no child holds answers the parent. A point outside the client area answers nought.

winbox.js agrees with all 30 records.
