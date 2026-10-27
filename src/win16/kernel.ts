'use strict';

/** @namespace Kernel */

import { _hread, _hwrite, hmemcpy } from './kernel/huge-files.js';
import {
  FreeProcInstance,
  GlobalFix,
  GlobalPageLock,
  GlobalPageUnlock,
  GlobalUnfix,
  GlobalUnWire,
  GlobalWire,
  SetErrorMode,
  SetHandleCount,
  GlobalNotify,
  IsRomFile,
  IsRomModule,
} from './kernel/misc.js';
import {
  GetCurrentTask,
  GetNumTasks,
  IsTaskLocked,
  IsWinOldApTask,
  LockCurrentTask,
} from './kernel/tasks.js';
import { GlobalCompact, LocalHandleDelta } from './kernel/memory-info.js';
import { asking } from './kernel/memory-model.js';
import {
  AddAtom,
  DeleteAtom,
  FindAtom,
  GetAtomHandle,
  GetAtomName,
  InitAtomTable,
} from './atoms.js';
import { Module } from './module.js';
import { KERNEL_CONSTANTS } from './kernel/constants.js';
import { AnsiNext } from './user/AnsiNext.js';
import { AnsiPrev } from './user/AnsiPrev.js';
import { AnsiLowerDriven, AnsiUpperDriven } from './user/language-driver.js';
import { GetExePtr, GlobalHandleNoRIP, IsSharedSelector } from './kernel/module-calls.js';
import {
  GetAppCompatFlags,
  GetCurrentPDB,
  GetExeVersion,
  GetTaskDS,
  GetTaskQueue,
  GetTaskQueueDS,
  GetTaskQueueES,
  IsTask,
  PostEvent,
  SetPriority,
  WaitEvent,
  SetTaskQueue,
} from './kernel/task-calls.js';
import {
  DiagQuery,
  FatalExitHook,
  GetFreeMemInfo,
  Reserved5,
  nothing,
  nought,
  noughtWord,
} from './kernel/retail.js';

import {
  BYTE,
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
  Struct,
} from './types.js';

import { _lclose } from './kernel/_lclose.js';
import { _lcreat } from './kernel/_lcreat.js';
import { _lopen } from './kernel/_lopen.js';
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
import { Dos3Call } from './kernel/Dos3Call.js';
import {
  AllocResource,
  DEFAULT_ORDINAL,
  DirectResAlloc,
  ResourceHandler,
  SetResourceHandler,
} from './kernel/resource-handlers.js';
import {
  CallProcInstance,
  DefineHandleTable,
  DeletePathName,
  GetLPErrMode,
  GlobalDosAlloc,
  GlobalDosFree,
  GlobalFreeAll,
  LongPtrAdd,
  NetBIOSCall,
  OpenPathName,
  SwitchStackBack,
  SwitchStackTo,
} from './kernel/more-calls.js';
import {
  GetCodeHandle,
  GetCodeInfo,
  GetHeapSpaces,
  GetLastDiskChange,
  GlobalLRU,
  MemoryFreed,
  SetSwapAreaSize,
  SetTaskSignalProc,
} from './kernel/code-calls.js';
import { IsDBCSLeadByte } from './kernel/IsDBCSLeadByte.js';
import { GetDriveType } from './kernel/GetDriveType.js';
import { GetTempDrive, GetTempFileName } from './kernel/GetTempFileName.js';
import { GetExpWinVer } from './kernel/GetExpWinVer.js';
import { GetModuleHandle } from './kernel/GetModuleHandle.js';
import { GetInstanceData } from './kernel/GetInstanceData.js';
import { LocalCountFree, LocalHeapSize, LocalNotify } from './kernel/LocalNotify.js';
import { FileCdr } from './kernel/FileCdr.js';
import { GetProcAddress } from './kernel/GetProcAddress.js';
import { GetVersion } from './kernel/GetVersion.js';
import { GetSystemDirectory, GetWindowsDirectory } from './kernel/GetWindowsDirectory.js';
import { GetWinFlags } from './kernel/GetWinFlags.js';
import { FindResource } from './kernel/FindResource.js';
import { AccessResource, SizeofResource } from './kernel/AccessResource.js';
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
import { lstrcpyn } from './kernel/lstrcpyn.js';
import { lstrcat } from './kernel/lstrcat.js';
import { lstrlen } from './kernel/lstrlen.js';
import { FreeLibrary, GetModuleUsage, LoadLibrary } from './kernel/LoadLibrary.js';
import { LocalAlloc } from './kernel/LocalAlloc.js';
import { LocalCompact } from './kernel/LocalCompact.js';
import { LocalShrink } from './kernel/LocalShrink.js';
import { DirectedYield, LoadModule, OldYield, WinExec, Yield } from './kernel/WinExec.js';
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
import {
  AllocCSToDSAlias,
  AllocDSToCSAlias,
  AllocAlias,
  AllocSelector,
  AllocSelectorArray,
  FreeSelector,
  GetSelectorBase,
  GetSelectorLimit,
  PrestoChangoSelector,
  SelectorAccessRights,
  SetSelectorBase,
  SetSelectorLimit,
} from './kernel/selector-aliases.js';
import { OpenFile } from './kernel/OpenFile.js';
import { OutputDebugString } from './kernel/OutputDebugString.js';
import { Throw } from './kernel/Throw.js';
import { UnlockSegment } from './kernel/UnlockSegment.js';
import { WritePrivateProfileString } from './kernel/WritePrivateProfileString.js';
import {
  IsBadCodePtr,
  IsBadHugeReadPtr,
  IsBadHugeWritePtr,
  IsBadReadPtr,
  IsBadStringPtr,
  IsBadWritePtr,
} from './kernel/bad-pointers.js';

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

  /* The kernel standard mode runs on a 386: `environ` and `loadenv` record
   * this path in every task's environment. */
  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\KRNL386.EXE';
  }

  /**
   * The Windows version KERNEL's own module says it was made for: 3.10,
   * the Windows version, which KERNEL sets in its module as it starts
   * (`KRNL386.EXE` seg1 `c285`-`c288`, `KRNL286.EXE` seg1 `b403`-`b406`),
   * where its file's header says 3.00. **Recorded** by `lbmark`.
   */
  static get expectedWindowsVersion() {
    return 0x30a;
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
      [LocalNotify, 'LocalNotify', 4, [FARPTR], DWORD],
      [asking(GlobalAlloc), 'GlobalAlloc', 6, [UINT, DWORD], HGLOBAL],
      [asking(GlobalReAlloc), 'GlobalReAlloc', 8, [HGLOBAL, DWORD, UINT], HGLOBAL],
      [GlobalFree, 'GlobalFree', 2, [HGLOBAL], HGLOBAL],
      [GlobalLock, 'GlobalLock', 2, [HGLOBAL], FARPTR],
      [GlobalUnlock, 'GlobalUnlock', 2, [HGLOBAL], FARPTR],
      // 20 //
      [GlobalSize, 'GlobalSize', 2, [HGLOBAL], DWORD],
      [GlobalHandle, 'GlobalHandle', 2, [UINT], DWORD],
      [GlobalFlags, 'GlobalFlags', 2, [HGLOBAL], UINT],
      [LockSegment, 'LockSegment', 2, [UINT], HGLOBAL],
      [UnlockSegment, 'UnlockSegment', 2, [UINT]],
      [GlobalCompact, 'GlobalCompact', 4, [DWORD], DWORD],
      [GlobalFreeAll, 'GlobalFreeAll', 2, [UINT], UINT],
      null, // was SetSwapHook; Windows 3.1 exports nothing at this ordinal
      [Kernel.stub, 'GlobalMasterHandle', 0],
      [Yield, 'Yield', 0, []],
      // 30 //
      [WaitEvent, 'WaitEvent', 2, [HANDLE], UINT],
      [PostEvent, 'PostEvent', 2, [HANDLE], HANDLE],
      [SetPriority, 'SetPriority', 4, [HANDLE, INT], INT],
      [LockCurrentTask, 'LockCurrentTask', 2, [BOOL], HANDLE],
      [SetTaskQueue, 'SetTaskQueue', 4, [HANDLE, HANDLE], HANDLE],
      [GetTaskQueue, 'GetTaskQueue', 2, [HANDLE], HANDLE],
      [GetCurrentTask, 'GetCurrentTask', 0, [], HANDLE],
      [GetCurrentPDB, 'GetCurrentPDB', 0, [], UINT],
      [SetTaskSignalProc, 'SetTaskSignalProc', 6, [HANDLE, FARPTR], FARPTR],
      null, // was SetTaskSwitchProc; Windows 3.1 exports nothing at this ordinal
      // 40 //
      null, // was SetTaskInterchange; Windows 3.1 exports nothing at this ordinal
      [nothing, 'EnableDos', 0, []],
      [nothing, 'DisableDos', 0, []],
      null, // was IsScreenGrab; Windows 3.1 exports nothing at this ordinal
      null, // was BuildPDB; Windows 3.1 exports nothing at this ordinal
      [LoadModule, 'LoadModule', 8, [LPCSTR, FARPTR], DWORD],
      /* The same code as `FreeLibrary` (`KRNL386.EXE` seg2 `0176`, `018a`). */
      [FreeLibrary, 'FreeModule', 2, [HINSTANCE]],
      [GetModuleHandle, 'GetModuleHandle', 4, [LPCSTR], HANDLE],
      [GetModuleUsage, 'GetModuleUsage', 2, [HINSTANCE], INT],
      [GetModuleFilename, 'GetModuleFilename', 8, [HINSTANCE, FARPTR, INT], INT],
      // 50 //
      [GetProcAddress, 'GetProcAddress', 6, [HINSTANCE, LPCSTR], FARPTR],
      [MakeProcInstance, 'MakeProcInstance', 6, [FARPTR, HINSTANCE], FARPTR],
      [FreeProcInstance, 'FreeProcInstance', 4, [FARPTR]],
      [CallProcInstance, 'CallProcInstance', 0],
      [GetInstanceData, 'GetInstanceData', 6, [HINSTANCE, NEARPTR, INT], INT],
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
      [AccessResource, 'AccessResource', 4, [HINSTANCE, HANDLE], INT],
      [SizeofResource, 'SizeofResource', 4, [HINSTANCE, HANDLE], DWORD],
      [AllocResource, 'AllocResource', 8, [HINSTANCE, HANDLE, DWORD], HGLOBAL],
      [SetResourceHandler, 'SetResourceHandler', 10, [HINSTANCE, LPCSTR, FARPTR], DWORD],
      [InitAtomTable, 'InitAtomTable', 2, [INT], BOOL],
      [FindAtom, 'FindAtom', 4, [FARPTR], ATOM],
      // 70 //
      [AddAtom, 'AddAtom', 4, [FARPTR], ATOM],
      [DeleteAtom, 'DeleteAtom', 2, [ATOM], ATOM],
      [GetAtomName, 'GetAtomName', 8, [ATOM, FARPTR, INT], UINT],
      [GetAtomHandle, 'GetAtomHandle', 2, [ATOM], HANDLE],
      [OpenFile, 'OpenFile', 10, [LPCSTR, [OFSTRUCT], UINT], HFILE],
      [OpenPathName, 'OpenPathName', 6, [FARPTR, UINT], UINT],
      [DeletePathName, 'DeletePathName', 4, [FARPTR], UINT],
      [AnsiNext, 'Reserved1', 4, [FARPTR], FARPTR],
      [AnsiPrev, 'Reserved2', 8, [FARPTR, FARPTR], FARPTR],
      [AnsiUpperDriven, 'Reserved3', 4, [FARPTR], FARPTR],
      // 80 //
      [AnsiLowerDriven, 'Reserved4', 4, [FARPTR], FARPTR],
      [_lclose, '_lclose', 2, [HFILE], HFILE],
      [_lread, '_lread', 8, [HFILE, FARPTR, UINT], UINT],
      [_lcreat, '_lcreat', 6, [LPCSTR, INT], HFILE],
      [_llseek, '_llseek', 8, [HFILE, LONG, INT], LONG],
      [_lopen, '_lopen', 6, [LPCSTR, INT], HFILE],
      [_lwrite, '_lwrite', 8, [HFILE, FARPTR, UINT], UINT],
      [Reserved5, 'Reserved5', 8, [FARPTR, FARPTR], INT],
      [lstrcpy, 'lstrcpy', 8, [FARPTR, FARPTR], FARPTR],
      [lstrcat, 'lstrcat', 8, [FARPTR, FARPTR], FARPTR],
      // 90 //
      [lstrlen, 'lstrlen', 4, [FARPTR], UINT],
      [InitTask, 'InitTask', 0, [], UINT],
      [GetTempDrive, 'GetTempDrive', 2, [BYTE], UINT],
      [GetCodeHandle, 'GetCodeHandle', 4, [FARPTR], DWORD],
      [DefineHandleTable, 'DefineHandleTable', 2, [UINT], UINT],
      [LoadLibrary, 'LoadLibrary', 4, [LPCSTR], HINSTANCE],
      [FreeLibrary, 'FreeLibrary', 2, [HINSTANCE]],
      [GetTempFileName, 'GetTempFileName', 12, [BYTE, LPCSTR, UINT, FARPTR], INT],
      [GetLastDiskChange, 'GetLastDiskChange', 0, [], BYTE],
      [GetLPErrMode, 'GetLPErrMode', 0, [], DWORD],
      // 100 //
      [nothing, 'ValidateCodeSegments', 0, []],
      [Dos3Call, 'NoHookDosCall', 0],
      [Dos3Call, 'Dos3Call', 0],
      [NetBIOSCall, 'NetBiosCall', 0],
      [GetCodeInfo, 'GetCodeInfo', 8, [FARPTR, FARPTR], UINT],
      [GetExeVersion, 'GetExeVersion', 0, [], UINT],
      [SetSwapAreaSize, 'SetSwapAreaSize', 2, [UINT], DWORD],
      [SetErrorMode, 'SetErrorMode', 2, [UINT], UINT],
      [SwitchStackTo, 'SwitchStackTo', 0],
      [SwitchStackBack, 'SwitchStackBack', 0],
      // 110 //
      [Kernel.stub, 'PatchCodeHandle', 2, [UINT]],
      [GlobalWire, 'GlobalWire', 2, [HGLOBAL], FARPTR],
      [GlobalUnWire, 'GlobalUnwire', 2, [HGLOBAL], BOOL],
      [KERNEL_CONSTANTS[113], '__AHSHIFT', 0],
      [KERNEL_CONSTANTS[114], '__AHINCR', 0],
      [OutputDebugString, 'OutputDebugString', 4, [LPCSTR]],
      [Kernel.stub, 'InitLib', 0],
      [OldYield, 'OldYield', 0, [], UINT],
      [GetTaskQueueDS, 'GetTaskQueueDS', 0, []],
      [GetTaskQueueES, 'GetTaskQueueES', 0, []],
      // 120 //
      [Kernel.stub, 'UndefDynLink', 0],
      [LocalShrink, 'LocalShrink', 4, [HANDLE, UINT], UINT],
      [IsTaskLocked, 'IsTaskLocked', 0, [], HANDLE],
      [nothing, 'KbdRst', 0, []],
      [nothing, 'EnableKernel', 0, []],
      [Kernel.stub, 'DisableKernel', 0],
      [MemoryFreed, 'MemoryFreed', 2, [UINT], DWORD],
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
      [FileCdr, 'FileCdr', 4, [FARPTR], DWORD],
      [GetDOSEnvironment, 'GetDOSEnvironment', 0, [], FARPTR],
      [GetWinFlags, 'GetWinFlags', 0, [], DWORD],
      [GetExePtr, 'GetExePtr', 2, [HANDLE], HANDLE],
      [GetWindowsDirectory, 'GetWindowsDirectory', 6, [FARPTR, UINT], UINT],
      [GetSystemDirectory, 'GetSystemDirectory', 6, [FARPTR, UINT], UINT],
      [GetDriveType, 'GetDriveType', 2, [INT], UINT],
      [FatalAppExit, 'FatalAppExit', 6, [UINT, LPCSTR]],
      [GetHeapSpaces, 'GetHeapSpaces', 2, [HANDLE], DWORD],
      [Kernel.stub, 'DoSignal', 0],
      // 140 //
      [Kernel.stub, 'SetSigHandler', 16],
      [Kernel.stub, 'InitTask1', 4],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      // 150 //
      [DirectedYield, 'DirectedYield', 2, [HANDLE]],
      [Kernel.stub, 'WinOldApCall', 2],
      [GetNumTasks, 'GetNumTasks', 0, [], UINT],
      [Kernel.stub, 'unknown'],
      [GlobalNotify, 'GlobalNotify', 4, [FARPTR]],
      [GetTaskDS, 'GetTaskDS', 0, [], DWORD],
      [nought, 'LimitEmsPages', 4, [DWORD], DWORD],
      [nought, 'GetCurPID', 4, [DWORD], DWORD],
      [IsWinOldApTask, 'IsWinOldApTask', 2, [HANDLE], BOOL],
      [GlobalHandleNoRIP, 'GlobalHandleNoRIP', 2, [UINT], DWORD],
      // 160 //
      [Kernel.stub, 'EMSCopy', 14],
      [LocalCountFree, 'LocalCountFree', 0, [], UINT],
      [LocalHeapSize, 'LocalHeapSize', 0, [], UINT],
      [GlobalLRU, 'GlobalLRUOldest', 2, [HGLOBAL], HGLOBAL],
      [GlobalLRU, 'GlobalLRUNewest', 2, [HGLOBAL], HGLOBAL],
      [Kernel.stub, 'A20Proc', 2],
      [WinExec, 'WinExec', 6, [LPCSTR, UINT], UINT],
      [GetExpWinVer, 'GetExpWinVer', 2, [HANDLE], DWORD],
      [DirectResAlloc, 'DirectResAlloc', 6, [HINSTANCE, UINT, UINT], HGLOBAL],
      [GetFreeSpace, 'GetFreeSpace', 2, [UINT], DWORD],
      // 170 //
      [AllocCSToDSAlias, 'AllocCSToDSAlias', 2, [UINT], UINT],
      [AllocDSToCSAlias, 'AllocDSToCSAlias', 2, [UINT], UINT],
      [AllocAlias, 'AllocAlias', 2, [UINT], DWORD],
      [KERNEL_CONSTANTS[173], '__ROMBIOS', 0],
      [KERNEL_CONSTANTS[174], '__A000H', 0],
      [AllocSelector, 'AllocSelector', 2, [UINT], UINT],
      [FreeSelector, 'FreeSelector', 2, [UINT], UINT],
      [PrestoChangoSelector, 'PrestoChangoSelector', 4, [UINT, UINT], UINT],
      [KERNEL_CONSTANTS[178], '__WINFLAGS', 0],
      [KERNEL_CONSTANTS[179], '__D000H', 0],
      // 180 //
      [LongPtrAdd, 'LONGPTRADD', 8, [DWORD, DWORD], DWORD],
      [KERNEL_CONSTANTS[181], '__B000H', 0],
      [KERNEL_CONSTANTS[182], '__B800H', 0],
      [KERNEL_CONSTANTS[183], '__0000H', 0],
      [asking(GlobalDosAlloc), 'GlobalDosAlloc', 4, [DWORD], DWORD],
      [GlobalDosFree, 'GlobalDosFree', 2, [UINT], UINT],
      [GetSelectorBase, 'GetSelectorBase', 2, [UINT], DWORD],
      [SetSelectorBase, 'SetSelectorBase', 6, [UINT, DWORD], UINT],
      [GetSelectorLimit, 'GetSelectorLimit', 2, [UINT], DWORD],
      [SetSelectorLimit, 'SetSelectorLimit', 6, [UINT, DWORD], UINT],
      // 190 //
      [KERNEL_CONSTANTS[190], '__E000H', 0],
      [GlobalPageLock, 'GlobalPageLock', 2, [HGLOBAL], UINT],
      [GlobalPageUnlock, 'GlobalPageUnlock', 2, [HGLOBAL], UINT],
      [KERNEL_CONSTANTS[193], '__0040H', 0],
      [KERNEL_CONSTANTS[194], '__F000H', 0],
      [KERNEL_CONSTANTS[195], '__C000H', 0],
      [SelectorAccessRights, 'SelectorAccessRights', 6, [UINT, UINT, UINT], UINT],
      [GlobalFix, 'GlobalFix', 2, [HGLOBAL], HGLOBAL],
      [GlobalUnfix, 'GlobalUnfix', 2, [HGLOBAL], HGLOBAL],
      [SetHandleCount, 'SetHandleCount', 2, [UINT], UINT],
      // 200 //
      [Kernel.stub, 'ValidateFreeSpaces', 0],
      [Kernel.stub, 'ReplaceInst', 6],
      [Kernel.stub, 'RegisterPtrace', 4],
      [nothing, 'DebugBreak', 0, []],
      [Kernel.stub, 'SwapRecording', 2],
      [Kernel.stub, 'CVWBreak', 2],
      [AllocSelectorArray, 'AllocSelectorArray', 2, [UINT], UINT],
      [IsDBCSLeadByte, 'IsDBCSLeadByte', 2, [BYTE], BOOL],
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
      [LocalHandleDelta, 'LocalHandleDelta', 2, [UINT], UINT],
      [Kernel.stub, 'GetSetKernelDosProc', 4],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'DebugDefineSegment', 0],
      [Kernel.stub, 'WriteOutProfiles', 0],
      [GetFreeMemInfo, 'GetFreeMemInfo', 0, [], DWORD],
      [Kernel.stub, 'unknown'],
      [FatalExitHook, 'FatalExitHook', 4, [FARPTR], FARPTR],
      [Kernel.stub, 'FlushCachedFileHandle', 2],
      // 320 //
      [IsTask, 'IsTask', 2, [HANDLE], HANDLE],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [IsRomModule, 'IsRomModule', 6, [HANDLE, DWORD], BOOL],
      [nothing, 'LogError', 6, [UINT, FARPTR]],
      [nothing, 'LogParamError', 10, [UINT, FARPTR, FARPTR]],
      [IsRomFile, 'IsRomFile', 6, [HANDLE, DWORD], BOOL],
      [Kernel.stub, 'K327', 0],
      [nothing, '_DEBUGOUTPUT', 0, []],
      [nothing, 'K329', 6, [UINT, UINT, UINT]],
      // 330 //
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'unknown'],
      [Kernel.stub, 'ThHook', 4],
      [Kernel.stub, 'unknown'],
      [IsBadReadPtr, 'IsBadReadPtr', 6, [FARPTR, UINT], BOOL],
      [IsBadWritePtr, 'IsBadWritePtr', 6, [FARPTR, UINT], BOOL],
      [IsBadCodePtr, 'IsBadCodePtr', 4, [FARPTR], BOOL],
      [IsBadStringPtr, 'IsBadStringPtr', 6, [FARPTR, UINT], BOOL],
      [Kernel.stub, 'HasGPHandler', 4],
      [DiagQuery, 'DiagQuery', 0, [], UINT],
      // 340 //
      [Kernel.stub, 'DiagOutput', 4],
      [Kernel.stub, 'ToolHelpHook', 4],
      /* KERNEL's own table of the places in its code that handle a
       * general protection fault, which `HasGPHandler` reads: data in its
       * code segment (`KRNL386.EXE` seg1 `a820`), not a function. */
      [Kernel.stub, '__GP', 14],
      [Kernel.stub, 'RegisterWinOldApHook', 6],
      [Kernel.stub, 'GetWinOldApHooks', 0],
      [IsSharedSelector, 'IsSharedSelector', 2, [UINT], BOOL],
      [IsBadHugeReadPtr, 'IsBadHugeReadPtr', 8, [FARPTR, DWORD], BOOL],
      [IsBadHugeWritePtr, 'IsBadHugeWritePtr', 8, [FARPTR, DWORD], BOOL],
      [hmemcpy, 'HMEMCPY', 12, [FARPTR, FARPTR, LONG]],
      [_hread, '_HREAD', 10, [HFILE, FARPTR, LONG], LONG],
      // 350 //
      [_hwrite, '_HWRITE', 10, [HFILE, FARPTR, LONG], LONG],
      [Kernel.stub, 'BUNNY_351', 0],
      [Kernel.stub, 'unknown'],
      [lstrcpyn, 'LSTRCPYN', 10, [FARPTR, FARPTR, UINT], FARPTR],
      [GetAppCompatFlags, 'GetAppCompatFlags', 2, [HANDLE], DWORD],
      [noughtWord, 'GetWinDebugInfo', 6, [FARPTR, UINT], BOOL],
      [noughtWord, 'SetWinDebugInfo', 4, [FARPTR], BOOL],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      [Kernel.stub, 'K403', 4],
      [Kernel.stub, 'K404', 2],
      // .. //
      //Kernel.stub, // K403,
      //Kernel.stub, // K404,
    ];
  }

  /**
   * The resource handler of KERNEL itself, at the ordinal whose stub is at 88C8h,
   * where that of KERNEL is in its code (resource-handlers.ts). No export: a
   * program is handed its address by SetResourceHandler.
   */
  static get hiddenExports(): Record<number, any[]> {
    return {
      [DEFAULT_ORDINAL]: [ResourceHandler, 'ResourceHandler', 6, [HANDLE, HANDLE, HANDLE], HGLOBAL],
    };
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
