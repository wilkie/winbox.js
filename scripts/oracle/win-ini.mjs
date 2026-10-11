/**
 * A probe's own `WIN.INI` settings: `oracle/probes/<probe>.win.ini`, put
 * into the installation's `WIN.INI` before Windows starts, so that a probe
 * can record what USER makes of settings it reads only as it starts. The
 * recorder does it here, and both engines' runs the same way
 * (`test/win16/run-probe.ts`, `crates/winbox-win16/tests/support/mod.rs`).
 *
 * Each `key=value` replaces the key's line in its section, the section's
 * name and the key's matched without regard to case; a key not there is
 * added after its section's last line, and a section not there at the
 * end. Lines are ended CR LF, as the installation's are.
 */

/** The settings of a `.win.ini`: section, key and value, in order. */
export function settingsOf(text) {
  const settings = [];
  let section = null;

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
export function mergeProfile(text, settings) {
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
          line.split('=')[0].trim().toLowerCase() === key.toLowerCase() && line.includes('=')
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
