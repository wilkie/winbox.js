---
kind: topic
name: Find and Replace
summary: COMMDLG's modeless Find and Replace dialogs — the FINDREPLACE structure, the templates, how the dialog sets itself up from the flags, what each button tells the owner, the hooks and a program's own template — read out of COMMDLG.DLL and recorded.
probes: [findrepl]
---

[[fn:COMMDLG.FindText]] and [[fn:COMMDLG.ReplaceText]] open a modeless dialog owned by one of the program's windows. The program keeps running its own loop, passing the dialog's messages through [[fn:USER.IsDialogMessage]], and the dialog tells the owner what to do with a registered message. Notepad and Cardfile use Find; nothing in the installation uses Replace. Every address on this page is in `COMMDLG.DLL` seg5. What all the common dialogs share -- the extended error, the registered messages, hooks and templates in general -- is in [[topic:common-dialogs]].

## The structure

`FINDREPLACE`, 36 bytes:

| Offset | Field              | What COMMDLG does with it                                             |
| ------ | ------------------ | --------------------------------------------------------------------- |
| 0      | `lStructSize`      | must be 36                                                            |
| 4      | `hwndOwner`        | must be a window; told of each search                                 |
| 6      | `hInstance`        | the template's module, or with `FR_ENABLETEMPLATEHANDLE` the template |
| 8      | `Flags`            | read as the dialog opens; written with each search                    |
| 0Ch    | `lpstrFindWhat`    | shown as the dialog opens; written with each search                   |
| 10h    | `lpstrReplaceWith` | the same, Replace only                                                |
| 14h    | `wFindWhatLen`     | the room `GetDlgItemText` is given                                    |
| 16h    | `wReplaceWithLen`  | Replace only                                                          |
| 18h    | `lCustData`        | not read                                                              |
| 1Ch    | `lpfnHook`         | written nought without `FR_ENABLEHOOK`                                |
| 20h    | `lpTemplateName`   | with `FR_ENABLETEMPLATE`                                              |

The flags: `FR_DOWN` 1, `FR_WHOLEWORD` 2, `FR_MATCHCASE` 4, `FR_FINDNEXT` 8, `FR_REPLACE` 10h, `FR_REPLACEALL` 20h, `FR_DIALOGTERM` 40h, `FR_SHOWHELP` 80h, `FR_ENABLEHOOK` 100h, `FR_ENABLETEMPLATE` 200h, `FR_NOUPDOWN` 400h, `FR_NOMATCHCASE` 800h, `FR_NOWHOLEWORD` 1000h, `FR_ENABLETEMPLATEHANDLE` 2000h, `FR_HIDEUPDOWN` 4000h, `FR_HIDEMATCHCASE` 8000h, `FR_HIDEWHOLEWORD` 10000h.

## The templates

[[read out]] COMMDLG's dialog 1540 is Find and 1541 Replace, both in 8-point "Helv", which the dialog manager makes bold MS Sans Serif ([[topic:standard-controls]]). Neither is `WS_VISIBLE`: the procedure shows the dialog as it starts. Find, 236 × 62: "Fi&nd What:" and its text (480h), "Match &Whole Word Only" (410h), "Match &Case" (411h), the "Direction" group box (430h) with "&Up" (420h) and "&Down" (421h), "&Find Next" (1, the default button), "Cancel" (2) and "&Help" (40Eh). Replace, 230 × 94: the same text, "Re&place With:" and its text (481h), the two check boxes, "&Find Next" (1), "&Replace" (400h), "Replace &All" (401h), "Cancel" and "&Help".

## As the dialog starts

[[read out]] `WM_INITDIALOG` (`0410`, then `0870`):

1. Its data, four bytes holding the structure's address, is put under the property A000h.
2. The text to find is set, and the dialog sent `EN_CHANGE` from it as if typed: Find Next is enabled only with text.
3. Help is hidden and disabled without `FR_SHOWHELP`.
4. Match Whole Word is hidden and disabled with `FR_HIDEWHOLEWORD`, disabled with `FR_NOWHOLEWORD`, and checked by `FR_WHOLEWORD`; Match Case the same with its three flags.
5. With `FR_HIDEUPDOWN`, the group box and both buttons are hidden and the buttons disabled; with `FR_NOUPDOWN`, the buttons disabled.
6. Find checks Down for `FR_DOWN`, else Up. Replace sets its second text and sends its `EN_CHANGE` too.
7. With a hook, the hook is given `WM_INITDIALOG`, and what it answers is answered; without one, 1. Not nought, the dialog is shown (`SW_SHOWNORMAL` for Find, `SW_SHOW` for Replace) and updated.

[[measured]] [[probe:findrepl]] records every control's text, check, and whether it is enabled and shown, for the flags as Notepad gives them, with all three hidden and all three disabled, and for Replace. With nothing to find, Find Next, Replace and Replace All are disabled.

## What the buttons do

[[read out]] Before each search the dialog writes the structure (`0a89`): the low byte of `Flags` keeps only `FR_DIALOGTERM` and `FR_SHOWHELP`; the two check boxes set `FR_WHOLEWORD` and `FR_MATCHCASE`; the search's own flag is added; the text is read with `GetDlgItemText` into `lpstrFindWhat`, `wFindWhatLen` its room. Find adds `FR_DOWN` unless Up is checked; Replace reads the second text and always adds `FR_DOWN`. Then the owner is sent the message, `wParam` nought and `lParam` the structure.

| Control, `WM_COMMAND`        | Flag added      | Then                                                                                     |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| Find Next (1)                | `FR_FINDNEXT`   | answers 1                                                                                |
| Replace (400h)               | `FR_REPLACE`    | if the owner answered exactly 1, Cancel's text becomes COMMDLG's string 40Dh, "Close"    |
| Replace All (401h)           | `FR_REPLACEALL` | the same                                                                                 |
| Cancel (2), and 3            | —               | the dialog ends                                                                          |
| Help (40Eh)                  | —               | the owner is sent `HELPMSGSTRING`'s message, `wParam` the dialog, `lParam` the structure |
| the text (480h), `EN_CHANGE` | —               | Find Next, and Replace's two, enabled when it has text                                   |

[[read out]] The dialog ends (`0831`) by clearing `FR_FINDNEXT`, `FR_REPLACE` and `FR_REPLACEALL`, setting `FR_DIALOGTERM`, telling the owner, removing its property -- its four bytes are not freed -- and destroying itself. `WM_CLOSE` is sent on as Cancel's `WM_COMMAND`.

[[measured]] With the keys, as a person uses it, the owner was told: Enter with Match Case pressed by its mnemonic, 18Ch -- `FR_ENABLEHOOK`, `FR_SHOWHELP`, `FR_FINDNEXT`, `FR_MATCHCASE`, and no `FR_DOWN`, since the flags given had none; Up then Enter, 18Ch again; Whole Word, 18Eh; Escape, 1C6h. Replace's Replace, Replace All and Find Next: 191h, 1A1h, 189h; after the owner answered 1, Cancel said "Close".

## Hooks

- [[read out]] Once the dialog has its property, each message goes first to the hook, through the structure, and what it answers that is not nought is the procedure's answer (`0390`). `WM_INITDIALOG` goes to the hook last, after the dialog has set itself up, with the structure as `lParam`.
- [[read out]] `FindText` also keeps the hook in COMMDLG's own data while it makes the dialog (`[118h]`), and the procedure calls that one too, but only for a message after the property is there, and not for `WM_INITDIALOG`, which clears it (`03ca`). [[measured]] The messages USER sends as it makes the dialog, `WM_SETFONT` and `WM_PARENTNOTIFY`, reach no hook: before its `WM_INITDIALOG`, the hook was given only the `WM_COMMAND`s and `WM_CTLCOLOR`s of the dialog's own setting up.
- [[measured]] A hook that answers 1 to Find Next's `WM_COMMAND` stops the search: the owner was told nothing.

## Templates of the program's

[[measured]] With `FR_ENABLETEMPLATEHANDLE`, a template of the program's with only the text, Match Case and two buttons made a dialog the procedure ran as its own: the controls it does not have are left alone, and the owner was told 210Dh -- `FR_DOWN` added since there is no Up -- and 2145h as it ended.

## The functions

- [[fn:COMMDLG.FindText]] and [[fn:COMMDLG.ReplaceText]], what a program calls, with their errors.
- [[fn:COMMDLG.FindTextDlgProc]] and [[fn:COMMDLG.ReplaceTextDlgProc]], the procedures COMMDLG hands to USER.
- [[fn:COMMDLG.Ordinal 33]], what Find and Replace free as COMMDLG is let go: nothing.

## In WinBox

- `src/win16/commdlg/find-replace.ts` and `guest-calls.ts`; `crates/winbox-win16/src/commdlg/find_replace.rs` and `guest_calls.rs`. The dialogs' procedures are `COMMDLG`'s exports 13 and 14, given to USER at their stubs' addresses.
- In Rust, each call the dialogs make into USER, GDI and KERNEL is made as a program makes it, through `api.rs`. In TypeScript they call the exports' functions directly ([[topic:common-dialogs]]).
- The templates are `COMMDLG`'s, kept as WinBox's own (`templates.ts`, `templates.rs`); a template is put in global memory as `LoadResource` would.
- [[measured]] [[probe:findrepl]], 629 of 629 records, agrees in both engines, run whole. Notepad's Find runs with no `COMMDLG.DLL` on the drive (`notepads_find_works_with_no_commdlg_file`).

## Not yet done

- The dialogs keep their data in WinBox's own memory, and put a number of WinBox's under their property A000h where `COMMDLG` puts a handle of its local memory.
