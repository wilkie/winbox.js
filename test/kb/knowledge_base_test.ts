'use strict';

import { existsSync } from 'node:fs';

import { collectExports } from '../../scripts/kb/exports.js';
import { parsePage } from '../../scripts/kb/frontmatter.js';
import { assemble, discrepancies, readPages, readSurvey } from '../../scripts/kb/pages.js';

/**
 * The knowledge base's first promise: every export Windows 3.1 has gets a page
 * with its ordinal and its status, and nothing a page in `kb/` says can
 * contradict the survey of the binaries or our export tables. See
 * `KNOWLEDGE_BASE_SPEC.md`, phase 1.
 */
describe('the knowledge base', () => {
  const survey = readSurvey('3.1');
  const tables = collectExports();

  it('surveys the Windows 3.1 libraries', () => {
    expect(survey.modules.map((module) => module.name)).toEqual([
      'KERNEL',
      'USER',
      'GDI',
      'KEYBOARD',
      'SYSTEM',
      'SOUND',
      'COMMDLG',
      'SHELL',
      'MMSYSTEM',
      'TOOLHELP',
      'VER',
      'LZEXPAND',
      'DDEML',
      'OLECLI',
      'OLESVR',
      'WIN87EM',
    ]);

    for (const module of survey.modules) {
      const ordinals = module.exports.map((entry) => entry.ordinal);

      expect(ordinals.every((ordinal) => ordinal > 0)).toBe(true);
      expect(new Set(ordinals).size).toBe(ordinals.length);
    }
  });

  it('gives every surveyed export a page, with a status for Windows 3.1', () => {
    const modules = assemble(survey, tables, readPages());

    for (const surveyed of survey.modules) {
      const module = modules.find((candidate) => candidate.name === surveyed.name)!;

      expect(module.exports).toHaveLength(surveyed.exports.length);

      const slugs = module.exports.map((page) => page.slug);
      expect(new Set(slugs).size).toBe(slugs.length);

      for (const page of module.exports) {
        expect(page.versions['3.1']).toBe(
          page.page?.front.versions['3.1'] ?? (page.entry?.implemented ? 'unrecorded' : 'stub')
        );
      }
    }
  });

  /* Where our export tables and Windows 3.1 disagree. A program imports by
   * ordinal, so each is a call that reaches the wrong function or none. The
   * list may only shrink: fix one, and take it off. */
  it('knows every place the export tables disagree with Windows 3.1', () => {
    expect(discrepancies(assemble(survey, tables, readPages()))).toEqual([
      'KERNEL.27: winbox.js declares SetSwapHook, Windows exports nothing there',
      'KERNEL.39: winbox.js declares SetTaskSwitchProc, Windows exports nothing there',
      'KERNEL.40: winbox.js declares SetTaskInterchange, Windows exports nothing there',
      'KERNEL.43: winbox.js declares IsScreenGrab, Windows exports nothing there',
      'KERNEL.44: winbox.js declares BuildPDB, Windows exports nothing there',
      'GDI.487: winbox.js declares SetBkMode, Windows exports nothing there',
      'MMSYSTEM.102: Windows exports JOYGETDEVCAPS, winbox.js declares joyGetNumCaps',
    ]);
  });

  it('agrees with the pages written in kb/', () => {
    expect(() => assemble(survey, tables, readPages())).not.toThrow();
  });

  describe('refuses a page that contradicts the survey or the tables', () => {
    const page = (lines: string[]) => {
      const text = ['---', ...lines, '---', ''].join('\n');
      return { file: 'kb/test.md', ...parsePage('kb/test.md', text) };
    };

    it.each([
      [
        'an export that does not exist',
        ['kind: function', 'module: GDI', 'name: NoSuchFunction', 'ordinal: 1'],
      ],
      [
        'an ordinal that disagrees',
        ['kind: function', 'module: GDI', 'name: GetGlyphOutline', 'ordinal: 310'],
      ],
      [
        'a stub marked exact',
        [
          'kind: function',
          'module: GDI',
          'name: SetMapMode',
          'ordinal: 3',
          'versions:',
          '  "3.1": exact',
        ],
      ],
      [
        'an implemented function marked stub',
        [
          'kind: function',
          'module: GDI',
          'name: GetGlyphOutline',
          'ordinal: 309',
          'versions:',
          '  "3.1": stub',
        ],
      ],
      [
        'a probe that does not exist',
        [
          'kind: function',
          'module: GDI',
          'name: GetGlyphOutline',
          'ordinal: 309',
          'probes: [nosuchprobe]',
        ],
      ],
    ])('%s', (_, lines) => {
      expect(() => assemble(survey, tables, [page(lines)])).toThrow();
    });
  });

  describe('front matter', () => {
    it('refuses a field the schema does not name', () => {
      expect(() =>
        parsePage('kb/x.md', '---\nkind: topic\nname: x\nstatuss: exact\n---\n')
      ).toThrow(/no field/);
    });

    it('refuses a status that is not one', () => {
      expect(() =>
        parsePage('kb/x.md', '---\nkind: topic\nname: x\nversions:\n  "3.1": done\n---\n')
      ).toThrow(/status/);
    });

    it('refuses a version that is not one', () => {
      expect(() =>
        parsePage('kb/x.md', '---\nkind: topic\nname: x\nversions:\n  "3.2": exact\n---\n')
      ).toThrow(/versions/);
    });
  });

  it('keeps its licence beside its content', () => {
    expect(existsSync('kb/LICENSE.md')).toBe(true);
  });
});
