---
kind: function
module: USER
name: RedrawWindow
ordinal: 290
summary: Makes a rectangle or region of a window due, or valid, or due a paint of its own, through USER's walk of the window and the windows in it, and paints or erases them now if asked.
versions:
  '3.1': exact
probes: [rdwwalk, rdw31]
source: src/win16/user/RedrawWindow.ts
topics: [painting, visible-regions]
---

## Observed behaviour

[[probe:rdwwalk]] calls `RedrawWindow` with each of its flags and the combinations that matter on two trees: P, a pop-up with a border and without `WS_CLIPCHILDREN`, with children A (with a child A1), B overlapping A, and Z wholly outside P's client area; and Q, a pop-up with `WS_CLIPCHILDREN`, with children C (with C1), D overlapping C, both `WS_CLIPSIBLINGS`, and X with `WS_EX_TRANSPARENT` overlapping D. Each case starts with nothing due. It logs what the call answers, the messages sent while it runs, each window's update region as it answers, and the messages the message loop brings after. [[probe:rdw31]] is the same program marked for Windows 3.10. [[measured]]

- **It answers 1**, for every case here.
- **`RDW_INVALIDATE`** makes the region due through the walk: P's children are due where it meets them, each erased and sent `WM_NCPAINT` before its paint, though P is not erased; Q's are not, but with `RDW_ALLCHILDREN`. A region is given whole: A's `WM_NCPAINT` region is the whole region given, in screen terms, complex where it is complex.
- With `RDW_ALLCHILDREN` and a rectangle, Q's children with `WS_CLIPSIBLINGS` each take their rectangles out of what is left for those behind them and for Q: C, the first made and in front of D, is due all of the rectangle it meets, D what C left of it, and Q what neither covers.
- **`RDW_NOCHILDREN`**: the window alone.
- **`RDW_ERASE` and `RDW_FRAME` without `RDW_INVALIDATE`** do nothing. **`RDW_INVALIDATE | RDW_VALIDATE`** makes due, and validates nothing.
- **`RDW_FRAME`**: the window is sent `WM_NCPAINT` before its paint, with 1 for all of it, or the region.
- **`RDW_UPDATENOW`** paints during the call: each window `WM_NCPAINT` if its frame is due, `WM_ERASEBKGND` if its erase is, then `WM_PAINT`; then the windows in it, front to back, the same -- none with `RDW_NOCHILDREN`. Nothing is due after.
- **`RDW_ERASENOW`** sends `WM_NCPAINT` and `WM_ERASEBKGND` during the call, and `WM_PAINT` is left for the message loop: of P alone, P having no `WS_CLIPCHILDREN`; of every window with `RDW_ALLCHILDREN`, Z among them, though nothing of it shows; of the window alone with `RDW_NOCHILDREN`. With both, `RDW_UPDATENOW` is what is done.
- **`RDW_INTERNALPAINT`** gives each window it reaches -- the walk's, as for `RDW_INVALIDATE` -- one `WM_PAINT` of its own: `rcPaint` empty, no erase, no `WM_NCPAINT`, nothing due. `RDW_NOINTERNALPAINT` after it takes them back: nothing is sent. `RDW_INTERNALPAINT | RDW_VALIDATE` gives the paint and validates nothing.
- **`RDW_VALIDATE`** of all of a window whose frame is still due leaves its frame due: its paint has `rcPaint` empty after `WM_NCPAINT` with a region of its frame alone. A child without a border so validated has nothing left, and is sent `WM_NCPAINT` with 1 from its parent's `BeginPaint`. A rectangle validated leaves the window due the rest of itself, frame included, `WM_NCPAINT` with that region.
- **`RDW_NOERASE`** alone does nothing; with `RDW_VALIDATE` the erase is taken back. **`RDW_NOFRAME`** with `RDW_VALIDATE` takes back the frame: of all of P, nothing is sent at all.
- **A program made before 3.10** (`rdwwalk`, the probes' own marking): all of a window made due without `RDW_ERASE` takes back an erase it was due; Z, outside P's client area, is made due all of itself, `GetUpdateRgn` answering nothing, and is sent `WM_NCPAINT` with 1 and a paint with `rcPaint` empty. A minimized window of a class with an icon is made due.
- **A program made for 3.10** ([[probe:rdw31]]): the erase stays; Z is passed over and sent nothing; the minimized window of a class with an icon is not made due without `RDW_FRAME`, and with it is.

## Nuances

- The update region of a window outside the client area it is in is not empty for its walk, only for `GetUpdateRgn`: it is still painted, with nothing to show.
- `RDW_ERASENOW` erases a window that shows nothing (Z): it has an update region.
- A window whose frame alone is due is sent `WM_NCPAINT` from its parent's `BeginPaint`, before the parent's paint, not from its own.

## Inside Windows

[[read out]] `USER.EXE` seg1 `aabf`, its checks: the window (`aac8`), the region a region (`aadd`-`aaec`) -- else KERNEL's `HandleParamError`, the call answering nought -- and flags above 0FFFh only warned of (`aaef`-`aafa`). Its body `3e1e`:

- A window shows unless it or one it is in is hidden, or one it is in minimized; the window itself minimized shows but for its client area, asked for a window of a program made for 3.10 without `RDW_FRAME`, where its class has an icon (`3e35`-`3e46`, `1c5f`). Not showing, it answers 1, nothing done (`3e4f`, `3ecd`).
- With `RDW_INVALIDATE` or `RDW_VALIDATE` (`3e56`), the rectangle or region, in client terms, is moved by the client area's corner onto the screen (`3e5c`-`3ebb`); with neither, all of the window. Then `3ed7` with its flags and USER's own 1000h.
- `3ed7`: all of the window is its client area, or with `RDW_FRAME` its whole rectangle (`3edd`-`3efc`, `16b7`); made due, the rectangle cut to those of the windows it is in, nothing where one is hidden or minimized (`3f27`-`3f3e`, `8bb3`); the lock told (`3f41`-`3f7c`); the walk `4034`. Then `RDW_UPDATENOW`: `441d` with the windows in it but for `RDW_NOCHILDREN` (`3f93`-`3fad`); else `RDW_ERASENOW`: `7913` with `DSP_ALLCHILDREN` for `RDW_ALLCHILDREN`, nought for `RDW_NOCHILDREN`, else `DSP_ENUMCLIPPEDCHILDREN` (`3faf`-`3fcf`).
- The walk `4034`: a window whose rectangle, cut, is empty is passed over -- but for a window of a program made before 3.10 given all of itself, which is then given all of itself and takes nothing out (`406e`-`4084`). Without `WS_CLIPCHILDREN` the window is given the region before the windows in it, with it after (`40c9`, `4180`). The windows in it are walked where it is not minimized, `RDW_NOCHILDREN` is not given, and `RDW_ALLCHILDREN` is or it has no `WS_CLIPCHILDREN`, each told to erase and draw its frame where made due (`40e8`-`4112`), and where its client area, cut, is not empty -- or is, for a window of a program made before 3.10 given all of itself (`4117`-`4139`). The region used up, the rest are walked on where `RDW_INTERNALPAINT` or `RDW_NOINTERNALPAINT` is given, with those alone (`415e`-`416c`). A window walked as one in another, with `WS_CLIPSIBLINGS`, without `WS_EX_TRANSPARENT`, takes its rectangle out of the region where it validates or its parent has `WS_CLIPCHILDREN` (or its task's `GACF_SUBTRACTCLIPSIBS`) (`4190`-`41f5`).
- What each is given, `4202`: with `RDW_INVALIDATE`, `RDW_INTERNALPAINT`, `RDW_ERASE` or `RDW_FRAME` (`4221`), `RDW_INTERNALPAINT` its flag 1000h of the word at 24h (`422b`), and only with `RDW_INVALIDATE` the rest (`4235`): the flag 20h of it where another task invalidates (`4242`-`424c`), its erase taken back where all of it is given to a window of a program made before 3.10 (`4250`-`425c`), `RDW_ERASE` and `RDW_FRAME` marked (`4260`-`4270`), and the region added to its update region, or all of it (`4274`-`4307`). Else validated (`4309`): nothing where USER's 1000h is given and another task made it due (`4315`-`4320`); `RDW_NOINTERNALPAINT` takes its paint of its own off (`4323`); with `RDW_VALIDATE` alone, `RDW_NOERASE` its erase (`4334`), `RDW_NOFRAME` its frame (`433d`), and the region cut from its update region -- all of it, while its frame is due, its client area (`4353`-`4369`) -- nothing left, no update region (`434a`-`43e2`). A window that came to be due, or stopped being, is counted in its queue's paints (`42c8`-`42e6`, `43e6`-`43f9`, seg1 `017b`, `01a2`).
- The bit 4 of the byte at 26h is set by `CreateWindow` for a window whose module `GetExpWinVer` answers 30Ah or more (seg8 `0425`-`0432`); bit 8 of it, for one of a program before 3.10 with `GACF_ALWAYSSENDNCPAINT`, sends the frames of the windows it is in with captions over it too (`0438`-`044c`, seg1 `40d9`, `3fda`).
- A paint of its own is taken as its `WM_PAINT` is taken (`7864`-`786a`), by `UpdateWindow` (`4469`-`446f`) and by `BeginPaint` (`7643`); with no update region `BeginPaint`'s region is empty (`7640`). `WM_NCPAINT`'s region is 1 where the window is due all of itself, else a copy of its update region (`7ba0`-`7be4`, `7b52`).

## Implementation

`src/win16/user/RedrawWindow.ts`, through `redrawThrough` and `invalidateThrough` in `src/win16/user/invalidate-through.ts`, `updateNow` in `UpdateWindow.ts` and `syncPaintFrom` in `erase.ts`; in Rust `redraw_window` in `user_calls/update_region.rs`, `invalidate_through.rs`, and `update_now` and `sync_paint_from` in `paint.rs`. Both engines agree with all 1064 records of [[probe:rdwwalk]] and all 1023 of [[probe:rdw31]]. Before, both made the whole of each window due -- its children only with `RDW_ALLCHILDREN` -- and kept neither rectangle nor region, followed none of `RDW_INTERNALPAINT`, `RDW_NOINTERNALPAINT`, `RDW_NOERASE`, `RDW_NOFRAME` or `RDW_ERASENOW`, and painted every window with `RDW_UPDATENOW` whatever `RDW_NOCHILDREN` asked.

Not followed: the flag 20h for a window invalidated by another task, and so a program's validation of it passed over (`4242`-`424c`, `4315`-`4320`); `GACF_NOHRGN1` and `GACF_SUBTRACTCLIPSIBS` (`40af`-`40c4`, `41b7`-`41ca`) and the frames bit 8 of the byte at 26h asks for (`40d9`, `3fda`) -- WinBox keeps no compatibility flags; the lock told the frame's rectangle with `RDW_FRAME` (`3f41`-`3f7c`: WinBox tells the client area's); `RedrawWindow` of the desktop (no window): the desktop's own part drawn at once, as before, where Windows makes the desktop due. Not recorded: a paint of its own taken by `PeekMessage` with `PM_NOREMOVE`, which WinBox takes as Windows' `7864` does.
