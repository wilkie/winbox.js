---
kind: topic
name: Visible regions
summary: How Windows 3.1 keeps a device context to what shows of its window -- USER works out a visible region and hands it to GDI, which clips every call to it and the clip region together -- read out of GDI.EXE and USER.EXE and recorded; and a design, not yet built, for keeping it so in both engines.
probes: [visrgn, visfam, viscost, getdcex, dchook]
---

**Status: designed, not built.** The first half of this page is what Windows does, read out and recorded. The second half is how winbox.js is to do the same, in phases, each mergeable on its own.

A window's device context draws only where the window shows. In Windows 3.1 that is two modules' work. USER works out which pixels of the screen a window's context may draw on -- its **visible region** -- whenever it hands out a context and whenever windows move, and gives it to GDI with [[fn:GDI.SelectVisRgn]] and [[fn:GDI.SetDCOrg]]. GDI keeps it in the context beside the program's own clip region ([[topic:clip-regions]]), and clips everything it draws to both. GDI exports a family of calls for USER to do this with; programs can call them too. winbox.js does it another way today: each pixel of the screen knows which window shows there, and a window's context is a view of the screen that draws only on its window's pixels ([[topic:painting]]). That leaves the family as stubs, [[fn:USER.GetDCEx]]'s `DCX_PARENTCLIP` undone, and the clip box of a covered window wrong.

## In GDI

### What a device context keeps

[[read out]] Besides the fields of [[topic:device-context-internals]], three regions and an origin (`GDI.EXE` seg1):

| Offset       | What                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `0Eh`        | The clip region a program set, or none ([[fn:GDI.GetClipRgn]] answers it). In the screen's terms: moved by the origin.      |
| `1Eh`        | What drawing is clipped to: the visible region where there is no clip region, else a region of its own, the two intersected |
| `A0h`        | The visible region, in the screen's terms. Never none.                                                                      |
| `A2h`, `A4h` | The origin: where the context's (0, 0) is on the screen ([[fn:GDI.GetDCOrg]])                                               |
| `70h`, `72h` | The origin with the viewport's origin added, which maps a logical point to the device                                       |

- [[read out]] `1Eh` is made again (seg1 `17b1`) whenever either region changes: the visible region's handle itself where there is no clip region, else a region of the context's own, `RGN_AND` of the two. Its kind is what the calls answer (seg1 `1892`: 1 empty, 2 a rectangle, 3 more).
- [[read out]] The state that [[fn:GDI.SaveDC]] and [[fn:GDI.GetDCState]] copy is the first A0h bytes of the context, the origin and the clip region (seg1 `0a46`): **not the visible region**. When the visible region changes, every saved level is marked (seg1 `081d`, bit 4 of `0Ah`), and restoring one does not bring an old visible region back.
- [[read out]] [[fn:GDI.SelectClipRgn]] copies the region and moves it by the origin (seg1 `15f9`-`161a`); [[fn:GDI.IntersectClipRect]] and [[fn:GDI.ExcludeClipRect]] with no clip region start from the whole surface, the bitmap's or the display's `HORZRES` by `VERTRES` from (0, 0) (seg1 `1722`-`1752`).

### The calls

All of these first call the context's hook where its flag is set ([[topic:device-context-internals]]), then:

- [[fn:GDI.SelectVisRgn]] (seg1 `1635`): the region's bytes copied into the context's own visible region (seg1 `58b3`), the saved levels marked, `1Eh` made again; answers its kind. [[measured]] The region given stays the program's: changed after, the context's is not ([[probe:visfam]]).
- [[fn:GDI.IntersectVisRect]] and [[fn:GDI.ExcludeVisRect]] (seg1 `16a2`, `16a5`): one body with `IntersectClipRect` and `ExcludeClipRect` (`16b9`), told apart by the field they change (`A0h` or `0Eh`). The rectangle is **in the screen's terms and not mapped**. [[measured]] The wrong way round, `IntersectVisRect` leaves nothing and answers 1.
- [[fn:GDI.OffsetVisRgn]] (seg1 `2929`): moves the visible region, answers the kind.
- [[fn:GDI.SaveVisRgn]] (seg1 `076c`): a copy of the visible region pushed on a stack kept in the region's own first word; answers the copy that was on top before. [[measured]] The first answers nought, the second a handle.
- [[fn:GDI.RestoreVisRgn]] (seg1 `07b2`): the copy on top becomes the visible region, the old one deleted; answers the kind. [[measured]] With nothing saved it answers −1 and changes nothing. After a restore, [[fn:GDI.InquireVisRgn]] answers another handle than before.
- [[fn:GDI.InquireVisRgn]] (seg1 `200a`): the handle at `A0h` -- the visible region itself, not a copy. [[measured]] The same handle each time until a restore.
- [[fn:GDI.SetDCOrg]] (seg1 `1118`): the origin exchanged, the clip region moved by the difference; **the visible region stays where it is**. Answers the old origin, x in the low word.
- [[fn:GDI.GetDCState]] and [[fn:GDI.SetDCState]] (seg1 `0601`, `0615`): a copy of the state as `SaveDC` makes one, as a handle; and that state copied back, the origin set through `SetDCOrg` where it differs, the visible region kept. [[measured]] The text colour comes back; a visible region narrowed between stays narrowed.
- [[fn:GDI.FastWindowFrame]] (seg1 `420e`): a rectangle's frame, `xWidth` across and `yWidth` down, drawn in one call by the display driver's `FastBorder` (the driver's table at 40h) -- only on a screen context whose driver has `RC_GDI20_OUTPUT` and whose clip is one rectangle; nought otherwise, and USER then draws the frame another way (`USER.EXE` seg1 `8d74`-`8d7d`). [[measured]] On a window's context it answers −1 and draws the frame; with a corner cut out of the visible region it answers nought and draws nothing; on a memory context, nought.
- [[fn:GDI.Death]] and [[fn:GDI.Resurrection]] (seg1 `2067`, `208e`): the display driver's `Disable` and `Enable`, through the context's driver; `Resurrection` sets the palette again on a palette device. USER calls them as it gives the screen to a full-screen DOS program and takes it back ([[topic:user-internals]]). Not recorded: under the recorder they would turn the display off.

### Drawing and asking

- [[read out]] Every drawing call clips to `1Eh`. A blit walks its rectangles, calling the driver once for each that meets the destination (seg1 `2e74`-`2ec3`).
- [[read out]] [[fn:GDI.GetClipBox]] is the box of `1Eh`, mapped back to logical terms (seg1 `1831`); [[fn:GDI.RectVisible]] and [[fn:GDI.PtVisible]] ask `1Eh` (seg1 `29b7`, `2b0e`). [[measured]] So a window covered in part answers a clip box of what shows of it, and kind 3 ([[probe:visrgn]]).
- [[measured]] [[fn:GDI.GetClipRgn]]'s region is in the screen's terms: `SelectClipRgn` of (0, 0, 20, 20) on a context at (100, 100) gives back (100, 100, 120, 120), and it moves with `SetDCOrg`.

## In USER

### Contexts USER hands out

[[read out]] USER keeps a list of entries, each a context and what it was got for (`USER.EXE` data `12Eh`; each entry: the next, the context, the window, the window whose region it has, a region given, the flags). Five are made as Windows starts, for common contexts (seg3 `0635`-`0662`); a context of a `CS_OWNDC` window or a `CS_CLASSDC` class is an entry of its own, found by its window or by the class's context (seg1 `8560`-`85b3`). A copy of a new context's state is kept with `GetDCState` (seg3 `0665`) for giving a common context back.

`GetDCEx`'s body (seg1 `847b`) takes the flags:

- [[read out]] With `DCX_USESTYLE` (10000h), which [[fn:USER.GetDC]], [[fn:USER.GetWindowDC]] and [[fn:USER.BeginPaint]] pass: the class's `CS_PARENTDC` gives `DCX_PARENTCLIP` for the client area; a class with neither `CS_OWNDC` nor `CS_CLASSDC` gives `DCX_CACHE`; the window's `WS_CLIPCHILDREN` gives `DCX_CLIPCHILDREN` (not while it is minimized, and not for `DCX_WINDOW`), its `WS_CLIPSIBLINGS` `DCX_CLIPSIBLINGS` (`8491`-`84fb`).
- [[read out]] `DCX_PARENTCLIP` (`850d`-`854c`): the parent's region is used, with the parent's `WS_CLIPSIBLINGS`, unless the parent has `WS_CLIPCHILDREN`, the child asked for `DCX_CLIPCHILDREN` or `DCX_CLIPSIBLINGS`, or one is visible and the other not. The origin stays the child's.
- [[read out]] A common context is an entry not in use for the same window and flags if there is one -- **taken as it is, its region not worked out again** (`85c5`-`85e8`, `8656`) -- else the last free entry (`85f4`-`8619`). Where all five are in use USER logs an error (43h) and takes one back (`8625`-`8683`). A taken entry's region is worked out (`86b2`-`86c8`, below), given with `SelectVisRgn`, and its origin and brush origin set from the window (seg1 `1540`).
- [[read out]] `DCX_INTERSECTRGN` and `DCX_EXCLUDERGN` (`86e7`-`87a0`): `SaveVisRgn`, then the visible region combined with the region given, in the screen's terms, and selected. [[fn:USER.BeginPaint]] passes the window's update region this way (seg1 `7671`, with `DCX_USESTYLE`), and the erase its own (`7ac6`).
- [[read out]] [[fn:USER.ReleaseDC]] (`8805`): where a region was given, `RestoreVisRgn` and the region deleted unless `DCX_KEEPCLIPRGN`; a common context then has its state set back with `SetDCState` from the copy kept at the start. [[measured]] The clip region goes, but **the visible region and origin stay** -- a program's `SelectVisRgn` or `SetDCOrg` is still there when the same window gets the same entry again ([[probe:visfam]], `again`).

### Working the region out

[[read out]] `USER.EXE` seg1 `1582`, for a window and flags:

1. Before there is a desktop, the screen.
2. Nothing where the window or an ancestor is hidden or minimized -- except a minimized window's client area where its class has no icon (`1c5f`) -- or where it is within the window [[fn:USER.LockWindowUpdate]] locked and `DCX_LOCKWINDOWUPDATE` is not given (`1c12`).
3. The window's client rectangle, or its window rectangle with `DCX_WINDOW` (`16b7`).
4. With `DCX_CLIPCHILDREN`, each visible child's window rectangle taken out, but not one with `WS_EX_TRANSPARENT` (`16f2`).
5. Then up the parents: at each level, with `DCX_CLIPSIBLINGS` for the first and the level's own `WS_CLIPSIBLINGS` after, each visible sibling above taken out the same way; then cut to the parent's client rectangle (`1612`-`16ad`, `1774`). The desktop's client rectangle is the screen.

[[measured]] [[probe:visrgn]] holds each case to the pixel: a child without `WS_CLIPSIBLINGS` keeps the whole of its client area under a sibling over it, one with it loses the part; a parent without `WS_CLIPCHILDREN` keeps its children's part, and `DCX_CLIPCHILDREN` or `WS_CLIPCHILDREN` takes it out; `GetWindowDC` of a `WS_CLIPCHILDREN` window does not; `CS_PARENTDC` and `DCX_PARENTCLIP` give the parent's client area at the child's origin, but `GetWindowDC` and a plain `DCX_CACHE` the child's own; a pop-up partly off the screen and partly under another loses both parts; a hidden window has nothing; [[fn:USER.BeginPaint]]'s region is the client area within the update region, two rectangles apart staying apart. Top-level windows have `WS_CLIPSIBLINGS` whether or not it was asked for.

A new memory context's visible region is empty; with a bitmap selected, the bitmap.

### When it is worked out again

- [[read out]] seg1 `8aa0`, given a window: every entry of that window and of its descendants -- of its parent's too, for a window shown or hidden whose parent has `WS_CLIPCHILDREN` or that has `WS_CLIPSIBLINGS` -- is made stale. A free common entry is emptied, to be worked out when next taken (`8b4f`-`8b7d`); one in use, or a window's own, gets its flags from the window's style again and `SetHookFlags(DCHF_INVALIDATEVISRGN)` (`8b7f`-`8ba9`). Its callers: `SetWindowPos` (seg7 `0595`), a window shown or hidden (seg1 `56ef`, `5726`), a style's `WS_CLIPCHILDREN` or `WS_CLIPSIBLINGS` changed (seg2 `0bce`), `LockWindowUpdate` and its end (seg13 `22dd`, `2306`), `ScrollWindow` moving children (seg13 `1666`), a window given `WS_CLIPSIBLINGS` (seg14 `0491`), and the desktop shown as Windows starts (seg3 `1ad5`).
- [[read out]] [[fn:USER.DCHook]] (seg1 `8a00`), which GDI calls the next time the context is used: for `DCHC_INVALIDVISRGN` it clears the flag, and for an entry in use works the region out again, applies the region given to `GetDCEx` again, selects it, and sets the origin. It answers 1, and does nothing for any other code. [[measured]] A program that selects a region of its own and sets the flag gets the window's region back; a region it saved is still there to restore ([[probe:visfam]], `hook`). [[measured]] A `CS_OWNDC` context kept while its window moves, and while another window comes over it and goes, answers for each where it is now ([[probe:visrgn]], `own`).

### USER's own uses

[[read out]] Besides `GetDCEx`, USER sets regions itself: `SetWindowPos` works out what of a moved window to copy (seg7 `0c41`) and selects it into a context for the copy (seg7 `0732`, `0975`); menus keep an item's drawing inside the bar with `SaveVisRgn`, `IntersectVisRect` and `RestoreVisRgn` (seg10 `29c3`-`2a30`, `2d70`-`2ec0`); `ScrollDC` and `ScrollWindow` blit through a region of their own and work out what was uncovered from `InquireVisRgn` and `GetDCOrg` (seg13 `1d90`-`1e5a`); the task switcher draws a window's icon by moving a context's origin and region (seg23 `0180`-`02d4`). `FastWindowFrame` draws the sizing frame (seg1 `8d74`). `EnableOEMLayer` calls `Resurrection` and `DisableOEMLayer` `Death` (seg5 `017e`, `01ba`).

## What it costs Windows

[[measured]] [[probe:viscost]] times `BitBlt` and `PatBlt` of 16 by 16 in a window at a fixed 80,000 instructions a millisecond, with windows over it: a pop-up clear of the drawing, eight of them, and one over half of it. A region of many rectangles costs almost nothing -- about 300 instructions more for a `BitBlt` with eight windows over, against 21,700 -- and a drawing half covered costs less, its pixels fewer. See [[topic:timing]].

## In winbox.js today

- Each pixel of the screen keeps the window that shows there (`owners`, `src/win16/user/desktop.ts` `#own`; `crates/winbox-win16/src/desktop.rs`). A window's context is a view of the screen from its client area's corner, as wide and high as the client area, that draws a pixel only where `owners` says the window shows, or where `#throughSibling` (`ViewClip::allows` in `crates/winbox-win16/src/surface.rs`) lets it draw over a sibling without `WS_CLIPSIBLINGS` or over its own children without `WS_CLIPCHILDREN`; while it paints, only within the update region (`paintClip`, `paintShape`). This is Windows' visible region worked out a pixel at a time, from another rule: the window on top wins, and exceptions are made.
- The clip region a program sets is a second test on each pixel (`dcClip`, `src/raster/surface.ts`).
- `GetClipBox`, `RectVisible` and `PtVisible` ask only the clip region within the client area (`clipOf`, `src/win16/gdi/clipping.ts`; `clip_of`, `crates/winbox-win16/src/gdi/regions.rs`). [[measured]] So a window under another answers its whole client area, and a hidden one too ([[probe:visrgn]]).
- [[fn:USER.GetDCEx]] (`src/win16/user/get-dc-ex.ts`, `crates/winbox-win16/src/get_dc.rs`) folds `DCX_CLIPCHILDREN`, `DCX_INTERSECTRGN` and `DCX_EXCLUDERGN` into the clip region, and does not do `DCX_PARENTCLIP`: the view ends at the client area, and nothing outside it can be drawn ([[probe:getdcex]]). `CS_PARENTDC` is not done either.
- A window has one context surface that all its `GetDC` handles share, made again on each `GetDC`.
- The family is stubs. The TypeScript engine's answer nought; the Rust engine's leave whatever was in AX, so [[fn:GDI.InquireVisRgn]] answers a number that is no region. Both disagree with every record of [[probe:visrgn]] and [[probe:visfam]] but a handful, which are left unregistered.

## The design

### The model

- **GDI keeps the visible region in the context, in the screen's terms**, as Windows does: `visRegion` on the TypeScript engine's `Surface`, `vis` on the Rust engine's `Dc`, with the stack `SaveVisRgn` pushes and the origin. A memory context's is its bitmap's rectangle (empty for the one-pixel bitmap); a printer's, its page and the band (`printer-bands.ts`'s band moves into it); the screen's, the screen.
- **One region to draw through.** The context keeps what Windows keeps at `1Eh`: the visible region moved to the context's own terms by the origin, intersected with the clip region. It is made again when either changes, and it is the one test the raster makes on a pixel (`dcClip`), in place of the view's test and the clip region's. `GetClipBox`, `RectVisible`, `PtVisible` and every drawing call ask it.
- **The clip region stays in the context's own terms.** Windows keeps it in the screen's and moves it with the origin, which comes to the same thing; `GetClipRgn` adds the origin to what it answers.
- **USER works the region out**, with Windows' rule (`USER.EXE` seg1 `1582`), from the window tree -- rectangles, styles, the order of siblings, what is shown and minimized, `LockWindowUpdate` -- not from `owners`, whose rule is another. `owners` stays for what it is also used for: finding the window at a point, and what a move uncovers.
- **A window's context is a view of the whole screen from its origin**, drawing at any pixel of the screen the region allows: the raster's views take a rectangle of addresses that may start left of and above nought (`IndexedContext.address`, `indexed_context.rs`), not a width and height from nought. Then `DCX_PARENTCLIP`, `CS_PARENTDC`, a program's `SelectVisRgn` reaching out of its window, and `SetDCOrg` all draw where Windows draws.
- **USER's hook is called by GDI.** A context USER hands out carries USER's `DCHook` and the flag; when windows change, USER sets the flag on the contexts concerned, and GDI calls the hook before it next uses one. The hook is WinBox's own code; a program's own hook is called through the processor, as [[probe:dchook]] records.

### The phases

Each phase is mergeable on its own, in both engines together, with the probes and the corpus as said.

1. **The region in GDI.** The field, the stack, the one region drawn through, the family's calls (`SelectVisRgn`, `IntersectVisRect`, `ExcludeVisRect`, `OffsetVisRgn`, `SaveVisRgn`, `RestoreVisRgn`, `InquireVisRgn` with a region object of the context's own, `GetDCState`, `SetDCState`), `GetClipRgn` in the screen's terms, `FastWindowFrame` as four `PatBlt`s on a screen context whose region is one rectangle, answering −1. USER sets each window context's region to its client or window rectangle, the rectangle today's view covers, so `GetClipBox`, `RectVisible` and `PtVisible` answer as now. Drawing is still kept to the window's pixels by the view as well. The corpus: unchanged -- no program of it calls the family, and what the others ask is answered as before. [[probe:visfam]]'s records within the window agree.
2. **USER works it out.** The region cut to the screen and worked out by Windows' rule: `GetDC`, `GetWindowDC`, `GetDCEx` and `BeginPaint` select it, with `DCX_USESTYLE`, `CS_PARENTDC`, `DCX_CLIPSIBLINGS` and `BeginPaint`'s update region as `DCX_INTERSECTRGN`; the old view test stays under it. [[probe:visrgn]] agrees but for `own`; [[probe:visfam]]'s drawing outside the window waits for phase 3. The corpus: `GetClipBox` and `RectVisible` now answer what shows. Five programs ask `GetClipBox` (cellwar, leapfrog, starmerc, fourseas, sptvlr) and three `RectVisible` (hanoi, fibsw, champ); each that asks while covered or off the screen -- starmerc's clip box, 644 by 484, is larger than the screen -- answers less, and may draw less after. Each change is to be explained from the program's calls before merging.
3. **Drawing through the region alone.** The view test (`#throughSibling`, `ViewClip`), `paintClip` and `paintShape` go; views span the screen from the origin; `DCX_PARENTCLIP` and `SetDCOrg` move where drawing lands. Closes `getdcex:parentclip`. Where Windows' rule and `#throughSibling`'s differ, the corpus changes and each is a fix to explain; where they agree -- the group box of `groupbox`, Control Panel's combo box -- nothing changes. [[inferred]] A pop-up menu's two shadow corners stop showing what is drawn beneath them while it is up: its rectangle covers them.
4. **USER's entries and the hook.** Five common entries and one for each own or class context, as `GetDCEx` keeps them; `GetDC` takes a valid entry as it is; `ReleaseDC` sets the state back from the copy kept, keeping region and origin; windows changing make entries stale by Windows' rule (seg1 `8aa0`'s callers); GDI calls the hook where the flag is set; [[fn:USER.DCHook]] answered. Closes [[probe:dchook]]'s gaps and `visfam`'s `again` and `hook`, and `visrgn`'s `own`. A window's contexts become separate surfaces, each with its own attributes, which retires `resetCommon`'s count of contexts out. The corpus: Cribbage, Championship Slots and the programs [[topic:clip-regions]] names, which depend on a context's attributes, are the risk; predicted unchanged, to be checked.
5. **The rest.** `ScrollDC` and `ScrollWindow` through the region, as USER does; `SetWindowPos`'s copy of a moved window's bits through the region of what showed; `LockWindowUpdate` as the region's step 2 rather than a surface of its own (`lock-window-update.ts`).

### The risks

- **Time on the host.** On the development machine the Rust engine's raster spends 6 ns on a pixel drawn with no test, 8 with one test -- the window's pixels or a region alike -- 9.5 with a region of eight holes, and 11.3 with both of today's tests. One region in place of two is a little faster. The TypeScript engine spends about 570 ns on a pixel, and its tests are lost in it. Working a region out is a few region operations for each context handed out, and once more for each context made stale. Neither needs a test of its own; drawing a run of a row at a time against the region's bands, rather than a pixel at a time, is a later gain open to both.
- **SimTower's clock.** The faithful clock charges a call what Windows ran for it, whatever winbox.js does inside; [[probe:viscost]] shows a region's rectangles add next to nothing in Windows, so nothing is to be charged for them. USER's hook is WinBox's own code and runs no instructions; only a program's own hook would. SimTower makes none of the family's calls, nor `GetClipBox` nor `RectVisible`. Predicted unchanged at every phase; checked with the faithful-clock survey.
- **The two engines.** Every phase lands in both, as twins; the Rust engine's stubs answering what was in AX go in phase 1.
- **USER's own drawing** into windows -- frames, menus, controls -- goes through the same contexts and changes with them in phase 3; the probes of [[topic:painting]] and [[topic:window-frames]] are the check.

### What stays out

- `Death` and `Resurrection`: WinBox runs no DOS program full screen and has no display driver to turn off. They answer as now.
- A program changing the region `InquireVisRgn` gave it, behind GDI's back: not recorded.
- Charging a drawing call by how much of it shows ([[probe:viscost]]'s half-covered drawing costs Windows a tenth less).
- The task switcher's and the menus' own uses: WinBox's switcher and menus are its own.

### Decisions for the owner

1. Whether phase 2 may change the answers of the eight corpus programs that ask `GetClipBox` or `RectVisible`, each explained, or must wait to land with phase 3.
2. Whether a window's context spans the whole screen from its origin (phase 3), which every drawing path's bounds checks then see, or stays the size of its window with the region kept in its terms and `DCX_PARENTCLIP` drawn some other way.
3. Whether phase 4's separate surfaces for a window's contexts -- Windows' model, and the end of `resetCommon`'s count -- are wanted now, or the entries are kept as records over the one surface for now.
4. What `Death` and `Resurrection` answer: nought, as now, or what a driver's `Disable` and `Enable` would.

## Not yet done

All of the design: phases 1 to 5. [[probe:visrgn]] and [[probe:visfam]] are recorded and unregistered; [[probe:viscost]] is a timing, not replayed.

## In winbox.js

Today: `src/win16/user/desktop.ts` (`#own`, `#view`, `#throughSibling`), `src/win16/user/get-dc-ex.ts`, `src/win16/user/GetDC.ts`, `src/win16/gdi/clipping.ts`, `src/win16/gdi/dc-internals.ts`, `src/raster/device-bitmap.ts`, `src/raster/surface.ts`; `crates/winbox-win16/src/surface.rs`, `get_dc.rs`, `gdi/regions.rs`, `gdi/dc.rs`, `gdi/dc_internals.rs`, `crates/winbox-raster/src/indexed_context.rs`. The probes: `oracle/probes/visrgn.c`, `visfam.c`, `viscost.c`, with `visprobe.h`.
