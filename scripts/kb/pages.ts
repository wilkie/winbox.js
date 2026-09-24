/**
 * The pages of the knowledge base: every export Windows really has, joined to
 * what winbox.js declares for it and to what a page in `kb/` says about it,
 * with the checks that keep the three in agreement. Kept apart from
 * `build.ts` so that the test suite runs the same checks without building the
 * site.
 *
 * Which exports exist comes from the survey of the Windows binaries
 * (`kb/data/exports-<version>.json`, made by `scripts/kb/survey.mjs`), not from
 * our export tables: the tables carry placeholders for unused ordinals and a
 * few names that are not what Windows 3.1 exports there. Where the table
 * agrees with the survey at an ordinal -- the same name -- it says whether
 * the export is implemented and how many bytes it pops. Where it disagrees,
 * the page says so, and the disagreement is listed on its module's page.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { type ExportEntry, type ModuleEntry } from './exports.js';
import { type FrontMatter, parsePage, type Status, type Version, VERSIONS } from './frontmatter.js';

const ROOT = process.cwd();
const PAGES = join(ROOT, 'kb');

export interface SurveyedExport {
  ordinal: number;
  name: string | null;
  nameFrom: 'binary' | 'import library' | null;
  in?: string[];
}

export interface SurveyedModule {
  name: string;
  files: string[];
  exports: SurveyedExport[];
}

export interface Survey {
  version: string;
  modules: SurveyedModule[];
}

export interface Page {
  file: string;
  front: FrontMatter;
  body: string;
}

/** What the site knows about one export. */
export interface ExportPage {
  /** The name to show: ours where it agrees with Windows, Windows' otherwise. */
  name: string;
  ordinal: number;
  slug: string;
  surveyed: SurveyedExport | null;

  /** Our table's entry at this ordinal, if it names the same export. */
  entry: ExportEntry | null;

  /** Our table's entry at this ordinal when it names something else. */
  conflict: ExportEntry | null;

  page: Page | null;
  source: string | null;
  versions: Record<Version, Status | null>;
}

export interface ModulePage {
  name: string;
  path: string | null;
  files: string[];
  addOn: boolean;
  surveyed: boolean;
  exports: ExportPage[];

  /** What our table declares that Windows 3.1 does not export at that ordinal. */
  undeclared: ExportEntry[];
}

export const escape = (text: string) =>
  String(text).replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!
  );

/** A URL-safe name: lower case, and nothing but letters, digits and underscores. */
export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

/** Our tables fill unused ordinals with entries named this; they are not exports. */
export const isPlaceholder = (entry: ExportEntry) => /^unknown$/i.test(entry.name);

const same = (a: string | null, b: string | null) =>
  !!a && !!b && a.toUpperCase() === b.toUpperCase();

/** The survey of the Windows 3.1 binaries. */
export function readSurvey(version = '3.1'): Survey {
  return JSON.parse(readFileSync(join(PAGES, 'data', `exports-${version}.json`), 'utf8'));
}

/** Every Markdown page under `kb/`, apart from the directory's own notes. */
export function readPages(): Page[] {
  const pages: Page[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.md') && !['README.md', 'LICENSE.md'].includes(entry.name)) {
        const file = relative(ROOT, path);
        pages.push({ file, ...parsePage(file, readFileSync(path, 'utf8')) });
      }
    }
  };

  if (existsSync(PAGES)) {
    walk(PAGES);
  }

  return pages;
}

/**
 * Joins the survey, our tables and the pages, and refuses a page that does not
 * match: an export Windows does not have, an ordinal that disagrees, a status
 * that contradicts our table, a probe or a source file that is not there.
 */
export function assemble(survey: Survey, tables: ModuleEntry[], pages: Page[]): ModulePage[] {
  const modules: ModulePage[] = [];

  for (const surveyed of survey.modules) {
    const table = tables.find((module) => module.name === surveyed.name);
    const declared = (table?.exports ?? []).filter((entry) => !isPlaceholder(entry));
    const taken = new Set<string>();

    const exports = surveyed.exports.map((export_): ExportPage => {
      const atOrdinal = declared.find((entry) => entry.ordinal === export_.ordinal) ?? null;
      const entry =
        atOrdinal && (same(atOrdinal.name, export_.name) || !export_.name) ? atOrdinal : null;
      const name = entry?.name ?? export_.name ?? `Ordinal ${export_.ordinal}`;

      let slug = export_.name ? slugOf(name) : `ordinal_${export_.ordinal}`;

      if (taken.has(slug)) {
        slug = `${slug}_${export_.ordinal}`;
      }

      taken.add(slug);

      return {
        name,
        ordinal: export_.ordinal,
        slug,
        surveyed: export_,
        entry,
        conflict: atOrdinal && !entry ? atOrdinal : null,
        page: null,
        source: null,
        versions: { '3.0': null, '3.1': null, '3.11': null },
      };
    });

    const undeclared = declared.filter((entry) => !exports.some((page) => page.entry === entry));

    modules.push({
      name: surveyed.name,
      path: table?.path ?? null,
      files: surveyed.files,
      addOn: false,
      surveyed: true,
      exports,
      undeclared,
    });
  }

  /* A module winbox.js declares that the survey has no binary for -- WinG, an
   * add-on the installation does not carry -- keeps its table as its list. */
  for (const table of tables) {
    if (survey.modules.some((module) => module.name === table.name)) {
      continue;
    }

    const taken = new Set<string>();

    modules.push({
      name: table.name,
      path: table.path,
      files: [],
      addOn: table.addOn,
      surveyed: false,
      undeclared: [],
      exports: table.exports
        .filter((entry) => !isPlaceholder(entry))
        .map((entry) => {
          let slug = slugOf(entry.name);

          if (taken.has(slug)) {
            slug = `${slug}_${entry.ordinal}`;
          }

          taken.add(slug);

          return {
            name: entry.name,
            ordinal: entry.ordinal,
            slug,
            surveyed: null,
            entry,
            conflict: null,
            page: null,
            source: null,
            versions: { '3.0': null, '3.1': null, '3.11': null },
          };
        }),
    });
  }

  const errors: string[] = [];

  for (const page of pages) {
    const { front, file } = page;

    for (const probe of front.probes) {
      if (!existsSync(join(ROOT, 'oracle', 'probes', `${probe}.c`))) {
        errors.push(`${file}: no probe oracle/probes/${probe}.c`);
      }
    }

    if (front.source && !existsSync(join(ROOT, front.source))) {
      errors.push(`${file}: no source file ${front.source}`);
    }

    if (front.kind !== 'function') {
      continue;
    }

    const module = modules.find((candidate) => candidate.name === front.module);
    const target = module?.exports.find((candidate) => same(candidate.name, front.name));

    if (!module || !target) {
      errors.push(`${file}: ${front.module} exports no ${front.name}`);
      continue;
    }

    if (target.ordinal !== front.ordinal) {
      errors.push(
        `${file}: ${front.module}.${front.name} is ordinal ${target.ordinal}, not ${front.ordinal}`
      );
    }

    const current = front.versions['3.1'];
    const implemented = !!target.entry?.implemented;

    if (current && current !== 'stub' && !implemented) {
      errors.push(`${file}: ${front.name} is a stub, so 3.1 cannot be ${current}`);
    }

    if (current === 'stub' && implemented) {
      errors.push(`${file}: ${front.name} is implemented, so 3.1 cannot be stub`);
    }

    target.page = page;
  }

  if (errors.length) {
    throw new Error(
      `the knowledge base does not agree with the survey and the tables:\n  ${errors.join('\n  ')}`
    );
  }

  /* The 3.1 status comes from our table unless a page has recorded more; the
   * other versions are not surveyed until a page says they are. */
  for (const module of modules) {
    for (const page of module.exports) {
      const implemented = !!page.entry?.implemented;
      const file = page.entry?.implementation
        ? `src/win16/${module.name.toLowerCase()}/${page.entry.implementation}.ts`
        : null;

      page.source = page.page?.front.source ?? (file && existsSync(join(ROOT, file)) ? file : null);

      for (const version of VERSIONS) {
        page.versions[version] =
          page.page?.front.versions[version] ??
          (version === '3.1' ? (implemented ? 'unrecorded' : 'stub') : null);
      }
    }
  }

  return modules;
}

/** Every place our tables and Windows 3.1 disagree, as one line each. */
export function discrepancies(modules: ModulePage[]) {
  const lines: string[] = [];

  for (const module of modules) {
    for (const page of module.exports) {
      if (page.conflict) {
        lines.push(
          `${module.name}.${page.ordinal}: Windows exports ${page.surveyed?.name}, winbox.js declares ${page.conflict.name}`
        );
      }
    }

    for (const entry of module.undeclared) {
      if (!module.exports.some((page) => page.conflict === entry)) {
        lines.push(
          `${module.name}.${entry.ordinal}: winbox.js declares ${entry.name}, Windows exports nothing there`
        );
      }
    }
  }

  return lines;
}
