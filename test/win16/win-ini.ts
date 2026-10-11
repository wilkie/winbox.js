'use strict';

/**
 * A probe's own `WIN.INI` settings, `oracle/probes/<probe>.win.ini`, put
 * into the installation's `WIN.INI` before the probe runs, as the recorder
 * puts them (`scripts/oracle/win-ini.mjs`, which says how).
 */

export interface Setting {
  section: string;
  key: string;
  value: string;
}

/** The settings of a `.win.ini`: section, key and value, in order. */
export function settingsOf(text: string): Setting[] {
  const settings: Setting[] = [];
  let section: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith(';')) {
      continue;
    }

    const header = /^\[(.*)\]$/.exec(line);

    if (header) {
      section = header[1];
      continue;
    }

    const at = line.indexOf('=');

    if (section !== null && at > 0) {
      settings.push({ section, key: line.slice(0, at).trim(), value: line.slice(at + 1) });
    }
  }

  return settings;
}

/** `text`, a profile, with `settings` put into it. */
export function mergeProfile(text: string, settings: Setting[]): string {
  const lines = text.split('\r\n');

  for (const { section, key, value } of settings) {
    const start = lines.findIndex(
      (line) => line.trim().toLowerCase() === `[${section.toLowerCase()}]`
    );

    if (start === -1) {
      while (lines.length && lines[lines.length - 1] === '') {
        lines.pop();
      }

      lines.push('', `[${section}]`, `${key}=${value}`, '');
      continue;
    }

    let end = start + 1;

    while (end < lines.length && !lines[end].trim().startsWith('[')) {
      end++;
    }

    const found = lines
      .slice(start + 1, end)
      .findIndex(
        (line) =>
          line.includes('=') && line.split('=')[0].trim().toLowerCase() === key.toLowerCase()
      );

    if (found !== -1) {
      lines[start + 1 + found] = `${key}=${value}`;
      continue;
    }

    let last = end - 1;

    while (last > start && lines[last].trim() === '') {
      last--;
    }

    lines.splice(last + 1, 0, `${key}=${value}`);
  }

  return lines.join('\r\n');
}
