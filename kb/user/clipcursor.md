---
kind: function
module: USER
name: ClipCursor
ordinal: 16
summary: Keeps the cursor inside a rectangle, which takes the screen's place even where it runs off the screen; the cursor is moved inside it at once.
versions:
  '3.1': exact
probes: [cursclip, userwin]
source: src/win16/user/userwin.ts
topics: [window-calls]
---

## Observed behaviour

[[measured]] [[probe:cursclip]] moves the cursor with [[fn:USER.SetCursorPos]] and reads it back with [[fn:USER.GetCursorPos]], with no clip and with several.

- **No clip:** the cursor is held to the screen. On the VGA, (-5, -5) comes back as (0, 0), and (700, 500) or (640, 480) as (639, 479).
- **A clip:** the rectangle takes the screen's place, right and bottom outside it. Clipped to (10, 20)-(300, 200), (0, 0) comes back as (10, 20), (1000, 1000) and (300, 200) as (299, 199), and (9, 150) as (10, 150).
- **At once:** a cursor at (500, 400) when `ClipCursor` gives (10, 20)-(300, 200) is at (299, 199) straight after.
- **Off the screen:** the rectangle is kept as given, not cut to the screen. [[fn:USER.GetClipCursor]] answers (-50, -50)-(700, 500) for one so, and the cursor goes to (-10, -10) and (699, 499).
- **Backwards:** the left and top are taken first, then the right and bottom less one. A rectangle of (200, 200)-(100, 100) holds the cursor at (99, 99) wherever it is sent. An empty one, (100, 100)-(100, 100), does the same.
- **Released:** `ClipCursor(NULL)` gives the screen back, and [[fn:USER.GetClipCursor]] answers it, (0, 0)-(640, 480).

winbox.js holds the cursor so wherever it moves: `SetCursorPos`, the page's pointer, and `mouse_event`. It agrees with all 23 records. It had kept the rectangle without holding the cursor to it.
