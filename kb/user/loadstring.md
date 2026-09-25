---
kind: function
module: USER
name: LoadString
ordinal: 176
summary: Copies one of a module's strings into a buffer, as much of it as fits with its terminating zero, and answers how many characters it copied.
versions:
  '3.1': exact
probes: [loadstr]
records: [sized, missing]
source: src/win16/user/LoadString.ts
---

## Observed behaviour

- [[measured]] [[probe:loadstr]] loads USER's string 4, "CursorBlinkRate", 15 characters long, into buffers of eight sizes, with a guard byte after each. A buffer of `n` bytes gets at most `n - 1` characters and then a zero, and the answer is how many characters were copied. So 5 gives "Curs" and answers 4; 15 gives "CursorBlinkRat" and answers 14; 16 and more give the whole string and answer 15.
- [[measured]] A buffer of 1 byte gets only the zero, and the answer is 0. A buffer of 0 bytes is not touched at all.
- [[measured]] Nothing is ever written past the buffer: every guard byte was left alone.
- [[measured]] A string the module does not have answers 0 and leaves the buffer as it was.

## Implementation

Until this probe, LoadString copied the whole string whatever the buffer's size. The Clipboard Viewer loads its strings into fixed buffers that sit next to the variable holding its instance handle, so it passed the overrun letters to `LoadAccelerators` as a handle and closed. All nine records now agree.
