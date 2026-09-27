---
kind: topic
name: Message boxes
summary: How Windows 3.1's MessageBox builds its box — the buttons and their width, the icons, the text's layout, where the box goes, and what it answers — read out of USER.EXE and measured pixel for pixel on four displays.
probes: [msgbox]
---

`MessageBox` is a dialog USER builds for itself. It works out every size in pixels, writes a dialog template in memory, and runs it as a modal dialog box with its own dialog procedure. The code is `USER.EXE` seg1 `9b91`, and seg42 from `04f5` for the layout and `0101` for the procedure.

[[measured]] [[probe:msgbox]] opens eight boxes on the VGA, the EGA, the Super VGA and the Hercules. A timer set before each call does the looking from inside the box's own message loop. It records the box's rectangles and caption, whether the owner is enabled, which control has the focus, and each control's class, number, style, text and rectangle. It reads every pixel of the box, then presses Enter, and records what `MessageBox` answered. winbox.js agrees with every record on all four displays.

## What is in it

- [[read out]] **The buttons** are the style's set, left to right: OK; OK and Cancel; Abort, Retry and Ignore; Yes, No and Cancel; Yes and No; Retry and Cancel. Their numbers are `IDOK` to `IDNO`. Their captions are USER's own string resources, read into its data segment as it starts: `OK`, `Cancel`, `&Abort`, `&Retry`, `&Ignore`, `&Yes` and `&No`.
- [[read out]] `MB_DEFBUTTON2` and `MB_DEFBUTTON3` make the second or third button the default, `BS_DEFPUSHBUTTON`. A button the set does not have means the first. The default button has the focus as the box opens. [[measured]] Enter answers the default in every case.
- [[read out]] **Every button is the same width**, worked out once as USER starts (seg3 `23be`). It takes the caption with the most characters, not the widest one: `&Ignore`, seven. It measures it without its `&`, and adds the width of `0` twice. On the VGA that is 41 + 16 = 57 pixels, though `Cancel` is wider than `Ignore`. The buttons are 1¾ times the System font's height tall, and `SM_CXSIZE` apart.
- [[read out]] **The icon** is the display driver's: `MB_ICONHAND` 7F01h, `MB_ICONQUESTION` 7F02h, `MB_ICONEXCLAMATION` 7F03h and `MB_ICONASTERISK` 7F04h. It is a static control with `SS_ICON`, which loads it from USER first and then from the display driver, since USER has none of those numbers ([[topic:standard-controls]]).
- [[read out]] **The text** is a static control with `SS_LEFT | SS_NOPREFIX`, so an `&` shows as it is. It is laid out as `DrawText` lays it out with `DT_WORDBREAK | DT_EXPANDTABS | DT_NOPREFIX`. The width it is allowed is five eighths of the screen, less `SM_CXSIZE` and a border each side and the icon, or the buttons' row if that is wider. [[measured]] [[probe:msgbox]]'s long text breaks into four lines on the VGA.
- [[read out]] **The title** is the one given. With none, it is USER's string 78, `Error`. [[measured]] That is the caption [[probe:msgbox]] recorded.
- The box is in the System font: its template has no `DS_SETFONT`.

## Its size and place

- [[read out]] The box is as wide as the widest of the text, the buttons' row, and the title with `SM_CXSIZE` each side. Then `SM_CXSIZE` is added each side, and the icon with `SM_CXSIZE` after it. It is as tall as the text or the icon, whichever is taller, and six times the System font's height more (seg42 `05d7`).
- [[read out]] The text and the icon are centred on each other vertically, with the taller at one font height from the top. The icon is `SM_CXSIZE` in, and the text `SM_CXSIZE` after it. The buttons' row is centred across and ends half a font height, the caption and two borders above the bottom.
- [[read out]] **The box is centred on the screen**, whatever its owner, and its template has `DS_ABSALIGN`. A box opened while another is up goes `SM_CXSIZE` across and `SM_CYSIZE` down from it. [[measured]] A box with no owner is centred on the screen in the same way.
- [[read out]] Every place and size is written in dialog units, each rounded on its own, so the dialog manager puts the controls on even pixels on the VGA.

## What it answers

- [[read out]] A box with only OK gives the OK button the number of Cancel, 2, as it opens, so that Escape closes it. It answers `IDOK` all the same. [[measured]] [[probe:msgbox]] recorded the OK button as 2, and the answer as 1.
- [[read out]] Otherwise it answers the number of the button pressed. Escape does nothing in a box without Cancel. A box without Cancel takes Close out of its system menu.
- [[measured]] The owner is disabled while the box is up. [[read out]] That is the modal dialog box's doing. With `MB_TASKMODAL` and no owner, the procedure disables the task's other top-level windows itself, and enables them again before it ends.
- [[read out]] No beep: nothing on the way calls `MessageBeep`.

## System-modal boxes

- [[read out]] `MB_SYSTEMMODAL` with no icon, or with the hand, is not a dialog at all. USER draws it itself through `SysErrorBox` (seg1 `9a86`), which is not read out here. With any other icon it is a dialog, `DS_SYSMODAL`, with a one-pixel border and no modal frame.

## Not followed

- `SysErrorBox`, and `MB_SYSTEMMODAL` with no icon or the hand, which winbox.js shows as an ordinary box.
- `MB_TASKMODAL` with no owner, and Close taken out of the system menu.

## Why it mattered

Message boxes were drawn only on winbox.js's old DOM desktop. On the raster desktop a program that called `MessageBox` waited for an answer to a box nobody could see. Sound Recorder's warning that no sound driver is installed, and Control Panel's that it cannot find its `.CPL` files, now show.

## In winbox.js

`src/win16/user/message-box.ts` builds the box and runs it with `dialogBoxTemplate` in `src/win16/user/dialogs.ts`. USER's strings, the buttons' words and the default title among them, are winbox.js's own, in `src/win16/user/strings.ts`, since no Windows file is shipped. They match `USER.EXE`'s string table, which `scripts/oracle/strings-table.mjs` makes them from.
