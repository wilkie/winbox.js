---
kind: topic
name: Small questions to USER and GDI
summary: What USER and GDI answer to the one-line questions a program asks — character classes, the keyboard state, points between windows, the last message's time and place, whether a handle is a menu or which kind of GDI object it is, and the settings a device context reads back — as the queries probe recorded them.
probes: [queries]
---

A program asks USER and GDI many small questions that nobody thinks of as part of the API until a program asks one that was never answered. [[measured]] [[probe:queries]] asks each of them once or twice on the VGA, and winbox.js agrees with all 56 records. Before, every one of them was a stub that answered nought.

## USER

- [[fn:USER.IsCharAlpha]], `IsCharAlphaNumeric`, `IsCharUpper` and `IsCharLower` follow the Windows character set: A to Z and a to z, and the accented letters from C0h up. The multiplication and division signs, D7h and F7h, are not letters. Among the rest of the upper half, 8Ah, 8Ch and 9Fh are capitals, and 9Ah, 9Ch and DFh small letters; DFh, `ß`, has no capital. The digits are alphanumeric and nothing else.
- `SetKeyboardState` sets USER's whole key-state table from 256 bytes, and `GetKeyboardState` gives it back as it was set. [[fn:USER.GetKeyState]] then reads it: 1Bh set for key 41h is 1Bh.
- `MapWindowPoints` moves points from one window's client area into another's, the screen being nought. It answers nothing on Windows 3.1.
- `IsMenu` is 1 for a menu, and nought for a window, for nought, and for a menu destroyed.
- `InSendMessage` is nought outside any message, in a message the program sent itself, and in one it posted. A message another task sent is not recorded.
- `GetMessageTime` and `GetMessagePos` are the time and point of the message `GetMessage` last took.
- `AnyPopup` is nought with only the program's own overlapped window shown, and 1 with a pop-up it owns shown.

## GDI

- `GetBkMode` is `OPAQUE` for a new device context, `GetTextAlign` and `GetTextCharacterExtra` nought, and each reads back what was set.
- `GetDCOrg` is nought for the screen and a window's client area's corner on the screen for its device context.
- [[fn:GDI.IsGDIObject]] answers what kind of object a handle is, not just whether it is one.
- `CreateBitmapIndirect` makes the bitmap its `BITMAP` describes, bits and all.
- `SetBitmapDimension` answers the dimension a bitmap had, nought for a new one, and `GetBitmapDimension` the one set, the width in the low word. The `Ex` forms write a `SIZE` and answer 1.
- `SetMapperFlags` answers the flags it replaces, nought for a new device context. `GetAspectRatioFilter` is nought until bit 1 is set, and then 96 by 96 on the VGA. winbox.js takes that from the display's logical pixels an inch; the documentation says the display's aspect ratio, and on the VGA the two agree.

## Implementation

USER's are in `src/win16/user/queries.ts`, the character classes kept as the probe recorded them. GDI's are in `src/win16/gdi/queries.ts`. `GetMessage` and `PeekMessage` keep the last message's time and point on the task. [[fn:USER.DestroyMenu]] now frees a menu's handle; its pop-ups, which the documentation says go with it, are left.
