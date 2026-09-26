---
kind: topic
name: Combo boxes
summary: How Windows 3.1's combo box is made of a field, a button and a list box, how it lays them out, drops its list down and puts it away, and how it talks to its parent and an owner that draws it — read out of USER.EXE and measured on four displays.
probes: [combobox]
---

[[measured]] [[probe:combobox]] makes four combo boxes in the System font and records them on the VGA, Super VGA, EGA and Hercules:

- a sorted drop-down list, as `COMMDLG.DLL`'s file types are;
- a drop-down;
- a simple one;
- an owner-drawn drop-down list that keeps its strings, as `COMMDLG.DLL`'s drives are.

Through `SendMessage` it fills them, selects, keys and drops them down, and puts their lists away. It records their windows and children, what the messages answered, the state, the notifications, what the owner was asked to draw, and the screen from each down. The code is `USER.EXE` segment 33, with segment 34 for its layout. winbox.js agrees with every record except two fields USER never sets.

## Parts

- [[read out]] A combo box is a field, a button and a list box of the class `ComboLBox`. The field is an edit control, except in a drop-down list, which draws its own. [[measured]] `GetWindow` finds a drop-down's edit control and a simple combo box's list and edit control. A dropped-down list is no child: it is taken off and lies on the desktop.
- [[read out]] The field is the font's height, plus a quarter of the smaller of it and the System font's height, plus four borders (seg34 `02ac`). [[measured]] That is 24 on the VGA and 19 on the EGA.
- [[read out]] An owner-drawn field's height is what the parent answers to `WM_MEASUREITEM` for item −1, plus six.
- [[read out]] The button is a scroll bar's width at the right. A drop-down list's field ends a border short of it, and a drop-down's edit control that and the System font's average width more.
- [[read out]] The list goes from a border above the field's bottom to a border above the combo box's. A drop-down list's list is under all of it; the others' are indented by that average width. [[measured]] A drop-down's list stands 8 pixels in.
- [[read out]] A combo box that drops its list is made as high as its field. The list keeps the size it was made at, less the list box's own step to whole rows.
  - [[measured]] That step has a quirk: it tests the list's inside, less its borders, for whole rows, but then sizes its whole height. A simple combo box's list made 65 high becomes 66 on the VGA.

## Dropping down and putting away

- [[read out]] Dropping down (seg33 `0c36`) tells the parent `CBN_DROPDOWN`, then shows the list on top without making it active. The list goes a border above the field's bottom, or above the field where there is no room below.
- [[read out]] Putting it away hides the list and tells the parent `CBN_CLOSEUP`, if it had been dropped.
- [[measured]] Keys in a drop-down list move the selection and tell `CBN_SELCHANGE` without dropping it down. Moved while dropped, the list stays dropped. Enter sent straight to the combo box does nothing.

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

## Not yet done

- The mouse in the list while it is dragged from the button.
- `CBS_OWNERDRAWVARIABLE`, `CB_DIR` and the extended interface.
- The notifications a program marked for Windows 3.1 gets on putting a list away.

## In winbox.js

- `src/win16/user/combobox.ts` holds the layout and styles.
- `control-classes.ts` holds the window procedure: `initCombo` makes the parts, and `comboMessage` handles the rest.
- `Desktop.paintCombo` draws the field and button.
