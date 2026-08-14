'use strict';

/** @namespace Kernel */

import { Module } from './module.js';

import {
  BYTE,
  UBYTE,
  INT,
  UINT,
  FARPTR,
  HFILE,
  ATOM,
  DWORD,
  HLOCAL,
  HGLOBAL,
  HANDLE,
  HINSTANCE,
  LONG,
  CHARARRAY,
  BOOL,
  NEARPTR,
  LPCSTR,
  HWND,
  Struct,
} from './types.js';

import { _lclose } from './kernel/_lclose.js';
import { _lcreat } from './kernel/_lcreat.js';
import { _lwrite } from './kernel/_lwrite.js';
import { _llseek } from './kernel/_llseek.js';
import { _lread } from './kernel/_lread.js';
import { Catch } from './kernel/Catch.js';
import { FatalAppExit } from './kernel/FatalAppExit.js';
import { FatalExit } from './kernel/FatalExit.js';
import { GetDOSEnvironment } from './kernel/GetDOSEnvironment.js';
import { GetFreeSpace } from './kernel/GetFreeSpace.js';
import { GetModuleFilename } from './kernel/GetModuleFilename.js';
import { GetPrivateProfileInt } from './kernel/GetPrivateProfileInt.js';
import { GetPrivateProfileString } from './kernel/GetPrivateProfileString.js';
import { GetProfileInt } from './kernel/GetProfileInt.js';
import { GetProfileString } from './kernel/GetProfileString.js';
import { WriteProfileString } from './kernel/WriteProfileString.js';
import { GetProcAddress } from './kernel/GetProcAddress.js';
import { GetVersion } from './kernel/GetVersion.js';
import { GetWindowsDirectory } from './kernel/GetWindowsDirectory.js';
import { GetWinFlags } from './kernel/GetWinFlags.js';
import { FindResource } from './kernel/FindResource.js';
import { FreeResource } from './kernel/FreeResource.js';
import { GlobalAlloc } from './kernel/GlobalAlloc.js';
import { LoadResource } from './kernel/LoadResource.js';
import { LockResource } from './kernel/LockResource.js';
import { GlobalFlags } from './kernel/GlobalFlags.js';
import { GlobalHandle } from './kernel/GlobalHandle.js';
import { GlobalReAlloc } from './kernel/GlobalReAlloc.js';
import { GlobalFree } from './kernel/GlobalFree.js';
import { GlobalLock } from './kernel/GlobalLock.js';
import { GlobalSize } from './kernel/GlobalSize.js';
import { GlobalUnlock } from './kernel/GlobalUnlock.js';
import { InitTask } from './kernel/InitTask.js';
import { lstrcpy } from './kernel/lstrcpy.js';
import { lstrcat } from './kernel/lstrcat.js';
import { lstrlen } from './kernel/lstrlen.js';
import { LoadLibrary } from './kernel/LoadLibrary.js';
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
import { MakeProcInstance } from './kernel/MakeProcInstance.js';
import { OpenFile } from './kernel/OpenFile.js';
import { OutputDebugString } from './kernel/OutputDebugString.js';
import { Throw } from './kernel/Throw.js';
import { UnlockSegment } from './kernel/UnlockSegment.js';
import { WaitEvent } from './kernel/WaitEvent.js';
import { WritePrivateProfileString } from './kernel/WritePrivateProfileString.js';

/**
 * The Win16 Kernel library.
 *
 * @memberof Win16
 */
export class Kernel extends Module {
  declare static GHND: any;
  declare static GMEM_DDESHARE: any;
  declare static GMEM_DISCARDABLE: any;
  declare static GMEM_FIXED: any;
  declare static GMEM_LOWER: any;
  declare static GMEM_MODIFY: any;
  declare static GMEM_MOVEABLE: any;
  declare static GMEM_NOCOMPACT: any;
  declare static GMEM_NODISCARD: any;
  declare static GMEM_NOTIFY: any;
  declare static GMEM_NOT_BANKED: any;
  declare static GMEM_SHARE: any;
  declare static GMEM_ZEROINIT: any;
  declare static GPTR: any;
  declare static HFILE_ERROR: any;
  declare static LHND: any;
  declare static LMEM_DISCARDABLE: any;
  declare static LMEM_DISCARDED: any;
  declare static LMEM_FIXED: any;
  declare static LMEM_LOCKCOUNT: any;
  declare static LMEM_MODIFY: any;
  declare static LMEM_MOVEABLE: any;
  declare static LMEM_NOCOMPACT: any;
  declare static LMEM_NODISCARD: any;
  declare static LMEM_ZEROINIT: any;
  declare static LPTR: any;
  declare static NONZEROLHND: any;
  declare static NONZEROLPTR: any;
  declare static OF_CANCEL: any;
  declare static OF_CREATE: any;
  declare static OF_DELETE: any;
  declare static OF_EXIST: any;
  declare static OF_PARSE: any;
  declare static OF_PROMPT: any;
  declare static OF_READ: any;
  declare static OF_READWRITE: any;
  declare static OF_REOPEN: any;
  declare static OF_SEARCH: any;
  declare static OF_SHARE_COMPAT: any;
  declare static OF_SHARE_DENY_NONE: any;
  declare static OF_SHARE_DENY_READ: any;
  declare static OF_SHARE_DENY_WRITE: any;
  declare static OF_SHARE_EXCLUSIVE: any;
  declare static OF_VERIFY: any;
  declare static OF_WRITE: any;
  declare static WF_80x87: any;
  declare static WF_CPU086: any;
  declare static WF_CPU186: any;
  declare static WF_CPU286: any;
  declare static WF_CPU386: any;
  declare static WF_CPU486: any;
  declare static WF_ENHANCED: any;
  declare static WF_LARGEFRAME: any;
  declare static WF_PAGING: any;
  declare static WF_PMODE: any;
  declare static WF_SMALLFRAME: any;
  declare static WF_STANDARD: any;
  declare static WF_WIN286: any;
  declare static WF_WIN386: any;
  declare static WF_WLO: any;
  static get name(): string {
    return 'KERNEL';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\KRNL286.EXE';
  }

  static get exports() {
    return [
      // 0 //
      null,
      [FatalExit, 'FatalExit', 2, [INT]],
      [Kernel.stub, 'ExitKernel', 2],
      [GetVersion, 'GetVersion', 0, [], DWORD],
      [LocalInit, 'LocalInit', 6, [UINT, UINT, UINT], BOOL],
      [LocalAlloc, 'LocalAlloc', 4, [UINT, UINT], HLOCAL],
      [LocalReAlloc, 'LocalReAlloc', 6, [HLOCAL, UINT, UINT], HLOCAL],
      [LocalFree, 'LocalFree', 2, [HLOCAL], HLOCAL],
      [LocalLock, 'LocalLock', 2, [HLOCAL], NEARPTR],
      [LocalUnlock, 'LocalUnlock', 2, [HLOCAL], BOOL],
      // 10 //
      [LocalSize, 'LocalSize', 2, [HLOCAL], UINT],
      [LocalHandle, 'LocalHandle', 2, [NEARPTR], HLOCAL],
      [LocalFlags, 'LocalFlags', 2, [HLOCAL], UINT],
      [LocalCompact, 'LocalCompact', 2, [UINT], UINT],
      [Kernel.stub, 'LocalNotify', 4],
      [GlobalAlloc, 'GlobalAlloc', 6, [UINT, DWORD], HGLOBAL],
      [GlobalReAlloc, 'GlobalReAlloc', 8, [HGLOBAL, DWORD, UINT], HGLOBAL],
      [GlobalFree, 'GlobalFree', 2, [HGLOBAL], HGLOBAL],
      [GlobalLock, 'GlobalLock', 2, [HGLOBAL], FARPTR],
      [GlobalUnlock, 'GlobalUnlock', 2, [HGLOBAL], FARPTR],
      // 20 //
      [GlobalSize, 'GlobalSize', 2, [HGLOBAL], DWORD],
      [GlobalHandle, 'GlobalHandle', 2, [UINT], DWORD],
      [GlobalFlags, 'GlobalFlags', 2, [HGLOBAL], UINT],
      [LockSegment, 'LockSegment', 2, [UINT], HGLOBAL],
      [UnlockSegment, 'UnlockSegment', 2, [UINT]],
      [Kernel.stub, 'GlobalCompact', 4],
      [Kernel.stub, 'GlobalFreeAll', 2],
      [Kernel.stub, 'SetSwapHook'],
      [Kernel.stub, 'GlobalMasterHandle', 0],
      [Kernel.stub, 'Yield', 0, []],
      // 30 //
      [WaitEvent, 'WaitEvent', 2, [HANDLE], BOOL],
      [Kernel.stub, 'PostEvent', 2],
      [Kernel.stub, 'SetPriority', 4],
      [Kernel.stub, 'LockCurrentTask', 2],
      [Kernel.stub, 'SetTaskQueue', 4],
      [Kernel.stub, 'GetTaskQueue', 2],
      [Kernel.stub, 'GetCurrentTask', 0, [], HANDLE],
      [Kernel.stub, 'GetCurrentPDB', 0, [], UINT],
      [Kernel.stub, 'SetTaskSignalProc', 6],
      [Kernel.stub, 'SetTaskSwitchProc'],
      // 40 //
      [Kernel.stub, 'SetTaskInterchange'],
      [Kernel.stub, 'EnableDos', 0],
      [Kernel.stub, 'DisableDos', 0],
      [Kernel.stub, 'IsScreenGrab'],
      [Kernel.stub, 'BuildPDB'],
      [Kernel.stub, 'LoadModule', 8, [LPCSTR, FARPTR], HINSTANCE],
      [Kernel.stub, 'FreeModule', 2, [HINSTANCE], BOOL],
      [Kernel.stub, 'GetModuleHandle', 4, [LPCSTR], HANDLE],
      [Kernel.stub, 'GetModuleUsage', 2, [HINSTANCE], INT],
      [GetModuleFilename, 'GetModuleFilename', 8, [HINSTANCE, FARPTR, INT], INT],
      // 50 //
      [GetProcAddress, 'GetProcAddress', 6, [HINSTANCE, LPCSTR], FARPTR],
      [MakeProcInstance, 'MakeProcInstance', 6, [FARPTR, HINSTANCE], FARPTR],
      [Kernel.stub, 'FreeProcInstance', 4, [FARPTR]],
      [Kernel.stub, 'CallProcInstance', 4],
      [Kernel.stub, 'GetInstanceData', 8, [HINSTANCE, FARPTR, INT], INT],
      [Catch, 'Catch', 4, [FARPTR], INT],
      [Throw, 'Throw', 6, [FARPTR, INT], INT], // Return value must match Catch
      [GetProfileInt, 'GetProfileInt', 10, [LPCSTR, LPCSTR, INT], UINT],
      [GetProfileString, 'GetProfileString', 18, [LPCSTR, LPCSTR, LPCSTR, FARPTR, INT], INT],
      [WriteProfileString, 'WriteProfileString', 12, [LPCSTR, LPCSTR, LPCSTR], BOOL],
      // 60 //
      [FindResource, 'FindResource', 10, [HINSTANCE, LPCSTR, LPCSTR], HANDLE],
      [LoadResource, 'LoadResource', 4, [HINSTANCE, HANDLE], HGLOBAL],
      [LockResource, 'LockResource', 2, [HGLOBAL], FARPTR],
      [FreeResource, 'FreeResource', 2, [HGLOBAL], BOOL],
      [Kernel.stub, 'AccessResource', 4, [HINSTANCE, HANDLE], INT],
      [Kernel.stub, 'SizeOfResource', 4, [HINSTANCE, HANDLE], DWORD],
      [Kernel.stub, 'AllocResource', 8, [HINSTANCE, HANDLE, DWORD], HGLOBAL],
      [Kernel.stub, 'SetResourceHandler', 10, [HINSTANCE, LPCSTR, FARPTR], FARPTR],
      [Kernel.stub, 'InitAtomTable', 2, [INT], BOOL],
      [Kernel.stub, 'FindAtom', 4, [LPCSTR], ATOM],
      // 70 //
      [Kernel.stub, 'AddAtom', 4, [LPCSTR], ATOM],
      [Kernel.stub, 'DeleteAtom', 2, [ATOM], ATOM],
      [Kernel.stub, 'GetAtomName', 8, [ATOM, FARPTR, INT], UINT],
      [Kernel.stub, 'GetAtomHandle', 2, [ATOM], HANDLE],
      [OpenFile, 'OpenFile', 10, [LPCSTR, [OFSTRUCT], UINT], HFILE],
      [Kernel.stub, 'OpenPathName', 6],
      [Kernel.stub, 'DeletePathName', 6],
      [Kernel.stub, 'Reserved1', 4],
      [Kernel.stub, 'Reserved2', 4],
      [Kernel.stub, 'Reserved3', 4],
      // 80 //
      [Kernel.stub, 'Reserved4', 4],
      [_lclose, '_lclose', 2, [HFILE], HFILE],
      [_lread, '_lread', 8, [HFILE, FARPTR, UINT], UINT],
      [_lcreat, '_lcreat', 6, [LPCSTR, INT], HFILE],
      [_llseek, '_llseek', 8, [HFILE, LONG, INT], LONG],
      [Kernel.stub, '_lopen', 6],
      [_lwrite, '_lwrite', 8, [HFILE, FARPTR, UINT], UINT],
      [Kernel.stub, 'Reserved5', 4],
      [lstrcpy, 'lstrcpy', 8, [FARPTR, FARPTR], FARPTR],
      [lstrcat, 'lstrcat', 8, [FARPTR, FARPTR], FARPTR],
      // 90 //
      [lstrlen, 'lstrlen', 4, [FARPTR], UINT],
      [InitTask, 'InitTask', 0, [], UINT],
      [Kernel.stub, 'GetTempDrive', 2, [BYTE], BYTE],
      [Kernel.stub, 'GetCodeHandle', 4, [FARPTR], HGLOBAL],
      [Kernel.stub, 'DefineHandleTable', 2],
      [LoadLibrary, 'LoadLibrary', 4, [LPCSTR], HINSTANCE],
      [Kernel.stub, 'FreeLibrary', 2, [HINSTANCE]],
      [Kernel.stub, 'GetTempFileName', 12, [BYTE, LPCSTR, UINT, FARPTR], INT],
      [Kernel.stub, 'GetLastDiskChange', 0],
      [Kernel.stub, 'GetLPErrMode', 0],
      // 100 //
      [Kernel.stub, 'ValidateCodeSegments', 0, []],
      [Kernel.stub, 'NoHookDosCall', 0],
      [Kernel.stub, 'Dos3Call', 0],
      [Kernel.stub, 'NetBiosCall', 0],
      [Kernel.stub, 'GetCodeInfo', 8, [FARPTR, FARPTR]],
      [Kernel.stub, 'GetExeVersion', 0],
      [Kernel.stub, 'SetSwapAreaSize', 2, [UINT], LONG],
      [Kernel.stub, 'SetErrorMode', 2, [UINT], UINT],
      [Kernel.stub, 'SwitchStackTo', 6, [UINT, UINT, UINT]],
      [Kernel.stub, 'SwitchStackBack', 0, []],
      // 110 //
      [Kernel.stub, 'PatchCodeHandle', 2, [UINT]],
      [Kernel.stub, 'GlobalWire', 2, [HGLOBAL]],
      [Kernel.stub, 'GlobalUnwire', 2, [HGLOBAL], BOOL],
      [Kernel.stub, '__AHSHIFT'],
      [Kernel.stub, '__AHINCR'],
      [OutputDebugString, 'OutputDebugString', 4, [LPCSTR]],
      [Kernel.stub, 'InitLib', 2],
      [Kernel.stub, 'OldYield', 6],
      [Kernel.stub, 'GetTaskQueueDS', 6],
      [Kernel.stub, 'GetTaskQueueES', 2],
      // 120 //
      [Kernel.stub, 'UndefDynLink', 0],
      [Kernel.stub, 'LocalShrink', 2],
      [Kernel.stub, 'IsTaskLocked', 4],
      [Kernel.stub, 'KbdRst', 4],
      [Kernel.stub, 'EnableKernel', 0],
      [Kernel.stub, 'DisableKernel', 2],
      [Kernel.stub, 'MemoryFreed', 0],
      [GetPrivateProfileInt, 'GetPrivateProfileInt', 14, [LPCSTR, LPCSTR, INT, LPCSTR], UINT],
      [
        GetPrivateProfileString,
        'GetPrivateProfileString',
        22,
        [LPCSTR, LPCSTR, LPCSTR, FARPTR, INT, LPCSTR],
        INT,
      ],
      [
        WritePrivateProfileString,
        'WritePrivateProfileString',
        16,
        [LPCSTR, LPCSTR, LPCSTR, LPCSTR],
        BOOL,
      ],
      // 130 //
      [Kernel.stub, 'FileCdr'],
      [GetDOSEnvironment, 'GetDOSEnvironment', 0, [], FARPTR],
      [GetWinFlags, 'GetWinFlags', 0, [], DWORD],
      [Kernel.stub, 'GetExePtr', 4],
      [GetWindowsDirectory, 'GetWindowsDirectory', 6, [FARPTR, UINT], UINT],
      [Kernel.stub, 'GetSystemDirectory', 6, [FARPTR, UINT], UINT],
      [Kernel.stub, 'GetDriveType', 2, [INT], UINT],
      [FatalAppExit, 'FatalAppExit', 6, [UINT, LPCSTR]],
      [Kernel.stub, 'GetHeapSpaces', 12],
      [Kernel.stub, 'DoSignal', 2],
      // 140 //
      [Kernel.stub, 'SetSigHandler', 2],
      [Kernel.stub, 'InitTask1', 0],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      // 150 //
      [Kernel.stub, 'DirectedYield', 2, [HANDLE]],
      [Kernel.stub, 'WinOldApCall', 5],
      [Kernel.stub, 'GetNumTasks', 0, []],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'GlobalNotify', 4, [FARPTR]],
      [Kernel.stub, 'GetTaskDS', 10],
      [Kernel.stub, 'LimitEmsPages', 2],
      [Kernel.stub, 'GetCurPID', 4],
      [Kernel.stub, 'IsWinOldApTask', 2],
      [Kernel.stub, 'GlobalHandleNoRIP', 0],
      // 160 //
      [Kernel.stub, 'EMSCopy', 2],
      [Kernel.stub, 'LocalCountFree', 2],
      [Kernel.stub, 'LocalHeapSize', 2],
      [Kernel.stub, 'GlobalLRUOldest', 2],
      [Kernel.stub, 'GlobalLRUNewest', 4],
      [Kernel.stub, 'A20Proc', 2],
      [Kernel.stub, 'WinExec', 4],
      [Kernel.stub, 'GetExpWinVer', 0],
      [Kernel.stub, 'DirectResAlloc', 4],
      [GetFreeSpace, 'GetFreeSpace', 2, [UINT], DWORD],
      // 170 //
      [Kernel.stub, 'AllocCSToDSAlias', 2],
      [Kernel.stub, 'AllocDSToCSAlias', 2],
      [Kernel.stub, 'AllocAlias', 14],
      [Kernel.stub, '__ROMBIOS', 2],
      [Kernel.stub, '__A000H', 6],
      [Kernel.stub, 'AllocSelector', 4],
      [Kernel.stub, 'FreeSelector', 6],
      [Kernel.stub, 'PrestoChangoSelector', 2],
      [Kernel.stub, '__WINFLAGS'],
      [Kernel.stub, '__D000H', 4],
      // 180 //
      [Kernel.stub, 'LONGPTRADD', 2],
      [Kernel.stub, '__B000H', 2],
      [Kernel.stub, '__B800H', 4],
      [Kernel.stub, '__0000H', 2],
      [Kernel.stub, 'GlobalDosAlloc', 2],
      [Kernel.stub, 'GlobalDosFree', 4],
      [Kernel.stub, 'GetSelectorBase', 2],
      [Kernel.stub, 'SetSelectorBase', 2],
      [Kernel.stub, 'GetSelectorLimit', 2],
      [Kernel.stub, 'SetSelectorLimit', 2],
      // 190 //
      [Kernel.stub, '__E000H', 6],
      [Kernel.stub, 'GlobalPageLock', 2],
      [Kernel.stub, 'GlobalPageUnlock', 2],
      [Kernel.stub, '__0040H', 2],
      [Kernel.stub, '__F000H', 2],
      [Kernel.stub, '__C000H', 2],
      [Kernel.stub, 'SelectorAccessRights', 4],
      [Kernel.stub, 'GlobalFix', 2],
      [Kernel.stub, 'GlobalUnfix', 2],
      [Kernel.stub, 'SetHandleCount', 8],
      // 200 //
      [Kernel.stub, 'ValidateFreeSpaces', 0],
      [Kernel.stub, 'ReplaceInst', 2],
      [Kernel.stub, 'RegisterPtrace', 0],
      [Kernel.stub, 'DebugBreak', 4],
      [Kernel.stub, 'SwapRecording', 2],
      [Kernel.stub, 'CVWBreak', 2],
      [Kernel.stub, 'AllocSelectorArray', 4],
      [Kernel.stub, 'IsDBCSLeadByte', 4],
      // ... unknown ordinals ... //
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      // 310 //
      [Kernel.stub, 'LocalHandleDelta', 0],
      [Kernel.stub, 'GetSetKernelDosProc', 0],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'DebugDefineSegment', 0],
      [Kernel.stub, 'WriteOutProfiles', 2],
      [Kernel.stub, 'GetFreeMemInfo'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'FatalExitHook', 0],
      [Kernel.stub, 'FlushCachedFileHandle', 2],
      // 320 //
      [Kernel.stub, 'IsTask', 10],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'IsRomModule', 2],
      [Kernel.stub, 'LogError', 2],
      [Kernel.stub, 'LogParamError', 10],
      [Kernel.stub, 'IsRomFile', 8],
      [Kernel.stub, 'K327', 0],
      [Kernel.stub, '_DEBUGOUTPUT', 10],
      [Kernel.stub, 'K329', 2],
      // 330 //
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'ThHook', 4],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'IsBadReadPtr', 0],
      [Kernel.stub, 'IsBadWritePtr', 4],
      [Kernel.stub, 'IsBadCodePtr', 4],
      [Kernel.stub, 'IsBadStringPtr', 2],
      [Kernel.stub, 'HasGPHandler', 0],
      [Kernel.stub, 'DiagQuery', 4],
      // 340 //
      [Kernel.stub, 'DiagOutput', 2],
      [Kernel.stub, 'ToolHelpHook', 6],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'RegisterWinOldApHook', 2],
      [Kernel.stub, 'GetWinOldApHooks', 2],
      [Kernel.stub, 'IsSharedSelector', 8],
      [Kernel.stub, 'IsBadHugeReadPtr', 6],
      [Kernel.stub, 'IsBadHugeWritePtr', 0],
      [Kernel.stub, 'HMEMCPY', 4],
      [Kernel.stub, '_HREAD', 0],
      // 350 //
      [Kernel.stub, '_HWRITE', 4],
      [Kernel.stub, 'BUNNY_351', 14],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'LSTRCPYN', 0],
      [Kernel.stub, 'GetAppCompatFlags', 2],
      [Kernel.stub, 'GetWinDebugInfo', 10],
      [Kernel.stub, 'SetWinDebugInfo', 0],
      // .. //
      //Kernel.stub, // K403,
      //Kernel.stub, // K404,
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

/**
 * The **OFSTRUCT** structure contains the file information which results from
 * opening that file.
 */
export class OFSTRUCT extends Struct {
  constructor() {
    super([
      ['cBytes', BYTE],
      ['fFixedDisk', BYTE],
      ['nErrCode', UINT],
      ['reserved', DWORD],
      ['szPathName', CHARARRAY + 128],
    ]);
  }
}

// OpenFile Constants
// ------------------

/**
 * Indicates a file operation error.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.HFILE_ERROR = 0xffff;

/**
 * Indicates opening a file for reading.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_READ = 0x0000;

/**
 * Indicates opening a file for writing.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_WRITE = 0x0001;

/**
 * Indicates opening a file for reading and writing.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_READWRITE = 0x0002;

/**
 * Indicates opening a file for sharing in compatibility mode.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_SHARE_COMPAT = 0x0000;

/**
 * Indicates opening a file for sharing with read and write exclusivity.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_SHARE_EXCLUSIVE = 0x0010;

/**
 * Indicates opening a file for sharing with write exclusivity.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_SHARE_DENY_WRITE = 0x0020;

/**
 * Indicates opening a file for sharing with read exclusivity.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_SHARE_DENY_READ = 0x0030;

/**
 * Indicates opening a file for sharing without exclusivity.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_SHARE_DENY_NONE = 0x0040;

/**
 * Indicates only filling the OFSTRUCT for a file instead of opening.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_PARSE = 0x0100;

/**
 * Indicates deleting an existing file.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_DELETE = 0x0200;

/**
 * Indicates to compare file date with the given OFSTRUCT instead of opening.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_VERIFY = 0x0400; /* Used with OF_REOPEN */

/**
 * Indicates to search in system directories even if a pull path is given.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_SEARCH = 0x0400; /* Used without OF_REOPEN */

/**
 * Indicates the prompt dialog should contain a Cancel button.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_CANCEL = 0x0800;

/**
 * Indicates creating or truncating the file when opening.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_CREATE = 0x1000;

/**
 * Indicates prompting for the location of the file.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_PROMPT = 0x2000;

/**
 * Indicates opening and then closing the file to test for its existence.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_EXIST = 0x4000;

/**
 * Indicates reopening the file using the information provided.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.OF_REOPEN = 0x8000;

// GlobalAlloc, etc, flags
// -----------------------

/**
 * Allocates fixed memory, globally.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_FIXED = 0x0000;

/**
 * Allocates moveable memory, globally.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_MOVEABLE = 0x0002;

/**
 * Does not compact or discard memory to satisfy the allocation request.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_NOCOMPACT = 0x0010;

/**
 * Does not discard memory to satisfy the allocation request.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_NODISCARD = 0x0020;

/**
 * Initializes memory contents to zero.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_ZEROINIT = 0x0040;

/**
 * When specified, will modify the attributes of the memory object.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_MODIFY = 0x0080;

/**
 * Allocates discardable memory.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_DISCARDABLE = 0x0100;

/**
 * Allocates non-banked memory.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_NOT_BANKED = 0x1000;

/**
 * Allocates lower memory.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_LOWER = 0x1000;

/**
 * Allocates shared memory.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_SHARE = 0x2000;

/**
 * Allocates shared memory for DDE use.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_DDESHARE = 0x2000;

/**
 * Notifies when the allocated block is discarded.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GMEM_NOTIFY = 0x4000;

/**
 * Combines GMEM_FIXED and GMEM_ZEROINIT.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GPTR = Kernel.GMEM_FIXED | Kernel.GMEM_ZEROINIT;

/**
 * Combines GMEM_MOVEABLE and GMEM_ZEROINIT.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.GHND = Kernel.GMEM_MOVEABLE | Kernel.GMEM_ZEROINIT;

// LocalAlloc, etc, flags
// ----------------------

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

// GetWinFlags constants
// ---------------------

/**
 * GetWinFlags flag when the system is using protected mode.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_PMODE = 0x0001;

/**
 * GetWinFlags flag when the system in an 80286.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_CPU286 = 0x0002;

/**
 * GetWinFlags flag when the system in an 80386.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_CPU386 = 0x0004;

/**
 * GetWinFlags flag when the system in an 80486.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_CPU486 = 0x0008;

/**
 * GetWinFlags flag when the system is running in a standard mode.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_STANDARD = 0x0010;

/**
 * GetWinFlags flag when the system is running in a standard mode. (Same as
 * `WF_STANDARD`)
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_WIN286 = 0x0010;

/**
 * GetWinFlags flag when the system is running in an enhanced mode.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_ENHANCED = 0x0020;

/**
 * GetWinFlags flag when the system is running in a standard mode. (Same as
 * `WF_ENHANCED`)
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_WIN386 = 0x0020;
Kernel.WF_CPU086 = 0x0040;
Kernel.WF_CPU186 = 0x0080;
Kernel.WF_LARGEFRAME = 0x0100;
Kernel.WF_SMALLFRAME = 0x0200;

/**
 * GetWinFlags flag when the system contains an Intel math coprocessor.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_80x87 = 0x0400;

/**
 * GetWinFlags flag when the system is using a paged memory mode.
 *
 * @static
 * @constant {number}
 * @memberof Kernel
 */
Kernel.WF_PAGING = 0x0800;
Kernel.WF_WLO = 0x8000;
