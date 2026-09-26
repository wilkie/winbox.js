'use strict';

/**
 * The order GDI's font directory holds the installed faces in.
 *
 * It matters because the mapper's ties go to the earliest entry: two faces can
 * both have a strike at exactly the height asked for, and which one answers is
 * decided by nothing else. See `FontManager.choose` and `_compete`.
 *
 * GDI's directory is not the `SYSTEM` directory. It is the three boot fonts
 * named in `SYSTEM.INI` `[boot]`, which GDI loads first, and then every line of
 * `WIN.INI` `[fonts]` in the order written, which `USER` adds at start-up.
 * Reading the directory instead gets a different order and, on a system that
 * has `DOSAPP.FON` installed, a different set: that file carries five more
 * faces called Terminal that GDI never has in its directory at all.
 *
 * Everything the directory holds is still loaded, because a program may name a
 * face that only a stray file provides and refusing to draw it would be worse
 * than drawing it late. What this settles is the order, and anything the two
 * profiles do not name sorts after everything they do.
 */

/** A `[section]` of a profile, as key and value pairs in the order written. */
export function profileSection(text: string | null, name: string): [string, string][] {
  const match = new RegExp(
    `^\\[${name}\\][ \\t]*\\r?\\n([\\s\\S]*?)(?=^\\[|$(?![\\r\\n]))`,
    'mi'
  ).exec(text ?? '');

  return (match?.[1] ?? '')
    .split(/\r?\n/)
    .map((line) => line.split('=').map((part) => part.trim()) as [string, string])
    .filter((parts) => parts.length === 2 && parts[1]);
}

/** The boot fonts, in the order `SYSTEM.INI` names them. */
const BOOT_FONTS = ['fonts.fon', 'fixedfon.fon', 'oemfonts.fon'];

/**
 * The file names GDI's directory is built from, upper cased and in order.
 *
 * @param {string|null} systemProfile - The text of `SYSTEM.INI`.
 * @param {string|null} windowsProfile - The text of `WIN.INI`.
 * @returns {string[]} File names, boot fonts first.
 */
export function fontDirectoryOrder(
  systemProfile: string | null,
  windowsProfile: string | null
): string[] {
  /* In GDI's own order, whatever order `SYSTEM.INI` writes them in (`GDI.EXE`
   * seg2 `0527`): the EGA's installation lists them the other way round. */
  const lines = profileSection(systemProfile, 'boot');
  const boot = BOOT_FONTS.flatMap((font) =>
    lines.filter(([key]) => key.toLowerCase() === font)
  );

  const names: string[] = [];

  for (const [, value] of [...boot, ...profileSection(windowsProfile, 'fonts')]) {
    const name = value.split(/[\\/]/).pop()!.toUpperCase();

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/**
 * The TrueType file a `.FOT` stub stands for: the stub is a font resource
 * whose one face names its `.TTF` by file name. `WIN.INI` `[fonts]` lists the
 * stub, and GDI loads the stub -- where the face's pitch and family come from
 * -- and then the outlines it names. See `font-resource.ts`.
 */
export function trueTypeFileOf(stub: Uint8Array, stubName: string): string {
  const text = Array.from(stub, (byte) => String.fromCharCode(byte)).join('');

  return (
    /[A-Z0-9_]+\.TTF/i.exec(text)?.[0].toUpperCase() ??
    stubName.toUpperCase().replace(/\.FOT$/, '.TTF')
  );
}

/**
 * Sorts font files into the order GDI's directory would hold them.
 *
 * Stable, so files the profiles do not name keep the order they arrived in and
 * sit after the ones they do.
 */
export function inDirectoryOrder<T>(files: T[], order: string[], nameOf: (file: T) => string): T[] {
  const rank = (file: T) => {
    const at = order.indexOf(nameOf(file).toUpperCase());

    return at < 0 ? order.length : at;
  };

  return files
    .map((file, at) => ({ file, at }))
    .sort((one, other) => rank(one.file) - rank(other.file) || one.at - other.at)
    .map(({ file }) => file);
}
