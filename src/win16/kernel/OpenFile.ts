'use strict';

import { deleteFile, fileStamp } from '../../dos/syscall/files.js';
import { sysErrorBox, SEB_CLOSE, SEB_DEFBUTTON } from '../user/sys-error-box.js';
import { tellFileChange, wholePath } from './FileCdr.js';
import { directoryOf, hasDirectory, searchFile, taskDirectory } from './search.js';

import { Kernel } from '../kernel.js';

/**
 * The **OpenFile** function creates, opens, reopens, or deletes a file.
 *
 * If the `lpszFileName` parameter specifies a filename and extension only (or
 * if the `OF_SEARCH` flag is specified), the **OpenFile** function searchs for
 * a matching file in the following directories (in this order):
 *
 * 1. The current directory.
 * 2. The system root directory, which {@link Kernel.GetWindowsDirectory
 * GetWindowsDirectory} retrieves.
 * 3. The system directory which contains system files and libraries, whose path
 * the {@link Kernel.GetSystemDirectory GetSystemDirectory} function retrieves.
 * 4. The directory containing the executable file for the current task; the
 * {@link Kernel.GetModuleFileName GetModuleFileName} function obtains the path
 * of this directory.
 * 5. The directories listed in the `PATH` environment variable.
 * 6. The list of directories mapped in a network.
 *
 * To close the file after use, the application should call the `_lclose`
 * function.
 *
 * The `fuMode` parameter can be a combination of the following values:
 *
 * | Value                 | Meaning
 * |-----------------------|---------------------------------------------------|
 * | `OF_CANCEL`           | Adds a Cancel button to the `OF_PROMPT` dialog box. Pressing the Cancel button directs **OpenFile** to return a file-not-found error message.
 * | `OF_CREATE`           | Creates a new file. If the file already exists, it is truncated to zero length. When this flag is specified, the sharing flags are ignored. If a file must be shared it should be closed after it is created and then reopened with the appropriate sharing flags.
 * | `OF_DELETE`           | Deletes the file.
 * | `OF_EXIST`            | Opens the file, and then closes it. This value is used to test for file existence. Using this value does not change the file date.
 * | `OF_PARSE`            | Fills the `OFSTRUCT` structure but carries out no other action.
 * | `OF_PROMPT`           | Displays a dialog box if the requested file does not exist. The dialog box informs the user that the system cannot find the file and prompts the user to insert the file in drive A.
 * | `OF_READ`             | Opens the file for reading only.
 * | `OF_READWRITE`        | Opens the file for reading and writing.
 * | `OF_REOPEN`           | Opens the file using information in the reopen buffer.
 * | `OF_SEARCH`           | The system searches in directories even when the file name includes a full path.
 * | `OF_SHARE_COMPAT`     | Opens the file with compatibility mode, allowing any program on a given machine to open the file any number of times. **OpenFile** fails if the file has been opened with any of the other sharing modes.
 * | `OF_SHARE_DENY_NONE`  | Opens the file without denying other programs read or write access to the file. **OpenFile** fails if the file has been opened in compatibility mode by any program.
 * | `OF_SHARE_DENY_READ`  | Opens the file and denies other programs read access to the file. **OpenFile** fails if the file has been opened in compatibility mode or for read access by any other program.
 * | `OF_SHARE_DENY_WRITE` | Opens the file denies other programs write access to the file. **OpenFile** fails if the file has been opened in compatibility mode or for write access by any other program.
 * | `OF_SHARE_EXCLUSIVE`  | Opens the file with exclusive mode, denying other programs both read and write access to the file. **OpenFile** fails if the file has been opened in any other mode for read or write access, even by the current program.
 * | `OF_VERIFY`           | Compares the time and date in the `OFSTRUCT` with the time and date of the specified file. The function returns `HFILE_ERROR` if the dates and times do not agree.
 * | `OF_WRITE`            | Opens the file for writing only.
 * |-----------------------|---------------------------------------------------|
 *
 * The error values contained in the `nErrCode` parameter of the `OFSTRUCT`
 * data structure are as follows:
 *
 * | Value    | Meaning                        |
 * |----------|--------------------------------|
 * | `0x0001` | Invalid function               |
 * | `0x0002` | File not found                 |
 * | `0x0003` | Path not found                 |
 * | `0x0004` | Too many open files            |
 * | `0x0005` | Access denied                  |
 * | `0x0006` | Invalid handle                 |
 * | `0x0007` | Arena trashed                  |
 * | `0x0008` | Not enough memory              |
 * | `0x0009` | Invalid block                  |
 * | `0x000a` | Bad environment                |
 * | `0x000b` | Bad format                     |
 * | `0x000c` | Invalid access                 |
 * | `0x000d` | Invalid data                   |
 * | `0x000f` | Invalid drive                  |
 * | `0x0010` | Current directory              |
 * | `0x0011` | Not same device                |
 * | `0x0012` | No more files                  |
 * | `0x0013` | Write protect error            |
 * | `0x0014` | Bad unit                       |
 * | `0x0015` | Not ready                      |
 * | `0x0016` | Bad command                    |
 * | `0x0017` | CRC error                      |
 * | `0x0018` | Bad length                     |
 * | `0x0019` | Seek error                     |
 * | `0x001a` | Not MS-DOS disk                |
 * | `0x001b` | Sector not found               |
 * | `0x001c` | Out of paper                   |
 * | `0x001d` | Write fault                    |
 * | `0x001e` | Read fault                     |
 * | `0x001f` | General failure                |
 * | `0x0020` | Sharing violation              |
 * | `0x0021` | Lock violation                 |
 * | `0x0022` | Wrong disk                     |
 * | `0x0023` | File control block unavailable |
 * | `0x0024` | Sharing buffer exceeded        |
 * | `0x0032` | Not supported                  |
 * | `0x0033` | Remote not listed              |
 * | `0x0034` | Duplicate name                 |
 * | `0x0035` | Bad netpath                    |
 * | `0x0036` | Network busy                   |
 * | `0x0037` | Device does not exist          |
 * | `0x0038` | Too many commands              |
 * | `0x0039` | Adaptor hardware error         |
 * | `0x003a` | Bad network response           |
 * | `0x003b` | Unexpected network error       |
 * | `0x003c` | Bad remote adapter             |
 * | `0x003d` | Print queue full               |
 * | `0x003e` | No spool space                 |
 * | `0x003f` | Print canceled                 |
 * | `0x0040` | Netname deleted                |
 * | `0x0041` | Network access denied          |
 * | `0x0042` | Bad device type                |
 * | `0x0043` | Bad network name               |
 * | `0x0044` | Too many names                 |
 * | `0x0045` | Too many sessions              |
 * | `0x0046` | Sharing paused                 |
 * | `0x0047` | Request not accepted           |
 * | `0x0048` | Redirection paused             |
 * | `0x0050` | File exists                    |
 * | `0x0051` | Duplicate file control block   |
 * | `0x0052` | Cannot make                    |
 * | `0x0053` | Interrupt 24 failure           |
 * | `0x0054` | Out of structures              |
 * | `0x0055` | Already assigned               |
 * | `0x0056` | Invalid password               |
 * | `0x0057` | Invalid parameter              |
 * | `0x0058` | Net write fault                |
 * |----------|--------------------------------|
 *
 * **See also**:
 * {@link Kernel.GetSystemDirectory GetSystemDirectory}
 * {@link Kernel.GetWindowsDirectory GetWindowsDirectory}
 *
 * @static
 * @function OpenFile
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszFileName - Points to a null-terminated string that
 *                                      names the file to be opened. The string
 *                                      must consist of characters from the
 *                                      Windows character set and cannot contain
 *                                      wildcards.
 * @param {Types.OFSTRUCT} lpOpenBuff - Points to the **OFSTRUCT** structure
 *                                      names the file to be opened. The string
 *                                      that will receive information about the
 *                                      file when the file is first opened. The
 *                                      structure can be used in subsequent
 *                                      calls to the **OpenFile** function to
 *                                      refer to the open file.
 * @param {Types.UINT} fuMode - Specifies the action to take and the attributes
 *                              for the file. This parameter can be a
 *                              combination of the values found in the
 *                              description.
 *
 * @returns {Types.HFILE} The return value is an MS-DOS file handle if the
 *                        function is successful. (This handle is not
 *                        necessarily valid; for example, if the `fuMode`
 *                        parameter is `OF_EXIST`, the handle does not identify
 *                        an open file, and if the `fuMode` parameter is
 *                        `OF_DELETE`, the handle is invalid.) The reture value
 *                        is `HFILE_ERROR` if an error occurs.
 */
export async function OpenFile(lpszFileName, lpOpenBuff, fuMode) {
  /* `OF_REOPEN` opens the file the structure names, from an earlier call,
   * whatever name is given (seg1 `539c`): Jewel Thief of the corpus gives
   * none. */
  if (fuMode & Kernel.OF_REOPEN) {
    return reopen(this, lpOpenBuff, fuMode);
  }

  if (lpszFileName === null || lpszFileName === undefined) {
    return Kernel.HFILE_ERROR;
  }

  const given = String(lpszFileName);

  /* `OF_PARSE`: the name made whole into the structure, and nothing opened --
   * the answer 0 (`KRNL386.EXE` seg1 `53f1`, `575f`, the handle it is given
   * 0). Cardfile parses the file to merge so, and took the handle a file
   * opened left as "Filename not valid". Made whole as it is before a
   * search, capital and with `.` gone: recorded by `mmio`, whose
   * `MMIO_PARSE` hands back the structure's path. KERNEL keeps in the
   * reserved bytes what DOS's 5700h answers for handle 0, the console
   * (`57bb`): under DOSBox neither nought nor the file's (`openfile`);
   * nought here, as this DOS keeps no date for the console. */
  if (fuMode & Kernel.OF_PARSE) {
    filled(lpOpenBuff, madeWhole(this.dos, given), 0);

    return 0;
  }

  /* A name without a directory, or any with `OF_SEARCH`, is looked for
   * where KERNEL looks (`search.ts`), a directory named looked in first;
   * one with a directory is opened there alone (**recorded** by `search`:
   * DOS's error 3 for a directory not there). A file made is not looked
   * for. Not found, the error is 2. */
  let error = 0;
  let path = given;

  const looks = !(fuMode & Kernel.OF_CREATE);

  if (looks && (!hasDirectory(given) || fuMode & Kernel.OF_SEARCH)) {
    const slash = Math.max(given.lastIndexOf('\\'), given.lastIndexOf('/'), given.lastIndexOf(':'));
    const first = hasDirectory(given)
      ? wholePath(this.dos, given.slice(0, slash + (given[slash] === ':' ? 1 : 0)) || '\\')
      : undefined;
    const found = await searchFile(this, given.slice(slash + 1), taskDirectory(this), first);

    if ('path' in found) {
      path = found.path;
    } else {
      error = found.error;
    }
  } else {
    path = wholePath(this.dos, given);
  }

  // Open the file. When successful, yields a file handle.
  let handle = error ? null : await this.dos.files.open(path);
  const file = this.dos.files.resolve(handle);

  // If the file could not be opened
  if (!file) {
    handle = Kernel.HFILE_ERROR;
    error ||= await notThere(this, path);
  } else {
    lpszFileName = file.mount + ':' + file.path;
  }

  // Create (or truncate) the file
  if (fuMode & Kernel.OF_CREATE) {
    /* Made again empty if it is there: creating replaces a file. */
    if (file) {
      this.dos.files.close(handle);
    }

    /* A name with no drive is made in the current directory, as DOS makes
     * it: BogOut makes its `TOPTEN.DAT` so, which went nowhere and answered
     * nothing. A file that cannot be made is `HFILE_ERROR`. */
    const where = String(lpszFileName);
    const full = where.includes(':')
      ? where
      : where.startsWith('\\')
        ? `${this.dos.files.drive ?? 'C'}:${where}`
        : `${this.dos.files.path ?? 'C:\\'}${where}`;

    handle = (await this.dos.files.create(full)) ?? Kernel.HFILE_ERROR;

    if (handle !== Kernel.HFILE_ERROR) {
      lpszFileName = full.toUpperCase();
      error = 0;

      /* KERNEL's own create tells `FileCdr`'s procedure, as 3C01h. */
      await tellFileChange(this, 0x3c01, given);
    } else {
      error ||= 5;
    }
  }

  /* Failing, KERNEL leaves in the structure DOS's error and the name as it
   * made it whole before it looked: its own buffer, copied as it gives up
   * (`KRNL386.EXE` seg1 `5490`, `5814`). The count, the fixed disk and the
   * reserved bytes are left as they were (`openfile`). COMMDLG's Save As box
   * finds the path of a file not there yet so; Terminal, handed the name as
   * given, `.\TEST.TRM`, saved its settings as `.TRM`. */
  if (handle === Kernel.HFILE_ERROR) {
    await prompt(this, given, fuMode, error);
    lpOpenBuff.szPathName = madeWhole(this.dos, given);
    lpOpenBuff.nErrCode = error;

    return Kernel.HFILE_ERROR;
  }

  filled(lpOpenBuff, String(lpszFileName), await stampOf(this, handle));

  return closedAsAsked(this, handle, fuMode, lpOpenBuff, given);
}

/**
 * The structure of a file opened, or a name parsed (`KRNL386.EXE` seg1
 * `575f`): its count the length of its path and eight, the offset of the
 * path's nought; a fixed disk; no error; the file's date and time in the
 * reserved bytes, the date's word first, as DOS's 5700h answers them; and
 * the path. **Recorded** by `openfile`: 28 for `C:\ORACLE\OFTEST.DAT`.
 */
function filled(buffer: any, path: string, stamp: number) {
  buffer.cBytes = (path.length + 8) & 0xff;
  buffer.fFixedDisk = 1;
  buffer.nErrCode = 0;
  buffer.reserved = stamp >>> 0;
  buffer.szPathName = path;
}

/** A file's date and time as the structure keeps them, the date in the low word; nought for none. */
async function stampOf(system: any, handle: number) {
  try {
    const [time, date] = await fileStamp.call(system.dos, handle);

    return (date | (time << 16)) >>> 0;
  } catch {
    return 0;
  }
}

/**
 * A file opened for `OF_EXIST` or `OF_DELETE` closed again, and for
 * `OF_DELETE` deleted (`KRNL386.EXE` seg1 `57ce`-`580a`, and `5509` after
 * `OF_REOPEN`). The answer is the handle it was opened as, closed or not:
 * **recorded** by `openfile`, 6 for a file there with the probe's own open
 * as 5, and 7 with another held open too. A delete that fails is DOS's error
 * in the structure and `HFILE_ERROR`.
 */
async function closedAsAsked(
  system: any,
  handle: number,
  mode: number,
  buffer: any,
  given: string
) {
  if (!(mode & (Kernel.OF_EXIST | Kernel.OF_DELETE))) {
    return handle;
  }

  const file = system.dos.files.resolve(handle);
  const path = file ? `${file.mount}:${file.path}` : String(buffer.szPathName);

  system.dos.files.close(handle);

  if (mode & Kernel.OF_DELETE) {
    try {
      await deleteFile.call(system.dos, path);
      await tellFileChange(system, 0x4100, given);
    } catch (error) {
      buffer.nErrCode = typeof error === 'number' ? error : 5;

      return Kernel.HFILE_ERROR;
    }
  }

  return handle;
}

/**
 * `OF_REOPEN` (`KRNL386.EXE` seg1 `54ad`): the file the structure names
 * opened again as it is named, or made with `OF_CREATE`, the name given
 * not looked at. Only the reserved bytes are written, the file's date and
 * time; failing, only DOS's error. With `OF_VERIFY` (the bit `OF_SEARCH`
 * is without `OF_REOPEN`) a file whose date or time is not the structure's
 * is closed and answers `HFILE_ERROR` with error nought. Then `OF_EXIST`
 * and `OF_DELETE` as for any open. **Recorded** by `openfile`.
 */
async function reopen(system: any, buffer: any, mode: number) {
  const path = String(buffer?.szPathName ?? '');

  if (!buffer || !path) {
    return Kernel.HFILE_ERROR;
  }

  let handle: number | null;

  if (mode & Kernel.OF_CREATE) {
    handle = (await system.dos.files.create(path)) ?? null;

    if (handle !== null) {
      await tellFileChange(system, 0x3c01, path);
    }
  } else {
    handle = await system.dos.files.open(path);
  }

  if (handle === null || handle === undefined || !system.dos.files.resolve(handle)) {
    buffer.nErrCode = mode & Kernel.OF_CREATE ? 5 : await notThere(system, path);

    return Kernel.HFILE_ERROR;
  }

  const stamp = await stampOf(system, handle);

  if (mode & Kernel.OF_VERIFY && stamp !== buffer.reserved >>> 0) {
    system.dos.files.close(handle);
    buffer.nErrCode = 0;

    return Kernel.HFILE_ERROR;
  }

  buffer.reserved = stamp;

  return closedAsAsked(system, handle, mode, buffer, path);
}

/**
 * `OF_PROMPT` with a file not found (`KRNL386.EXE` seg1 `5827`, `5994`):
 * USER's system error box, "File Error", "Cannot find" and the name after
 * the last `\` of the name made whole, with Close, before `OpenFile` answers
 * `HFILE_ERROR`. `OF_CANCEL` adds no button: KERNEL never looks at it.
 * **Recorded** by `openfile`, the box shown for a directory not there too.
 */
async function prompt(system: any, given: string, mode: number, error: number) {
  if (!(mode & Kernel.OF_PROMPT) || !error) {
    return;
  }

  const whole = madeWhole(system.dos, given);
  const name = whole.slice(whole.lastIndexOf('\\') + 1);

  if (name) {
    await sysErrorBox(system, `Cannot find ${name}`, 'File Error', [
      0,
      SEB_CLOSE | SEB_DEFBUTTON,
      0,
    ]);
  }
}

/**
 * A name made whole as `OpenFile` makes it before it looks (`KRNL386.EXE`
 * seg1 `5a34`): on the current drive and in its current directory unless it
 * names them, `/` taken for `\`, `.` and `..` gone, and each letter capital
 * as KERNEL makes it (`83e9`).
 */
function madeWhole(dos: any, name: string) {
  const whole = wholePath(dos, name);
  const parts: string[] = [];

  for (const part of whole.slice(2).split(/[\\/]/)) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '' && part !== '.') {
      parts.push([...part].map(capital).join(''));
    }
  }

  return `${whole.slice(0, 2)}\\${parts.join('\\')}`;
}

/** A letter as KERNEL makes it capital: `a` to `z`, and `E0h` to `FEh` but `F7h` (seg1 `83e9`). */
function capital(letter: string) {
  const code = letter.charCodeAt(0);

  return (code >= 0x61 && code <= 0x7a) || (code >= 0xe0 && code <= 0xfe && code !== 0xf7)
    ? String.fromCharCode(code - 0x20)
    : letter;
}

/** DOS's error for a path that opened nothing: 3 for its directory not there, else 2. */
async function notThere(system: any, path: string) {
  const directory = directoryOf(path);

  if (!directory || /^[A-Za-z]:$/.test(directory)) {
    return 2;
  }

  try {
    await system.files.list(directory);
    return 2;
  } catch {
    return 3;
  }
}
