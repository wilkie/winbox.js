---
kind: topic
name: The clipboard
summary: How Windows 3.1's clipboard is opened, filled and read, which formats it lists, how a format is rendered only when asked for, and what the chain of viewers is sent — recorded with an owner and two viewers.
probes: [clip, editclip]
---

The clipboard is one for the whole system. A window opens it, empties it to become its owner, puts a block of memory on it for each format it offers, and closes it. Viewers, such as the Clipboard Viewer, form a chain and are told when it changes.

[[measured]] [[probe:clip]] does all of this with three windows: an owner, O; a viewer, V; and a second viewer, W, put in after V. It records what each call answers, the text of what it takes off, the formats listed, and the clipboard messages each window is sent. winbox.js agrees with all 48 records.

## Opening, emptying and closing

- [[measured]] [[fn:USER.OpenClipboard]] opens it for one window at a time. While it is open, another window's `OpenClipboard` answers 0.
- [[measured]] [[fn:USER.EmptyClipboard]] makes the window that opened it the owner ([[fn:USER.GetClipboardOwner]]). The owner before it is sent `WM_DESTROYCLIPBOARD`, whichever window empties it.
- [[measured]] [[fn:USER.CloseClipboard]] answers 0 when it is not open. Closed, [[fn:USER.GetClipboardData]] answers 0.

## Formats

- [[measured]] [[fn:USER.SetClipboardData]] answers the handle it was given. While the clipboard is open, [[fn:USER.CountClipboardFormats]] and [[fn:USER.IsClipboardFormatAvailable]] count only what was put on.
- [[measured]] Once it is closed, a text format is made from the other if it has one and not the other. `CF_TEXT` put on gives `CF_OEMTEXT` as well, listed after it, and `CF_OEMTEXT` gives `CF_TEXT`: two formats, `1,7` or `7,1`. [[inferred]] The text is carried through the keyboard driver's tables (`AnsiToOem`, `OemToAnsi`), which the probe's plain text cannot show.
- [[measured]] [[fn:USER.EnumClipboardFormats]] lists them in the order they were put on. A registered format ([[fn:USER.RegisterClipboardFormat]]) is listed like any other.
- [[measured]] A format put on with no handle is rendered when it is asked for. `GetClipboardData` sends its owner `WM_RENDERFORMAT`, the owner puts the data on then, and `GetClipboardData` answers that.

## Viewers

- [[measured]] [[fn:USER.SetClipboardViewer]] sends the new viewer `WM_DRAWCLIPBOARD` and answers the viewer before it. The new viewer passes that message on to the old one.
- [[measured]] `CloseClipboard` sends the first viewer `WM_DRAWCLIPBOARD` if anything was put on or emptied off. Opened and only read, it sends nothing.
- [[measured]] [[fn:USER.ChangeClipboardChain]] sends the first viewer `WM_CHANGECBCHAIN`, naming the window leaving and the one after it, and answers what the viewer answered. [[fn:USER.GetClipboardViewer]] names the first viewer.

## Cut, copy and paste

[[measured]] [[probe:editclip]] sends a single-line and a multi-line edit control `WM_COPY`, `WM_CUT`, `WM_PASTE` and `WM_CLEAR`. After each it records the text, the selection, the clipboard's text and owner, and what the parent was told. winbox.js agrees with all 11 records.

- [[measured]] `WM_COPY` puts the selection on as `CF_TEXT`, and the control becomes the clipboard's owner. With nothing selected, the clipboard is left as it was. The parent is told nothing.
- [[measured]] `WM_CUT` copies the selection and takes it out. `WM_CLEAR` only takes it out. Either tells the parent `EN_UPDATE`, then `EN_CHANGE`.
- [[measured]] `WM_PASTE` puts `CF_TEXT` in place of the selection, with the caret after it. A single-line control takes the text only up to its first line break; a multi-line one takes all of it. When the text passes the limit, a single-line control tells the parent `EN_MAXTEXT` and puts in what fits: ten characters pasted into three, with a limit of six, put in three. Even with nothing on the clipboard, the parent is told `EN_UPDATE` and `EN_CHANGE`.

## Not yet recorded

- What `EmptyClipboard` does with what was on the clipboard. winbox.js frees it: a bitmap or palette with `DeleteObject`, anything else with `GlobalFree`, as documented.
- An owner destroyed with formats it has not rendered (`WM_RENDERALLFORMATS`), and a viewer destroyed without leaving the chain.
- `GetPriorityClipboardFormat`.

## In winbox.js

`src/win16/user/clipboard.ts`, and `edit-clipboard.ts` for the edit controls.
