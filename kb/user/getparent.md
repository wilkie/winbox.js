---
kind: function
module: USER
name: GetParent
ordinal: 46
summary: A child's parent, or a pop-up's owner — but nought for an overlapped window, owned or not.
versions:
  '3.1': exact
probes: [ownerpos, owners]
source: src/win16/user/window-queries.ts
topics: [enumerating-windows]
---

## Observed behaviour

- [[measured]] A child's parent is its parent, and a pop-up's is its owner ([[probe:owners]]).
- [[measured]] [[probe:ownerpos]] makes a window as the Visual Basic runtime makes its hidden main window: a pop-up with a system menu at (320, 240), nought by nought, shown without being activated. It then makes an overlapped window with that pop-up as its owner. `GetParent` of the overlapped window answers **nought**, though [[fn:USER.GetWindow]]'s `GW_OWNER` answers the pop-up. A pop-up the same window owns answers it.
- [[measured]] The hidden window is at (320, 240), with an empty client area there. `ScreenToClient` of it takes (20, 55) to (-300, -185).

## Why it matters

The Visual Basic runtime places a form in its "parent's" coordinates. It asks `GetParent` and, given a window, converts through `ScreenToClient` of it. winbox.js answered the owner for every window at the top. Four Seasons' form was placed 320 pixels left of where Windows puts it, and 193 above. Answered as Windows answers, the form, its menu and its shareware notice are where Windows has them.
