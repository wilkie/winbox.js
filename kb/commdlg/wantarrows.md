---
kind: function
module: COMMDLG
name: WantArrows
ordinal: 25
summary: The Color dialog's subclass of its two colour grids — asks for the arrows and characters, hands the keys to the dialog, and draws the focus box's dotted rectangle as the grid gains and loses the focus.
versions:
  '3.1': exact
probes: [choosclr]
topics: [common-dialogs, choose-color]
source: src/win16/commdlg/choose-color.ts
---

## Observed behaviour

No program calls it. The Color dialog's `WM_INITDIALOG` gives it to `SetWindowLong(GWL_WNDPROC)` for both grids, the basic colours' static 2D0h and the custom colours' 2D1h ([[topic:choose-color]]); USER then calls it as the statics' window procedure, with a window, a message, `wParam` and `lParam`.

- [[read out]] `WM_GETDLGCODE` answers 81h, `DLGC_WANTCHARS` and `DLGC_WANTARROWS`, so the dialog manager leaves the arrows and characters to the grid (`COMMDLG.DLL` seg1 `1b74`).
- [[read out]] `WM_KEYDOWN` and `WM_CHAR` are sent on to the dialog, the grid's parent, with the same `wParam` and `lParam`, and what the dialog answers is answered (seg1 `1b7b`). The dialog moves the focus box and chooses it ([[fn:COMMDLG.ColorDlgProc]]).
- [[read out]] `WM_SETFOCUS` and `WM_KILLFOCUS` draw the focus box's dotted rectangle with `DrawFocusRect`, through `GetDC` of the dialog: the box is the custom grid's focus box, or the basic grid's for 2D0h, its rectangle from COMMDLG's table at `[0AA8h]` grown by 3 pixels each way. `DrawFocusRect` inverts, so the second call takes the first's away. The static's own procedure is not called for these (seg1 `1b98`).
- [[read out]] Anything else, and the focus messages before the dialog has its property A000h, goes to the static's own procedure through `CallWindowProc` (`[0A9Ah]`, seg1 `1c2c`).
- [[measured]] [[probe:choosclr]] drives the grids with the arrows, Home, End, Space and Tab through USER's `KEYBD_EVENT`, and records the boxes chosen and the dialog's pixels: every record agrees with the read-out.

## Nuances

- [[read out]] It answers the dialog's own answer for the keys, not the static's: a static would answer nought for `WM_GETDLGCODE` and never see an arrow.
- [[read out]] The rectangle is drawn whether or not the box is visible in the grid's window: `GetDC` of the dialog is not clipped to the static.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg1 `1b46`, `retf 0Ah`. The grids are subclassed at seg1 `13d9` with the far address of entry 25.

## Implementation

WinBox's own: `WantArrows` in `src/win16/commdlg/choose-color.ts` and `want_arrows` in `crates/winbox-win16/src/commdlg/choose_color.rs`, given to `SetWindowLong` at its stub's address, as COMMDLG gives the entry's. Both engines agree with all of [[probe:choosclr]]'s records.
