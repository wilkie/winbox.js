/**
 * Which of the Win16 functions Win32s 1.25's own 16-bit modules import
 * WinBox already has.
 *
 * Reads the JSON `scripts/kb/win32s-inventory.py` writes (the path on the
 * command line) and prints it again with `win16Needs` added: for the 16-bit
 * modules Win32s installs ("runtime") and the ones its setup runs ("setup"),
 * each function imported from a module Windows 3.1 carries, with its ordinal
 * (an import by name is turned into one through `kb/data/exports-3.1.json`)
 * and whether WinBox implements it (`scripts/kb/exports.ts`, which reads
 * `kb/data/winbox-exports.json`, the same flag the
 * kb's pages show). An import from a module one of Win32s' own files is
 * (W32SYS, WIN32S16, OLECLI, WINMM16...) is looked for in that file's exports.
 *
 *   npx tsx scripts/kb/win32s-coverage.ts inventory.json > out.json
 */

import { readFileSync } from 'node:fs';

import { collectExports } from './exports.js';

const inventory = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const windows = JSON.parse(
  readFileSync(new URL('../../kb/data/exports-3.1.json', import.meta.url), 'utf8')
);
const ours = new Map(collectExports().map((m) => [m.name, m]));

const files: Record<string, any> = inventory.win32s.files;

/** The role of each file: installed into the system folder, or part of the setup. */
const installed = new Set(
  inventory.win32s.installLists
    .filter((l: any) => l.section === 'WindowsSystemWin32s' || l.section === 'WindowsSystem')
    .map((l: any) => l.name.toUpperCase())
);

/** The modules Win32s' own NE files are, by module name. */
const own = new Map<string, string>();
for (const [name, info] of Object.entries<any>(files)) {
  if (info.format === 'NE' && info.moduleName) {
    own.set(info.moduleName.toUpperCase(), name);
  }
}

interface Need {
  ordinal: number | null;
  name: string | null;
  implemented: boolean | null;
  usedBy: string[];
}

const needs: Record<string, Record<string, any>> = { runtime: {}, setup: {} };
const perFile: Record<string, any> = {};

for (const [file, info] of Object.entries<any>(files)) {
  if (info.format !== 'NE' || file === 'FREECELL.EXE') {
    continue;
  }

  const role = installed.has(file.toUpperCase()) ? 'runtime' : 'setup';
  const counts: Record<string, any> = {};

  for (const [module, list] of Object.entries<any>(info.imports)) {
    let entry = needs[role][module];

    if (!entry) {
      const ownFile = own.get(module);
      const known = windows.modules.find((m: any) => m.name === module);
      const impl = ours.get(module);
      entry = needs[role][module] = {
        provider: ownFile ? `Win32s: ${ownFile}` : known ? 'Windows 3.1' : 'not read out',
        winboxModule: ownFile ? null : impl ? true : false,
        functions: new Map<string, Need>(),
      };
    }

    let have = 0;
    let total = 0;

    for (const imp of list) {
      let ordinal: number | null = imp.ordinal ?? null;
      let name: string | null = imp.name ?? null;
      let implemented: boolean | null = null;
      const ownFile = own.get(module);

      if (ownFile) {
        const exp = files[ownFile].exports.find((e: any) =>
          ordinal !== null
            ? e.ordinal === ordinal
            : (e.name ?? '').toUpperCase() === name!.toUpperCase()
        );
        if (exp) {
          ordinal = exp.ordinal;
          name = exp.name ?? name;
        }
      } else {
        const known = windows.modules.find((m: any) => m.name === module);
        if (known) {
          const exp = known.exports.find((e: any) =>
            ordinal !== null ? e.ordinal === ordinal : e.name === name!.toUpperCase()
          );
          if (exp) {
            ordinal = exp.ordinal;
            name = imp.ordinal !== undefined ? exp.name : name;
          }
        }
        const impl = ours.get(module);
        implemented = impl
          ? impl.exports.some((e) => e.ordinal === ordinal && e.implemented)
          : false;
      }

      const key = ordinal !== null ? String(ordinal) : `n:${name}`;
      const slot: Need = entry.functions.get(key) ?? { ordinal, name, implemented, usedBy: [] };
      if (!slot.usedBy.includes(file)) {
        slot.usedBy.push(file);
      }
      entry.functions.set(key, slot);

      total++;
      if (implemented) {
        have++;
      }
    }

    counts[module] = { imports: total, implemented: own.has(module) ? null : have };
  }

  perFile[file] = { role, modules: counts };
}

const summary: Record<string, any> = {};

for (const role of ['runtime', 'setup']) {
  summary[role] = {};

  for (const [module, entry] of Object.entries<any>(needs[role])) {
    const fns: Need[] = [...entry.functions.values()].sort(
      (a, b) => (a.ordinal ?? 1e9) - (b.ordinal ?? 1e9)
    );
    summary[role][module] = {
      provider: entry.provider,
      winboxHasModule: entry.winboxModule,
      distinct: fns.length,
      implemented: entry.provider.startsWith('Win32s')
        ? null
        : fns.filter((f) => f.implemented).length,
      functions: fns,
    };
  }
}

inventory.generated =
  'scripts/kb/win32s-expand.py, scripts/kb/win32s-inventory.py, scripts/kb/win32s-coverage.ts';
inventory.win16Needs = {
  note: 'implemented = scripts/kb/exports.ts implemented flag against kb/data/exports-3.1.json at the commit that generated this file',
  perFile,
  ...summary,
};

process.stdout.write(JSON.stringify(inventory, null, 1));
