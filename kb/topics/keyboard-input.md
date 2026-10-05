---
kind: topic
name: Keyboard input
summary: How a key pressed in the browser becomes the virtual key a Windows 3.1 program sees, with the punctuation keys read out of the US keyboard driver's scan-code table, how VkKeyScan finds the key a character is typed with, and where the system keys go when a child window has the focus.
probes: [misc, minis2, minis3, altchild]
---

A Windows program sees a key as a **virtual key**, a byte from `KEYBOARD.DRV`, in the `wParam` of `WM_KEYDOWN` and `WM_KEYUP`. `TranslateMessage` then makes a `WM_CHAR` from what the key typed. A browser names the key by its place on the keyboard, `KeyA` or `Equal`, and winbox.js turns that name into the virtual key the driver would give.

- [[documented]] Letters and digits are their own capital letter and digit, `41h`–`5Ah` and `30h`–`39h`. Named keys such as Enter, the arrows and the function keys have fixed virtual keys.
- [[read out]] The keys that are neither come from the US keyboard driver's table of one virtual key for each scan code, at offset `12EEh` of `KEYBOARD.DRV`. Read at the scan codes those keys send, the table gives:

  | Key | Scan code | Virtual key |
  | --- | --- | --- |
  | `-` | 0Ch | BDh |
  | `=` | 0Dh | BBh |
  | `[` | 1Ah | DBh |
  | `]` | 1Bh | DDh |
  | `;` | 27h | BAh |
  | `'` | 28h | DEh |
  | `` ` `` | 29h | C0h |
  | `\` | 2Bh | DCh |
  | `,` | 33h | BCh |
  | `.` | 34h | BEh |
  | `/` | 35h | BFh |
  | the 102nd key | 56h | E2h |

  The same table gives both Shift keys `10h` and Control `11h`.
- [[measured]] Calculator takes its keys through an accelerator table. Before these were mapped, `=` sent no message at all. So `+`, which is Shift and `=`, did nothing, and typing `12+3=` left 123 on the display. Now it gives 15.

## The key a character is typed with

[[fn:KEYBOARD.VkKeyScan]] answers the other way round: given a character, the virtual key in the low byte and the shift state in the high, 1 for Shift, 2 for Ctrl and 4 for Alt. [[probe:misc]] records it for every character from 0 to 255, and winbox.js agrees with all 24 records.

- [[read out]] It is the driver's own (seg5 `0007`), and runs in this order. FFh answers `FFFFh`. A capital letter is its key with Shift, `0141h` for `A`; a small letter is the same key alone.
- [[read out]] Anything else is looked for in the layout's character tables, up to four, in order, and the first match answers. Table 0 holds each key's character unshifted and shifted, in pairs; a shifted match adds Shift. The others hold one character a key, with the table's own shift state: 0, 2, 6 and 7 for tables 0 to 3, a byte each at seg5 `0000`.
- [[read out]] The US layout fills only the first two. Table 0 has 34 keys: space, Tab, Enter, Backspace, Escape, the digits and the punctuation, and the numeric keypad's operators. Table 1, with Ctrl, has 12. Tables 2 and 3, with Ctrl and Alt, are empty, so no US character answers with Alt.
- [[read out]] A character no table has is Ctrl and a letter from 01h to 1Ah, and `FFFFh` past it.
- [[measured]] The order shows in three answers. Escape, 1Bh, is found in table 0 first and answers `001Bh`, not Ctrl and `[`. 1Ch is found in table 1 at the `\` key before the 102nd key, and answers `02DCh`. Line feed, 0Ah, is Ctrl and Enter, `020Dh`, from table 1, and not Ctrl and `J`.
- [[measured]] Every character from 80h up answers `FFFFh`, `é` and `£` among them: the US tables have none.

The tables are in the driver's seg2 when `SYSTEM.INI` names no layout library in `keyboard.dll=`, as the installation does not. Their counts and places are a header the driver copies into its data as it starts, from seg3 `0000`.

## Mapping keys and scan codes

[[fn:KEYBOARD.MapVirtualKey]] maps one of three ways, by its second argument. [[read out]] It is the driver's own (seg8 `0000`), and looks only at the low byte of the type. [[probe:minis2]] records every code from 0 to 255 for each of the three types, and winbox.js agrees with all 768 answers.

- [[read out]] **Type 0**, a virtual key to its scan code: the first scan code whose entry in the scan-code table is that key. A key only the numeric keypad has, such as `VK_NUMPAD0` (60h), is looked up in a second table of the keypad's keys, which starts at scan code 47h. Anything else answers 0.
- [[measured]] So `VK_SHIFT` (10h) answers 2Ah, the left Shift key, and `VK_INSERT` (2Dh) answers 52h, the keypad's Insert. 96 keys have a scan code.
- [[read out]] **Type 1**, a scan code to its virtual key: the table's entry, or 0 past the table's end. The end is checked with "greater than", so the code one past it, 59h, reads the byte after the table.
- [[measured]] That byte is 0 in the US driver. Scan code 0, and 54h and 55h, answer FFh, the table's mark for no key.
- [[read out]] **Type 2**, a virtual key to its character: a digit or a capital letter is itself. Any other key is looked up in the first layout table, and answers its unshifted character, with the code's high byte kept. A key that has none answers 0. No dead keys are reported, as the US layout has none.
- [[measured]] So `VK_OEM_1` (BAh) answers `;`, and the keypad's `VK_MULTIPLY` (6Ah) answers `*`. `VK_CANCEL` (3) answers 3, the character Ctrl and Break types. 59 keys have a character.

## The keys as they are now

- [[read out]] [[fn:USER.GetAsyncKeyState]] reads the keys as they are, not as the program's messages have them. It answers 8000h while a key is down, plus 1 if the key has gone down since it was last asked, which asking clears. Only the low byte of the key is looked at. The mouse buttons count too: `VK_LBUTTON`, `VK_RBUTTON` and `VK_MBUTTON`.
- [[measured]] With nothing pressed, [[probe:minis3]] finds every key answering nought.
- [[read out]] [[fn:USER.SwapMouseButton]] keeps the value it is given as it is, and answers the one before. `GetSystemMetrics(SM_SWAPBUTTON)` then answers the value: 5 for a 5. [[measured]] The recording shows each call answering what the one before set.

## System keys, and a child with the focus

A key goes to the window with the focus, which in a program like Notepad is a child: its edit control. The keys that reach the menu and the system menu, Alt+F4 among them, still work there, because the child's `DefWindowProc` passes them up. [[probe:altchild]] puts its keys in through [[fn:USER.Keybd_Event]] with the focus in an edit control, in a child of its own class, in that child one level further down, and in the top-level window itself. It records every message each window procedure is handed.

[[read out]] `DefWindowProc` takes the keys at `USER.EXE` seg1 `616e`-`6299`. It keeps two flags of its own: Alt pressed with nothing after it (`1d0`), and F10 pressed (`352`).

- **A system key with Alt down** (`61be`). Alt's first press sets the Alt flag; any other key clears it; a repeat leaves it. The F10 flag is cleared. Then `578d` looks at the key. [[measured]] Alt+F4 posts `WM_SYSCOMMAND` with `SC_CLOSE` to the **active window**, the child's top-level window, from any depth. That window takes it from its queue, is sent `WM_CLOSE`, and is destroyed. [[read out]] Nothing is posted if the active window's class has `CS_NOCLOSE` (`57ce`). Alt with Tab, Escape or F6 sends the active window `SC_NEXTWINDOW` or `SC_PREVWINDOW` (`57a7`); winbox.js does not follow that yet.
- **A system key without Alt** (`61f6`). F10 sets its flag. Shift and Escape sends the window `SC_KEYMENU` with a space, its system menu.
- **A key released**, `WM_KEYUP` or `WM_SYSKEYUP` (`6180`). Alt with its flag set, or F10 with its flag set, sends `WM_SYSCOMMAND` with `SC_KEYMENU` and nought to the **top-level window**, past every window between (seg2 `0ab8` walks the parents). Any release clears both flags. [[measured]] Alt alone, or F10 alone, from a child two deep: the top-level window is sent `SC_KEYMENU`, and the window in between hears nothing.
- **A character typed with Alt**, `WM_SYSCHAR` (`622c`). Tab and Escape are nothing. A space in a child is the parent's: the same `WM_SYSCHAR` is sent to it. [[measured]] From a child two deep, Alt+Space goes to its parent, then to the top-level window, whose `DefWindowProc` opens the system menu. Any other character is `SC_KEYMENU` with it, sent to the window itself. [[measured]] So Alt+F in a child is `WM_SYSCOMMAND` to the child, and the top-level window is sent no `WM_SYSCOMMAND` at all.
- **`SC_KEYMENU` in a child** (seg1 `04dd`, seg17 `00fe`). The menu is that of the nearest window the child lies in that is not a child, or that has a system menu of its own. [[measured]] It opens as the top-level window's menu: `WM_INITMENU` and the rest go to that window.

[[measured]] Before this was followed, Alt+F4 did nothing in Notepad while its edit box had the focus. Both engines carried the child's `SC_CLOSE` out on the child itself. Alt and a letter worked, by sending the top-level window `WM_SYSCOMMAND`, which Windows does not send. Both engines now agree with all 20 of [[probe:altchild]]'s records.

Not measured: a child with a system menu of its own, as an MDI document window has. USER would track that child's own system menu; winbox.js sends `SC_KEYMENU` on to the top-level window, as before. Not followed: Enter typed with Alt in a minimized window, which posts it `SC_RESTORE` (`6238`), and the beep for a character without Alt (`6297`).

## Not yet done

Other layouts, which Windows 3.1 loads as a separate DLL for each language, and `OemKeyScan` and `ToAscii`. `OemKeyScan` shares `VkKeyScan`'s tables and has been read, but nothing has recorded it.

## In winbox.js

`User.VIRTUAL_KEY_TRANSLATE` in `src/win16/user.ts` holds the names. `RasterInput.key` in `src/win16/user/raster-input.ts` turns a key into its virtual key, and `RasterInput.virtualKey`, which [[fn:USER.Keybd_Event]] calls too, posts the messages. `DefWindowProc` takes the system keys in `src/win16/user/DefWindowProc.ts`; the Rust engine has them in `crates/winbox-win16/src/key_input.rs` and `menu_default.rs`. `VkKeyScan` and `MapVirtualKey` are in `src/win16/keyboard/scan.ts`. Its tables, and the ANSI and OEM translations, are winbox.js's own, in `src/win16/keyboard/tables.ts`, since no Windows file is shipped. They match `KEYBOARD.DRV`'s, which `scripts/oracle/keyboard-tables.mjs` makes them from.
