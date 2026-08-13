"use strict";

import { NULL } from '../consts.js';

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
    // Open the file. When successful, yields a file handle.
    let handle = await this.dos.files.open(lpszFileName);
    const file = this.dos.files.resolve(handle);

    // If the file could not be opened
    if (!file) {
        handle = Kernel.HFILE_ERROR;
    }
    else {
        lpszFileName = file.mount + ":" + file.path;
    }

    // Create (or truncate) the file
    if (fuMode & Kernel.OF_CREATE) {
        if (file) {
            // Truncate the file
            await file.truncate();
        }
        else {
            // Create a new file
            handle = await this.dos.files.create(lpszFileName);
        }
    }

    // Delete the file
    if (fuMode & Kernel.OF_DELETE) {
        await this.dos.files.remove(lpszFileName);
    }

    // Check for the file's existence
    if (fuMode & Kernel.OF_EXIST) {
        if (file) {
            this.dos.files.close(file);
            // Apparently, it returns 1 if the file is found.
            handle = 1;
        }
        else {
            handle = Kernel.HFILE_ERROR;
        }
    }

    console.log(file);

    lpOpenBuff.cBytes = lpOpenBuff.structSize; // Number of bytes of the
                                               // OFSTRUCT structure
    lpOpenBuff.szPathName = lpszFileName; // Path to the file
    lpOpenBuff.nErrCode = 0; // DOS error codes
    lpOpenBuff.fFixedDisk = 1; // Whether or not it is on a fixed disk

    return handle;
}
