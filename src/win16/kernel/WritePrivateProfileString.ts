'use strict';

import { Profile } from '../profile.js';
import { readProfile, releaseProfile, writeProfile } from './profiles.js';
/**
 * The **WritePrivateProfileString** function copies a character string into the
 * specified section of the specified initialization file.
 *
 * To improve performance, the system keeps a cached version of the
 * most-recently accessed initialization file. If that filename is specified and
 * the other three parameters are `NULL`, the system flushes the cache.
 *
 * Sections in the initialization file have the following form:
 *
 *   [ section ]
 *   entry = string
 *
 * If `lpszFilename` does not contain a fully qualified path and filename for
 * the file, **WritePrivateProfileString** searches the system directory for the
 * file. If the file does not exist, this function creates the file in the
 * system directory.
 *
 * If `lpszFilename` contains a fully qualified path and filename and the file
 * does not exist, this function creates the file. The specified directory must
 * already exist.
 *
 * An application should use a private (application-specific) initialization
 * file to record information that affects only that application. This improves
 * the performance of both the application and the system itself by reducing the
 * amount of information that the system must read when it accesses the
 * initialization file. The exception to this is that device drivers should use
 * the `SYSTEM.INI` file, to reduce the number of initialization files the
 * system must open and read during the startup process.
 *
 * An application can use the
 * {@link Kernel.WriteProfileString WriteProfileString} function to add a string
 * to the `WIN.INI` file.
 *
 * **See also**:
 * {@link Kernel.GetPrivateProfileString GetPrivateProfileString}
 * {@link Kernel.WriteProfileString WriteProfileString}
 *
 * @static
 * @function WritePrivateProfileString
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszSection - Points to a null-terminated string that
 *                                     specifies the section to which the string
 *                                     will be copied. If the section does not
 *                                     exist, it is created. The name of the
 *                                     section is case-independent; the string
 *                                     may be any combination of uppercase and
 *                                     lowercase letters.
 * @param {Types.LPCSTR} lpszEntry - Points to a null-terminated string
 *                                   containing the entry to be associated with
 *                                   the string. If the entry does not exist in
 *                                   the specified section, it is created. If
 *                                   this parameter is `NULL`, the entire
 *                                   section, including all entries with the
 *                                   section, is deleted.
 * @param {Types.LPCSTR} lpszString - Points to a null-terminated string to be
 *                                    written to the file. If this parameter is
 *                                    `NULL`, the entry specified by the
 *                                    `lpszEntry` parameter is deleted.
 * @param {Types.LPCSTR} lpszFilename - Points to a null-terminated string that
 *                                      names the initialization file.
 *
 * @returns {Types.BOOL} The return value is nonzero if the function is
 *                       successful. Otherwise it is zero.
 */
export async function WritePrivateProfileString(lpszSection, lpszEntry, lpszString, lpszFilename) {
  /* All three null is a flush: what KERNEL holds of the file is let go, and
   * the next read is of the file. Windows returns 0 for it, as recorded.
   */
  if (lpszSection === null && lpszEntry === null && lpszString === null) {
    await releaseProfile(this, lpszFilename);
    return 0;
  }

  const section = String(lpszSection);
  const profile = await readProfile(this, lpszFilename);

  /* **Read out** (`KRNL386.EXE` seg1 `6d5a`-`6e1f`): the section is looked
   * for first. Where it is missing, a NULL entry or value leaves the file
   * as it is and answers 1 (`707c`): SimTower's setup's
   * `WriteProfileString("WinG", NULL, NULL)` writes nothing to a `WIN.INI`
   * with no `[WinG]` (`profnul`). Where it is there, a NULL entry removes
   * it, whatever the value (`6d97`, `703f`). An entry not there with a NULL
   * value leaves the file as it is (`6db6`); one there has its line
   * removed (`6deb`, `704b`). An empty string is a string. */
  if (!profile.hasSection(section)) {
    if (lpszEntry === null || lpszString === null) {
      return 1;
    }
  } else if (lpszEntry === null) {
    profile.removeSection(section);
    this.debug('WritePrivateProfileString', section, null);

    return (await writeProfile(this, lpszFilename, profile)) ? 1 : 0;
  }

  const entry = String(lpszEntry);
  const present = profile.get(section, entry, false) !== null;

  if (lpszString === null) {
    if (!present) {
      return 1;
    }

    profile.set(section, entry, null);
    this.debug('WritePrivateProfileString', section, entry, null);

    return (await writeProfile(this, lpszFilename, profile)) ? 1 : 0;
  }

  /* A value the same as the buffer's, byte for byte, is left as it is:
   * nothing changes and nothing is written, and the answer is 1
   * (`KRNL386.EXE` seg1 `6df2`-`6e03`, `7150`, `707c`; `pmshell`: Program
   * Manager's `display.drv=` unchanged leaves `Order=`'s leading space in
   * the file). The caller's string is compared as it was given. */
  if (present && profile.holds(section, entry, String(lpszString))) {
    return 1;
  }

  /* Each string written is measured as KERNEL measures it (`6e25`-`6e85`,
   * `6890`, `6864`): to its first byte at or below `0Dh`, back over its
   * trailing spaces, the byte that ended it written over the first of
   * them, in the caller's string -- the section's where it is new, the
   * entry's where it is new, and the value's always. So a value's trailing
   * spaces are cut off in place, by a null over the first of them, and a
   * trailing tab stays in the caller's string but not in the file
   * (`profile`'s in-place records). */
  const measured = (given) => {
    const text = String(given);
    const { value, after } = Profile.measure(text);

    if (after !== text && given.segment !== undefined) {
      this.machine.cpu.core.write8(
        given.segment,
        given.offset + value.length,
        after.charCodeAt(value.length)
      );
    }

    return value;
  };

  const newSection = !profile.hasSection(section);
  const sectionWritten = newSection ? measured(lpszSection) : section;
  const entryWritten = !present ? measured(lpszEntry) : entry;
  const value = measured(lpszString);

  profile.set(sectionWritten, entryWritten, value);

  this.debug('WritePrivateProfileString', section, entry);

  const ok = await writeProfile(this, lpszFilename, profile);

  return ok ? 1 : 0;
}
