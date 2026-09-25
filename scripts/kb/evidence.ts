/**
 * The evidence behind the knowledge base: the oracle's probes, the fixtures
 * they recorded, and the conformance report of how far winbox.js agrees with
 * each. Phase 2 of `KNOWLEDGE_BASE_SPEC.md`.
 *
 * A status badge is a claim, and this is what holds it to the report. A page
 * that says a function is `exact` on Windows 3.1 must cite at least one probe,
 * and every record every cited probe made must agree, with no known gap open
 * against it. A page that says `partial` must cite a probe that was recorded.
 * Which probes count is the page's to say: a probe's C source calls many
 * functions for setup that its replay never checks, so the build does not
 * guess at coverage from what a probe calls.
 */

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

import { type ModulePage } from './pages.js';

const ROOT = process.cwd();

export interface FunctionCounts {
  total: number;
  agreed: number;
  disagreed: number;
  unimplemented: number;
  unsupported: number;
}

/** One fixture's line in `kb/data/conformance.json`. */
export interface FixtureReport {
  probe: string;
  display: string | null;
  windows: string | null;
  records: number;
  functions: Record<string, FunctionCounts>;
  gaps: Record<string, string>;
}

export type Report = Record<string, FixtureReport>;

export interface Probe {
  name: string;

  /** The probe's own opening comment, which says what it measures and why. */
  description: string;
  fixtures: [string, FixtureReport][];
  records: number;
  agreed: number;
  disagreed: number;
  unsupported: number;
  gaps: number;
}

/** The conformance suite's last full report, or an empty one if it has never run. */
export function readReport(): Report {
  const path = join(ROOT, 'kb', 'data', 'conformance.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/**
 * A recording made against a font built for the purpose -- a real font with
 * the bytes under test changed, by `scripts/oracle/fabricate.mjs` -- rather
 * than one Windows installs. These are not in the conformance report: the
 * raster tests replay them, one question about the scaler at a time.
 */
export interface Fabrication {
  /** The file, from `oracle/fixtures/` and without `.json`. */
  file: string;
  font: string;
  display: string;
}

/**
 * Every tracked recording in `oracle/fixtures/fabricated/`, by probe. Only the
 * head of each file is read: together they are hundreds of megabytes, and the
 * probe, display and font are all in the first few lines.
 */
export function readFabrications(): Map<string, Fabrication[]> {
  const found = new Map<string, Fabrication[]>();
  let files: string[];

  try {
    files = execFileSync('git', ['ls-files', 'oracle/fixtures/fabricated'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((file) => file.endsWith('.json'));
  } catch {
    return found;
  }

  const head = Buffer.alloc(4096);

  for (const file of files.sort()) {
    const descriptor = openSync(join(ROOT, file), 'r');
    const length = readSync(descriptor, head, 0, head.length, 0);
    closeSync(descriptor);

    const text = head.toString('latin1', 0, length);
    const field = (name: string) => text.match(new RegExp(`"${name}": "([^"]*)"`))?.[1];
    const probe = field('probe');
    const font = field('font');

    if (probe && font) {
      found.set(probe, [
        ...(found.get(probe) ?? []),
        {
          file: file.replace(/^oracle\/fixtures\//, '').replace(/\.json$/, ''),
          font,
          display: field('display') ?? 'vga',
        },
      ]);
    }
  }

  return found;
}

/** The first comment block of a probe's source, without its `*` margins. */
function describe(source: string) {
  const match = source.match(/\/\*([\s\S]*?)\*\//);

  if (!match) {
    return '';
  }

  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();
}

/** Every probe in `oracle/probes/`, joined to what its fixtures reported. */
export function readProbes(report: Report): Probe[] {
  const directory = join(ROOT, 'oracle', 'probes');

  return readdirSync(directory)
    .filter((file) => file.endsWith('.c'))
    .sort()
    .map((file) => {
      const name = file.replace(/\.c$/, '');
      const fixtures = Object.entries(report).filter(([, fixture]) => fixture.probe === name);
      const sum = (key: keyof FunctionCounts) =>
        fixtures.reduce(
          (total, [, fixture]) =>
            total +
            Object.values(fixture.functions).reduce((part, counts) => part + counts[key], 0),
          0
        );

      return {
        name,
        description: describe(readFileSync(join(directory, file), 'latin1')),
        fixtures,
        records: sum('total'),
        agreed: sum('agreed'),
        disagreed: sum('disagreed'),
        unsupported: sum('unsupported') + sum('unimplemented'),
        gaps: fixtures.reduce((total, [, fixture]) => total + Object.keys(fixture.gaps).length, 0),
      };
    });
}

/**
 * Holds every page's badges to the report, and throws with every claim the
 * report does not support.
 */
export function checkEvidence(modules: ModulePage[], probes: Probe[]) {
  const errors: string[] = [];

  for (const module of modules) {
    for (const page of module.exports) {
      if (!page.page) {
        continue;
      }

      const { file, front } = page.page;
      const cited = front.probes.map((name) => probes.find((probe) => probe.name === name)!);

      for (const [version, status] of Object.entries(front.versions)) {
        if (version !== '3.1' || !status || status === 'stub' || status === 'unrecorded') {
          continue;
        }

        if (!cited.length) {
          errors.push(`${file}: ${front.name} is ${status} on ${version} but cites no probe`);
          continue;
        }

        for (const probe of cited) {
          if (!probe.fixtures.length) {
            errors.push(`${file}: ${probe.name} has no fixture in the conformance report`);
          } else if (status === 'exact' && (probe.disagreed || probe.gaps || !probe.agreed)) {
            errors.push(
              `${file}: ${front.name} is exact, but ${probe.name} has ${probe.disagreed} disagreeing records and ${probe.gaps} known gaps`
            );
          }
        }
      }
    }
  }

  if (errors.length) {
    throw new Error(
      `the knowledge base claims more than the conformance report shows:\n  ${errors.join('\n  ')}`
    );
  }
}
