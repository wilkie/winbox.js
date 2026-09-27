'use strict';

/**
 * The file a module was loaded from, as a full path, copied with its null to
 * `lpszFilename`, no more than `cbFileName` bytes in all: a program's, or a
 * library's by the instance `LoadLibrary` gave or the module
 * `GetModuleHandle` found. A handle that names neither answers for the
 * running task.
 *
 * @param {Types.HINSTANCE} hinst - The module or instance.
 * @param {Types.FARPTR} lpszFilename - Where the path goes.
 * @param {Types.INT} cbFileName - The room there, in bytes.
 *
 * @returns {Types.INT} How many bytes were copied, the null not counted.
 */
export function GetModuleFilename(hinst, lpszFilename, cbFileName) {
  const item = hinst ? this.handles.resolve(hinst) : null;
  const task = this.handles.resolve(this.scheduler.active);
  const filename = String(
    item?.executable?.path ?? item?.loader?.path ?? item?.path ?? task.executable.path
  );

  const cpu = this.machine.cpu.core;

  const destSegment = (lpszFilename >> 16) & 0xffff;
  let destOffset = lpszFilename & 0xffff;

  if (cbFileName == 0) {
    return 0;
  }

  let count = 0;
  for (let i = 0; i < filename.length && i < cbFileName - 1; i++) {
    cpu.write8(destSegment, destOffset, filename.charCodeAt(i));
    destOffset++;
    count++;
  }

  cpu.write8(destSegment, destOffset, 0x0);

  return count;
}
