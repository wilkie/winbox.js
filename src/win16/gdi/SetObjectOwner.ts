'use strict';

/**
 * Gives a GDI object to another owner, so that it outlives the task that made
 * it. `COMMDLG.DLL` calls it (seg6 `0160`) for an object it keeps, looking it
 * up by ordinal on Windows 3.10 and later; 16 of the accessories load it.
 *
 * **Read out** of `GDI.EXE` (seg1 `76a2`): in Windows 3.1 it does nothing. It
 * takes its two words off the stack and returns, `retf 4`, with no answer:
 * `AX` is left at GDI's own data segment, from its entry.
 *
 * @param {Types.HGDIOBJ} hObject - The object.
 * @param {Types.HANDLE} hOwner - Its new owner.
 */
export function SetObjectOwner(this: any, _hObject: number, _hOwner: number) {}
