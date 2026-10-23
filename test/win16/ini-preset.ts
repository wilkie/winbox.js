'use strict';

/**
 * A probe's `WIN.INI` preset, `oracle/probes/<probe>.<preset>.ini`, as
 * `scripts/oracle/ini-preset.mjs` reads and sets it for the recording
 * (`record.mjs --ini`): each key of each section set in `WIN.INI`, and an
 * `[oracle copy]` section's lines, `to=from`, files of drive C: copied.
 */

export type Preset = { name: string; keys: [string, string][] }[];

/** The preset's sections, each with its keys and values in order. */
export function parsePreset(text: string): Preset {
  const sections: Preset = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith(';')) {
      continue;
    }

    const header = /^\[(.*)\]$/.exec(line);

    if (header) {
      sections.push({ name: header[1], keys: [] });
      continue;
    }

    const at = line.indexOf('=');

    if (sections.length && at > 0) {
      sections[sections.length - 1].keys.push([
        line.slice(0, at).trim(),
        line.slice(at + 1).trim(),
      ]);
    }
  }

  return sections;
}

/** `WIN.INI`'s text with the preset's sections set in it, its lines ended CR LF. */
export function mergeIni(text: string, sections: Preset) {
  const lines = text.split(/\r?\n/);

  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop();
  }

  for (const { name, keys } of sections) {
    if (name.toLowerCase().startsWith('oracle ')) {
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
export function presetCopies(sections: Preset) {
  return sections
    .filter(({ name }) => name.toLowerCase() === 'oracle copy')
    .flatMap(({ keys }) => keys);
}

/**
 * The shell the preset keeps, its `[oracle shell]` section's `shell=`: the
 * program `SYSTEM.INI`'s `shell=` names in place of the probe, which then
 * runs as that shell starts it (`pmshell`'s `run=`). Null where it has none.
 */
export function presetShell(sections: Preset) {
  const shell = sections
    .filter(({ name }) => name.toLowerCase() === 'oracle shell')
    .flatMap(({ keys }) => keys)
    .find(([key]) => key.toLowerCase() === 'shell');

  return shell ? shell[1] : null;
}
