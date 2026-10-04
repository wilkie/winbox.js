//! The modules winbox.js keeps, written by `scripts/rust/modules.ts` from
//! the TypeScript engine's export tables: do not edit by hand.

use crate::modules::{Export, Kept};

/// In the order they are kept, which is the order their selectors are given.
pub static KEPT: &[Kept] = &[
    Kept {
        name: "KERNEL",
        path: "C:\\WINDOWS\\SYSTEM\\KRNL386.EXE",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "FatalExit",
                pops: 2,
            }),
            Some(Export {
                name: "ExitKernel",
                pops: 2,
            }),
            Some(Export {
                name: "GetVersion",
                pops: 0,
            }),
            Some(Export {
                name: "LocalInit",
                pops: 6,
            }),
            Some(Export {
                name: "LocalAlloc",
                pops: 4,
            }),
            Some(Export {
                name: "LocalReAlloc",
                pops: 6,
            }),
            Some(Export {
                name: "LocalFree",
                pops: 2,
            }),
            Some(Export {
                name: "LocalLock",
                pops: 2,
            }),
            Some(Export {
                name: "LocalUnlock",
                pops: 2,
            }),
            Some(Export {
                name: "LocalSize",
                pops: 2,
            }),
            Some(Export {
                name: "LocalHandle",
                pops: 2,
            }),
            Some(Export {
                name: "LocalFlags",
                pops: 2,
            }),
            Some(Export {
                name: "LocalCompact",
                pops: 2,
            }),
            Some(Export {
                name: "LocalNotify",
                pops: 4,
            }),
            Some(Export {
                name: "GlobalAlloc",
                pops: 6,
            }),
            Some(Export {
                name: "GlobalReAlloc",
                pops: 8,
            }),
            Some(Export {
                name: "GlobalFree",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalLock",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalUnlock",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalSize",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalHandle",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalFlags",
                pops: 2,
            }),
            Some(Export {
                name: "LockSegment",
                pops: 2,
            }),
            Some(Export {
                name: "UnlockSegment",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalCompact",
                pops: 4,
            }),
            Some(Export {
                name: "GlobalFreeAll",
                pops: 2,
            }),
            None,
            Some(Export {
                name: "GlobalMasterHandle",
                pops: 0,
            }),
            Some(Export {
                name: "Yield",
                pops: 0,
            }),
            Some(Export {
                name: "WaitEvent",
                pops: 2,
            }),
            Some(Export {
                name: "PostEvent",
                pops: 2,
            }),
            Some(Export {
                name: "SetPriority",
                pops: 4,
            }),
            Some(Export {
                name: "LockCurrentTask",
                pops: 2,
            }),
            Some(Export {
                name: "SetTaskQueue",
                pops: 4,
            }),
            Some(Export {
                name: "GetTaskQueue",
                pops: 2,
            }),
            Some(Export {
                name: "GetCurrentTask",
                pops: 0,
            }),
            Some(Export {
                name: "GetCurrentPDB",
                pops: 0,
            }),
            Some(Export {
                name: "SetTaskSignalProc",
                pops: 6,
            }),
            None,
            None,
            Some(Export {
                name: "EnableDos",
                pops: 0,
            }),
            Some(Export {
                name: "DisableDos",
                pops: 0,
            }),
            None,
            None,
            Some(Export {
                name: "LoadModule",
                pops: 8,
            }),
            Some(Export {
                name: "FreeModule",
                pops: 2,
            }),
            Some(Export {
                name: "GetModuleHandle",
                pops: 4,
            }),
            Some(Export {
                name: "GetModuleUsage",
                pops: 2,
            }),
            Some(Export {
                name: "GetModuleFilename",
                pops: 8,
            }),
            Some(Export {
                name: "GetProcAddress",
                pops: 6,
            }),
            Some(Export {
                name: "MakeProcInstance",
                pops: 6,
            }),
            Some(Export {
                name: "FreeProcInstance",
                pops: 4,
            }),
            Some(Export {
                name: "CallProcInstance",
                pops: 4,
            }),
            Some(Export {
                name: "GetInstanceData",
                pops: 6,
            }),
            Some(Export {
                name: "Catch",
                pops: 4,
            }),
            Some(Export {
                name: "Throw",
                pops: 6,
            }),
            Some(Export {
                name: "GetProfileInt",
                pops: 10,
            }),
            Some(Export {
                name: "GetProfileString",
                pops: 18,
            }),
            Some(Export {
                name: "WriteProfileString",
                pops: 12,
            }),
            Some(Export {
                name: "FindResource",
                pops: 10,
            }),
            Some(Export {
                name: "LoadResource",
                pops: 4,
            }),
            Some(Export {
                name: "LockResource",
                pops: 2,
            }),
            Some(Export {
                name: "FreeResource",
                pops: 2,
            }),
            Some(Export {
                name: "AccessResource",
                pops: 4,
            }),
            Some(Export {
                name: "SizeofResource",
                pops: 4,
            }),
            Some(Export {
                name: "AllocResource",
                pops: 8,
            }),
            Some(Export {
                name: "SetResourceHandler",
                pops: 10,
            }),
            Some(Export {
                name: "InitAtomTable",
                pops: 2,
            }),
            Some(Export {
                name: "FindAtom",
                pops: 4,
            }),
            Some(Export {
                name: "AddAtom",
                pops: 4,
            }),
            Some(Export {
                name: "DeleteAtom",
                pops: 2,
            }),
            Some(Export {
                name: "GetAtomName",
                pops: 8,
            }),
            Some(Export {
                name: "GetAtomHandle",
                pops: 2,
            }),
            Some(Export {
                name: "OpenFile",
                pops: 10,
            }),
            Some(Export {
                name: "OpenPathName",
                pops: 6,
            }),
            Some(Export {
                name: "DeletePathName",
                pops: 6,
            }),
            Some(Export {
                name: "Reserved1",
                pops: 4,
            }),
            Some(Export {
                name: "Reserved2",
                pops: 4,
            }),
            Some(Export {
                name: "Reserved3",
                pops: 4,
            }),
            Some(Export {
                name: "Reserved4",
                pops: 4,
            }),
            Some(Export {
                name: "_lclose",
                pops: 2,
            }),
            Some(Export {
                name: "_lread",
                pops: 8,
            }),
            Some(Export {
                name: "_lcreat",
                pops: 6,
            }),
            Some(Export {
                name: "_llseek",
                pops: 8,
            }),
            Some(Export {
                name: "_lopen",
                pops: 6,
            }),
            Some(Export {
                name: "_lwrite",
                pops: 8,
            }),
            Some(Export {
                name: "Reserved5",
                pops: 8,
            }),
            Some(Export {
                name: "lstrcpy",
                pops: 8,
            }),
            Some(Export {
                name: "lstrcat",
                pops: 8,
            }),
            Some(Export {
                name: "lstrlen",
                pops: 4,
            }),
            Some(Export {
                name: "InitTask",
                pops: 0,
            }),
            Some(Export {
                name: "GetTempDrive",
                pops: 2,
            }),
            Some(Export {
                name: "GetCodeHandle",
                pops: 4,
            }),
            Some(Export {
                name: "DefineHandleTable",
                pops: 2,
            }),
            Some(Export {
                name: "LoadLibrary",
                pops: 4,
            }),
            Some(Export {
                name: "FreeLibrary",
                pops: 2,
            }),
            Some(Export {
                name: "GetTempFileName",
                pops: 12,
            }),
            Some(Export {
                name: "GetLastDiskChange",
                pops: 0,
            }),
            Some(Export {
                name: "GetLPErrMode",
                pops: 0,
            }),
            Some(Export {
                name: "ValidateCodeSegments",
                pops: 0,
            }),
            Some(Export {
                name: "NoHookDosCall",
                pops: 0,
            }),
            Some(Export {
                name: "Dos3Call",
                pops: 0,
            }),
            Some(Export {
                name: "NetBiosCall",
                pops: 0,
            }),
            Some(Export {
                name: "GetCodeInfo",
                pops: 8,
            }),
            Some(Export {
                name: "GetExeVersion",
                pops: 0,
            }),
            Some(Export {
                name: "SetSwapAreaSize",
                pops: 2,
            }),
            Some(Export {
                name: "SetErrorMode",
                pops: 2,
            }),
            Some(Export {
                name: "SwitchStackTo",
                pops: 0,
            }),
            Some(Export {
                name: "SwitchStackBack",
                pops: 0,
            }),
            Some(Export {
                name: "PatchCodeHandle",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalWire",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalUnwire",
                pops: 2,
            }),
            Some(Export {
                name: "__AHSHIFT",
                pops: 0,
            }),
            Some(Export {
                name: "__AHINCR",
                pops: 0,
            }),
            Some(Export {
                name: "OutputDebugString",
                pops: 4,
            }),
            Some(Export {
                name: "InitLib",
                pops: 0,
            }),
            Some(Export {
                name: "OldYield",
                pops: 0,
            }),
            Some(Export {
                name: "GetTaskQueueDS",
                pops: 0,
            }),
            Some(Export {
                name: "GetTaskQueueES",
                pops: 0,
            }),
            Some(Export {
                name: "UndefDynLink",
                pops: 0,
            }),
            Some(Export {
                name: "LocalShrink",
                pops: 4,
            }),
            Some(Export {
                name: "IsTaskLocked",
                pops: 0,
            }),
            Some(Export {
                name: "KbdRst",
                pops: 0,
            }),
            Some(Export {
                name: "EnableKernel",
                pops: 0,
            }),
            Some(Export {
                name: "DisableKernel",
                pops: 0,
            }),
            Some(Export {
                name: "MemoryFreed",
                pops: 2,
            }),
            Some(Export {
                name: "GetPrivateProfileInt",
                pops: 14,
            }),
            Some(Export {
                name: "GetPrivateProfileString",
                pops: 22,
            }),
            Some(Export {
                name: "WritePrivateProfileString",
                pops: 16,
            }),
            Some(Export {
                name: "FileCdr",
                pops: 4,
            }),
            Some(Export {
                name: "GetDOSEnvironment",
                pops: 0,
            }),
            Some(Export {
                name: "GetWinFlags",
                pops: 0,
            }),
            Some(Export {
                name: "GetExePtr",
                pops: 2,
            }),
            Some(Export {
                name: "GetWindowsDirectory",
                pops: 6,
            }),
            Some(Export {
                name: "GetSystemDirectory",
                pops: 6,
            }),
            Some(Export {
                name: "GetDriveType",
                pops: 2,
            }),
            Some(Export {
                name: "FatalAppExit",
                pops: 6,
            }),
            Some(Export {
                name: "GetHeapSpaces",
                pops: 2,
            }),
            Some(Export {
                name: "DoSignal",
                pops: 0,
            }),
            Some(Export {
                name: "SetSigHandler",
                pops: 16,
            }),
            Some(Export {
                name: "InitTask1",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DirectedYield",
                pops: 2,
            }),
            Some(Export {
                name: "WinOldApCall",
                pops: 2,
            }),
            Some(Export {
                name: "GetNumTasks",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GlobalNotify",
                pops: 4,
            }),
            Some(Export {
                name: "GetTaskDS",
                pops: 0,
            }),
            Some(Export {
                name: "LimitEmsPages",
                pops: 4,
            }),
            Some(Export {
                name: "GetCurPID",
                pops: 4,
            }),
            Some(Export {
                name: "IsWinOldApTask",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalHandleNoRIP",
                pops: 2,
            }),
            Some(Export {
                name: "EMSCopy",
                pops: 14,
            }),
            Some(Export {
                name: "LocalCountFree",
                pops: 0,
            }),
            Some(Export {
                name: "LocalHeapSize",
                pops: 0,
            }),
            Some(Export {
                name: "GlobalLRUOldest",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalLRUNewest",
                pops: 2,
            }),
            Some(Export {
                name: "A20Proc",
                pops: 2,
            }),
            Some(Export {
                name: "WinExec",
                pops: 6,
            }),
            Some(Export {
                name: "GetExpWinVer",
                pops: 2,
            }),
            Some(Export {
                name: "DirectResAlloc",
                pops: 6,
            }),
            Some(Export {
                name: "GetFreeSpace",
                pops: 2,
            }),
            Some(Export {
                name: "AllocCSToDSAlias",
                pops: 2,
            }),
            Some(Export {
                name: "AllocDSToCSAlias",
                pops: 2,
            }),
            Some(Export {
                name: "AllocAlias",
                pops: 2,
            }),
            Some(Export {
                name: "__ROMBIOS",
                pops: 2,
            }),
            Some(Export {
                name: "__A000H",
                pops: 6,
            }),
            Some(Export {
                name: "AllocSelector",
                pops: 2,
            }),
            Some(Export {
                name: "FreeSelector",
                pops: 2,
            }),
            Some(Export {
                name: "PrestoChangoSelector",
                pops: 4,
            }),
            Some(Export {
                name: "__WINFLAGS",
                pops: 0,
            }),
            Some(Export {
                name: "__D000H",
                pops: 4,
            }),
            Some(Export {
                name: "LONGPTRADD",
                pops: 8,
            }),
            Some(Export {
                name: "__B000H",
                pops: 2,
            }),
            Some(Export {
                name: "__B800H",
                pops: 4,
            }),
            Some(Export {
                name: "__0000H",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalDosAlloc",
                pops: 4,
            }),
            Some(Export {
                name: "GlobalDosFree",
                pops: 2,
            }),
            Some(Export {
                name: "GetSelectorBase",
                pops: 2,
            }),
            Some(Export {
                name: "SetSelectorBase",
                pops: 6,
            }),
            Some(Export {
                name: "GetSelectorLimit",
                pops: 2,
            }),
            Some(Export {
                name: "SetSelectorLimit",
                pops: 6,
            }),
            Some(Export {
                name: "__E000H",
                pops: 6,
            }),
            Some(Export {
                name: "GlobalPageLock",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalPageUnlock",
                pops: 2,
            }),
            Some(Export {
                name: "__0040H",
                pops: 2,
            }),
            Some(Export {
                name: "__F000H",
                pops: 2,
            }),
            Some(Export {
                name: "__C000H",
                pops: 2,
            }),
            Some(Export {
                name: "SelectorAccessRights",
                pops: 6,
            }),
            Some(Export {
                name: "GlobalFix",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalUnfix",
                pops: 2,
            }),
            Some(Export {
                name: "SetHandleCount",
                pops: 2,
            }),
            Some(Export {
                name: "ValidateFreeSpaces",
                pops: 0,
            }),
            Some(Export {
                name: "ReplaceInst",
                pops: 6,
            }),
            Some(Export {
                name: "RegisterPtrace",
                pops: 4,
            }),
            Some(Export {
                name: "DebugBreak",
                pops: 0,
            }),
            Some(Export {
                name: "SwapRecording",
                pops: 2,
            }),
            Some(Export {
                name: "CVWBreak",
                pops: 2,
            }),
            Some(Export {
                name: "AllocSelectorArray",
                pops: 2,
            }),
            Some(Export {
                name: "IsDBCSLeadByte",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "LocalHandleDelta",
                pops: 2,
            }),
            Some(Export {
                name: "GetSetKernelDosProc",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DebugDefineSegment",
                pops: 0,
            }),
            Some(Export {
                name: "WriteOutProfiles",
                pops: 0,
            }),
            Some(Export {
                name: "GetFreeMemInfo",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "FatalExitHook",
                pops: 4,
            }),
            Some(Export {
                name: "FlushCachedFileHandle",
                pops: 2,
            }),
            Some(Export {
                name: "IsTask",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "IsRomModule",
                pops: 6,
            }),
            Some(Export {
                name: "LogError",
                pops: 6,
            }),
            Some(Export {
                name: "LogParamError",
                pops: 10,
            }),
            Some(Export {
                name: "IsRomFile",
                pops: 6,
            }),
            Some(Export {
                name: "K327",
                pops: 0,
            }),
            Some(Export {
                name: "_DEBUGOUTPUT",
                pops: 0,
            }),
            Some(Export {
                name: "K329",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "ThHook",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "IsBadReadPtr",
                pops: 6,
            }),
            Some(Export {
                name: "IsBadWritePtr",
                pops: 6,
            }),
            Some(Export {
                name: "IsBadCodePtr",
                pops: 4,
            }),
            Some(Export {
                name: "IsBadStringPtr",
                pops: 6,
            }),
            Some(Export {
                name: "HasGPHandler",
                pops: 4,
            }),
            Some(Export {
                name: "DiagQuery",
                pops: 0,
            }),
            Some(Export {
                name: "DiagOutput",
                pops: 4,
            }),
            Some(Export {
                name: "ToolHelpHook",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 14,
            }),
            Some(Export {
                name: "RegisterWinOldApHook",
                pops: 6,
            }),
            Some(Export {
                name: "GetWinOldApHooks",
                pops: 0,
            }),
            Some(Export {
                name: "IsSharedSelector",
                pops: 2,
            }),
            Some(Export {
                name: "IsBadHugeReadPtr",
                pops: 8,
            }),
            Some(Export {
                name: "IsBadHugeWritePtr",
                pops: 8,
            }),
            Some(Export {
                name: "HMEMCPY",
                pops: 12,
            }),
            Some(Export {
                name: "_HREAD",
                pops: 10,
            }),
            Some(Export {
                name: "_HWRITE",
                pops: 10,
            }),
            Some(Export {
                name: "BUNNY_351",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "LSTRCPYN",
                pops: 10,
            }),
            Some(Export {
                name: "GetAppCompatFlags",
                pops: 2,
            }),
            Some(Export {
                name: "GetWinDebugInfo",
                pops: 6,
            }),
            Some(Export {
                name: "SetWinDebugInfo",
                pops: 4,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "K403",
                pops: 4,
            }),
            Some(Export {
                name: "K404",
                pops: 2,
            }),
        ],
    },
    Kept {
        name: "GDI",
        path: "C:\\WINDOWS\\SYSTEM\\GDI.EXE",
        fixed: false,
        exports: &[
            None,
            Some(Export {
                name: "SetBkColor",
                pops: 6,
            }),
            Some(Export {
                name: "SetBkMode",
                pops: 4,
            }),
            Some(Export {
                name: "SetMapMode",
                pops: 4,
            }),
            Some(Export {
                name: "SetRop2",
                pops: 4,
            }),
            Some(Export {
                name: "SetRelAbs",
                pops: 4,
            }),
            Some(Export {
                name: "SetPolyFillMode",
                pops: 4,
            }),
            Some(Export {
                name: "SetStretchBltMode",
                pops: 4,
            }),
            Some(Export {
                name: "SetTextCharacterExtra",
                pops: 4,
            }),
            Some(Export {
                name: "SetTextColor",
                pops: 6,
            }),
            Some(Export {
                name: "SetTextJustification",
                pops: 6,
            }),
            Some(Export {
                name: "SetWindowOrg",
                pops: 6,
            }),
            Some(Export {
                name: "SetWindowExt",
                pops: 6,
            }),
            Some(Export {
                name: "SetViewportOrg",
                pops: 6,
            }),
            Some(Export {
                name: "SetViewportExt",
                pops: 6,
            }),
            Some(Export {
                name: "OffsetWindowOrg",
                pops: 6,
            }),
            Some(Export {
                name: "ScaleWindowExt",
                pops: 10,
            }),
            Some(Export {
                name: "OffsetViewportOrg",
                pops: 6,
            }),
            Some(Export {
                name: "ScaleViewportExt",
                pops: 10,
            }),
            Some(Export {
                name: "LineTo",
                pops: 6,
            }),
            Some(Export {
                name: "MoveTo",
                pops: 6,
            }),
            Some(Export {
                name: "ExcludeClipRect",
                pops: 10,
            }),
            Some(Export {
                name: "IntersectClipRect",
                pops: 10,
            }),
            Some(Export {
                name: "Arc",
                pops: 18,
            }),
            Some(Export {
                name: "Ellipse",
                pops: 10,
            }),
            Some(Export {
                name: "FloodFill",
                pops: 10,
            }),
            Some(Export {
                name: "Pie",
                pops: 18,
            }),
            Some(Export {
                name: "Rectangle",
                pops: 10,
            }),
            Some(Export {
                name: "RoundRect",
                pops: 14,
            }),
            Some(Export {
                name: "PatBlt",
                pops: 14,
            }),
            Some(Export {
                name: "SaveDC",
                pops: 2,
            }),
            Some(Export {
                name: "SetPixel",
                pops: 10,
            }),
            Some(Export {
                name: "OffsetClipRgn",
                pops: 6,
            }),
            Some(Export {
                name: "TextOut",
                pops: 12,
            }),
            Some(Export {
                name: "BitBlt",
                pops: 20,
            }),
            Some(Export {
                name: "StretchBlt",
                pops: 24,
            }),
            Some(Export {
                name: "Polygon",
                pops: 8,
            }),
            Some(Export {
                name: "Polyline",
                pops: 8,
            }),
            Some(Export {
                name: "Escape",
                pops: 14,
            }),
            Some(Export {
                name: "RestoreDC",
                pops: 4,
            }),
            Some(Export {
                name: "FillRgn",
                pops: 6,
            }),
            Some(Export {
                name: "FrameRgn",
                pops: 10,
            }),
            Some(Export {
                name: "InvertRgn",
                pops: 4,
            }),
            Some(Export {
                name: "PaintRgn",
                pops: 4,
            }),
            Some(Export {
                name: "SelectClipRgn",
                pops: 4,
            }),
            Some(Export {
                name: "SelectObject",
                pops: 4,
            }),
            Some(Export {
                name: "__GP",
                pops: 0,
            }),
            Some(Export {
                name: "CombineRgn",
                pops: 8,
            }),
            Some(Export {
                name: "CreateBitmap",
                pops: 12,
            }),
            Some(Export {
                name: "CreateBitmapIndirect",
                pops: 4,
            }),
            Some(Export {
                name: "CreateBrushIndirect",
                pops: 4,
            }),
            Some(Export {
                name: "CreateCompatibleBitmap",
                pops: 6,
            }),
            Some(Export {
                name: "CreateCompatibleDC",
                pops: 2,
            }),
            Some(Export {
                name: "CreateDC",
                pops: 16,
            }),
            Some(Export {
                name: "CreateEllipticRgn",
                pops: 8,
            }),
            Some(Export {
                name: "CreateEllipticRgnIndirect",
                pops: 4,
            }),
            Some(Export {
                name: "CreateFont",
                pops: 30,
            }),
            Some(Export {
                name: "CreateFontIndirect",
                pops: 4,
            }),
            Some(Export {
                name: "CreateHatchBrush",
                pops: 6,
            }),
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            Some(Export {
                name: "CreatePatternBrush",
                pops: 2,
            }),
            Some(Export {
                name: "CreatePen",
                pops: 8,
            }),
            Some(Export {
                name: "CreatePenIndirect",
                pops: 4,
            }),
            Some(Export {
                name: "CreatePolygonRgn",
                pops: 8,
            }),
            Some(Export {
                name: "CreateRectRgn",
                pops: 8,
            }),
            Some(Export {
                name: "CreateRectRgnIndirect",
                pops: 4,
            }),
            Some(Export {
                name: "CreateSolidBrush",
                pops: 4,
            }),
            Some(Export {
                name: "DPToLP",
                pops: 8,
            }),
            Some(Export {
                name: "DeleteDC",
                pops: 2,
            }),
            Some(Export {
                name: "DeleteObject",
                pops: 2,
            }),
            Some(Export {
                name: "EnumFonts",
                pops: 14,
            }),
            Some(Export {
                name: "EnumObjects",
                pops: 12,
            }),
            Some(Export {
                name: "EqualRgn",
                pops: 4,
            }),
            Some(Export {
                name: "ExcludeVisRect",
                pops: 10,
            }),
            Some(Export {
                name: "GetBitmapBits",
                pops: 10,
            }),
            Some(Export {
                name: "GetBkColor",
                pops: 2,
            }),
            Some(Export {
                name: "GetBkMode",
                pops: 2,
            }),
            Some(Export {
                name: "GetClipBox",
                pops: 6,
            }),
            Some(Export {
                name: "GetCurrentPosition",
                pops: 2,
            }),
            Some(Export {
                name: "GetDCOrg",
                pops: 2,
            }),
            Some(Export {
                name: "GetDeviceCaps",
                pops: 4,
            }),
            Some(Export {
                name: "GetMapMode",
                pops: 2,
            }),
            Some(Export {
                name: "GetObject",
                pops: 8,
            }),
            Some(Export {
                name: "GetPixel",
                pops: 6,
            }),
            Some(Export {
                name: "GetPolyFillMode",
                pops: 2,
            }),
            Some(Export {
                name: "GetRop2",
                pops: 2,
            }),
            Some(Export {
                name: "GetRelAbs",
                pops: 2,
            }),
            Some(Export {
                name: "GetStockObject",
                pops: 2,
            }),
            Some(Export {
                name: "GetStretchBltMode",
                pops: 2,
            }),
            Some(Export {
                name: "GetTextCharacterExtra",
                pops: 2,
            }),
            Some(Export {
                name: "GetTextColor",
                pops: 2,
            }),
            Some(Export {
                name: "GetTextExtent",
                pops: 8,
            }),
            Some(Export {
                name: "GetTextFace",
                pops: 8,
            }),
            Some(Export {
                name: "GetTextMetrics",
                pops: 6,
            }),
            Some(Export {
                name: "GetViewportExt",
                pops: 2,
            }),
            Some(Export {
                name: "GetViewportOrg",
                pops: 2,
            }),
            Some(Export {
                name: "GetWindowExt",
                pops: 2,
            }),
            Some(Export {
                name: "GetWindowOrg",
                pops: 2,
            }),
            Some(Export {
                name: "IntersectVisRect",
                pops: 10,
            }),
            Some(Export {
                name: "LPToDP",
                pops: 8,
            }),
            Some(Export {
                name: "LineDDA",
                pops: 16,
            }),
            Some(Export {
                name: "OffsetRgn",
                pops: 6,
            }),
            Some(Export {
                name: "OffsetVisRgn",
                pops: 6,
            }),
            Some(Export {
                name: "PtVisible",
                pops: 6,
            }),
            Some(Export {
                name: "RectVisible",
                pops: 6,
            }),
            Some(Export {
                name: "SelectVisRgn",
                pops: 4,
            }),
            Some(Export {
                name: "SetBitmapBits",
                pops: 10,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "SetDCOrg",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "AddFontResource",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Death",
                pops: 2,
            }),
            Some(Export {
                name: "Resurrection",
                pops: 14,
            }),
            Some(Export {
                name: "PlayMetafile",
                pops: 4,
            }),
            Some(Export {
                name: "GetMetafile",
                pops: 4,
            }),
            Some(Export {
                name: "CreateMetafile",
                pops: 4,
            }),
            Some(Export {
                name: "CloseMetafile",
                pops: 2,
            }),
            Some(Export {
                name: "DeleteMetafile",
                pops: 2,
            }),
            Some(Export {
                name: "MulDiv",
                pops: 6,
            }),
            Some(Export {
                name: "SaveVisRgn",
                pops: 2,
            }),
            Some(Export {
                name: "RestoreVisRgn",
                pops: 2,
            }),
            Some(Export {
                name: "InquireVisRgn",
                pops: 2,
            }),
            Some(Export {
                name: "SetEnvironment",
                pops: 10,
            }),
            Some(Export {
                name: "GetEnvironment",
                pops: 10,
            }),
            Some(Export {
                name: "GetRgnBox",
                pops: 6,
            }),
            Some(Export {
                name: "ScanLR",
                pops: 12,
            }),
            Some(Export {
                name: "RemoveFontResource",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "SetBrushOrg",
                pops: 6,
            }),
            Some(Export {
                name: "GetBrushOrg",
                pops: 2,
            }),
            Some(Export {
                name: "UnrealizeObject",
                pops: 2,
            }),
            Some(Export {
                name: "CopyMetafile",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "CreateIC",
                pops: 16,
            }),
            Some(Export {
                name: "GetNearestColor",
                pops: 6,
            }),
            Some(Export {
                name: "QueryAbort",
                pops: 4,
            }),
            Some(Export {
                name: "CreateDiscardableBitmap",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetMetafileBits",
                pops: 2,
            }),
            Some(Export {
                name: "SetMetafileBits",
                pops: 2,
            }),
            Some(Export {
                name: "PtInRegion",
                pops: 6,
            }),
            Some(Export {
                name: "GetBitmapDimension",
                pops: 2,
            }),
            Some(Export {
                name: "SetBitmapDimension",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "IsDCDirty",
                pops: 6,
            }),
            Some(Export {
                name: "SetDCStatus",
                pops: 8,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "SetRectRgn",
                pops: 10,
            }),
            Some(Export {
                name: "GetClipRgn",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "EnumMetafile",
                pops: 12,
            }),
            Some(Export {
                name: "PlayMetafileRecord",
                pops: 12,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetDCState",
                pops: 2,
            }),
            Some(Export {
                name: "SetDCState",
                pops: 4,
            }),
            Some(Export {
                name: "RectInRegion",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "SetDCHook",
                pops: 10,
            }),
            Some(Export {
                name: "GetDCHook",
                pops: 6,
            }),
            Some(Export {
                name: "SetHookFlags",
                pops: 4,
            }),
            Some(Export {
                name: "SetBoundsRect",
                pops: 8,
            }),
            Some(Export {
                name: "GetBoundsRect",
                pops: 8,
            }),
            Some(Export {
                name: "SelectBitmap",
                pops: 4,
            }),
            Some(Export {
                name: "SetMetafileBitsBetter",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DMBitBlt",
                pops: 0,
            }),
            Some(Export {
                name: "DMColorInfo",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DMEnumDFonts",
                pops: 16,
            }),
            Some(Export {
                name: "DMEnumObj",
                pops: 0,
            }),
            Some(Export {
                name: "DMOutput",
                pops: 0,
            }),
            Some(Export {
                name: "DMPixel",
                pops: 0,
            }),
            Some(Export {
                name: "DMRealizeObject",
                pops: 0,
            }),
            Some(Export {
                name: "DMStrBlt",
                pops: 30,
            }),
            Some(Export {
                name: "DMScanLR",
                pops: 0,
            }),
            Some(Export {
                name: "Brute",
                pops: 0,
            }),
            Some(Export {
                name: "DMExtTextOut",
                pops: 40,
            }),
            Some(Export {
                name: "DMGetCharWidth",
                pops: 0,
            }),
            Some(Export {
                name: "DMStretchBlt",
                pops: 0,
            }),
            Some(Export {
                name: "DMDibBits",
                pops: 0,
            }),
            Some(Export {
                name: "DMStretchDIBits",
                pops: 0,
            }),
            Some(Export {
                name: "DMSetDibToDev",
                pops: 0,
            }),
            Some(Export {
                name: "DMTranspose",
                pops: 10,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "CreatePQ",
                pops: 2,
            }),
            Some(Export {
                name: "MinPQ",
                pops: 2,
            }),
            Some(Export {
                name: "ExtractPQ",
                pops: 2,
            }),
            Some(Export {
                name: "InsertPQ",
                pops: 6,
            }),
            Some(Export {
                name: "SizePQ",
                pops: 4,
            }),
            Some(Export {
                name: "DeletePQ",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "OpenJob",
                pops: 10,
            }),
            Some(Export {
                name: "WriteSpool",
                pops: 8,
            }),
            Some(Export {
                name: "WriteDialog",
                pops: 8,
            }),
            Some(Export {
                name: "CloseJob",
                pops: 2,
            }),
            Some(Export {
                name: "DeleteJob",
                pops: 4,
            }),
            Some(Export {
                name: "GetSpoolJob",
                pops: 6,
            }),
            Some(Export {
                name: "StartSpoolPage",
                pops: 2,
            }),
            Some(Export {
                name: "EndSpoolPage",
                pops: 2,
            }),
            Some(Export {
                name: "QueryJob",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Copy",
                pops: 10,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DeleteSpoolPage",
                pops: 2,
            }),
            Some(Export {
                name: "SpoolFile",
                pops: 16,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "EngineEnumerateFont",
                pops: 12,
            }),
            Some(Export {
                name: "EngineDeleteFont",
                pops: 4,
            }),
            Some(Export {
                name: "EngineRealizeFont",
                pops: 12,
            }),
            Some(Export {
                name: "EngineGetCharWidth",
                pops: 12,
            }),
            Some(Export {
                name: "EngineSetFontContext",
                pops: 6,
            }),
            Some(Export {
                name: "EngineGetGlyphBmp",
                pops: 22,
            }),
            Some(Export {
                name: "EngineMakeFontDir",
                pops: 10,
            }),
            Some(Export {
                name: "GetCharAbcWidths",
                pops: 10,
            }),
            Some(Export {
                name: "GetOutlineTextMetrics",
                pops: 8,
            }),
            Some(Export {
                name: "GetGlyphOutline",
                pops: 22,
            }),
            Some(Export {
                name: "CreateScalableFontResource",
                pops: 14,
            }),
            Some(Export {
                name: "GetFontData",
                pops: 18,
            }),
            Some(Export {
                name: "ConvertOutlineFontFile",
                pops: 12,
            }),
            Some(Export {
                name: "GetRasterizerCaps",
                pops: 6,
            }),
            Some(Export {
                name: "EngineExtTextOut",
                pops: 42,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "EnumFontFamilies",
                pops: 14,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetKerningPairs",
                pops: 8,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetTextAlign",
                pops: 2,
            }),
            Some(Export {
                name: "SetTextAlign",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Chord",
                pops: 18,
            }),
            Some(Export {
                name: "SetMapperFlags",
                pops: 6,
            }),
            Some(Export {
                name: "GetCharWidth",
                pops: 10,
            }),
            Some(Export {
                name: "ExtTextOut",
                pops: 22,
            }),
            Some(Export {
                name: "GetPhysicalFontHandle",
                pops: 2,
            }),
            Some(Export {
                name: "GetAspectRatioFilter",
                pops: 2,
            }),
            Some(Export {
                name: "ShrinkGDIHeap",
                pops: 0,
            }),
            Some(Export {
                name: "FTrapping0",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "CreatePalette",
                pops: 4,
            }),
            Some(Export {
                name: "GDISelectPalette",
                pops: 6,
            }),
            Some(Export {
                name: "GDIRealizePalette",
                pops: 2,
            }),
            Some(Export {
                name: "GetPaletteEntries",
                pops: 10,
            }),
            Some(Export {
                name: "SetPaletteEntries",
                pops: 10,
            }),
            Some(Export {
                name: "RealizeDefaultPalette",
                pops: 2,
            }),
            Some(Export {
                name: "UpdateColors",
                pops: 2,
            }),
            Some(Export {
                name: "AnimatePalette",
                pops: 10,
            }),
            Some(Export {
                name: "ResizePalette",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetNearestPaletteIndex",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "ExtFloodFill",
                pops: 12,
            }),
            Some(Export {
                name: "SetSystemPaletteUse",
                pops: 4,
            }),
            Some(Export {
                name: "GetSystemPaletteUse",
                pops: 2,
            }),
            Some(Export {
                name: "GetSystemPaletteEntries",
                pops: 10,
            }),
            Some(Export {
                name: "ResetDC",
                pops: 6,
            }),
            Some(Export {
                name: "StartDoc",
                pops: 6,
            }),
            Some(Export {
                name: "EndDoc",
                pops: 2,
            }),
            Some(Export {
                name: "StartPage",
                pops: 2,
            }),
            Some(Export {
                name: "EndPage",
                pops: 2,
            }),
            Some(Export {
                name: "SetAbortProc",
                pops: 6,
            }),
            Some(Export {
                name: "AbortDoc",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "FastWindowFrame",
                pops: 14,
            }),
            Some(Export {
                name: "GDIMoveBitmap",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GDIInit2",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "FinalGDIInit",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "CreateUserBitmap",
                pops: 12,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "CreateUserDiscardableBitmap",
                pops: 6,
            }),
            Some(Export {
                name: "IsValidMetafile",
                pops: 2,
            }),
            Some(Export {
                name: "GetCurLogFont",
                pops: 2,
            }),
            Some(Export {
                name: "IsDCCurrentPalette",
                pops: 2,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "StretchDIBits",
                pops: 32,
            }),
            Some(Export {
                name: "SetDIBits",
                pops: 18,
            }),
            Some(Export {
                name: "GetDIBits",
                pops: 18,
            }),
            Some(Export {
                name: "CreateDIBitmap",
                pops: 20,
            }),
            Some(Export {
                name: "SetDIBitsToDevice",
                pops: 28,
            }),
            Some(Export {
                name: "CreateRoundRectRgn",
                pops: 12,
            }),
            Some(Export {
                name: "CreateDIBPatternBrush",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DeviceColorMatch",
                pops: 8,
            }),
            Some(Export {
                name: "PolyPolygon",
                pops: 12,
            }),
            Some(Export {
                name: "CreatePolyPolygonRgn",
                pops: 12,
            }),
            Some(Export {
                name: "GDISeeGDIDo",
                pops: 8,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GDITaskTermination",
                pops: 2,
            }),
            Some(Export {
                name: "SetObjectOwner",
                pops: 4,
            }),
            Some(Export {
                name: "IsGDIObject",
                pops: 2,
            }),
            Some(Export {
                name: "MakeObjectPrivate",
                pops: 4,
            }),
            Some(Export {
                name: "FixUpBogusPublisherMetafile",
                pops: 6,
            }),
            Some(Export {
                name: "RectVisible_Ehh",
                pops: 6,
            }),
            Some(Export {
                name: "RectInRegion_Ehh",
                pops: 6,
            }),
            Some(Export {
                name: "UnicodeToAnsi",
                pops: 8,
            }),
            Some(Export {
                name: "GetBitmapDimensionEx",
                pops: 6,
            }),
            Some(Export {
                name: "GetBrushOrgEx",
                pops: 6,
            }),
            Some(Export {
                name: "GetCurrentPositionEx",
                pops: 6,
            }),
            Some(Export {
                name: "GetTextExtentPoint",
                pops: 12,
            }),
            Some(Export {
                name: "GetViewportExtEx",
                pops: 6,
            }),
            Some(Export {
                name: "GetViewportOrgEx",
                pops: 6,
            }),
            Some(Export {
                name: "GetWindowExtEx",
                pops: 6,
            }),
            Some(Export {
                name: "GetWindowOrgEx",
                pops: 6,
            }),
            Some(Export {
                name: "OffsetViewportOrgEx",
                pops: 10,
            }),
            Some(Export {
                name: "OffsetWindowOrgEx",
                pops: 10,
            }),
            Some(Export {
                name: "SetBitmapDimensionEx",
                pops: 10,
            }),
            Some(Export {
                name: "SetViewportExtEx",
                pops: 10,
            }),
            Some(Export {
                name: "SetViewportOrgEx",
                pops: 10,
            }),
            Some(Export {
                name: "SetWindowExtEx",
                pops: 10,
            }),
            Some(Export {
                name: "SetWindowOrgEx",
                pops: 10,
            }),
            Some(Export {
                name: "MoveToEx",
                pops: 10,
            }),
            Some(Export {
                name: "ScaleViewportExtEx",
                pops: 14,
            }),
            Some(Export {
                name: "ScaleWindowExtEx",
                pops: 14,
            }),
            Some(Export {
                name: "GetAspectRatioFilterEx",
                pops: 6,
            }),
        ],
    },
    Kept {
        name: "USER",
        path: "C:\\WINDOWS\\SYSTEM\\USER.EXE",
        fixed: false,
        exports: &[
            None,
            Some(Export {
                name: "MessageBox",
                pops: 12,
            }),
            Some(Export {
                name: "OldExitWindows",
                pops: 0,
            }),
            Some(Export {
                name: "EnableOEMLayer",
                pops: 0,
            }),
            Some(Export {
                name: "DisableOEMLayer",
                pops: 0,
            }),
            Some(Export {
                name: "InitApp",
                pops: 2,
            }),
            Some(Export {
                name: "PostQuitMessage",
                pops: 2,
            }),
            Some(Export {
                name: "ExitWindows",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 2,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "SetTimer",
                pops: 10,
            }),
            Some(Export {
                name: "Bear11",
                pops: 10,
            }),
            Some(Export {
                name: "KillTimer",
                pops: 4,
            }),
            Some(Export {
                name: "GetTickCount",
                pops: 0,
            }),
            Some(Export {
                name: "GetTimerResolution",
                pops: 0,
            }),
            Some(Export {
                name: "GetCurrentTime",
                pops: 0,
            }),
            Some(Export {
                name: "ClipCursor",
                pops: 4,
            }),
            Some(Export {
                name: "GetCursorPos",
                pops: 4,
            }),
            Some(Export {
                name: "SetCapture",
                pops: 2,
            }),
            Some(Export {
                name: "ReleaseCapture",
                pops: 0,
            }),
            Some(Export {
                name: "SetDoubleClickTime",
                pops: 2,
            }),
            Some(Export {
                name: "GetDoubleClickTime",
                pops: 0,
            }),
            Some(Export {
                name: "SetFocus",
                pops: 2,
            }),
            Some(Export {
                name: "GetFocus",
                pops: 0,
            }),
            Some(Export {
                name: "RemoveProp",
                pops: 6,
            }),
            Some(Export {
                name: "GetProp",
                pops: 6,
            }),
            Some(Export {
                name: "SetProp",
                pops: 8,
            }),
            Some(Export {
                name: "EnumProps",
                pops: 6,
            }),
            Some(Export {
                name: "ClientToScreen",
                pops: 6,
            }),
            Some(Export {
                name: "ScreenToClient",
                pops: 6,
            }),
            Some(Export {
                name: "WindowFromPoint",
                pops: 4,
            }),
            Some(Export {
                name: "IsIconic",
                pops: 2,
            }),
            Some(Export {
                name: "GetWindowRect",
                pops: 6,
            }),
            Some(Export {
                name: "GetClientRect",
                pops: 6,
            }),
            Some(Export {
                name: "EnableWindow",
                pops: 4,
            }),
            Some(Export {
                name: "IsWindowEnabled",
                pops: 2,
            }),
            Some(Export {
                name: "GetWindowText",
                pops: 8,
            }),
            Some(Export {
                name: "SetWindowText",
                pops: 6,
            }),
            Some(Export {
                name: "GetWindowTextLength",
                pops: 2,
            }),
            Some(Export {
                name: "BeginPaint",
                pops: 6,
            }),
            Some(Export {
                name: "EndPaint",
                pops: 6,
            }),
            Some(Export {
                name: "CreateWindow",
                pops: 30,
            }),
            Some(Export {
                name: "ShowWindow",
                pops: 4,
            }),
            Some(Export {
                name: "CloseWindow",
                pops: 2,
            }),
            Some(Export {
                name: "OpenIcon",
                pops: 2,
            }),
            Some(Export {
                name: "BringWindowToTop",
                pops: 2,
            }),
            Some(Export {
                name: "GetParent",
                pops: 2,
            }),
            Some(Export {
                name: "IsWindow",
                pops: 2,
            }),
            Some(Export {
                name: "IsChild",
                pops: 4,
            }),
            Some(Export {
                name: "IsWindowVisible",
                pops: 2,
            }),
            Some(Export {
                name: "FindWindow",
                pops: 8,
            }),
            Some(Export {
                name: "Bear51",
                pops: 2,
            }),
            Some(Export {
                name: "AnyPopUp",
                pops: 0,
            }),
            Some(Export {
                name: "DestroyWindow",
                pops: 2,
            }),
            Some(Export {
                name: "EnumWindows",
                pops: 8,
            }),
            Some(Export {
                name: "EnumChildWindows",
                pops: 10,
            }),
            Some(Export {
                name: "MoveWindow",
                pops: 12,
            }),
            Some(Export {
                name: "RegisterClass",
                pops: 4,
            }),
            Some(Export {
                name: "GetClassName",
                pops: 8,
            }),
            Some(Export {
                name: "SetActiveWindow",
                pops: 2,
            }),
            Some(Export {
                name: "GetActiveWindow",
                pops: 0,
            }),
            Some(Export {
                name: "ScrollWindow",
                pops: 14,
            }),
            Some(Export {
                name: "SetScrollPos",
                pops: 8,
            }),
            Some(Export {
                name: "GetScrollPos",
                pops: 4,
            }),
            Some(Export {
                name: "SetScrollRange",
                pops: 10,
            }),
            Some(Export {
                name: "GetScrollRange",
                pops: 12,
            }),
            Some(Export {
                name: "GetDC",
                pops: 2,
            }),
            Some(Export {
                name: "GetWindowDC",
                pops: 2,
            }),
            Some(Export {
                name: "ReleaseDC",
                pops: 4,
            }),
            Some(Export {
                name: "SetCursor",
                pops: 2,
            }),
            Some(Export {
                name: "SetCursorPos",
                pops: 4,
            }),
            Some(Export {
                name: "ShowCursor",
                pops: 2,
            }),
            Some(Export {
                name: "SetRect",
                pops: 12,
            }),
            Some(Export {
                name: "SetRectEmpty",
                pops: 4,
            }),
            Some(Export {
                name: "CopyRect",
                pops: 8,
            }),
            Some(Export {
                name: "IsRectEmpty",
                pops: 4,
            }),
            Some(Export {
                name: "PtInRect",
                pops: 8,
            }),
            Some(Export {
                name: "OffsetRect",
                pops: 8,
            }),
            Some(Export {
                name: "InflateRect",
                pops: 8,
            }),
            Some(Export {
                name: "IntersectRect",
                pops: 12,
            }),
            Some(Export {
                name: "UnionRect",
                pops: 12,
            }),
            Some(Export {
                name: "FillRect",
                pops: 8,
            }),
            Some(Export {
                name: "InvertRect",
                pops: 6,
            }),
            Some(Export {
                name: "FrameRect",
                pops: 8,
            }),
            Some(Export {
                name: "DrawIcon",
                pops: 8,
            }),
            Some(Export {
                name: "DrawText",
                pops: 14,
            }),
            Some(Export {
                name: "Bear86",
                pops: 0,
            }),
            Some(Export {
                name: "DialogBox",
                pops: 12,
            }),
            Some(Export {
                name: "EndDialog",
                pops: 4,
            }),
            Some(Export {
                name: "CreateDialog",
                pops: 12,
            }),
            Some(Export {
                name: "IsDialogMessage",
                pops: 6,
            }),
            Some(Export {
                name: "GetDlgItem",
                pops: 4,
            }),
            Some(Export {
                name: "SetDlgItemText",
                pops: 8,
            }),
            Some(Export {
                name: "GetDlgItemText",
                pops: 10,
            }),
            Some(Export {
                name: "SetDlgItemInt",
                pops: 8,
            }),
            Some(Export {
                name: "GetDlgItemInt",
                pops: 10,
            }),
            Some(Export {
                name: "CheckRadioButton",
                pops: 8,
            }),
            Some(Export {
                name: "CheckDlgButton",
                pops: 6,
            }),
            Some(Export {
                name: "IsDlgButtonChecked",
                pops: 4,
            }),
            Some(Export {
                name: "DlgDirSelect",
                pops: 8,
            }),
            Some(Export {
                name: "DlgDirList",
                pops: 12,
            }),
            Some(Export {
                name: "SendDlgItemMessage",
                pops: 12,
            }),
            Some(Export {
                name: "AdjustWindowRect",
                pops: 10,
            }),
            Some(Export {
                name: "MapDialogRect",
                pops: 6,
            }),
            Some(Export {
                name: "MessageBeep",
                pops: 2,
            }),
            Some(Export {
                name: "FlashWindow",
                pops: 4,
            }),
            Some(Export {
                name: "GetKeyState",
                pops: 2,
            }),
            Some(Export {
                name: "DefWindowProc",
                pops: 10,
            }),
            Some(Export {
                name: "GetMessage",
                pops: 10,
            }),
            Some(Export {
                name: "PeekMessage",
                pops: 12,
            }),
            Some(Export {
                name: "PostMessage",
                pops: 10,
            }),
            Some(Export {
                name: "SendMessage",
                pops: 10,
            }),
            Some(Export {
                name: "WaitMessage",
                pops: 0,
            }),
            Some(Export {
                name: "TranslateMessage",
                pops: 4,
            }),
            Some(Export {
                name: "DispatchMessage",
                pops: 4,
            }),
            Some(Export {
                name: "ReplyMessage",
                pops: 4,
            }),
            Some(Export {
                name: "PostAppMessage",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "RegisterWindowMessage",
                pops: 4,
            }),
            Some(Export {
                name: "GetMessagePos",
                pops: 0,
            }),
            Some(Export {
                name: "GetMessageTime",
                pops: 0,
            }),
            Some(Export {
                name: "SetWindowsHook",
                pops: 6,
            }),
            Some(Export {
                name: "CallWindowProc",
                pops: 14,
            }),
            Some(Export {
                name: "CallMsgFilter",
                pops: 6,
            }),
            Some(Export {
                name: "UpdateWindow",
                pops: 2,
            }),
            Some(Export {
                name: "InvalidateRect",
                pops: 8,
            }),
            Some(Export {
                name: "InvalidateRgn",
                pops: 6,
            }),
            Some(Export {
                name: "ValidateRect",
                pops: 6,
            }),
            Some(Export {
                name: "ValidateRgn",
                pops: 4,
            }),
            Some(Export {
                name: "GetClassWord",
                pops: 4,
            }),
            Some(Export {
                name: "SetClassWord",
                pops: 6,
            }),
            Some(Export {
                name: "GetClassLong",
                pops: 4,
            }),
            Some(Export {
                name: "SetClassLong",
                pops: 8,
            }),
            Some(Export {
                name: "GetWindowWord",
                pops: 4,
            }),
            Some(Export {
                name: "SetWindowWord",
                pops: 6,
            }),
            Some(Export {
                name: "GetWindowLong",
                pops: 4,
            }),
            Some(Export {
                name: "SetWindowLong",
                pops: 8,
            }),
            Some(Export {
                name: "OpenClipboard",
                pops: 2,
            }),
            Some(Export {
                name: "CloseClipboard",
                pops: 0,
            }),
            Some(Export {
                name: "EmptyClipboard",
                pops: 0,
            }),
            Some(Export {
                name: "GetClipboardOwner",
                pops: 0,
            }),
            Some(Export {
                name: "SetClipboardData",
                pops: 4,
            }),
            Some(Export {
                name: "GetClipboardData",
                pops: 2,
            }),
            Some(Export {
                name: "CountClipboardFormats",
                pops: 0,
            }),
            Some(Export {
                name: "EnumClipboardFormats",
                pops: 2,
            }),
            Some(Export {
                name: "RegisterClipboardFormat",
                pops: 4,
            }),
            Some(Export {
                name: "GetClipboardFormatName",
                pops: 8,
            }),
            Some(Export {
                name: "SetClipboardViewer",
                pops: 2,
            }),
            Some(Export {
                name: "GetClipboardViewer",
                pops: 0,
            }),
            Some(Export {
                name: "ChangeClipboardChain",
                pops: 4,
            }),
            Some(Export {
                name: "LoadMenu",
                pops: 6,
            }),
            Some(Export {
                name: "CreateMenu",
                pops: 0,
            }),
            Some(Export {
                name: "DestroyMenu",
                pops: 2,
            }),
            Some(Export {
                name: "ChangeMenu",
                pops: 12,
            }),
            Some(Export {
                name: "CheckMenuItem",
                pops: 6,
            }),
            Some(Export {
                name: "EnableMenuItem",
                pops: 6,
            }),
            Some(Export {
                name: "GetSystemMenu",
                pops: 4,
            }),
            Some(Export {
                name: "GetMenu",
                pops: 2,
            }),
            Some(Export {
                name: "SetMenu",
                pops: 4,
            }),
            Some(Export {
                name: "GetSubMenu",
                pops: 4,
            }),
            Some(Export {
                name: "DrawMenuBar",
                pops: 2,
            }),
            Some(Export {
                name: "GetMenuString",
                pops: 12,
            }),
            Some(Export {
                name: "HiliteMenuItem",
                pops: 8,
            }),
            Some(Export {
                name: "CreateCaret",
                pops: 8,
            }),
            Some(Export {
                name: "DestroyCaret",
                pops: 0,
            }),
            Some(Export {
                name: "SetCaretPos",
                pops: 4,
            }),
            Some(Export {
                name: "HideCaret",
                pops: 2,
            }),
            Some(Export {
                name: "ShowCaret",
                pops: 2,
            }),
            Some(Export {
                name: "SetCaretBlinkTime",
                pops: 2,
            }),
            Some(Export {
                name: "GetCaretBlinkTime",
                pops: 0,
            }),
            Some(Export {
                name: "ArrangeIconicWindows",
                pops: 2,
            }),
            Some(Export {
                name: "WinHelp",
                pops: 12,
            }),
            Some(Export {
                name: "SwitchToThisWindow",
                pops: 4,
            }),
            Some(Export {
                name: "LoadCursor",
                pops: 6,
            }),
            Some(Export {
                name: "LoadIcon",
                pops: 6,
            }),
            Some(Export {
                name: "LoadBitmap",
                pops: 6,
            }),
            Some(Export {
                name: "LoadString",
                pops: 10,
            }),
            Some(Export {
                name: "LoadAccelerators",
                pops: 6,
            }),
            Some(Export {
                name: "TranslateAccelerator",
                pops: 8,
            }),
            Some(Export {
                name: "GetSystemMetrics",
                pops: 2,
            }),
            Some(Export {
                name: "GetSysColor",
                pops: 2,
            }),
            Some(Export {
                name: "SetSysColors",
                pops: 10,
            }),
            Some(Export {
                name: "Bear182",
                pops: 4,
            }),
            Some(Export {
                name: "GetCaretPos",
                pops: 4,
            }),
            Some(Export {
                name: "QuerySendMessage",
                pops: 10,
            }),
            Some(Export {
                name: "GrayString",
                pops: 22,
            }),
            Some(Export {
                name: "SwapMouseButton",
                pops: 2,
            }),
            Some(Export {
                name: "EndMenu",
                pops: 0,
            }),
            Some(Export {
                name: "SetSysModalWindow",
                pops: 2,
            }),
            Some(Export {
                name: "GetSysModalWindow",
                pops: 0,
            }),
            Some(Export {
                name: "GetUpdateRect",
                pops: 8,
            }),
            Some(Export {
                name: "ChildWindowFromPoint",
                pops: 6,
            }),
            Some(Export {
                name: "InSendMessage",
                pops: 0,
            }),
            Some(Export {
                name: "IsClipboardFormatAvailable",
                pops: 2,
            }),
            Some(Export {
                name: "DlgDirSelectComboBox",
                pops: 8,
            }),
            Some(Export {
                name: "DlgDirListComboBox",
                pops: 12,
            }),
            Some(Export {
                name: "TabbedTextOut",
                pops: 20,
            }),
            Some(Export {
                name: "GetTabbedTextExtent",
                pops: 14,
            }),
            Some(Export {
                name: "CascadeChildWindows",
                pops: 4,
            }),
            Some(Export {
                name: "TileChildWindows",
                pops: 4,
            }),
            Some(Export {
                name: "OpenComm",
                pops: 8,
            }),
            Some(Export {
                name: "SetCommState",
                pops: 4,
            }),
            Some(Export {
                name: "GetCommState",
                pops: 6,
            }),
            Some(Export {
                name: "GetCommError",
                pops: 6,
            }),
            Some(Export {
                name: "ReadComm",
                pops: 8,
            }),
            Some(Export {
                name: "WriteComm",
                pops: 8,
            }),
            Some(Export {
                name: "TransmitCommChar",
                pops: 4,
            }),
            Some(Export {
                name: "CloseComm",
                pops: 2,
            }),
            Some(Export {
                name: "SetCommEventMask",
                pops: 4,
            }),
            Some(Export {
                name: "GetCommEventMask",
                pops: 4,
            }),
            Some(Export {
                name: "SetCommBreak",
                pops: 2,
            }),
            Some(Export {
                name: "ClearCommBreak",
                pops: 2,
            }),
            Some(Export {
                name: "UngetCommChar",
                pops: 4,
            }),
            Some(Export {
                name: "BuildCommDCB",
                pops: 8,
            }),
            Some(Export {
                name: "EscapeCommFunction",
                pops: 4,
            }),
            Some(Export {
                name: "FlushComm",
                pops: 4,
            }),
            Some(Export {
                name: "UserSeeUserDo",
                pops: 8,
            }),
            Some(Export {
                name: "LookupMenuHandle",
                pops: 4,
            }),
            Some(Export {
                name: "DialogBoxIndirect",
                pops: 10,
            }),
            Some(Export {
                name: "CreateDialogIndirect",
                pops: 12,
            }),
            Some(Export {
                name: "LoadMenuIndirect",
                pops: 4,
            }),
            Some(Export {
                name: "ScrollDC",
                pops: 20,
            }),
            Some(Export {
                name: "GetKeyboardState",
                pops: 4,
            }),
            Some(Export {
                name: "SetKeyboardState",
                pops: 4,
            }),
            Some(Export {
                name: "GetWindowTask",
                pops: 2,
            }),
            Some(Export {
                name: "EnumTaskWindows",
                pops: 10,
            }),
            Some(Export {
                name: "LockInput",
                pops: 6,
            }),
            Some(Export {
                name: "GetNextDlgGroupItem",
                pops: 6,
            }),
            Some(Export {
                name: "GetNextDlgTabItem",
                pops: 6,
            }),
            Some(Export {
                name: "GetTopWindow",
                pops: 2,
            }),
            Some(Export {
                name: "GetNextWindow",
                pops: 4,
            }),
            Some(Export {
                name: "GetSystemDebugState",
                pops: 0,
            }),
            Some(Export {
                name: "SetWindowPos",
                pops: 14,
            }),
            Some(Export {
                name: "SetParent",
                pops: 4,
            }),
            Some(Export {
                name: "UnhookWindowsHook",
                pops: 6,
            }),
            Some(Export {
                name: "DefHookProc",
                pops: 12,
            }),
            Some(Export {
                name: "GetCapture",
                pops: 0,
            }),
            Some(Export {
                name: "GetUpdateRgn",
                pops: 6,
            }),
            Some(Export {
                name: "ExcludeUpdateRgn",
                pops: 4,
            }),
            Some(Export {
                name: "DialogBoxParam",
                pops: 16,
            }),
            Some(Export {
                name: "DialogBoxIndirectParam",
                pops: 14,
            }),
            Some(Export {
                name: "CreateDialogParam",
                pops: 16,
            }),
            Some(Export {
                name: "CreateDialogIndirectParam",
                pops: 16,
            }),
            Some(Export {
                name: "GetDialogBaseUnits",
                pops: 0,
            }),
            Some(Export {
                name: "EqualRect",
                pops: 8,
            }),
            Some(Export {
                name: "EnableCommNotification",
                pops: 8,
            }),
            Some(Export {
                name: "ExitWindowsExec",
                pops: 8,
            }),
            Some(Export {
                name: "GetCursor",
                pops: 0,
            }),
            Some(Export {
                name: "GetOpenClipboardWindow",
                pops: 0,
            }),
            Some(Export {
                name: "GetAsyncKeyState",
                pops: 2,
            }),
            Some(Export {
                name: "GetMenuState",
                pops: 6,
            }),
            Some(Export {
                name: "SendDriverMessage",
                pops: 12,
            }),
            Some(Export {
                name: "OpenDriver",
                pops: 12,
            }),
            Some(Export {
                name: "CloseDriver",
                pops: 10,
            }),
            Some(Export {
                name: "GetDriverModuleHandle",
                pops: 2,
            }),
            Some(Export {
                name: "DefDriverProc",
                pops: 16,
            }),
            Some(Export {
                name: "GetDriverInfo",
                pops: 6,
            }),
            Some(Export {
                name: "GetNextDriver",
                pops: 6,
            }),
            Some(Export {
                name: "MapWindowPoints",
                pops: 10,
            }),
            Some(Export {
                name: "BeginDeferWindowPos",
                pops: 2,
            }),
            Some(Export {
                name: "DeferWindowPos",
                pops: 16,
            }),
            Some(Export {
                name: "EndDeferWindowPos",
                pops: 2,
            }),
            Some(Export {
                name: "GetWindow",
                pops: 4,
            }),
            Some(Export {
                name: "GetMenuItemCount",
                pops: 2,
            }),
            Some(Export {
                name: "GetMenuItemId",
                pops: 4,
            }),
            Some(Export {
                name: "ShowOwnedPopups",
                pops: 4,
            }),
            Some(Export {
                name: "SetMessageQueue",
                pops: 2,
            }),
            Some(Export {
                name: "ShowScrollBar",
                pops: 6,
            }),
            Some(Export {
                name: "GlobalAddAtom",
                pops: 4,
            }),
            Some(Export {
                name: "GlobalDeleteAtom",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalFindAtom",
                pops: 4,
            }),
            Some(Export {
                name: "GlobalGetAtomName",
                pops: 8,
            }),
            Some(Export {
                name: "IsZoomed",
                pops: 2,
            }),
            Some(Export {
                name: "ControlPanelInfo",
                pops: 8,
            }),
            Some(Export {
                name: "GetNextQueueWindow",
                pops: 4,
            }),
            Some(Export {
                name: "RepaintScreen",
                pops: 0,
            }),
            Some(Export {
                name: "LockMyTask",
                pops: 2,
            }),
            Some(Export {
                name: "GetDlgCtrlId",
                pops: 2,
            }),
            Some(Export {
                name: "GetDesktopHWnd",
                pops: 0,
            }),
            Some(Export {
                name: "OldSetDeskPattern",
                pops: 0,
            }),
            Some(Export {
                name: "SetSystemMenu",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "SelectPalette",
                pops: 6,
            }),
            Some(Export {
                name: "RealizePalette",
                pops: 2,
            }),
            Some(Export {
                name: "GetFreeSystemResources",
                pops: 2,
            }),
            Some(Export {
                name: "Bear285",
                pops: 4,
            }),
            Some(Export {
                name: "GetDesktopWindow",
                pops: 0,
            }),
            Some(Export {
                name: "GetLastActivePopup",
                pops: 2,
            }),
            Some(Export {
                name: "GetMessageExtraInfo",
                pops: 0,
            }),
            Some(Export {
                name: "Keybd_Event",
                pops: 0,
            }),
            Some(Export {
                name: "RedrawWindow",
                pops: 10,
            }),
            Some(Export {
                name: "SetWindowsHookEx",
                pops: 10,
            }),
            Some(Export {
                name: "UnhookWindowsHookEx",
                pops: 4,
            }),
            Some(Export {
                name: "CallNextHookEx",
                pops: 12,
            }),
            Some(Export {
                name: "LockWindowUpdate",
                pops: 2,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Mouse_Event",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "BozosLiveHere",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Bear306",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DefDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "GetClipCursor",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "SignalProc",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "ScrollWindowEx",
                pops: 22,
            }),
            Some(Export {
                name: "SysErrorBox",
                pops: 14,
            }),
            Some(Export {
                name: "SetEventHook",
                pops: 4,
            }),
            Some(Export {
                name: "WinOldAppHackomatic",
                pops: 4,
            }),
            Some(Export {
                name: "GetMessage2",
                pops: 14,
            }),
            Some(Export {
                name: "FillWindow",
                pops: 8,
            }),
            Some(Export {
                name: "PaintRect",
                pops: 12,
            }),
            Some(Export {
                name: "GetControlBrush",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "EnableHardwareInput",
                pops: 2,
            }),
            Some(Export {
                name: "UserYield",
                pops: 0,
            }),
            Some(Export {
                name: "IsUserIdle",
                pops: 0,
            }),
            Some(Export {
                name: "GetQueueStatus",
                pops: 2,
            }),
            Some(Export {
                name: "GetInputState",
                pops: 0,
            }),
            Some(Export {
                name: "LoadCursorIconHandler",
                pops: 6,
            }),
            Some(Export {
                name: "GetMouseEventProc",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "_FFFE_FARFRAME",
                pops: 2,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetFilePortName",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "LoadDibCursorHandler",
                pops: 6,
            }),
            Some(Export {
                name: "LoadDibIconHandler",
                pops: 6,
            }),
            Some(Export {
                name: "IsMenu",
                pops: 2,
            }),
            Some(Export {
                name: "GetDCEx",
                pops: 8,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DCHook",
                pops: 12,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "CopyIcon",
                pops: 4,
            }),
            Some(Export {
                name: "CopyCursor",
                pops: 4,
            }),
            Some(Export {
                name: "GetWindowPlacement",
                pops: 6,
            }),
            Some(Export {
                name: "SetWindowPlacement",
                pops: 6,
            }),
            Some(Export {
                name: "GetInternalIconHeader",
                pops: 8,
            }),
            Some(Export {
                name: "SubtractRect",
                pops: 12,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "FinalUserInit",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetPriorityClipboardFormat",
                pops: 6,
            }),
            Some(Export {
                name: "UnregisterClass",
                pops: 6,
            }),
            Some(Export {
                name: "GetClassInfo",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "CreateCursor",
                pops: 18,
            }),
            Some(Export {
                name: "CreateIcon",
                pops: 18,
            }),
            Some(Export {
                name: "CreateCursorIconIndirect",
                pops: 14,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "InsertMenu",
                pops: 12,
            }),
            Some(Export {
                name: "AppendMenu",
                pops: 10,
            }),
            Some(Export {
                name: "RemoveMenu",
                pops: 6,
            }),
            Some(Export {
                name: "DeleteMenu",
                pops: 6,
            }),
            Some(Export {
                name: "ModifyMenu",
                pops: 12,
            }),
            Some(Export {
                name: "CreatePopupMenu",
                pops: 0,
            }),
            Some(Export {
                name: "TrackPopupMenu",
                pops: 16,
            }),
            Some(Export {
                name: "GetMenuCheckmarkDimensions",
                pops: 0,
            }),
            Some(Export {
                name: "SetMenuItemBitmaps",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "_WSPRINTF",
                pops: 0,
            }),
            Some(Export {
                name: "WVSPRINTF",
                pops: 12,
            }),
            Some(Export {
                name: "DlgDirSelectEx",
                pops: 10,
            }),
            Some(Export {
                name: "DlgDirSelectComboBoxEx",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "lstrcmp",
                pops: 8,
            }),
            Some(Export {
                name: "AnsiUpper",
                pops: 4,
            }),
            Some(Export {
                name: "AnsiLower",
                pops: 4,
            }),
            Some(Export {
                name: "IsCharAlpha",
                pops: 2,
            }),
            Some(Export {
                name: "IsCharAlphanumeric",
                pops: 2,
            }),
            Some(Export {
                name: "IsCharUpper",
                pops: 2,
            }),
            Some(Export {
                name: "IsCharLower",
                pops: 2,
            }),
            Some(Export {
                name: "AnsiUpperBuff",
                pops: 6,
            }),
            Some(Export {
                name: "AnsiLowerBuff",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DefFrameProc",
                pops: 12,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "DefMDIChildProc",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "TranslateMDISysAccel",
                pops: 6,
            }),
            Some(Export {
                name: "CreateWindowEx",
                pops: 34,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "AdjustWindowRectEx",
                pops: 14,
            }),
            Some(Export {
                name: "GetIconID",
                pops: 6,
            }),
            Some(Export {
                name: "LoadIconHandler",
                pops: 4,
            }),
            Some(Export {
                name: "DestroyIcon",
                pops: 2,
            }),
            Some(Export {
                name: "DestroyCursor",
                pops: 2,
            }),
            Some(Export {
                name: "DumpIcon",
                pops: 16,
            }),
            Some(Export {
                name: "GetInternalWindowPos",
                pops: 10,
            }),
            Some(Export {
                name: "SetInternalWindowPos",
                pops: 12,
            }),
            Some(Export {
                name: "CalcChildScroll",
                pops: 4,
            }),
            Some(Export {
                name: "ScrollChildren",
                pops: 10,
            }),
            Some(Export {
                name: "DragObject",
                pops: 12,
            }),
            Some(Export {
                name: "DragDetect",
                pops: 6,
            }),
            Some(Export {
                name: "DrawFocusRect",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "StringFunc",
                pops: 8,
            }),
            Some(Export {
                name: "lstrcmpi",
                pops: 8,
            }),
            Some(Export {
                name: "AnsiNext",
                pops: 4,
            }),
            Some(Export {
                name: "AnsiPrev",
                pops: 8,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "GetUserLocalObjType",
                pops: 2,
            }),
            Some(Export {
                name: "Hardware_Event",
                pops: 0,
            }),
            Some(Export {
                name: "EnableScrollBar",
                pops: 6,
            }),
            Some(Export {
                name: "SystemParametersInfo",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "WNetErrorText",
                pops: 8,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "WNetOpenJob",
                pops: 14,
            }),
            Some(Export {
                name: "WNetCloseJob",
                pops: 10,
            }),
            Some(Export {
                name: "WNetAbortJob",
                pops: 6,
            }),
            Some(Export {
                name: "WNetHoldJob",
                pops: 6,
            }),
            Some(Export {
                name: "WNetReleaseJob",
                pops: 6,
            }),
            Some(Export {
                name: "WNetCancelJob",
                pops: 6,
            }),
            Some(Export {
                name: "WNetSetJobCopies",
                pops: 8,
            }),
            Some(Export {
                name: "WNetWatchQueue",
                pops: 12,
            }),
            Some(Export {
                name: "WNetUnwatchQueue",
                pops: 4,
            }),
            Some(Export {
                name: "WNetLockQueueData",
                pops: 12,
            }),
            Some(Export {
                name: "WNetUnlockQueueData",
                pops: 4,
            }),
            Some(Export {
                name: "WNetGetConnection",
                pops: 12,
            }),
            Some(Export {
                name: "WNetGetCaps",
                pops: 2,
            }),
            Some(Export {
                name: "WNetDeviceMode",
                pops: 2,
            }),
            Some(Export {
                name: "WNetBrowseDialog",
                pops: 8,
            }),
            Some(Export {
                name: "WNetGetUser",
                pops: 8,
            }),
            Some(Export {
                name: "WNetAddConnection",
                pops: 12,
            }),
            Some(Export {
                name: "WNetCancelConnection",
                pops: 6,
            }),
            Some(Export {
                name: "WNetGetError",
                pops: 4,
            }),
            Some(Export {
                name: "WNetGetErrorText",
                pops: 10,
            }),
            Some(Export {
                name: "WNetEnable",
                pops: 0,
            }),
            Some(Export {
                name: "WNetDisable",
                pops: 0,
            }),
            Some(Export {
                name: "WNetRestoreConnection",
                pops: 6,
            }),
            Some(Export {
                name: "WNetWriteJob",
                pops: 10,
            }),
            Some(Export {
                name: "WNetConnectDialog",
                pops: 4,
            }),
            Some(Export {
                name: "WNetDisconnectDialog",
                pops: 4,
            }),
            Some(Export {
                name: "WNetConnectionDialog",
                pops: 4,
            }),
            Some(Export {
                name: "WNetViewQueueDialog",
                pops: 6,
            }),
            Some(Export {
                name: "WNetPropertyDialog",
                pops: 8,
            }),
            Some(Export {
                name: "WNetGetDirectoryType",
                pops: 8,
            }),
            Some(Export {
                name: "WNetDirectoryNotify",
                pops: 8,
            }),
            Some(Export {
                name: "WNetGetPropertyText",
                pops: 8,
            }),
        ],
    },
    Kept {
        name: "MMSYSTEM",
        path: "C:\\WINDOWS\\SYSTEM\\MMSYSTEM.DLL",
        fixed: false,
        exports: &[
            None,
            Some(Export {
                name: "unknown",
                pops: 2,
            }),
            Some(Export {
                name: "sndPlaySound",
                pops: 6,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "mmsystemGetVersion",
                pops: 0,
            }),
            Some(Export {
                name: "DriverProc",
                pops: 16,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "OutputDebugStr",
                pops: 4,
            }),
            Some(Export {
                name: "DriverCallback",
                pops: 22,
            }),
            Some(Export {
                name: "StackEnter",
                pops: 0,
            }),
            Some(Export {
                name: "StackLeave",
                pops: 0,
            }),
            Some(Export {
                name: "mmDrvInstall",
                pops: 8,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "joyGetNumDevs",
                pops: 0,
            }),
            Some(Export {
                name: "joyGetDevCaps",
                pops: 8,
            }),
            Some(Export {
                name: "joyGetPos",
                pops: 6,
            }),
            Some(Export {
                name: "joyGetThreshold",
                pops: 6,
            }),
            Some(Export {
                name: "joyReleaseCapture",
                pops: 2,
            }),
            Some(Export {
                name: "joySetCapture",
                pops: 8,
            }),
            Some(Export {
                name: "joySetThreshold",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "joySetCalibration",
                pops: 26,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "midiOutGetNumDevs",
                pops: 0,
            }),
            Some(Export {
                name: "midiOutGetDevCaps",
                pops: 8,
            }),
            Some(Export {
                name: "midiOutGetErrorText",
                pops: 8,
            }),
            Some(Export {
                name: "midiOutOpen",
                pops: 18,
            }),
            Some(Export {
                name: "midiOutClose",
                pops: 2,
            }),
            Some(Export {
                name: "midiOutPrepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "midiOutUnprepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "midiOutShortMsg",
                pops: 6,
            }),
            Some(Export {
                name: "midiOutLongMsg",
                pops: 8,
            }),
            Some(Export {
                name: "midiOutReset",
                pops: 2,
            }),
            Some(Export {
                name: "midiOutGetVolume",
                pops: 6,
            }),
            Some(Export {
                name: "midiOutSetVolume",
                pops: 6,
            }),
            Some(Export {
                name: "midiOutCachePatches",
                pops: 10,
            }),
            Some(Export {
                name: "midiOutCacheDrumPatches",
                pops: 10,
            }),
            Some(Export {
                name: "midiOutGetID",
                pops: 6,
            }),
            Some(Export {
                name: "midiOutMessage",
                pops: 12,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "midiInGetNumDevs",
                pops: 0,
            }),
            Some(Export {
                name: "midiInGetDevCaps",
                pops: 8,
            }),
            Some(Export {
                name: "midiInGetErrorText",
                pops: 8,
            }),
            Some(Export {
                name: "midiInOpen",
                pops: 18,
            }),
            Some(Export {
                name: "midiInClose",
                pops: 2,
            }),
            Some(Export {
                name: "midiInPrepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "midiInUnprepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "midiInAddBuffer",
                pops: 8,
            }),
            Some(Export {
                name: "midiInStart",
                pops: 2,
            }),
            Some(Export {
                name: "midiInStop",
                pops: 2,
            }),
            Some(Export {
                name: "midiInReset",
                pops: 2,
            }),
            Some(Export {
                name: "midiInGetID",
                pops: 6,
            }),
            Some(Export {
                name: "midiInMessage",
                pops: 12,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "auxGetNumDevs",
                pops: 0,
            }),
            Some(Export {
                name: "auxGetDevCaps",
                pops: 8,
            }),
            Some(Export {
                name: "auxGetVolume",
                pops: 6,
            }),
            Some(Export {
                name: "auxSetVolume",
                pops: 6,
            }),
            Some(Export {
                name: "auxOutMessage",
                pops: 12,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "waveOutGetNumDevs",
                pops: 0,
            }),
            Some(Export {
                name: "waveOutGetDevCaps",
                pops: 8,
            }),
            Some(Export {
                name: "waveOutGetErrorText",
                pops: 8,
            }),
            Some(Export {
                name: "waveOutOpen",
                pops: 22,
            }),
            Some(Export {
                name: "waveOutClose",
                pops: 2,
            }),
            Some(Export {
                name: "waveOutPrepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "waveOutUnprepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "waveOutWrite",
                pops: 8,
            }),
            Some(Export {
                name: "waveOutPause",
                pops: 2,
            }),
            Some(Export {
                name: "waveOutRestart",
                pops: 2,
            }),
            Some(Export {
                name: "waveOutReset",
                pops: 2,
            }),
            Some(Export {
                name: "waveOutGetPosition",
                pops: 8,
            }),
            Some(Export {
                name: "waveOutGetPitch",
                pops: 6,
            }),
            Some(Export {
                name: "waveOutSetPitch",
                pops: 6,
            }),
            Some(Export {
                name: "waveOutGetVolume",
                pops: 6,
            }),
            Some(Export {
                name: "waveOutSetVolume",
                pops: 6,
            }),
            Some(Export {
                name: "waveOutGetPlaybackRate",
                pops: 6,
            }),
            Some(Export {
                name: "waveOutSetPlaybackRate",
                pops: 6,
            }),
            Some(Export {
                name: "waveOutBreakLoop",
                pops: 2,
            }),
            Some(Export {
                name: "waveOutGetID",
                pops: 6,
            }),
            Some(Export {
                name: "waveOutMessage",
                pops: 12,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "waveInGetNumDevs",
                pops: 0,
            }),
            Some(Export {
                name: "waveInGetDevCaps",
                pops: 8,
            }),
            Some(Export {
                name: "waveInGetErrorText",
                pops: 8,
            }),
            Some(Export {
                name: "waveInOpen",
                pops: 22,
            }),
            Some(Export {
                name: "waveInClose",
                pops: 2,
            }),
            Some(Export {
                name: "waveInPrepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "waveInUnprepareHeader",
                pops: 8,
            }),
            Some(Export {
                name: "waveInAddBuffer",
                pops: 8,
            }),
            Some(Export {
                name: "waveInStart",
                pops: 2,
            }),
            Some(Export {
                name: "waveInStop",
                pops: 2,
            }),
            Some(Export {
                name: "waveInReset",
                pops: 2,
            }),
            Some(Export {
                name: "waveInGetPosition",
                pops: 8,
            }),
            Some(Export {
                name: "waveInGetID",
                pops: 6,
            }),
            Some(Export {
                name: "waveInMessage",
                pops: 12,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "timeGetSystemTime",
                pops: 6,
            }),
            Some(Export {
                name: "timeSetEvent",
                pops: 14,
            }),
            Some(Export {
                name: "timeKillEvent",
                pops: 2,
            }),
            Some(Export {
                name: "timeGetDevCaps",
                pops: 6,
            }),
            Some(Export {
                name: "timeBeginPeriod",
                pops: 2,
            }),
            Some(Export {
                name: "timeEndPeriod",
                pops: 2,
            }),
            Some(Export {
                name: "timeGetTime",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "mciSendCommand",
                pops: 12,
            }),
            Some(Export {
                name: "mciSendString",
                pops: 12,
            }),
            Some(Export {
                name: "mciGetDeviceID",
                pops: 4,
            }),
            Some(Export {
                name: "mciParseCommand",
                pops: 0,
            }),
            Some(Export {
                name: "mciLoadCommandResource",
                pops: 8,
            }),
            Some(Export {
                name: "mciGetErrorString",
                pops: 10,
            }),
            Some(Export {
                name: "mciSetDriverData",
                pops: 6,
            }),
            Some(Export {
                name: "mciGetDriverData",
                pops: 2,
            }),
            None,
            Some(Export {
                name: "MCIDRIVERYIELD",
                pops: 2,
            }),
            None,
            Some(Export {
                name: "MCIEXECUTE",
                pops: 4,
            }),
            Some(Export {
                name: "MCIFREECOMMANDRESOURCE",
                pops: 2,
            }),
            Some(Export {
                name: "MCISETYIELDPROC",
                pops: 10,
            }),
            Some(Export {
                name: "MCIGETDEVICEIDFROMELEMENTID",
                pops: 8,
            }),
            Some(Export {
                name: "MCIGETYIELDPROC",
                pops: 6,
            }),
            Some(Export {
                name: "MCIGETCREATORTASK",
                pops: 2,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "MMTASKCREATE",
                pops: 12,
            }),
            None,
            Some(Export {
                name: "MMTASKBLOCK",
                pops: 2,
            }),
            None,
            None,
            Some(Export {
                name: "MMTASKYIELD",
                pops: 0,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "MMIOOPEN",
                pops: 12,
            }),
            Some(Export {
                name: "MMIOCLOSE",
                pops: 4,
            }),
            Some(Export {
                name: "MMIOREAD",
                pops: 10,
            }),
            Some(Export {
                name: "MMIOWRITE",
                pops: 10,
            }),
            Some(Export {
                name: "MMIOSEEK",
                pops: 8,
            }),
            Some(Export {
                name: "MMIOGETINFO",
                pops: 8,
            }),
            Some(Export {
                name: "MMIOSETINFO",
                pops: 8,
            }),
            Some(Export {
                name: "MMIOSETBUFFER",
                pops: 12,
            }),
            Some(Export {
                name: "MMIOFLUSH",
                pops: 4,
            }),
            Some(Export {
                name: "MMIOADVANCE",
                pops: 8,
            }),
            Some(Export {
                name: "MMIOSTRINGTOFOURCC",
                pops: 6,
            }),
            Some(Export {
                name: "MMIOINSTALLIOPROC",
                pops: 12,
            }),
            Some(Export {
                name: "MMIOSENDMESSAGE",
                pops: 12,
            }),
            Some(Export {
                name: "MMIODESCEND",
                pops: 12,
            }),
            Some(Export {
                name: "MMIOASCEND",
                pops: 8,
            }),
            Some(Export {
                name: "MMIOCREATECHUNK",
                pops: 8,
            }),
            Some(Export {
                name: "MMIORENAME",
                pops: 16,
            }),
        ],
    },
    Kept {
        name: "SOUND",
        path: "C:\\WINDOWS\\SYSTEM\\SOUND.DRV",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "OpenSound",
                pops: 0,
            }),
            Some(Export {
                name: "CloseSound",
                pops: 0,
            }),
            Some(Export {
                name: "SetVoiceQueueSize",
                pops: 4,
            }),
            Some(Export {
                name: "SetVoiceNote",
                pops: 8,
            }),
            Some(Export {
                name: "SetVoiceAccent",
                pops: 10,
            }),
            Some(Export {
                name: "SetVoiceEnvelope",
                pops: 6,
            }),
            Some(Export {
                name: "SetSoundNoise",
                pops: 4,
            }),
            Some(Export {
                name: "SetVoiceSound",
                pops: 8,
            }),
            Some(Export {
                name: "StartSound",
                pops: 0,
            }),
            Some(Export {
                name: "StopSound",
                pops: 0,
            }),
            Some(Export {
                name: "WaitSoundState",
                pops: 2,
            }),
            Some(Export {
                name: "SyncAllVoices",
                pops: 0,
            }),
            Some(Export {
                name: "CountVoiceNotes",
                pops: 2,
            }),
            Some(Export {
                name: "GetThresholdEvent",
                pops: 0,
            }),
            Some(Export {
                name: "GetThresholdStatus",
                pops: 0,
            }),
            Some(Export {
                name: "SetVoiceThreshold",
                pops: 4,
            }),
            Some(Export {
                name: "DoBeep",
                pops: 2,
            }),
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
        ],
    },
    Kept {
        name: "WIN87EM",
        path: "C:\\WINDOWS\\SYSTEM\\WIN87EM.DLL",
        fixed: false,
        exports: &[
            None,
            Some(Export {
                name: "__FPMATH",
                pops: 0,
            }),
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            Some(Export {
                name: "__WIN87EMINFO",
                pops: 6,
            }),
            Some(Export {
                name: "__WIN87EMRESTORE",
                pops: 6,
            }),
            Some(Export {
                name: "__WIN87EMSAVE",
                pops: 6,
            }),
        ],
    },
    Kept {
        name: "WING",
        path: "C:\\WINDOWS\\SYSTEM\\WING.DLL",
        fixed: false,
        exports: &[
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "WinGCreateDC",
                pops: 0,
            }),
            Some(Export {
                name: "WinGRecommendedDIBFormat",
                pops: 4,
            }),
            Some(Export {
                name: "WinGCreateBitmap",
                pops: 10,
            }),
            Some(Export {
                name: "WinGGetDIBPointer",
                pops: 6,
            }),
            Some(Export {
                name: "WinGGetDIBColorTable",
                pops: 10,
            }),
            Some(Export {
                name: "WinGSetDIBColorTable",
                pops: 10,
            }),
            Some(Export {
                name: "WinGCreateHalftonePalette",
                pops: 0,
            }),
            Some(Export {
                name: "WinGCreateHalftoneBrush",
                pops: 8,
            }),
            Some(Export {
                name: "WinGStretchBlt",
                pops: 20,
            }),
            Some(Export {
                name: "WinGBitBlt",
                pops: 16,
            }),
        ],
    },
    Kept {
        name: "COMMDLG",
        path: "C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL",
        fixed: false,
        exports: &[
            None,
            Some(Export {
                name: "GetOpenFilename",
                pops: 4,
            }),
            Some(Export {
                name: "GetSaveFilename",
                pops: 4,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "ChooseColor",
                pops: 4,
            }),
            Some(Export {
                name: "FileOpenDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "FileSaveDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "ColorDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "LoadAlterBitmap",
                pops: 10,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "FindText",
                pops: 4,
            }),
            Some(Export {
                name: "ReplaceText",
                pops: 4,
            }),
            Some(Export {
                name: "FindTextDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "ReplaceTextDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "ChooseFont",
                pops: 4,
            }),
            Some(Export {
                name: "FormatCharDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "FontStyleEnumProc",
                pops: 14,
            }),
            Some(Export {
                name: "FontFamilyEnumProc",
                pops: 14,
            }),
            Some(Export {
                name: "PrintDlg",
                pops: 4,
            }),
            Some(Export {
                name: "PrintDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "PrintSetupDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "EditIntegerOnly",
                pops: 10,
            }),
            Some(Export {
                name: "unknown",
                pops: 0,
            }),
            Some(Export {
                name: "WantArrows",
                pops: 10,
            }),
            Some(Export {
                name: "CommDlgExtendedError",
                pops: 0,
            }),
            Some(Export {
                name: "GetFileTitle",
                pops: 10,
            }),
            Some(Export {
                name: "unknown",
                pops: 2,
            }),
            Some(Export {
                name: "dwLBSubclass",
                pops: 10,
            }),
            Some(Export {
                name: "dwUpArrowHack",
                pops: 10,
            }),
            Some(Export {
                name: "dwOKSubclass",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 2,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 2,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 12,
            }),
            Some(Export {
                name: "Unknown",
                pops: 2,
            }),
            Some(Export {
                name: "Unknown",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
        ],
    },
    Kept {
        name: "SHELL",
        path: "C:\\WINDOWS\\SYSTEM\\SHELL.DLL",
        fixed: false,
        exports: &[
            None,
            Some(Export {
                name: "RegOpenKey",
                pops: 12,
            }),
            Some(Export {
                name: "RegCreateKey",
                pops: 12,
            }),
            Some(Export {
                name: "RegCloseKey",
                pops: 4,
            }),
            Some(Export {
                name: "RegDeleteKey",
                pops: 8,
            }),
            Some(Export {
                name: "RegSetValue",
                pops: 20,
            }),
            Some(Export {
                name: "RegQueryValue",
                pops: 16,
            }),
            Some(Export {
                name: "RegEnumKey",
                pops: 16,
            }),
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            Some(Export {
                name: "DragAcceptFiles",
                pops: 4,
            }),
            None,
            Some(Export {
                name: "DragQueryFile",
                pops: 10,
            }),
            Some(Export {
                name: "DragFinish",
                pops: 2,
            }),
            Some(Export {
                name: "DragQueryPoint",
                pops: 6,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "ShellExecute",
                pops: 20,
            }),
            Some(Export {
                name: "FindExecutable",
                pops: 12,
            }),
            Some(Export {
                name: "ShellAbout",
                pops: 12,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "WCI",
                pops: 10,
            }),
            Some(Export {
                name: "AboutDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "ExtractIcon",
                pops: 8,
            }),
            None,
            Some(Export {
                name: "ExtractAssociatedIcon",
                pops: 10,
            }),
            Some(Export {
                name: "DoEnvironmentSubst",
                pops: 6,
            }),
            Some(Export {
                name: "FindEnvironmentString",
                pops: 4,
            }),
            Some(Export {
                name: "InternalExtractIcon",
                pops: 10,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "HERETHARBETYGARS",
                pops: 10,
            }),
            Some(Export {
                name: "FindExeDlgProc",
                pops: 10,
            }),
            Some(Export {
                name: "RegisterShellHook",
                pops: 4,
            }),
            Some(Export {
                name: "ShellHookProc",
                pops: 8,
            }),
            Some(Export {
                name: "Unknown",
                pops: 2,
            }),
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 2,
            }),
            None,
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 8,
            }),
            Some(Export {
                name: "Unknown",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            Some(Export {
                name: "Unknown",
                pops: 6,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
            None,
            Some(Export {
                name: "Unknown",
                pops: 4,
            }),
            None,
            None,
            Some(Export {
                name: "Unknown",
                pops: 0,
            }),
            Some(Export {
                name: "Unknown",
                pops: 10,
            }),
        ],
    },
    Kept {
        name: "KEYBOARD",
        path: "C:\\WINDOWS\\SYSTEM\\KEYBOARD.DRV",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "Inquire",
                pops: 4,
            }),
            Some(Export {
                name: "Enable",
                pops: 8,
            }),
            Some(Export {
                name: "Disable",
                pops: 0,
            }),
            Some(Export {
                name: "ToAscii",
                pops: 14,
            }),
            Some(Export {
                name: "AnsiToOem",
                pops: 8,
            }),
            Some(Export {
                name: "OemToAnsi",
                pops: 8,
            }),
            Some(Export {
                name: "SetSpeed",
                pops: 2,
            }),
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "ScreenSwitchEnable",
                pops: 2,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "GetTableSeg",
                pops: 0,
            }),
            Some(Export {
                name: "NewTable",
                pops: 0,
            }),
            Some(Export {
                name: "OemKeyScan",
                pops: 2,
            }),
            Some(Export {
                name: "VkKeyScan",
                pops: 2,
            }),
            Some(Export {
                name: "GetKeyboardType",
                pops: 2,
            }),
            Some(Export {
                name: "MapVirtualKey",
                pops: 4,
            }),
            Some(Export {
                name: "GetKbCodePage",
                pops: 0,
            }),
            Some(Export {
                name: "GetKeyNameText",
                pops: 10,
            }),
            Some(Export {
                name: "AnsiToOemBuff",
                pops: 10,
            }),
            Some(Export {
                name: "OemToAnsiBuff",
                pops: 10,
            }),
            Some(Export {
                name: "EnableKBSysReq",
                pops: 2,
            }),
            Some(Export {
                name: "GetBIOSKeyProc",
                pops: 0,
            }),
        ],
    },
    Kept {
        name: "SYSTEM",
        path: "C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "InquireSystem",
                pops: 4,
            }),
            Some(Export {
                name: "CreateSystemTimer",
                pops: 6,
            }),
            Some(Export {
                name: "KillSystemTimer",
                pops: 2,
            }),
            Some(Export {
                name: "EnableSystemTimers",
                pops: 0,
            }),
            Some(Export {
                name: "DisableSystemTimers",
                pops: 0,
            }),
            Some(Export {
                name: "GetSystemMSecCount",
                pops: 0,
            }),
            Some(Export {
                name: "Get80x87SaveSize",
                pops: 0,
            }),
            Some(Export {
                name: "Save80x87State",
                pops: 4,
            }),
            Some(Export {
                name: "Restore80x87State",
                pops: 4,
            }),
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "A20_Proc",
                pops: 2,
            }),
        ],
    },
    Kept {
        name: "DISPLAY",
        path: "C:\\WINDOWS\\SYSTEM\\VGA.DRV",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "BitBlt",
                pops: 32,
            }),
            Some(Export {
                name: "ColorInfo",
                pops: 12,
            }),
            Some(Export {
                name: "Control",
                pops: 14,
            }),
            Some(Export {
                name: "Disable",
                pops: 4,
            }),
            Some(Export {
                name: "Enable",
                pops: 18,
            }),
            Some(Export {
                name: "EnumDFonts",
                pops: 16,
            }),
            Some(Export {
                name: "EnumObj",
                pops: 14,
            }),
            Some(Export {
                name: "Output",
                pops: 28,
            }),
            Some(Export {
                name: "Pixel",
                pops: 16,
            }),
            Some(Export {
                name: "RealizeObject",
                pops: 18,
            }),
            Some(Export {
                name: "StrBlt",
                pops: 40,
            }),
            Some(Export {
                name: "ScanLR",
                pops: 14,
            }),
            Some(Export {
                name: "DeviceMode",
                pops: 12,
            }),
            Some(Export {
                name: "ExtTextOut",
                pops: 40,
            }),
            Some(Export {
                name: "GetCharWidth",
                pops: 24,
            }),
            Some(Export {
                name: "DeviceBitmap",
                pops: 14,
            }),
            Some(Export {
                name: "FastBorder",
                pops: 28,
            }),
            Some(Export {
                name: "SetAttribute",
                pops: 12,
            }),
            Some(Export {
                name: "DeviceBitmapBits",
                pops: 26,
            }),
            Some(Export {
                name: "CreateBitmap",
                pops: 0,
            }),
            Some(Export {
                name: "DIBScreenBlt",
                pops: 32,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "Do_Polylines",
                pops: 28,
            }),
            Some(Export {
                name: "Do_Scanlines",
                pops: 28,
            }),
            Some(Export {
                name: "SaveScreenBitmap",
                pops: 6,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "Inquire",
                pops: 4,
            }),
            Some(Export {
                name: "SetCursor",
                pops: 4,
            }),
            Some(Export {
                name: "MoveCursor",
                pops: 4,
            }),
            Some(Export {
                name: "CheckCursor",
                pops: 0,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "PExtTextOut",
                pops: 40,
            }),
            Some(Export {
                name: "PStrBlt",
                pops: 40,
            }),
            Some(Export {
                name: "RExtTextOut",
                pops: 40,
            }),
            Some(Export {
                name: "RStrBlt",
                pops: 40,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "UserRepaintDisable",
                pops: 2,
            }),
            Some(Export { name: "", pops: 34 }),
        ],
    },
    Kept {
        name: "TOOLHELP",
        path: "C:\\WINDOWS\\SYSTEM\\TOOLHELP.DLL",
        fixed: false,
        exports: &[
            None,
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(Export {
                name: "GlobalHandleToSel",
                pops: 2,
            }),
            Some(Export {
                name: "GlobalFirst",
                pops: 6,
            }),
            Some(Export {
                name: "GlobalNext",
                pops: 6,
            }),
            Some(Export {
                name: "GlobalInfo",
                pops: 4,
            }),
            Some(Export {
                name: "GlobalEntryHandle",
                pops: 6,
            }),
            Some(Export {
                name: "GlobalEntryModule",
                pops: 8,
            }),
            Some(Export {
                name: "LocalInfo",
                pops: 6,
            }),
            Some(Export {
                name: "LocalFirst",
                pops: 6,
            }),
            Some(Export {
                name: "LocalNext",
                pops: 4,
            }),
            Some(Export {
                name: "ModuleFirst",
                pops: 4,
            }),
            Some(Export {
                name: "ModuleNext",
                pops: 4,
            }),
            Some(Export {
                name: "ModuleFindName",
                pops: 8,
            }),
            Some(Export {
                name: "ModuleFindHandle",
                pops: 6,
            }),
            Some(Export {
                name: "TaskFirst",
                pops: 4,
            }),
            Some(Export {
                name: "TaskNext",
                pops: 4,
            }),
            Some(Export {
                name: "TaskFindHandle",
                pops: 6,
            }),
            Some(Export {
                name: "StackTraceFirst",
                pops: 6,
            }),
            Some(Export {
                name: "StackTraceCSIPFirst",
                pops: 12,
            }),
            Some(Export {
                name: "StackTraceNext",
                pops: 4,
            }),
            Some(Export {
                name: "ClassFirst",
                pops: 4,
            }),
            Some(Export {
                name: "ClassNext",
                pops: 4,
            }),
            Some(Export {
                name: "SystemHeapInfo",
                pops: 4,
            }),
            Some(Export {
                name: "MemManInfo",
                pops: 4,
            }),
            Some(Export {
                name: "NotifyRegister",
                pops: 8,
            }),
            Some(Export {
                name: "NotifyUnRegister",
                pops: 2,
            }),
            Some(Export {
                name: "InterruptRegister",
                pops: 6,
            }),
            Some(Export {
                name: "InterruptUnRegister",
                pops: 2,
            }),
            Some(Export {
                name: "TerminateApp",
                pops: 4,
            }),
            Some(Export {
                name: "MemoryRead",
                pops: 14,
            }),
            Some(Export {
                name: "MemoryWrite",
                pops: 14,
            }),
            Some(Export {
                name: "TimerCount",
                pops: 4,
            }),
            Some(Export {
                name: "TaskSetCSIP",
                pops: 6,
            }),
            Some(Export {
                name: "TaskGetCSIP",
                pops: 2,
            }),
            Some(Export {
                name: "TaskSwitch",
                pops: 6,
            }),
        ],
    },
    Kept {
        name: "TIMER",
        path: "C:\\WINDOWS\\SYSTEM\\TIMER.DRV",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            Some(Export {
                name: "DriverProc",
                pops: 16,
            }),
        ],
    },
    Kept {
        name: "MCIWAVE",
        path: "C:\\WINDOWS\\SYSTEM\\MCIWAVE.DRV",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            Some(Export {
                name: "DriverProc",
                pops: 16,
            }),
        ],
    },
    Kept {
        name: "MCISEQ",
        path: "C:\\WINDOWS\\SYSTEM\\MCISEQ.DRV",
        fixed: true,
        exports: &[
            None,
            Some(Export {
                name: "WEP",
                pops: 2,
            }),
            Some(Export {
                name: "DriverProc",
                pops: 16,
            }),
        ],
    },
];
