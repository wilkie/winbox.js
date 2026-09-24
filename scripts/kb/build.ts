/**
 * Builds the Windows API knowledge base: one page per module, one page per
 * export, and an index.
 *
 * Phase 1 of `KNOWLEDGE_BASE_SPEC.md`. Every export Windows 3.1 really has --
 * surveyed from its binaries into `kb/data/exports-3.1.json` -- gets a page
 * with its ordinal, the bytes of arguments it pops where winbox.js declares
 * them, and its status, so the index shows the whole of the API from the
 * start and every stub is a visible record of what is not yet known. What a
 * page in `kb/` says is checked against the survey and our export tables
 * before it is used; see `pages.ts`.
 *
 * Run with `npm run kb`; the site lands in `dist/kb/`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkEvidence, type Probe, readProbes, readReport } from './evidence.js';
import { collectExports } from './exports.js';
import { type Status, VERSIONS } from './frontmatter.js';
import {
  assemble,
  discrepancies,
  escape,
  type ExportPage,
  type ModulePage,
  readPages,
  readSurvey,
  slugOf,
} from './pages.js';

const ROOT = process.cwd();
const OUT = join(ROOT, process.env.KB_OUT ?? 'dist/kb');
/**
 * Where a page links for a file's source: the repository's own `origin`,
 * whether it is on GitHub or GitLab, at `KB_SOURCE_BRANCH` (by default
 * `develop`). `KB_SOURCE_URL` overrides it.
 */
function sourceUrl() {
  if (process.env.KB_SOURCE_URL) {
    return process.env.KB_SOURCE_URL;
  }

  const branch = process.env.KB_SOURCE_BRANCH ?? 'develop';

  try {
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const match = origin.match(/^(?:https?:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?$/);

    if (match) {
      const [, host, path] = match;
      return host.includes('gitlab') ? `https://${host}/${path}/-/blob/${branch}` : `https://${host}/${path}/blob/${branch}`;
    }
  } catch {
    // No git, or no origin: links are left relative to the repository.
  }

  return '.';
}

const SOURCE_URL = sourceUrl();

const STATUS_LABEL: Record<Status, string> = {
  exact: 'Exact',
  partial: 'Partial',
  stub: 'Stub',
  unrecorded: 'Unrecorded',
};

const STATUS_MEANING: Record<Status, string> = {
  exact: 'every recorded case agrees with Windows',
  partial: 'implemented, with open gaps against Windows',
  stub: 'not implemented: its behaviour is not yet known here',
  unrecorded: 'implemented, but no probe has recorded Windows doing it yet',
};

const badge = (status: Status | null) =>
  status
    ? `<span class="badge ${status}" title="${escape(STATUS_MEANING[status])}">${STATUS_LABEL[status]}</span>`
    : '<span class="badge unsurveyed" title="not yet surveyed for this version">Not surveyed</span>';

const percent = (part: number, whole: number) =>
  whole ? `${((100 * part) / whole).toFixed(1)}%` : '—';

const implementedIn = (module: ModulePage) =>
  module.exports.filter((page) => page.entry?.implemented).length;

/** One page of the site, with the navigation back up the tree. */
function layout(depth: number, title: string, crumbs: [string, string | null][], content: string) {
  const up = '../'.repeat(depth);
  const trail = crumbs
    .map(([label, href]) =>
      href ? `<a href="${up}${href}">${escape(label)}</a>` : `<span>${escape(label)}</span>`
    )
    .join(' <span aria-hidden="true">/</span> ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — Windows API Knowledge Base</title>
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<header class="site">
<a class="home" href="${up}index.html">Windows API Knowledge Base</a>
<nav aria-label="Breadcrumb">${trail}</nav>
</header>
<main>
${content}
</main>
<footer class="site">
<p>Built from the survey of the Windows 3.1 binaries, the export tables of winbox.js, and the pages in <code>kb/</code>. Content is licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.</p>
</footer>
</body>
</html>
`;
}

function renderIndex(modules: ModulePage[]) {
  const rows = modules
    .map((module) => {
      const implemented = implementedIn(module);
      const total = module.exports.length;
      const files = module.files.length
        ? module.files.join(', ')
        : (module.path ?? '').split('\\').pop();

      return `<tr>
<th scope="row"><a href="${slugOf(module.name)}/index.html">${escape(module.name)}</a>${
        module.surveyed ? '' : ' <span class="note">add-on, not surveyed</span>'
      }</th>
<td><code>${escape(files ?? '')}</code></td>
<td class="num">${total}</td>
<td class="num">${implemented}</td>
<td class="num">${total - implemented}</td>
<td class="num">${percent(implemented, total)}</td>
</tr>`;
    })
    .join('\n');

  const surveyed = modules.filter((module) => module.surveyed);
  const total = surveyed.reduce((sum, module) => sum + module.exports.length, 0);
  const implemented = surveyed.reduce((sum, module) => sum + implementedIn(module), 0);
  const disagreements = discrepancies(modules).length;

  return layout(
    0,
    'Modules',
    [['Modules', null]],
    `<h1>Windows API Knowledge Base</h1>
<p class="lead">Windows 3.1's application libraries export ${total} functions; winbox.js implements ${implemented} of them (${percent(
      implemented,
      total
    )}). Every one of them has a page here, and a stub page is a record of what is not yet known.</p>
<table>
<caption>Modules, and how much of each winbox.js implements</caption>
<thead><tr><th scope="col">Module</th><th scope="col">File</th><th scope="col" class="num">Exports</th><th scope="col" class="num">Implemented</th><th scope="col" class="num">Not implemented</th><th scope="col" class="num">Implemented share</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p class="note">Exports are counted from the entry tables of the Windows 3.1 binaries. ${disagreements} places where the export tables of winbox.js disagree with them are listed on each module's page.</p>
<h2>Evidence</h2>
<p>Every claim that winbox.js matches Windows rests on a probe: a small Windows 3.1 program that records what Windows did, replayed against winbox.js by its test suite. <a href="evidence/index.html">The probes and how far winbox.js agrees with each</a>.</p>`
  );
}

function renderModule(module: ModulePage) {
  const rows = module.exports
    .map(
      (page) => `<tr>
<td class="num">${page.ordinal}</td>
<th scope="row"><a href="${page.slug}/index.html"><code>${escape(page.name)}</code></a>${
        page.conflict ? ' <span class="note">disagrees</span>' : ''
      }</th>
<td class="num">${page.entry?.argumentBytes ?? '—'}</td>
<td>${badge(page.versions['3.1'])}</td>
</tr>`
    )
    .join('\n');

  const lines = discrepancies([module]);
  const disagreements = lines.length
    ? `<h2>Where winbox.js disagrees with Windows 3.1</h2>
<p>Its export table and the Windows 3.1 binary name a different export at these ordinals, or it declares an export Windows does not have. A program imports by ordinal, so each is a call that reaches the wrong function or none.</p>
<ul>${lines.map((line) => `<li>${escape(line.replace(`${module.name}.`, 'Ordinal '))}</li>`).join('')}</ul>`
    : '';

  const from = module.surveyed
    ? `Surveyed from <code>${escape(module.files.join('</code> and <code>'))}</code>.`
    : 'An add-on to Windows 3.1 rather than part of it, and not surveyed: the list is what winbox.js declares.';

  return layout(
    1,
    module.name,
    [
      ['Modules', 'index.html'],
      [module.name, null],
    ],
    `<h1>${escape(module.name)}</h1>
<p class="lead">${from} ${module.exports.length} exports, ${implementedIn(module)} implemented.</p>
<table>
<caption>Exports in ordinal order, with their Windows 3.1 status</caption>
<thead><tr><th scope="col" class="num">Ordinal</th><th scope="col">Name</th><th scope="col" class="num">Argument bytes</th><th scope="col">3.1</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${disagreements}`
  );
}

function renderExport(module: ModulePage, page: ExportPage, probes: Probe[]) {
  const versions = VERSIONS.map(
    (version) =>
      `<tr><th scope="row">Windows ${version}</th><td>${badge(page.versions[version])}</td><td>${
        page.versions[version]
          ? escape(STATUS_MEANING[page.versions[version]!])
          : 'not yet surveyed for this version'
      }</td></tr>`
  ).join('\n');

  const entry = page.entry;
  const bytes = !entry
    ? 'Not yet known'
    : entry.argumentBytes === null
      ? 'Not declared'
      : `${entry.argumentBytes}${entry.implemented ? '' : ' <span class="note">as declared; not yet checked against the binary</span>'}`;

  const source = page.source
    ? `<a href="${SOURCE_URL}/${page.source}"><code>${escape(page.source)}</code></a>`
    : entry?.implemented
      ? 'Implemented, source not located'
      : entry
        ? 'None: calls reach the module stub'
        : 'None: winbox.js does not declare it';

  const unnamed =
    page.surveyed && !page.surveyed.name
      ? '<p class="note">Windows 3.1 exports this ordinal without a name, so a program can only import it by number.</p>'
      : '';

  const conflict = page.conflict
    ? `<h2>Disagreement</h2><p>winbox.js declares <code>${escape(page.conflict.name)}</code> at this ordinal, but Windows 3.1 exports <code>${escape(
        page.surveyed?.name ?? ''
      )}</code> here. A program that imports this ordinal reaches winbox.js's <code>${escape(page.conflict.name)}</code>.</p>`
    : '';

  const cited = (page.page?.front.probes ?? []).map((name) => probes.find((probe) => probe.name === name)!);
  const evidence = cited.length
    ? `<h2>Evidence</h2><ul>${cited
        .map(
          (probe) =>
            `<li><a href="../../evidence/${escape(probe.name)}/index.html"><code>${escape(probe.name)}</code></a>: ${probe.agreed} of ${probe.records} records agree, over ${probe.fixtures.length} ${probe.fixtures.length === 1 ? 'recording' : 'recordings'}</li>`
        )
        .join('')}</ul>`
    : '';

  const unknown =
    page.versions['3.1'] === 'stub'
      ? '<h2>What is not yet known</h2><p>Everything about this function beyond its name and ordinal: what it does in Windows, its arguments, its edge cases, and where in the binary it lives.</p>'
      : '';

  return layout(
    2,
    `${module.name}.${page.name}`,
    [
      ['Modules', 'index.html'],
      [module.name, `${slugOf(module.name)}/index.html`],
      [page.name, null],
    ],
    `<h1><code>${escape(page.name)}</code></h1>
${page.page?.front.summary ? `<p class="lead">${escape(page.page.front.summary)}</p>` : ''}
${unnamed}
<dl class="facts">
<dt>Module</dt><dd><a href="../index.html">${escape(module.name)}</a></dd>
<dt>Ordinal</dt><dd>${page.ordinal}</dd>
<dt>Argument bytes</dt><dd>${bytes}</dd>
<dt>Implementation</dt><dd>${source}</dd>
</dl>
<h2>Status by version</h2>
<table>
<thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Meaning</th></tr></thead>
<tbody>
${versions}
</tbody>
</table>
${conflict}
${evidence}
${unknown}`
  );
}

const STYLE = `:root {
  --bg: #ffffff; --fg: #1b1b1f; --muted: #5b5b66; --line: #d9d9e0; --link: #1f5fbf;
  --exact: #1d6b3a; --partial: #8a5a00; --stub: #6b6b75; --unrecorded: #1f5fbf; --unsurveyed: #9a9aa5;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #16161a; --fg: #e8e8ee; --muted: #a2a2ae; --line: #33333b; --link: #7fb0ff;
    --exact: #5fd08a; --partial: #e0b050; --stub: #a2a2ae; --unrecorded: #7fb0ff; --unsurveyed: #6b6b75; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, sans-serif; }
header.site, main, footer.site { max-width: 60rem; margin: 0 auto; padding: 0 16px; }
header.site { padding-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; align-items: baseline; }
header.site .home { font-weight: 600; color: var(--fg); text-decoration: none; }
nav { color: var(--muted); font-size: 0.9rem; }
a { color: var(--link); }
h1 { font-size: 1.8rem; margin: 1.5rem 0 0.5rem; overflow-wrap: anywhere; }
h2 { font-size: 1.2rem; margin: 2rem 0 0.5rem; }
.lead { font-size: 1.05rem; color: var(--muted); }
.note { color: var(--muted); font-size: 0.85rem; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.92em; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; display: block; overflow-x: auto; }
caption { text-align: left; color: var(--muted); font-size: 0.9rem; padding-bottom: 0.5rem; }
th, td { text-align: left; padding: 0.35rem 0.75rem 0.35rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1.5rem; }
dl.facts dt { color: var(--muted); }
dl.facts dd { margin: 0; }
.badge { display: inline-block; font-size: 0.8rem; font-weight: 600; padding: 0 0.5rem; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.badge.exact { color: var(--exact); } .badge.partial { color: var(--partial); } .badge.stub { color: var(--stub); }
.badge.unrecorded { color: var(--unrecorded); } .badge.unsurveyed { color: var(--unsurveyed); font-weight: 400; }
footer.site { margin-top: 3rem; padding-bottom: 2rem; color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--line); }
`;

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Which function pages cite each probe, by probe name. */
function citations(modules: ModulePage[]) {
  const cited = new Map<string, [ModulePage, ExportPage][]>();

  for (const module of modules) {
    for (const page of module.exports) {
      for (const probe of page.page?.front.probes ?? []) {
        cited.set(probe, [...(cited.get(probe) ?? []), [module, page]]);
      }
    }
  }

  return cited;
}

function renderEvidence(probes: Probe[], cited: ReturnType<typeof citations>) {
  const rows = probes
    .map(
      (probe) => `<tr>
<th scope="row"><a href="${escape(probe.name)}/index.html"><code>${escape(probe.name)}</code></a></th>
<td>${escape(firstSentence(probe.description))}</td>
<td class="num">${probe.fixtures.length}</td>
<td class="num">${probe.records}</td>
<td class="num">${probe.records ? percent(probe.agreed, probe.records) : '—'}</td>
<td class="num">${cited.get(probe.name)?.length ?? 0}</td>
</tr>`
    )
    .join('\n');

  const recorded = probes.filter((probe) => probe.fixtures.length);
  const records = recorded.reduce((sum, probe) => sum + probe.records, 0);
  const agreed = recorded.reduce((sum, probe) => sum + probe.agreed, 0);

  return layout(
    1,
    'Evidence',
    [
      ['Modules', 'index.html'],
      ['Evidence', null],
    ],
    `<h1>Evidence</h1>
<p class="lead">${probes.length} probes, ${recorded.length} of them recorded against Windows 3.1: ${records} records, of which winbox.js agrees with ${agreed} (${percent(agreed, records)}). Records a probe makes that the replay cannot yet check are counted but not agreed.</p>
<table>
<caption>Probes, their recordings, and how far winbox.js agrees</caption>
<thead><tr><th scope="col">Probe</th><th scope="col">What it measures</th><th scope="col" class="num">Recordings</th><th scope="col" class="num">Records</th><th scope="col" class="num">Agree</th><th scope="col" class="num">Cited by</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
  );
}

/** A probe's description as paragraphs, with its `code` spans kept. */
function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((block) => `<p>${escape(block).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('\n');
}

function firstSentence(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.:](\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
}

function renderProbe(probe: Probe, cited: ReturnType<typeof citations>) {
  const recordings = probe.fixtures.length
    ? probe.fixtures
        .map(([file, fixture]) => {
          const rows = Object.entries(fixture.functions)
            .map(
              ([name, counts]) => `<tr>
<th scope="row"><code>${escape(name)}</code></th>
<td class="num">${counts.total}</td>
<td class="num">${counts.agreed}</td>
<td class="num">${counts.disagreed}</td>
<td class="num">${counts.unsupported + counts.unimplemented}</td>
<td>${fixture.gaps[name] ? escape(fixture.gaps[name]) : ''}</td>
</tr>`
            )
            .join('\n');

          return `<h3><code>${escape(file)}</code></h3>
<p class="note">Recorded on ${escape(fixture.display ?? 'the default display')}${fixture.windows ? `, ${escape(fixture.windows)}` : ''}: ${fixture.records} records.</p>
<table>
<thead><tr><th scope="col">Measurement</th><th scope="col" class="num">Records</th><th scope="col" class="num">Agree</th><th scope="col" class="num">Disagree</th><th scope="col" class="num">Not replayed</th><th scope="col">Known gap</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
        })
        .join('\n')
    : '<p>Not yet recorded, or not replayed: no fixture of this probe is in the conformance report.</p>';

  const citing = cited.get(probe.name) ?? [];

  return layout(
    2,
    `Probe ${probe.name}`,
    [
      ['Modules', 'index.html'],
      ['Evidence', 'evidence/index.html'],
      [probe.name, null],
    ],
    `<h1><code>${escape(probe.name)}</code></h1>
<dl class="facts">
<dt>Source</dt><dd><a href="${SOURCE_URL}/oracle/probes/${escape(probe.name)}.c"><code>oracle/probes/${escape(probe.name)}.c</code></a></dd>
<dt>Records</dt><dd>${probe.records ? `${probe.agreed} of ${probe.records} agree (${percent(probe.agreed, probe.records)})` : 'none replayed'}</dd>
<dt>Cited by</dt><dd>${
      citing.length
        ? citing
            .map(
              ([module, page]) =>
                `<a href="../../${slugOf(module.name)}/${page.slug}/index.html"><code>${escape(module.name)}.${escape(page.name)}</code></a>`
            )
            .join(', ')
        : 'no page yet'
    }</dd>
</dl>
<h2>What it measures</h2>
${paragraphs(probe.description)}
<h2>Recordings</h2>
${recordings}
<h2>Reproducing it</h2>
<p>Build it with <code>node scripts/oracle/build-probes.mjs ${escape(probe.name)}</code> and record it under Windows 3.1 with <code>node scripts/oracle/record.mjs ${escape(probe.name)}</code>, adding <code>--display &lt;name&gt;</code> for another display; the test suite replays the recording against winbox.js.</p>`
  );
}

export function build() {
  const modules = assemble(readSurvey('3.1'), collectExports(), readPages());
  const probes = readProbes(readReport());
  const cited = citations(modules);

  checkEvidence(modules, probes);

  rmSync(OUT, { recursive: true, force: true });
  write(join(OUT, 'style.css'), STYLE);
  write(join(OUT, 'index.html'), renderIndex(modules));

  let count = 0;

  for (const module of modules) {
    const directory = join(OUT, slugOf(module.name));
    write(join(directory, 'index.html'), renderModule(module));

    for (const page of module.exports) {
      write(join(directory, page.slug, 'index.html'), renderExport(module, page, probes));
      count++;
    }
  }

  write(join(OUT, 'evidence', 'index.html'), renderEvidence(probes, cited));

  for (const probe of probes) {
    write(join(OUT, 'evidence', probe.name, 'index.html'), renderProbe(probe, cited));
  }

  return {
    probes: probes.length,
    modules: modules.length,
    exports: count,
    disagreements: discrepancies(modules).length,
    out: relative(ROOT, OUT),
  };
}

/* Run when this is the program, not when a test imports it. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = build();
  console.log(
    `knowledge base: ${result.modules} modules, ${result.exports} export pages, ${result.probes} probe pages, ${result.disagreements} disagreements with Windows 3.1 -> ${result.out}`
  );
}
