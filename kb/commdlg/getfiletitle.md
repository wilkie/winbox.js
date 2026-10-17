---
kind: function
module: COMMDLG
name: GetFileTitle
ordinal: 27
summary: A file name's last part, without its drive or folders, as COMMDLG's own parser finds it — nought, the size a buffer must have, or the parser's error — the name itself tidied in place.
versions:
  '3.1': exact
probes: [ftitle]
source: src/win16/commdlg/parse-file.ts
---

## Observed behaviour

[[probe:ftitle]] gives `GetFileTitle` fifty names, each in a buffer of 64, and records the answer, the title written, and the name as it is left. It then gives `C:\DIR\FILE.TXT` with buffers of 0, 1, 8, 9, 10 and 64 bytes, and reads [[fn:COMMDLG.CommDlgExtendedError]] after.

- [[measured]] The title is the part after the last `\` or `/`, and after a drive's `C:`: `C:\DIR\FILE.TXT`, `C:FILE.TXT`, `C:/DIR/FILE.TXT` and `\\SERVER\SHARE\FILE.TXT` all give `FILE.TXT`. Case is kept, and so is a character above 127 (`éTé.TXT`).
- [[measured]] The answer is nought with the title written; the size the buffer must have, the title and its nought, where it is smaller (9 for `FILE.TXT` with a buffer of 0, 1 or 8), nothing written; or a negative error, nothing written:

| Answer | Name                                                                        |
| ------ | --------------------------------------------------------------------------- |
| -1     | A folder alone: `C:\`, `C:\DIR\`, `C:`, `.`, `..`                           |
| -2     | A drive that is not a letter: `1:\FILE`                                     |
| -3     | A period out of place: `.TXT`, `FILE.T.X`, `C:\..\FILE`, `\..\FILE`         |
| -5     | A character a name may not have: `+ , ; = [ ] \| " < >`, a tab              |
| -6     | Two separators together: `C:\DIR\\FILE`                                     |
| -7     | A space inside: `IN SIDE.TXT`                                               |
| -8     | An extension of more than three: `FILE.TEXT`                                |
| -9     | A name of more than eight: `LONGFILENAME.TXT`, `TOOLONGNAME`                |
| -10    | Nothing, or spaces alone                                                    |
| -11    | A wildcard in a folder: `C:\D*R\FILE.TXT`                                   |
| -12    | A wildcard in the title: `*.*`, `FI?E.TXT`, `C:\DIR\*.TXT`                  |
| -13    | A network name cut short or too long: `\\SERVER\`, `\\SERVERNAMEXX\SHARE\F` |

- [[measured]] The name is changed in place, whatever the answer: spaces before it are taken off (`  LEAD.TXT` becomes `LEAD.TXT`), spaces after it end it (`TRAIL.TXT  ` becomes `TRAIL.TXT`), and a period that ends it is taken off (`FILE.` becomes `FILE`, titled `FILE`).
- [[measured]] `.\FILE.TXT`, `..\FILE.TXT` and `\.\FILE` are titled `FILE.TXT` and `FILE`, but `\..\FILE` and `C:\..\FILE` are -3: a `..` is let be only at the start of a relative name.
- [[measured]] `\\SERVER\SHARE` is titled `SHARE`.
- [[measured]] `GetFileTitle` sets no extended error: [[fn:COMMDLG.CommDlgExtendedError]] answers nought after it.

## Inside Windows

[[read out]] `COMMDLG.DLL` seg2 `0c79`: the name is given to COMMDLG's parser (seg2 `5664`), and an error is answered as it is. The title runs from the offset the parser answers to the nought. Its length and a nought are compared with `cbBuf`, as a signed word, before the title is looked at for `*` or `?`, so a short buffer is answered with a size even for a title with a wildcard.

The parser is the one the file dialogs check a name with ([[fn:COMMDLG.GetOpenFileName]]). [[read out]] seg2 `5664`:

1. Spaces before the name are skipped, and the name copied down over them, its nought with it. Nothing left is -10.
2. A second character `:` makes the first a drive, which must be a letter (-2).
3. A leading `\` or `/` is the root. `\\` starts a network name, whose server must be named in at most eleven characters and followed by a share (-13). `\.\` is let be; `\.` alone is a folder (-1); `\..` is -3. A leading `.` or `..` must be followed by a separator or the end.
4. Each part is checked a character at a time: control characters and `|"+,:;<=>[]` are -5; a separator with nothing before it is -6; a wildcard before a separator is -11; a space followed by anything but spaces to the end is -7, while spaces to the end are cut off with a nought; a second period is -3; a name over eight or an extension over three is -9 or -8 (eleven altogether for a network name).
5. A period that ends the name is overwritten with a nought (seg2 `5990`).

The answer is the offset of the last part, and of its extension (the end, where there is none); or the error and the offset where it was found.

## Implementation

`parseFile` and `GetFileTitle` in `src/win16/commdlg/parse-file.ts`, and `parse_file` and `get_file_title` in `crates/winbox-win16/src/commdlg/parse.rs`, follow the parser step by step, changing the name in the caller's memory as it does. Both engines agree with all 57 of [[probe:ftitle]]'s records.

## Not yet done

- A name of more than 260 bytes: COMMDLG's parser does not limit one, and neither do the engines; no probe has given one.
