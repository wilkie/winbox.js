---
kind: function
module: MMSYSTEM
name: mciExecute
ordinal: 712
summary: Runs an MCI command string, showing its error in a box.
versions:
  '3.1': exact
probes: [mmmisc]
records: [mci, box]
source: crates/winbox-win16/src/mmsystem/mci_execute.rs
topics: [sound-devices]
---

## Observed behaviour

- [[measured]] [[probe:mmmisc]]: a command that succeeds answers 1 and shows nothing. One that fails answers 0 after a box of no owner: its title the word after the command -- `nosuch` for `status nosuch mode`, `waveaudio` for `  play   waveaudio   from 99` -- or empty for a command alone, its text the error's, an OK button and the hand.

## Inside Windows

- [[read out]] seg5 `1293`: `mciSendString` with no buffer; nought is TRUE. Else `mciGetErrorString` into 80h bytes, or string 7D1h; the title a word as MCI reads one (seg5 `22d5`): quotes taken off, `""` one quote, an unclosed quote no title at all; `MessageBox` with `MB_ICONHAND`.

## Implementation

As read out: `crates/winbox-win16/src/mmsystem/mci_execute.rs`.
