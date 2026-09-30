---
kind: topic
name: DOS file handles
summary: The file handles a Windows 3.1 program is given, from 5 on, and what DOS's function 4400h says a handle is — as the devinfo probe recorded them under Windows.
probes: [devinfo]
---

A Windows program opens files through KERNEL, and KERNEL goes to DOS. The handle a program is given is DOS's, from the program's own table of handles.

[[measured]] [[probe:devinfo]] makes a file with [[fn:KERNEL._lcreat]], writes a byte, closes it, and opens it again with [[fn:KERNEL.OpenFile]]. It asks INT 21h function 4400h about each handle, and about handles 0 to 4 and one nobody opened. winbox.js agrees with every record.

- **The numbers:** handles 0 to 4 are DOS's own devices. A file gets the first free handle after them. With the probe's own output file open as 5, `_lcreat` answers 6. winbox.js had started at 3.
- **Function 4400h**, "get device information", answers in DX:
  - a file, made, written or opened again, is its drive counted from A: as nought, and nothing more: 0002 on C:, with bit 7, "a device", clear;
  - handles 0 to 4 are each the console, 80D3h;
  - a handle nobody opened is error 6, with the carry set.

  DOS documents bit 6 as set for a file not yet written. It was clear here even for the new file. The recording was made under DOSBox, whose DOS answers so.

## Why it matters

[[measured]] The Visual Basic runtime opens each custom control's `.VBX` file and asks function 4400h about the handle. It refuses a file that says it is a device, with "Can't use character device names in file names". winbox.js did not answer 4400h, and Four Seasons stopped there over `PICCLIP.VBX`.

## In winbox.js

`deviceInformation` in `src/dos/syscall/ioctl.ts`, and `FileManager.allocate` in `src/dos/file-manager.ts`. An error a DOS call throws at once, not only one it rejects later, sets the carry and puts the error in AX.

A path's `.` is the folder it is in and `..` the one above, as DOS reads them: Four Seasons opens `.\FS_CARDS.PIC` from its own folder. winbox.js had looked for a folder named `.`.
