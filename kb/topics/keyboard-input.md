---
kind: topic
name: Keyboard input
summary: How a key pressed in the browser becomes the virtual key a Windows 3.1 program sees, with the punctuation keys read out of the US keyboard driver's scan-code table, and how VkKeyScan finds the key a character is typed with.
probes: [misc]
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

## Not yet done

Other layouts, which Windows 3.1 loads as a separate DLL for each language, and `OemKeyScan`, `MapVirtualKey` and `ToAscii`. The first two share `VkKeyScan`'s tables and have been read, but nothing has recorded them.

## In winbox.js

`User.VIRTUAL_KEY_TRANSLATE` in `src/win16/user.ts` holds the names. `RasterInput.key` in `src/win16/user/raster-input.ts` posts the messages. `VkKeyScan` is in `src/win16/keyboard/scan.ts`, and reads its tables out of `KEYBOARD.DRV` on the disk as it is first called, through `src/win16/keyboard/driver-file.ts`.
