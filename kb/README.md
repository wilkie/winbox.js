# The Windows API knowledge base

The pages the knowledge base site is built from. The design is in
`KNOWLEDGE_BASE_SPEC.md`; build the site with `npm run kb`, which writes it to
`dist/kb/`.

Every export Windows 3.1 has already has a page. Which exports exist comes
from the Windows binaries themselves: `scripts/kb/survey.mjs` reads the entry
and name tables of the installed libraries and writes
`kb/data/exports-3.1.json`, which is committed so the site builds without the
Windows media. winbox.js's export tables in `src/win16/<module>.ts` are then
joined to it: where a table names the same export at the same ordinal, it
says whether the export is implemented and how many bytes of arguments it
pops. Where a table disagrees with Windows, the export's page and its
module's page say so, and `test/kb/knowledge_base_test.ts` keeps the list of
disagreements from growing.

A file here adds to an export's page what neither the survey nor the tables
can know, and the build checks it before using it.

## Where a page goes

| Kind          | File                                                                | Built at                  |
| ------------- | ------------------------------------------------------------------- | ------------------------- |
| A function    | `kb/<module>/<name>.md`, in lower case: `kb/gdi/getglyphoutline.md` | `/gdi/getglyphoutline/`   |
| A topic       | `kb/topics/<slug>.md`: `kb/topics/synthetic-bold.md`                | `/topics/synthetic-bold/` |
| A file format | `kb/formats/<slug>.md`: `kb/formats/fot.md`                         | `/formats/fot/`           |
| A guide       | `kb/guides/<slug>.md`: `kb/guides/contributing.md`                  | `/guides/contributing/`   |

## The body

After the front matter, a page is Markdown, with raw HTML refused. A function
page follows the order of the spec's page anatomy: `## Observed behaviour`,
`## Nuances`, `## Inside Windows`, `## Implementation`. Its title, facts,
status, signature, evidence and topics are generated around it.

Two additions, both checked by the build:

- **References**, `[[kind:target]]` or `[[kind:target|text]]`: `[[fn:GDI.TextOut]]`,
  `[[topic:synthetic-bold]]`, `[[format:fot]]`, `[[guide:reproducing]]`,
  `[[probe:smearmod]]`, and
  `[[fonts:8u]]` for a section of `FONTS.md`. One that does not resolve fails
  the build.
- **Evidence labels** before a claim: `[[documented]]`, `[[measured]]`,
  `[[read out]]`, `[[inferred]]` and `[[refused]]`, as the spec's evidence model
  defines them. A claim nothing has settled says so in words: "Not yet measured".

A ` ```mermaid ` fence is drawn as a diagram.

A page states each rule briefly with its evidence and its count, and links
the `FONTS.md` section that derives it. `FONTS.md` stays the long form for the
people doing the reverse engineering, and the two are kept in step: a finding
lands in both.

## Front matter

Every page starts with a front matter block. It is a strict subset of YAML --
`key: value`, `key: [a, b]` (or that list wrapped one item a line, as
Prettier writes a long one), and one level of nesting for `versions` -- and a
field the schema does not name is an error, not something ignored.

```yaml
---
kind: function
module: GDI
name: GetGlyphOutline
ordinal: 309
summary: One sentence on what the call is for.
versions:
  '3.1': exact
probes: [smearglf]
source: src/win16/gdi/GetGlyphOutline.ts
topics: [turned-text]
---
```

| Field      | Required                                            | Meaning                                                                                 |
| ---------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `kind`     | yes                                                 | `function`, `structure`, `message`, `constants`, `format`, `topic` or `guide`           |
| `name`     | yes                                                 | The exported name, or the structure's, message's or topic's                             |
| `module`   | for `function`, `structure`, `message`, `constants` | The module as Windows names it: `GDI`, `KERNEL`                                         |
| `ordinal`  | for `function`                                      | Must match the export table                                                             |
| `summary`  | no                                                  | One or two sentences, shown under the title                                             |
| `versions` | no                                                  | A status for each of `"3.0"`, `"3.1"`, `"3.11"`; a version left out is not yet surveyed |
| `probes`   | no                                                  | Probes in `oracle/probes/` that record the behaviour                                    |
| `source`   | no                                                  | The implementation, where it is not `src/win16/<module>/<Name>.ts`                      |
| `topics`   | no                                                  | Topic pages the function belongs to                                                     |

A status is one of:

| Status       | Meaning                                                 |
| ------------ | ------------------------------------------------------- |
| `exact`      | Every recorded case agrees with Windows                 |
| `partial`    | Implemented, with open gaps against Windows             |
| `stub`       | Declared, not implemented                               |
| `unrecorded` | Implemented, but no probe has recorded Windows doing it |

Without a page, a function's 3.1 status is `unrecorded` if winbox.js
implements it and `stub` if not, and its 3.0 and 3.11 statuses are not
surveyed. Surveying those versions is `node scripts/kb/survey.mjs 3.0` against
an installation of that version.

## What the build refuses

- A function page whose module does not export that name in Windows 3.1, or
  whose ordinal disagrees with the survey.
- A 3.1 status that contradicts the table: anything but `stub` for a stub, or
  `stub` for an implemented function.
- A probe that is not in `oracle/probes/`, or a `source` file that does not
  exist.

## Evidence

The conformance suite (`test/oracle/api_conformance_test.ts`) writes
`kb/data/conformance.json` on every full run: for every tracked fixture and
every measurement in it, how many records agreed with Windows, disagreed, or
could not be replayed. It holds nothing that varies between runs, so it only
changes when agreement does. Commit it with the change that moved it.

A status badge is a claim, and the build holds it to that report:

- `exact` on 3.1 needs at least one probe in `probes`, and every record of
  every cited probe must agree, with no known gap open against it.
- `partial` needs at least one cited probe that was recorded.

Which probes count is the page's to say. A probe calls many functions for
setup that its replay never checks, so the build does not infer coverage from
what a probe calls. Each probe also gets a page of its own, built from its
source's opening comment and its report.

## Licence

The content of this directory is licensed CC BY-SA 4.0; see `LICENSE.md`. The
code of winbox.js keeps its own licence.
