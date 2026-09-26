---
kind: topic
name: Keyboard input
summary: How a key pressed in the browser becomes the virtual key a Windows 3.1 program sees, with the punctuation keys read out of the US keyboard driver's scan-code table.
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

## Not yet done

Other layouts, which Windows 3.1 loads as a separate DLL for each language, and `OemKeyScan`, `VkKeyScan` and `ToAscii`.

## In winbox.js

`User.VIRTUAL_KEY_TRANSLATE` in `src/win16/user.ts` holds the names. `RasterInput.key` in `src/win16/user/raster-input.ts` posts the messages.
