/**
 * A probe's `WIN.INI` preset: `oracle/probes/<probe>.<preset>.ini`, settings
 * made before Windows starts, for what Windows reads only as it starts --
 * `[TrueType]`, `[fonts]`. `record.mjs --ini <preset>` records the probe with
 * it, as the fixture `<probe>-<preset>`, and both engines' replays make the
 * same settings (`test/win16/ini-preset.ts`, the Rust engine's
 * `tests/support/mod.rs`).
 *
 * The file is an INI file. Each key of each section is set in `WIN.INI`: its
 * line in the section replaced, else written as the section's last line, else
 * the section added at the end. A section `[oracle copy]` is not
 * `WIN.INI`'s: each of its lines, `to=from`, copies a file of drive C: to
 * another place on it first.
 */

/** The preset's sections, each with its keys and values in order. */
export function parsePreset(text) {
  const sections = [];
  let section = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith(';')) {
      continue;
    }

    const header = /^\[(.*)\]$/.exec(line);

    if (header) {
      section = { name: header[1], keys: [] };
      sections.push(section);
      continue;
    }

    const at = line.indexOf('=');

    if (section && at > 0) {
      section.keys.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }

  return sections;
}

/** `WIN.INI`'s text with the preset's sections set in it, its lines ended CR LF. */
export function mergeIni(text, sections) {
  const lines = text.split(/\r?\n/);

  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }

  for (const { name, keys } of sections) {
    if (name.toLowerCase() === 'oracle copy') {
      continue;
    }

    for (const [key, value] of keys) {
      const header = lines.findIndex(
        (line) => line.trim().toLowerCase() === `[${name.toLowerCase()}]`
      );

      if (header < 0) {
        lines.push(`[${name}]`, `${key}=${value}`);
        continue;
      }

      let end = header + 1;

      while (end < lines.length && !lines[end].trim().startsWith('[')) {
        end++;
      }

      const existing = lines
        .slice(header + 1, end)
        .findIndex((line) => line.split('=')[0].trim().toLowerCase() === key.toLowerCase());

      if (existing >= 0) {
        lines[header + 1 + existing] = `${key}=${value}`;
      } else {
        /* After the section's last line that is not blank. */
        let last = end;

        while (last > header + 1 && !lines[last - 1].trim()) {
          last--;
        }

        lines.splice(last, 0, `${key}=${value}`);
      }
    }
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** The preset's copies, each `[to, from]`, paths on drive C:. */
export function presetCopies(sections) {
  return sections
    .filter(({ name }) => name.toLowerCase() === 'oracle copy')
    .flatMap(({ keys }) => keys);
}
