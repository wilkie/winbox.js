---
kind: function
module: USER
name: WinHelp
ordinal: 171
summary: Starts Windows Help on a help file, or tells it that a program no longer needs it; with Help not running, the latter succeeds.
versions:
  '3.1': partial
probes: [winhelp]
records: [quit]
source: src/win16/user/WinHelp.ts
---

## Observed behaviour

- [[measured]] [[probe:winhelp]] calls `WinHelp` with `HELP_QUIT`, for a help file no one has opened, while Windows Help is not running. The answer is 1: there is nothing to close, and that counts as success.
- Notepad makes this call as it closes, and stays open if it fails.

## Implementation

`HELP_QUIT` answers TRUE. Every other command would start `WINHELP.EXE`, and winbox.js cannot start another program yet, so they answer FALSE.
