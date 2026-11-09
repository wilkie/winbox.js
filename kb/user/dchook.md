---
kind: function
module: USER
name: DCHook
ordinal: 362
summary: USER's hook on the device contexts it lends, which GDI calls where the context's region is stale; it works the region out again.
versions:
  '3.1': exact
probes: [visfam, dcentry, dchook]
source: crates/winbox-win16/src/dc_entries.rs
topics: [visible-regions, device-context-internals]
---

## Observed behaviour

- [[measured]] A context USER lends has `DCHOOK` for its hook ([[fn:GDI.GetDCHook]]; [[probe:dchook]]).
- [[measured]] `SetHookFlags(DCHF_INVALIDATEVISRGN)` on a window's context has the hook called at the next call that uses it: a visible region a program selected gives way to the window's again; one it saved with `SaveVisRgn` is still there to restore; an origin it set goes back to the window's corner ([[probe:visfam]], `hook`, `origin`). A whole-window context left stale by a child's move has the child where it is now ([[probe:dcentry]], `stale`).

## Inside Windows

[[read out]] `USER.EXE` seg1 `8a00`, called by GDI with the context, the code, the data -- the context's entry, as USER set it with [[fn:GDI.SetDCHook]] (seg1 `890d`) -- and nought. For `DCHC_INVALIDVISRGN` (1): the flag cleared, `SetHookFlags(DCHF_VALIDATEVISRGN)` (`8a18`); then, for an entry in use, the region worked out by USER's rule (seg1 `1582`), the region given to [[fn:USER.GetDCEx]] combined again (`8a3b`-`8a82`), `SelectVisRgn`, and the origin and brush origin set from the window (seg1 `1540`). It answers 1, for any code. USER sets the flag on an entry in use as windows change (seg1 `8b4f`, from `8aa0`); a free entry is emptied instead. See [[topic:visible-regions]].

## Implementation

`crates/winbox-win16/src/dc_entries.rs`. WinBox runs it itself where a context's hook is USER's: GDI's calls run it first where the flag is set, and so does reading the visible region. Called through the processor, at the address `GetProcAddress` gives, it finds the entry by the data, the context's handle here, and does the same.
