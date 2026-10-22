'use strict';

export class Module {}

/**
 * The Windows version the module of a handle or instance was made for, as
 * `CreateWindow` asks `GetExpWinVer` of the instance it is given (`USER.EXE`
 * seg8 `0425`-`0432`): its file's header's (word 3Eh); or one a module
 * WinBox keeps says of itself -- KERNEL's 3.10, which KERNEL sets on itself
 * as it starts, and `COMMDLG`'s with no file, `COMMDLG.DLL`'s 3.00, as its
 * dialogs are made with its instance; or, for another kept module, its
 * file's header's, the installation's or the asset bundle's, read as the
 * system starts (`Win16.keptVersions`); or, for one with no file there,
 * the version its file has on the installation (`KEPT_VERSIONS`). Undefined
 * for any other. As the Rust engine's `System::expected_windows_version`.
 */
export function expectedWindowsVersion(system: any, handle: number): number | undefined {
  const module = system.handles.resolve(handle);

  return (
    module?.executable?.neHeader?.expectedWindowsVersion ??
    module?.expectedWindowsVersion ??
    module?.fileWindowsVersion ??
    (module && !module.executable && typeof module.path === 'string'
      ? KEPT_VERSIONS[String(module.name).toUpperCase()]
      : undefined)
  );
}

/**
 * The Windows version of each module WinBox keeps, as its file on the
 * installation says (its NE header's word 3Eh), for a base with no file of
 * it, as the asset bundle's has none of most: WinBox's stand-in carries
 * its file's version, as `COMMDLG`'s does. KERNEL's own is the Windows
 * version, 3.10 (`Kernel.expectedWindowsVersion`). As the Rust engine's
 * `kept_version`.
 */
export const KEPT_VERSIONS: Record<string, number> = {
  COMMDLG: 0x300,
  DDEML: 0x300,
  LZEXPAND: 0x300,
  TOOLHELP: 0x300,
  VER: 0x300,
  WIN87EM: 0x300,
  SHELL: 0x300,
  GDI: 0x30a,
  USER: 0x30a,
  KEYBOARD: 0x30a,
  MMSYSTEM: 0x30a,
  SOUND: 0x30a,
  SYSTEM: 0x30a,
  TIMER: 0x30a,
  MCISEQ: 0x30a,
  MCIWAVE: 0x30a,
  WING: 0x30a,
  DISPLAY: 0x30a,
};

/**
 * KERNEL's flag 2000h of the module of a handle or instance, which
 * `GetExpWinVer` answers in DX (`KRNL386.EXE` seg1 `4f1a`-`4f1f`): set as
 * `LoadModule` loads a file whose header's byte 37h has 02h (seg2
 * `0ed9`-`0edc`, `1271`-`1279`), a Windows 2 program marked to run in
 * protected mode; a file whose own flags have 2000h is refused (seg2
 * `0ebd`-`0ec2`). No file of the installation, the probes or the corpus has
 * it. Nought for a kept module with no file. As the Rust engine's
 * `System::module_flag_2000`.
 */
export function moduleFlag2000(system: any, handle: number): number {
  const module = system.handles.resolve(handle);
  const others = module?.executable?.neHeader?.OS2Flags ?? module?.fileOtherFlags ?? 0;

  return others & 0x02 ? 0x2000 : 0;
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
