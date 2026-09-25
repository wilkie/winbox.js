'use strict';

import { existsSync, readFileSync } from 'node:fs';

import { checkEvidence, readProbes, readReport } from '../../scripts/kb/evidence.js';
import { collectExports } from '../../scripts/kb/exports.js';
import { fontsSections, headingSlug, render } from '../../scripts/kb/markup.js';
import { parsePage } from '../../scripts/kb/frontmatter.js';
import {
  articles,
  assemble,
  discrepancies,
  readPages,
  readSurvey,
  targetsOf,
} from '../../scripts/kb/pages.js';

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

    it('a guide outside kb/guides/', () => {
      expect(() => assemble(survey, tables, [page(['kind: guide', 'name: Misplaced'])])).toThrow(
        /a guide lives in kb\/guides/
      );
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

    it('reads a version quoted either way, as Prettier may write it', () => {
      const double = parsePage(
        'kb/x.md',
        '---\nkind: topic\nname: x\nversions:\n  "3.1": exact\n---\n'
      );
      const single = parsePage(
        'kb/x.md',
        "---\nkind: topic\nname: x\nversions:\n  '3.1': exact\n---\n"
      );

      expect(single.front.versions).toEqual(double.front.versions);
    });

    it('reads a list wrapped one item a line, as Prettier writes a long one', () => {
      const wrapped = parsePage(
        'kb/x.md',
        '---\nkind: topic\nname: x\nprobes:\n  [\n    font,\n    glyphs,\n  ]\n---\n'
      );

      expect(wrapped.front.probes).toEqual(['font', 'glyphs']);
    });

    it('refuses a version that is not one', () => {
      expect(() =>
        parsePage('kb/x.md', '---\nkind: topic\nname: x\nversions:\n  "3.2": exact\n---\n')
      ).toThrow(/versions/);
    });
  });

  describe('evidence', () => {
    const report = readReport();
    const probes = readProbes(report);

    it('has a report from the conformance suite, for probes that exist', () => {
      expect(Object.keys(report).length).toBeGreaterThan(0);

      for (const fixture of Object.values(report)) {
        expect(existsSync(`oracle/probes/${fixture.probe}.c`)).toBe(true);
      }
    });

    it('backs every badge the pages in kb/ claim', () => {
      expect(() => checkEvidence(assemble(survey, tables, readPages()), probes)).not.toThrow();
    });

    const claim = (lines: string[], against = probes) => {
      const text = ['---', ...lines, '---', ''].join('\n');
      const pages = [{ file: 'kb/test.md', ...parsePage('kb/test.md', text) }];
      return () => checkEvidence(assemble(survey, tables, pages), against);
    };

    const base = [
      'kind: function',
      'module: GDI',
      'name: GetGlyphOutline',
      'ordinal: 309',
      'versions:',
      '  "3.1": exact',
    ];

    it('refuses exact with no probe cited', () => {
      expect(claim(base)).toThrow(/cites no probe/);
    });

    it('refuses exact over a probe with a disagreement', () => {
      const disagreeing = probes.map((probe) =>
        probe.name === 'smearglf' ? { ...probe, disagreed: 1 } : probe
      );
      expect(claim([...base, 'probes: [smearglf]'], disagreeing)).toThrow(/is exact, but smearglf/);
    });

    it('refuses a claim on a probe that was never recorded', () => {
      const unrecorded = probes.map((probe) =>
        probe.name === 'smearglf' ? { ...probe, fixtures: [] } : probe
      );
      expect(claim([...base, 'probes: [smearglf]'], unrecorded)).toThrow(/no fixture/);
    });
  });

  describe('the bodies of pages', () => {
    const pages = readPages();
    const probes = readProbes(readReport());
    const targets = targetsOf(
      assemble(survey, tables, pages),
      pages,
      probes,
      readFileSync('FONTS.md', 'utf8')
    );
    const context = (errors: string[]) => ({
      up: '../../',
      fontsUrl: 'FONTS.md',
      targets,
      file: 'test.md',
      errors,
    });

    it('resolve every reference in every page in kb/', () => {
      const errors: string[] = [];

      for (const page of pages) {
        render(page.body, { ...context(errors), file: page.file });
      }

      expect(errors).toEqual([]);
    });

    it('refuse a reference to something that does not exist', () => {
      const errors: string[] = [];
      render(
        '[[fn:GDI.NoSuchFunction]] [[topic:no-such-topic]] [[fonts:99z]] [[nonsense]]',
        context(errors)
      );

      expect(errors).toHaveLength(4);
    });

    it('link a function and label a claim', () => {
      const { html } = render('[[measured]] see [[fn:GDI.GetGlyphOutline]]', context([]));

      expect(html).toContain('<span class="label measured">Measured</span>');
      expect(html).toContain('href="../../gdi/getglyphoutline/index.html"');
    });

    it('keep raw HTML out', () => {
      expect(render('<script>alert(1)</script>', context([])).html).not.toContain('<script>');
    });

    it('link a guide, and say where each reference landed', () => {
      const linked: string[] = [];
      const { html } = render('[[guide:reproducing]] and [[probe:smeargnd]]', {
        ...context([]),
        linked: (url: string) => linked.push(url),
      });

      expect(html).toContain('href="../../guides/reproducing/index.html"');
      expect(linked).toEqual(['guides/reproducing/index.html', 'evidence/smeargnd/index.html']);
    });

    it('include a guide on reproducing a measurement and one on contributing', () => {
      expect(articles(pages, 'guide').map((guide) => guide.slug)).toEqual(
        expect.arrayContaining(['contributing', 'reproducing'])
      );
    });

    it('link FONTS.md sections at the anchors GitHub gives them', () => {
      expect(
        headingSlug('8u. `lfEscapement`, which was thrown away with a comment saying so')
      ).toBe('8u-lfescapement-which-was-thrown-away-with-a-comment-saying-so');
      expect(fontsSections(readFileSync('FONTS.md', 'utf8')).has('8u')).toBe(true);
    });
  });

  it('keeps its licence beside its content', () => {
    expect(existsSync('kb/LICENSE.md')).toBe(true);
  });
});
