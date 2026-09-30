---
kind: topic
name: The cursor a window sets
summary: How Windows 3.1 asks the window under the mouse for its cursor with WM_SETCURSOR as each mouse message is taken, and what DefWindowProc answers — the class's cursor, a border's sizing cursor, the arrow — as the setcur probe recorded it.
probes: [setcur]
---

The cursor is one for the whole screen. Windows does not keep a cursor for each window. It asks the window under the mouse for one each time the mouse does something there.

[[measured]] [[probe:setcur]] has three windows log `WM_SETCURSOR` and `WM_MOUSEMOVE` and pass both on to [[fn:USER.DefWindowProc]]. `A` is a top-level window whose class's cursor is the I-beam, `C` is a child of `A` whose class's cursor is the cross, and `N` is a window whose class has none. The probe moves the cursor, shows, moves and destroys windows under it, and reads [[fn:USER.GetCursor]] after each. winbox.js agrees with every record.

## When a window is asked

- As a mouse message is taken for a window, Windows first sends the window `WM_SETCURSOR`. `wParam` names the window, the low word of `lParam` is the hit-test code, and the high word is the mouse message. The high word is `WM_MOUSEMOVE`, 200h, over the caption and the borders as well as over the client area. A move in the client area then follows it.
- The move USER makes up when a window is shown, moved or destroyed under the cursor asks too ([[topic:mouse-input]]). A repaint asks nothing.
- Moves not yet taken become one. The cursor set somewhere and a window then shown under it make a single move, and only the new window is asked.
- Over the desktop, the program is asked nothing, and the cursor is the arrow.

## What DefWindowProc answers

- **A child** passes the question to its parent first, still naming the child. The parent leaves a child's client area to the child, so over `C` the cursor is the cross, not `A`'s I-beam.
- **In its own client area**, a window shows its class's cursor. A class with none leaves the cursor as it was: the wait cursor the program had set stayed.
- **On a border**, the sizing cursor for that side: `IDC_SIZEWE` left and right, `IDC_SIZENS` top and bottom, `IDC_SIZENWSE` at the top-left and bottom-right corners, and `IDC_SIZENESW` at the other two.
- **On the caption, the system menu box and the maximize box**, the arrow.
- **To begin with**, before anything is set, the cursor is the arrow. `SetCursor` answers the arrow's handle.

Not measured: the mouse captured, a press on nothing (`HTERROR`), and a child's own border.

## In winbox.js

`src/win16/user/set-cursor.ts`. The window is asked as `GetMessage` or `PeekMessage` takes a mouse message from the queue. The page's own pointer stands in for the cursor, so nothing draws it on the screen. The corpus survey draws the cursor into its picture of the screen, as the display driver would draw it, to compare with Windows' screenshots: `withCursor` in `cursor-api.ts`. With that done, the cursor that Champ's edit field sets matches, and its screen matches Windows' pixel for pixel.
