---
kind: function
module: SHELL
name: RegisterShellHook
ordinal: 102
summary: Asks SHELL to post a window a message whenever a top-level window is made or goes — how Program Manager hears of other programs' windows.
versions:
  '3.1': exact
probes: [shlhook]
topics: [hooks]
source: src/win16/shell/shell-hook.ts
---

## Observed behaviour

[[probe:shlhook]] registers its own window, makes and destroys windows of every kind, then unregisters and does it again. winbox.js runs it whole, and all 30 of its records agree.

- [[measured]] It answers 1, registering and unregistering.
- [[measured]] While the window is registered, it is posted `OTHERWINDOWCREATED` for each top-level window with no owner that is made, overlapped or popup, hidden or shown, and `OTHERWINDOWDESTROYED` as each goes. The window is in `wParam`. A child and an owned popup bring nothing, and neither does showing a window.
- [[measured]] Once unregistered, it is posted nothing.

## Nuances

- [[read out]] It is SHELL's own `WH_SHELL` hook, `ShellHookProc`, that posts (`SHELL.DLL` seg4 `11ca`). The first window registered puts the hook in and registers three messages: `OTHERWINDOWCREATED`, `OTHERWINDOWDESTROYED` and `ACTIVATESHELLWINDOW` (seg4 `128c`). The last window unregistered takes the hook out.
- [[read out]] A flag of 2 registers the window as the shell's own as well. That window is posted `ACTIVATESHELLWINDOW` when USER calls the hook with code 3.
- [[read out]] A registered window that is a window no more is dropped from the list when there is next something to post.
- [[measured]] Program Manager registers itself as its frame window is made.
- USER calls the hook; see [[topic:hooks]].
