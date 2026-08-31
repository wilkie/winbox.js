/**
 * Recursive descent through a sixteen bit code segment.
 *
 * The reason not to sweep linearly is that a compiler leaves jump tables and
 * constants between and inside functions, and `ndisasm` resynchronises after
 * them at whatever offset happens to work -- every address after the first
 * patch of data is a guess. Descent only decodes from somewhere control
 * actually reaches, so it steps over the data instead of through it.
 *
 * Usage: node scripts/oracle/descend.mjs <segment> <entry> [entry...]
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readNE } from './ne.mjs';

const IMAGE = 'oracle/build/drive-c/WINDOWS/SYSTEM/GDI.EXE';
const SCRATCH = process.env.SCRATCH ?? '/tmp';

/** Instructions that end a run: control does not fall through them. */
const STOPS = /^(ret|retf|retn|iret|jmp)\b/;
/** Instructions that go somewhere else as well as, or instead of, onwards. */
const BRANCH = /^(j\w+|loop\w*|call)\b/;

export function descend(code, entries, { name = 'seg' } = {}) {
  const path = `${SCRATCH}/${name}.bin`;
  writeFileSync(path, code);

  /** One window of linear disassembly, which is only trusted until a stop. */
  const window = (at) => {
    const text = execFileSync(
      'ndisasm',
      ['-b', '16', '-e', String(at), '-o', String(at), '-k', `${at + 512},${code.length}`, path],
      { encoding: 'utf8' }
    );

    return text
      .split('\n')
      .map((line) => line.match(/^([0-9A-F]{8})\s+([0-9A-F]+)\s+(.*)$/))
      .filter(Boolean)
      .map((m) => ({ at: parseInt(m[1], 16), bytes: m[2], text: m[3].trim() }));
  };

  const seen = new Map();
  const work = [...entries];
  const targets = new Set(entries);

  while (work.length) {
    const start = work.pop();

    if (seen.has(start) || start < 0 || start >= code.length) {
      continue;
    }

    for (const one of window(start)) {
      if (seen.has(one.at)) {
        break;
      }

      seen.set(one.at, one);

      if (BRANCH.test(one.text)) {
        // A near branch names an absolute offset in the same segment; a far one
        // names a segment we are not decoding, and is left alone.
        const to = one.text.match(
          /^(?:j\w+|loop\w*|call)\s+(?:short\s+|near\s+|word\s+)?0x([0-9a-f]+)$/
        );

        if (to) {
          const at = parseInt(to[1], 16);
          targets.add(at);
          work.push(at);
        }
      }

      if (STOPS.test(one.text)) {
        break;
      }
    }
  }

  return { instructions: seen, targets };
}

if (process.argv[1].endsWith('descend.mjs')) {
  const [number, ...entries] = process.argv.slice(2);
  const ne = readNE(IMAGE);
  const seg = ne.segments.find((s) => s.number === Number(number));
  const code = ne.bytes.subarray(seg.at, seg.at + seg.length);
  const { instructions } = descend(
    code,
    entries.map((e) => Number(e)),
    { name: `seg${number}` }
  );

  for (const at of [...instructions.keys()].sort((a, b) => a - b)) {
    const one = instructions.get(at);
    console.log(`${at.toString(16).padStart(4, '0')}  ${one.bytes.padEnd(16)} ${one.text}`);
  }
}
