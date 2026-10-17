---
kind: function
module: COMMDLG
name: ChooseColor
ordinal: 5
summary: The Color dialog — 48 basic colours, 16 custom, and, opened out, a spectrum of hue and saturation with a bar of luminosity — answering the colour chosen; read out of COMMDLG.DLL and recorded.
versions:
  '3.1': exact
probes: [choosclr]
topics: [common-dialogs]
source: src/win16/commdlg/choose-color.ts
---

## Observed behaviour

[[probe:choosclr]] opens the dialog four ways and uses it with the keys and the mouse through USER's `KEYBD_EVENT` and `MOUSE_EVENT`. It records each control's state, the dialog's pixels, the six numbers of the opened dialog, what the hook is given and what the call answers.

- [[measured]] It answers 1 for OK, with the colour in `rgbResult`, and nought for Cancel, leaving `rgbResult` as it was. The 16 custom colours are written back to `lpCustColors` either way.
- [[measured]] A hook is given `WM_INITDIALOG` with the `CHOOSECOLOR` as `lParam`, and on OK the `COLOROKSTRING` message, `wParam` nought and `lParam` the structure, with `rgbResult` and the custom colours already written. A hook answering it not nought keeps the dialog open.
- [[measured]] What fails answers nought and sets [[fn:COMMDLG.CommDlgExtendedError]], except a wrong size:

| Asked                                                | Error                       |
| ---------------------------------------------------- | --------------------------- |
| `lStructSize` not 32                                 | none: the last error stands |
| `CC_ENABLEHOOK` and no hook                          | 0Bh, `CDERR_NOHOOK`         |
| `CC_ENABLETEMPLATEHANDLE` with a handle of nought    | 3, `CDERR_NOTEMPLATE`       |
| `CC_ENABLETEMPLATE` and no name                      | 3                           |
| `CC_ENABLETEMPLATE` with an instance of nought       | 4, `CDERR_NOHINSTANCE`      |
| `CC_ENABLETEMPLATE` with a name the instance has not | 6, `CDERR_FINDRESFAILURE`   |

- [[measured]] A successful call does not clear the error: it was still 6 after each of the four dialogs.

## Nuances

- [[read out]] The dialog is `DialogBoxIndirectParam` on COMMDLG's instance with its procedure, `ColorDlgProc`, COMMDLG's export 8, and the structure as its parameter. An answer of -1 is nought, with `CDERR_DIALOGFAILURE` (`COMMDLG.DLL` seg1 `0fea`).
- [[read out]] COMMDLG's template is its resource named by its string 303h, "ChooseColor": the dialog `CHOOSECOLOR`.
- The rest, from the grids to the arithmetic, is in [[topic:common-dialogs]].

## Inside Windows

[[read out]] `ChooseColor` is `COMMDLG.DLL` seg1 `0ea1`; its dialog's procedure seg1 `0197`.

## Implementation

WinBox's own: `ChooseColor`, `ColorDlgProc` and `WantArrows` in `src/win16/commdlg/choose-color.ts` and `crates/winbox-win16/src/commdlg/choose_color.rs`, the arithmetic in `colour-math.ts` and `colour_math.rs`. It works with no `COMMDLG.DLL` on the drive.
