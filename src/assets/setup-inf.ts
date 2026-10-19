/**
 * Reads Windows 3.1's `SETUP.INF` (and a driver disk's `OEMSETUP.INF`) as
 * Setup's own lists: sections of lines, a line's fields split at the commas
 * outside quotes, a field `5:SSERIFB.FON` a disk and a file.
 *
 * Only reading. The asset bundle's maker and the survey of the oracle's
 * installations use it to know which file a display, a font resolution or
 * a sound is, so that nothing about Setup's choices is written down twice.
 */

export interface InfLine {
  /** The text left of `=`, where the line has one outside quotes; trimmed. */
  key?: string;
  /** The fields, split at commas outside quotes, trimmed, quotes kept. */
  fields: string[];
  /** The line as it is, less its end. */
  text: string;
}

export type Inf = Map<string, InfLine[]>;

/** Splits at a character outside double quotes. */
function splitOutside(text: string, at: string) {
  const parts = [''];
  let quoted = false;

  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
    }

    if (character === at && !quoted) {
      parts.push('');
    } else {
      parts[parts.length - 1] += character;
    }
  }

  return parts;
}

/** The sections, by name in lower case; comment lines and blank lines left out. */
export function readInf(text: string): Inf {
  const sections: Inf = new Map();
  let current: InfLine[] | null = null;

  for (const raw of text.split(/\r?\n/)) {
    /* A DOS end-of-file mark, 1Ah, ends the text. */
    const end = raw.indexOf('\x1a');
    const line = end === -1 ? raw : raw.slice(0, end);
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith(';')) {
      continue;
    }

    const header = /^\[([^\]]*)\]/.exec(trimmed);

    if (header) {
      const name = header[1].trim().toLowerCase();

      current = sections.get(name) ?? [];
      sections.set(name, current);
      continue;
    }

    if (!current) {
      continue;
    }

    const halves = splitOutside(trimmed, '=');
    const key = halves.length > 1 ? halves[0].trim() : undefined;
    const rest = halves.length > 1 ? halves.slice(1).join('=') : trimmed;

    current.push({
      key,
      fields: splitOutside(rest, ',').map((field) => field.trim()),
      text: line,
    });
  }

  return sections;
}

/**
 * A field naming a file on a disk, `5:SSERIFB.FON`: the disk and the name,
 * upper case. A driver disk's `?:` is its own disk; `x:*vddvga`, a device
 * built into WIN386, is no file.
 */
export function diskFile(field: string | undefined): { disk: string; name: string } | null {
  const match = /^([0-9a-z?]+):\s*([^\s,"]+)/i.exec(field ?? '');

  if (!match || match[2].startsWith('*')) {
    return null;
  }

  return { disk: match[1].toLowerCase(), name: match[2].toUpperCase() };
}

/** A field's text without its quotes. */
export function unquote(field: string | undefined) {
  return (field ?? '').replace(/^"(.*)"$/, '$1');
}

/** The lines of a section, none where it is missing. */
export function section(inf: Inf, name: string) {
  return inf.get(name.toLowerCase()) ?? [];
}
