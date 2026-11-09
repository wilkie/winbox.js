---
kind: function
module: SHELL
name: HERETHARBETYGARS
ordinal: 100
summary: The window procedure of SHELL's windows for a DDE conversation, which ShellExecute starts for an association that asks for DDE.
versions:
  '3.1': exact
probes: [ugaps]
records: [dde]
source: crates/winbox-win16/src/shell/internal_procs.rs
topics: [user-internals]
---

## Observed behaviour

- [[read out]] seg4 `0550`-`065e`, the property named `ddeconv` (SHELL's data seg13 `00a0`): `WM_DDE_ACK` with no partner sets the sender as one and answers `SetProp`'s 1; with the property 1, or from the partner, frees the block in lParam's high word, and from the partner destroys the window; `WM_DDE_TERMINATE` from the partner posts one back, takes the property away and destroys the window; `WM_DESTROY` with a partner sets the property to 1, posts the partner `WM_DDE_TERMINATE`, dispatches the task's DDE messages until the partner's `WM_DDE_TERMINATE` to it or ten seconds (`04ec`-`054c`), and takes the property away. Anything else, and `WM_DESTROY` after, is `DefWindowProc`'s.
- [[measured]] [[probe:ugaps]], on windows of the probe's: every case above, the blocks freed, the windows destroyed and the partner's terminations as read out.

## Inside Windows

- [[read out]] `SHELL.DLL` seg4 `0550`: `WM_DESTROY`, `WM_DDE_TERMINATE` and `WM_DDE_ACK`, with the conversation kept as a property of the window (`GetProp`, `SetProp` of the name at `[0A0h]`): an acknowledgement frees the command's block, and its end destroys the window.

## Callers

- No file of the installations or the corpus imports it (`kb/data/shell-callers.json`).

## Implementation

**Implemented (a).** Both engines answer it as read out, the name laid in SHELL's data where SHELL keeps it (`HERETHARBETYGARS` in `src/win16/shell/internal-procs.ts`, `shell/internal_procs.rs`). Not done: WinBox's `ShellExecute` making these windows for an association that asks for DDE. See [[topic:user-internals]].
