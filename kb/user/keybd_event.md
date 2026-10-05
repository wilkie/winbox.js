---
kind: function
module: USER
name: Keybd_Event
ordinal: 289
summary: The keyboard driver's way into USER, open to a program too — a key pressed or released, put in as the keyboard made it, which USER makes a system key or not.
versions:
  '3.1': exact
probes: [altchild]
source: src/win16/user/keybd-event.ts
topics: [keyboard-input, menus]
---

## Observed behaviour

`Keybd_Event` is called with registers, not a stack. [[read out]] Its code is at `USER.EXE` seg1 `4b59`.

- AL holds the virtual key. AH is 80h for a release and nought for a press (`4b6c`-`4b8b`). BL holds the scan code.
- A key is a system key, `WM_SYSKEYDOWN` or `WM_SYSKEYUP`, when Alt is down and Control is not (`4c3c`-`4c4e`). Alt's own press is one. Its release is one only if no other key was pressed while it was down; USER counts those keys at `32d`, and after one the release is a plain `WM_KEYUP` (`4c27`-`4c35`). Control is never one (`4c1d`).
- The system queue makes F10 a system key as it is taken, Alt or not (seg1 `3188`).

[[probe:altchild]] finds `KEYBD_EVENT` with [[fn:KERNEL.GetProcAddress]] and puts every key it presses in through it, as the keyboard driver would.

- [[measured]] Alt's press is `WM_SYSKEYDOWN` with bit 29 of `lParam` set, for Alt down. Its release alone is `WM_SYSKEYUP` without bit 29.
- [[measured]] A key pressed with Alt is `WM_SYSKEYDOWN` with bit 29, and what it types is `WM_SYSCHAR`: Alt and F types `f`, 66h.
- [[measured]] F10 alone is `WM_SYSKEYDOWN` and `WM_SYSKEYUP`, without bit 29.

winbox.js agrees with all of [[probe:altchild]]'s records, on both engines. The browser's keys go the same way as a program's: both engines make a key a system key by the rules above.

Not modelled: the scan code, which Windows puts in bits 16 to 23 of `lParam` and winbox.js leaves at nought, as it does for the browser's keys. The character a key types is the US keyboard's, unshifted unless Shift is down, for the letters, the digits, Space and the keys that type a control character.
