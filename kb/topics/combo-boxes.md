---
kind: topic
name: Combo boxes
summary: How Windows 3.1's combo box is made of a field, a button and a list box, how it lays them out, drops its list down and puts it away, and how it talks to its parent and an owner that draws it — read out of USER.EXE and measured on four displays.
probes: [combobox, comboact, comboesc]
---

[[measured]] [[probe:combobox]] makes four combo boxes in the System font and records them on the VGA, Super VGA, EGA and Hercules:

- a sorted drop-down list, as `COMMDLG.DLL`'s file types are;
- a drop-down;
- a simple one;
- an owner-drawn drop-down list that keeps its strings, as `COMMDLG.DLL`'s drives are.

Through `SendMessage` it fills them, selects, keys and drops them down, and puts their lists away. It records their windows and children, what the messages answered, the state, the notifications, what the owner was asked to draw, and the screen from each down. The code is `USER.EXE` segment 33, with segment 34 for its layout. winbox.js agrees with every record except two fields USER never sets.

## Parts

- [[read out]] A combo box is a field, a button and a list box of the class `ComboLBox`. The field is an edit control, except in a drop-down list, which draws its own. [[measured]] `GetWindow` finds a drop-down's edit control and a simple combo box's list and edit control. A list that drops down is no child of the combo box: it is a child of the desktop window ([below](#the-list-on-the-desktop)).
- [[read out]] The field is the font's height, plus a quarter of the smaller of it and the System font's height, plus four borders (seg34 `02ac`). [[measured]] That is 24 on the VGA and 19 on the EGA.
- [[read out]] An owner-drawn field's height is what the parent answers to `WM_MEASUREITEM` for item −1, plus six.
- [[read out]] The button is a scroll bar's width at the right. A drop-down list's field ends a border short of it, and a drop-down's edit control that and the System font's average width more.
- [[read out]] The list goes from a border above the field's bottom to a border above the combo box's. A drop-down list's list is under all of it; the others' are indented by that average width. [[measured]] A drop-down's list stands 8 pixels in.
- [[read out]] A combo box that drops its list is made as high as its field. The list keeps the size it was made at, less the list box's own step to whole rows.
  - [[measured]] That step has a quirk: it tests the list's inside, less its borders, for whole rows, but then sizes its whole height. A simple combo box's list made 65 high becomes 66 on the VGA.

## Dropping down and putting away

- [[read out]] Dropping down (seg33 `0c36`) tells the parent `CBN_DROPDOWN`, then shows the list on top without making it active. The list goes a border above the field's bottom, or above the field where there is no room below.
- [[read out]] Putting it away hides the list and tells the parent `CBN_CLOSEUP`, if it had been dropped.

## The list on the desktop

[[measured]] [[probe:comboact]] puts a drop-down list in a window `H`, with another window `Q` beside it, and subclasses the list to log its messages. It drops the list with the mouse and with `CB_SHOWDROPDOWN`, and presses a row with `H` active and with `Q` active. Both engines agree with all 12 records.

- [[read out]] A combo box makes its list as its child, visible, then hides it and gives it to the desktop window with `SetParent` (seg34 `0280`-`028f`). It stays `WS_CHILD`, and `SetParent` adds `WS_CLIPSIBLINGS` (seg14 `0484`). [[measured]] [[fn:USER.GetParent]] of the list answers the desktop window, it has no owner, and it is found among the desktop window's children by [[fn:USER.GetWindow]]. Its style reads `44A08041h`: `WS_CHILD`, `WS_CLIPSIBLINGS`, `WS_BORDER`, `WS_VSCROLL`, `LBS_COMBOBOX`, `LBS_HASSTRINGS` and `LBS_NOTIFY`, and no longer `WS_VISIBLE`.
- [[read out]] Dropping down moves the list with `SetWindowPos` to `HWND_TOPMOST`, with `SWP_NOSIZE | SWP_NOACTIVATE` (seg33 `0d12`-`0d52`), and shows it with `SW_SHOWNA` (`0d63`). [[measured]] The list is sent `WM_WINDOWPOSCHANGING` with 11h, `WM_SHOWWINDOW`, and `WM_WINDOWPOSCHANGING` with 57h, which keeps the order and the activation as a child's does. It is then the first of the desktop window's children.
- [[read out]] Putting it away first sends the list `WM_LBUTTONUP` at (−1, −1), which ends a press it is following, and then hides it with `ShowWindow` (seg33 `0b7a`, `0ba6`). [[measured]] A row pressed and let go, the list gets `WM_LBUTTONUP` twice, then `WM_SHOWWINDOW` and `WM_WINDOWPOSCHANGING` with 97h, and the parent `CBN_CLOSEUP` and `CBN_SELCHANGE`.
- [[read out]] **A press never makes the list active.** USER activates the window at the top of the one pressed, found by climbing its parents while it is a child, and does nothing when that is the desktop window (seg1 `2998`). It sends no `WM_MOUSEACTIVATE` either. [[measured]] The list is sent no `WM_MOUSEACTIVATE`, `WM_NCACTIVATE` or `WM_ACTIVATE`, and while the list has a row pressed the active window stays as it was.
- [[read out]] The list's own press gives the focus to the combo box's field, the edit control or the combo box itself, not to the list (seg35 `133d`-`1353`). [[measured]] With `Q` active, a press on the list makes `H` active as `SetFocus` does: `Q` loses the activation, `H` is brought up with `WM_WINDOWPOSCHANGING` and activated, and the focus goes from `H` to the combo box, which tells `CBN_SETFOCUS`.
- winbox.js took the list for any window at the top: a press on it made it the active window, and the list took the focus from its combo box. A random run of the Rust engine left Notepad's Save As box inactive behind its own list of file types.
- [[measured]] Keys in a drop-down list move the selection and tell `CBN_SELCHANGE` without dropping it down. Moved while dropped, the list stays dropped. Enter sent straight to the combo box does nothing.
- [[read out]] The combo box is destroyed with its list: its `WM_NCDESTROY` calls [[fn:USER.DestroyWindow]] on the list before `DefWindowProc` (seg33 `03e4`, seg34 `046a`-`0479`). The list is no child of the combo box, so nothing else would. winbox.js left it on the desktop's children. [[measured]] [[probe:comboesc]]: after an Open box closed with its drives' list down, the next Open box said it could not select drive `t:`, where Windows' opened as the first had.

## Keys

[[measured]] [[probe:comboesc]] runs a dialog with a drop-down list and a drop-down and drops each list three ways: F4, Alt and Down, and a press of the button. It moves the selection with Down, then presses Escape, Enter or F4, and records the dialog's commands, both lists' state and the focus. It does the same with the drives of COMMDLG.DLL's Open box. Both engines agree with all 56 records.

- [[read out]] A combo box sends `WM_KEYDOWN` and `WM_CHAR` on to its edit control, or to its list for a drop-down list (seg33 `0270`, `05ae`, `0725`). It keeps no key of its own but Alt with Up or Down, as `WM_SYSKEYDOWN`. That drops the list down or puts it away, and then goes on to `DefWindowProc` (`0227`-`026d`). A key of the numeric keypad counts only while Num Lock is off.
- [[read out]] The list's own `WM_KEYDOWN` takes F4: it drops a drop-down's or a drop-down list's list down, or puts it away (seg35 `1b18`). Escape and Enter are not among the keys it takes (`1988`-`19ea`).
- [[read out]] A drop-down's edit control sends F4, Page Up and Page Down on to the list, and Up and Down too (seg28 `0b74`, `0c0f`-`0c85`). Alt and Up or Down drop the list down or put it away (`14b6`-`1542`). [[measured]] With the focus in a drop-down's field, F4 and Alt and Down drop its list, and Down then moves its selection with `CBN_SELCHANGE`, the list staying down. winbox.js kept these keys in the edit control, and none of them did anything.
- [[read out]] `CB_SETEXTENDEDUI` sets the **extended interface** of a drop-down or a drop-down list with 1 and clears it with 0. Anything else, or a simple combo box, answers `CB_ERR`, and `CB_GETEXTENDEDUI` answers it (seg33 `0568`-`05a5`). With it, F4 does nothing. While the list is put away, Down and Right drop it, and Up, Left, Page Up, Page Down, Home and End do nothing (seg35 `19f7`-`1abb`). A drop-down's Up and Down drop the list too (seg28 `0c23`-`0c80`).
  - [[read out]] COMMDLG.DLL sets the extended interface on the Open box's types and drives.
  - [[measured]] F4 on the Open box's drives does nothing.
  - winbox.js had no extended interface. F4 dropped the drives, and Down chose the next drive, which was A:.
- [[measured]] Escape and Enter with the list down go to the dialog as `IDCANCEL` and `IDOK` ([[topic:dialog-boxes]]).

## Drawing

- [[read out]] The button is raised, with the display driver's combo arrow centred on it in the button text colour (seg33 `079f`).
- [[read out]] A drop-down list's field is outlined in the frame colour while its list is put away. With the focus, it is filled with the highlight inside a pixel of the window colour, and its text is a pixel in with the dotted focus rectangle around it. An owner is asked to draw the field's item three pixels inside the field (seg33 `0dB2`).
- [[measured]] The focus rectangle is a grey pattern in the context's text and background colours, exclusive-ored on. Over the highlighted field, white on dark blue, every pixel of it changes.

## Notifications and focus

- [[measured]] The focus arriving tells `CBN_SETFOCUS`, and leaving tells `CBN_KILLFOCUS`, after putting a dropped list away with `CBN_CLOSEUP`. The focus moving into a combo box's own edit control is not leaving it.
- [[measured]] Setting a drop-down's text tells its parent nothing.
- [[read out]] The combo box tells its list it has the focus, and no longer, with messages 424h and 425h. [[measured]] A dropped list then shows the focus rectangle once its keys move its selection, and not before.

## Owner-drawn

- [[read out]] The list's `WM_MEASUREITEM`, `WM_DRAWITEM`, `WM_DELETEITEM` and `WM_COMPAREITEM` are passed to the parent as the combo box's own: type 3, the combo box's identifier and window.
- [[measured]] The field is asked for with item −1 while nothing is selected.
- [[measured]] Two fields are left unset: the field's width in its `WM_MEASUREITEM`, and the list's item number in its own. They carry what was on the stack (879 and 2567 on the VGA). They are the only records winbox.js does not reproduce.

## Choosing

- [[read out]] A combo box made by a module whose expected Windows version is 3.10 or more is marked so as it is made: `CreateWindow` asks `GetExpWinVer` of its instance and sets bit 2 of byte 26h of its window (`USER.EXE` seg8 `0428`-`0432`).
- [[read out]] Putting the list away, such a combo box tells its parent `CBN_SELENDOK` first (seg33 `0b47`-`0b6f`). It tells `CBN_SELENDCANCEL` instead where the list is put away as no choice: with `CB_SHOWDROPDOWN` (seg33 `0700`), or as the combo box loses the focus (`11e7`). F4, or Alt with Up or Down, and a choice in the list, tell `CBN_SELENDOK` (`026a`, `02c8`, `0a20`). A combo box gone by then is told no more.
- [[measured]] [[probe:comboesc]]'s combo boxes, a probe's made for Windows 3.0, tell neither. `MIDIMAP.DRV`'s dialog makes a setup current only once told `CBN_SELENDOK` ([[topic:midi-mapper]], [[probe:mapcpl]]).

## Not yet done

- The mouse in the list while it is dragged from the button.
- `CBS_OWNERDRAWVARIABLE`, `CB_DIR` and the extended interface.

## In winbox.js

- `src/win16/user/combobox.ts` holds the layout and styles.
- `control-classes.ts` holds the window procedure: `initCombo` makes the parts, and `comboMessage` handles the rest. `comboListKey` and `comboEditKey` take the keys the list and a drop-down's edit control take for the combo box.
- `Desktop.paintCombo` draws the field and button.
