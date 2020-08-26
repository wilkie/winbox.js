"use strict";

/** @namespace Kernel */

import { Module } from './module.js';

import { BYTE, UBYTE, INT, UINT, FARPTR,
         DWORD, HLOCAL, HGLOBAL, HANDLE,
         BOOL, NEARPTR, LPCSTR, HWND } from './types.js';

import { FatalAppExit } from './kernel/FatalAppExit.js';
import { FatalExit } from './kernel/FatalExit.js';
import { GetVersion } from './kernel/GetVersion.js';
import { InitTask } from './kernel/InitTask.js';
import { lstrcpy } from './kernel/lstrcpy.js';
import { lstrcat } from './kernel/lstrcat.js';
import { lstrlen } from './kernel/lstrlen.js';
import { LocalAlloc } from './kernel/LocalAlloc.js';
import { LocalCompact } from './kernel/LocalCompact.js';
import { LocalFlags } from './kernel/LocalFlags.js';
import { LocalFree } from './kernel/LocalFree.js';
import { LocalHandle } from './kernel/LocalHandle.js';
import { LocalInit } from './kernel/LocalInit.js';
import { LocalLock } from './kernel/LocalLock.js';
import { LocalReAlloc } from './kernel/LocalReAlloc.js';
import { LocalSize } from './kernel/LocalSize.js';
import { LocalUnlock } from './kernel/LocalUnlock.js';
import { LockSegment } from './kernel/LockSegment.js';
import { OutputDebugString } from './kernel/OutputDebugString.js';
import { UnlockSegment } from './kernel/UnlockSegment.js';
import { WaitEvent } from './kernel/WaitEvent.js';

/**
 * The Win16 Kernel library.
 *
 * @memberof Win16
 */
export class Kernel extends Module {
    static get name() {
        return "KERNEL";
    }

    static get exports() {
        return [
            // 0 //
            null,
            [FatalExit, "FatalExit", 2, [INT]],
            [Kernel.stub, "ExitKernel", 2],
            [GetVersion, "GetVersion", 0, [], DWORD],
            [LocalInit, "LocalInit", 6, [UINT, UINT, UINT], BOOL],
            [LocalAlloc, "LocalAlloc", 4, [UINT, UINT], HLOCAL],
            [LocalReAlloc, "LocalReAlloc", 6, [HLOCAL, UINT, UINT], HLOCAL],
            [LocalFree, "LocalFree", 2, [HLOCAL], HLOCAL],
            [LocalLock, "LocalLock", 2, [HLOCAL], NEARPTR],
            [LocalUnlock, "LocalUnlock", 2, [HLOCAL], BOOL],
            // 10 //
            [LocalSize, "LocalSize", 2, [HLOCAL], UINT],
            [LocalHandle, "LocalHandle", 2, [NEARPTR], HLOCAL],
            [LocalFlags, "LocalFlags", 2, [HLOCAL], UINT],
            [LocalCompact, "LocalCompact", 2, [UINT], UINT],
            [Kernel.stub, "LocalNotify", 4],
            [Kernel.stub, "GlobalAlloc", 6],
            [Kernel.stub, "GlobalReAlloc", 8],
            [Kernel.stub, "GlobalFree", 2],
            [Kernel.stub, "GlobalLock", 2],
            [Kernel.stub, "GlobalUnlock", 2],
            // 20 //
            [Kernel.stub, "GlobalSize", 2],
            [Kernel.stub, "GlobalHandle", 2],
            [Kernel.stub, "GlobalFlags", 2],
            [LockSegment, "LockSegment", 2, [UINT], HGLOBAL],
            [UnlockSegment, "UnlockSegment", 2, [UINT]],
            [Kernel.stub, "GlobalCompact", 4],
            [Kernel.stub, "GlobalFreeAll", 2],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "GlobalMasterHandle", 0],
            [Kernel.stub, "Yield", 0],
            // 30 //
            [WaitEvent, "WaitEvent", 2, [HANDLE], BOOL],
            [Kernel.stub, "PostEvent", 2],
            [Kernel.stub, "SetPriority", 4],
            [Kernel.stub, "LockCurrentTask", 2],
            [Kernel.stub, "SetTaskQueue", 4],
            [Kernel.stub, "GetTaskQueue", 2],
            [Kernel.stub, "GetCurrentTask", 0],
            [Kernel.stub, "GetCurrentPDB", 0],
            [Kernel.stub, "SetTaskSignalProc", 6],
            [Kernel.stub, "unknown"],
            // 40 //
            [Kernel.stub, "unknown"],
            [Kernel.stub, "EnableDos", 0],
            [Kernel.stub, "DisableDos", 0],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "LoadModule", 8],
            [Kernel.stub, "FreeModule", 2],
            [Kernel.stub, "GetModuleHandle", 4],
            [Kernel.stub, "GetModuleUsage", 2],
            [Kernel.stub, "GetModuleFilename", 8],
            // 50 //
            [Kernel.stub, "GetProcAddress", 6],
            [Kernel.stub, "MakeProcInstance", 6],
            [Kernel.stub, "FreeProcInstance", 4],
            [Kernel.stub, "CallProcInstance", 4],
            [Kernel.stub, "GetInstanceData", 6],
            [Kernel.stub, "Catch", 4],
            [Kernel.stub, "Throw", 10],
            [Kernel.stub, "GetProfileInt", 10],
            [Kernel.stub, "GetProfileString", 18],
            [Kernel.stub, "WriteProfileString", 12],
            // 60 //
            [Kernel.stub, "FindResource", 10],
            [Kernel.stub, "LoadResource", 4],
            [Kernel.stub, "LockResource", 2],
            [Kernel.stub, "FreeResource", 2],
            [Kernel.stub, "AccessResource", 4],
            [Kernel.stub, "SizeOfResource", 4],
            [Kernel.stub, "AllocResource", 8],
            [Kernel.stub, "SetResourceHandler", 10],
            [Kernel.stub, "InitAtomTable", 2],
            [Kernel.stub, "FindAtom", 4],
            // 70 //
            [Kernel.stub, "AddAtom", 4],
            [Kernel.stub, "DeleteAtom", 2],
            [Kernel.stub, "GetAtomName", 8],
            [Kernel.stub, "GetAtomHandle", 2],
            [Kernel.stub, "OpenFile", 10],
            [Kernel.stub, "OpenPathName", 6],
            [Kernel.stub, "DeletePathName", 6],
            [Kernel.stub, "Reserved1", 4],
            [Kernel.stub, "Reserved2", 4],
            [Kernel.stub, "Reserved3", 4],
            // 80 //
            [Kernel.stub, "Reserved4", 4],
            [Kernel.stub, "_LCLOSE", 2],
            [Kernel.stub, "_LREAD", 8],
            [Kernel.stub, "_LCREAT", 6],
            [Kernel.stub, "_LLSEEK", 8],
            [Kernel.stub, "_LOPEN", 6],
            [Kernel.stub, "_LWRITE", 8],
            [Kernel.stub, "Reserved5", 4],
            [lstrcpy, "LSTRCPY", 8, [FARPTR, FARPTR], FARPTR],
            [lstrcat, "LSTRCAT", 4, [FARPTR, FARPTR], FARPTR],
            // 90 //
            [lstrlen, "LSTRLEN", 4, [FARPTR], UINT],
            [InitTask, "InitTask", 0, [], UINT],
            [Kernel.stub, "GetTempDrive", 2],
            [Kernel.stub, "GetCodeHandle", 4],
            [Kernel.stub, "DefineHandleTable", 2],
            [Kernel.stub, "LoadLibrary", 4],
            [Kernel.stub, "FreeLibrary", 2],
            [Kernel.stub, "GetTempFileName", 12],
            [Kernel.stub, "GetLastDiskChange", 0],
            [Kernel.stub, "GetLPErrMode", 0],
            // 100 //
            [Kernel.stub, "ValidateCodeSegments", 0],
            [Kernel.stub, "NoHookDosCall", 0],
            [Kernel.stub, "Dos3Call", 0],
            [Kernel.stub, "NetBiosCall", 0],
            [Kernel.stub, "GetCodeInfo", 8],
            [Kernel.stub, "GetExeVersion", 0],
            [Kernel.stub, "SetSwapAreaSize", 2],
            [Kernel.stub, "SetErrorMode", 2],
            [Kernel.stub, "SwitchStackTo", 0],
            [Kernel.stub, "SwitchStackBack", 0],
            // 110 //
            [Kernel.stub, "PatchCodeHandle", 2],
            [Kernel.stub, "GlobalWire", 2],
            [Kernel.stub, "GlobalUnwire", 2],
            [Kernel.stub, "__AHSHIFT"],
            [Kernel.stub, "__AHINCR"],
            [OutputDebugString, "OutputDebugString", 4, [LPCSTR]],
            [Kernel.stub, "InitLib", 2],
            [Kernel.stub, "OldYield", 6],
            [Kernel.stub, "GetTaskQueueDS", 6],
            [Kernel.stub, "GetTaskQueueES", 2],
            // 120 //
            [Kernel.stub, "UndefDynLink", 0],
            [Kernel.stub, "LocalShrink", 2],
            [Kernel.stub, "IsTaskLocked", 4],
            [Kernel.stub, "KbdRst", 4],
            [Kernel.stub, "EnableKernel", 0],
            [Kernel.stub, "DisableKernel", 2],
            [Kernel.stub, "MemoryFreed", 0],
            [Kernel.stub, "GetPrivateProfileInt", 0],
            [Kernel.stub, "GetPrivateProfileString", 10],
            [Kernel.stub, "WritePrivateProfileString", 12],
            // 130 //
            [Kernel.stub, "FileCdr"],
            [Kernel.stub, "GetDosEnvironment", 2],
            [Kernel.stub, "GetWinFlags", 2],
            [Kernel.stub, "GetExePtr", 4],
            [Kernel.stub, "GetWindowsDirectory", 4],
            [Kernel.stub, "GetSystemDirectory", 4],
            [Kernel.stub, "GetDriveType", 4],
            [FatalAppExit, "FatalAppExit", 6, [UINT, LPCSTR]],
            [Kernel.stub, "GetHeapSpaces", 12],
            [Kernel.stub, "DoSignal", 2],
            // 140 //
            [Kernel.stub, "SetSigHandler", 2],
            [Kernel.stub, "InitTask1", 0],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            // 150 //
            [Kernel.stub, "DirectedYield", 6],
            [Kernel.stub, "WinOldApCall", 5],
            [Kernel.stub, "GetNumTasks", 2],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "GlobalNotify", 4],
            [Kernel.stub, "GetTaskDS", 10],
            [Kernel.stub, "LimitItemsPages", 2],
            [Kernel.stub, "GetCurPID", 4],
            [Kernel.stub, "IsWinOldApTask", 2],
            [Kernel.stub, "GlobalHandleNoRIP", 0],
            // 160 //
            [Kernel.stub, "EMSCopy", 2],
            [Kernel.stub, "LocalCountFree", 2],
            [Kernel.stub, "LocalHeapSize", 2],
            [Kernel.stub, "GlobalLRUOldest", 2],
            [Kernel.stub, "GlobalLRUNewest", 4],
            [Kernel.stub, "A20Proc", 2],
            [Kernel.stub, "WinExec", 4],
            [Kernel.stub, "GetExpWinVer", 0],
            [Kernel.stub, "DirectResAlloc", 4],
            [Kernel.stub, "GetFreeSpace", 4],
            // 170 //
            [Kernel.stub, "AllocCSToDSAlias", 2],
            [Kernel.stub, "AllocDSToCSAlias", 2],
            [Kernel.stub, "AllocAlias", 14],
            [Kernel.stub, "__ROMBIOS", 2],
            [Kernel.stub, "__A000H", 6],
            [Kernel.stub, "AllocSelector", 4],
            [Kernel.stub, "FreeSelector", 6],
            [Kernel.stub, "PrestoChangoSelector", 2],
            [Kernel.stub, "__WINFLAGS"],
            [Kernel.stub, "__D000H", 4],
            // 180 //
            [Kernel.stub, "LONGPTRADD", 2],
            [Kernel.stub, "__B000H", 2],
            [Kernel.stub, "__B800H", 4],
            [Kernel.stub, "__0000H", 2],
            [Kernel.stub, "GlobalDosAlloc", 2],
            [Kernel.stub, "GlobalDosFree", 4],
            [Kernel.stub, "GetSelectorBase", 2],
            [Kernel.stub, "SetSelectorBase", 2],
            [Kernel.stub, "GetSelectorLimit", 2],
            [Kernel.stub, "SetSelectorLimit", 2],
            // 190 //
            [Kernel.stub, "__E000H", 6],
            [Kernel.stub, "GlobalPageLock", 2],
            [Kernel.stub, "GlobalPageUnlock", 2],
            [Kernel.stub, "__0040H", 2],
            [Kernel.stub, "__F000H", 2],
            [Kernel.stub, "__C000H", 2],
            [Kernel.stub, "SelectorAccessRights", 4],
            [Kernel.stub, "GlobalFix", 2],
            [Kernel.stub, "GlobalUnfix", 2],
            [Kernel.stub, "SetHandleCount", 8],
            // 200 //
            [Kernel.stub, "ValidateFreeSpaces", 0],
            [Kernel.stub, "ReplaceInst", 2],
            [Kernel.stub, "RegisterPtrace", 0],
            [Kernel.stub, "DebugBreak", 4],
            [Kernel.stub, "SwapRecording", 2],
            [Kernel.stub, "CVWBreak", 2],
            [Kernel.stub, "AllocSelectorArray", 4],
            [Kernel.stub, "IsDBCSLeadByte", 4],
            // ... unknown ordinals ... //
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"], [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            // 310 //
            [Kernel.stub, "LocalHandleDelta", 0],
            [Kernel.stub, "GetSetKernelDosProc", 0],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "DebugDefineSegment", 0],
            [Kernel.stub, "WriteOutProfiles", 2],
            [Kernel.stub, "GetFreeMemInfo"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "FatalExitHook", 0],
            [Kernel.stub, "FlushCachedFileHandle", 2],
            // 320 //
            [Kernel.stub, "IsTask", 10],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "IsRomModule", 2],
            [Kernel.stub, "LogError", 2],
            [Kernel.stub, "LogParamError", 10],
            [Kernel.stub, "IsRomFile", 8],
            [Kernel.stub, "K327", 0],
            [Kernel.stub, "_DEBUGOUTPUT", 10],
            [Kernel.stub, "K329", 2],
            // 330 //
            [Kernel.stub, "unknown"],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "ThHook", 4],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "IsBadReadPtr", 0],
            [Kernel.stub, "IsBadWritePtr", 4],
            [Kernel.stub, "IsBadCodePtr", 4],
            [Kernel.stub, "IsBadStringPtr", 2],
            [Kernel.stub, "HasGPHandler", 0],
            [Kernel.stub, "DiagQuery", 4],
            // 340 //
            [Kernel.stub, "DiagOutput", 2],
            [Kernel.stub, "ToolHelpHook", 6],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "RegisterWinOldApHook", 2],
            [Kernel.stub, "GetWinOldApHooks", 2],
            [Kernel.stub, "IsSharedSelector", 8],
            [Kernel.stub, "IsBadHugeReadPtr", 6],
            [Kernel.stub, "IsBadHugeWritePtr", 0],
            [Kernel.stub, "HMEMCPY", 4],
            [Kernel.stub, "_HREAD", 0],
            // 350 //
            [Kernel.stub, "_HWRITE", 4],
            [Kernel.stub, "BUNNY_351", 14],
            [Kernel.stub, "unknown"],
            [Kernel.stub, "LSTRCPYN", 0],
            [Kernel.stub, "GetAppCompatFlags", 2],
            [Kernel.stub, "GetWinDebugInfo", 10],
            [Kernel.stub, "SetWinDebugInfo", 0],
            // .. //
            //Kernel.stub, // K403,
            //Kernel.stub, // K404,
        ];
    }

    static stub() {
        console.log("Stub called!");
    }
}

/**
 * Allocates fixed memory.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_FIXED = 0x0000;

/**
 * Allocates moveable memory.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_MOVEABLE = 0x0002;

/**
 * Does not compact or discard memory to satisfy the allocation request.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_NOCOMPACT = 0x0010;

/**
 * Does not discard memory to satisfy the allocation request.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_NODISCARD = 0x0020;

/**
 * Initializes memory contents to zero.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_ZEROINIT = 0x0040;

/**
 * When specified, will modify the attributes of the memory object.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_MODIFY = 0x0080;

/**
 * Allocates discardable memory.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_DISCARDABLE = 0x0f00;

/**
 * Combines LMEM_FIXED and LMEM_ZEROINIT.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LPTR = Kernel.LMEM_FIXED | Kernel.LMEM_ZEROINIT;

/**
 * Combines LMEM_MOVEABLE and LMEM_ZEROINIT.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LHND = Kernel.LMEM_MOVEABLE | Kernel.LMEM_ZEROINIT;

/**
 * Same as LMEM_MOVEABLE.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.NONZEROLHND = Kernel.LMEM_MOVEABLE;

/**
 * Same as LMEM_FIXED.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.NONZEROLPTR = Kernel.LMEM_FIXED;

/**
 * A flag set when the associated object has been discarded.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_DISCARDED = 0x4000;

/**
 * A mask to retrieve the lock count from the object flags.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.LMEM_LOCKCOUNT = 0x00ff;
