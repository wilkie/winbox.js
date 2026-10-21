'use strict';

export class Module {}

/**
 * The Windows version the module of a handle or instance was made for, as
 * `CreateWindow` asks `GetExpWinVer` of the instance it is given (`USER.EXE`
 * seg8 `0425`-`0432`): its file's header's (word 3Eh), or one a module
 * WinBox keeps says of itself -- `COMMDLG`'s with no file, `COMMDLG.DLL`'s
 * 3.00, as its dialogs are made with its instance. Undefined for any other.
 * As the Rust engine's `System::expected_windows_version`.
 */
export function expectedWindowsVersion(system: any, handle: number): number | undefined {
  const module = system.handles.resolve(handle);

  return module?.executable?.neHeader?.expectedWindowsVersion ?? module?.expectedWindowsVersion;
}

/**
 * The Windows version the module of the instance a window was made with
 * was made for: its `CREATESTRUCT`'s instance, as `CreateWindow` was given
 * it, where `window.data.hInstance` is its task's. 3.10 where it has none,
 * as the Rust engine's `expected_version` answers.
 */
export function windowVersion(system: any, window: any): number {
  const instance = window?._createStruct?.hInstance ?? window?.data?.hInstance ?? 0;

  return expectedWindowsVersion(system, instance) ?? 0x30a;
}
