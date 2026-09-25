'use strict';

/**
 * A Windows task's DOS environment, as the `environ` probe recorded it.
 *
 * The DOS host's variables come first, then `windir` -- Windows' own, in
 * lower case, last -- then the zero that ends them, a word count of 1, and
 * the path of the program DOS started. That is the kernel's path and not the
 * task's: every task inherits the environment the kernel was given. A C
 * runtime's start-up walks exactly this for its program's path, past the first
 * two zeros in a row and then the count.
 *
 * There is no DOS shell under this Windows to lend it variables, so the host
 * gives none and `windir` is the only one. Under DOSBox the recording had
 * `PATH`, `COMSPEC` and `BLASTER` before it.
 *
 * @param {string} windowsDirectory - Where Windows is, as `windir` gives it.
 * @param {string[]} host - The DOS host's variables, `NAME=value` each.
 * @returns {Uint8Array} The environment's bytes.
 */
export function taskEnvironment(windowsDirectory: string, host: string[] = []): Uint8Array {
  const kernel = `${windowsDirectory}\\SYSTEM\\KRNL386.EXE`;
  const bytes: number[] = [];

  for (const variable of [...host, `windir=${windowsDirectory}`]) {
    for (const character of variable) {
      bytes.push(character.charCodeAt(0) & 0xff);
    }

    bytes.push(0);
  }

  bytes.push(0, 1, 0);

  for (const character of kernel) {
    bytes.push(character.charCodeAt(0) & 0xff);
  }

  bytes.push(0);

  return new Uint8Array(bytes);
}
