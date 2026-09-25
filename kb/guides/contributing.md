---
kind: guide
name: Contributing a probe or a page
summary: How to add to the knowledge base — write a probe that asks Windows 3.1 a question, record and replay it, and write the page that states what it found, with the checks the build holds every page to.
---

The site states what Windows 3.1 does and how each statement is known. A contribution is usually both halves: a probe that asks Windows the question, and a page that states the answer with its evidence. The build checks the page against the probe's recording, so a page cannot claim more than the recording shows.

The ground rule is that nothing is invented. A rule goes on a page only once a recording agrees with it or a binary shows it. Where a first reading does not fit, look for why before reaching for a new rule. Keep the readings that were tried and failed, with their counts, because they save the next reader from trying them again.

## Adding a probe

A probe is a C file in `oracle/probes/`. It is built with Open Watcom into an ordinary Windows 3.1 executable, so the loader, the imports and the calling convention are tested with it.

- Open the file with a comment saying what the probe asks and why. The site shows that comment as the probe's description, so write it for a reader who has not seen the code.
- Include `probe.h`. In `WinMain`, open the output with `probeOpen("C:\\ORACLE\\<NAME>.OUT")`, then write one record per answer with `probe(function, arguments, result)`. Each field is text: build it with `wsprintf` into `probeArgs` and `probeResult`. `probeNote` writes a line of commentary, and `probeFinish` closes the file and exits Windows, which ends the recording.
- Ask each question so its answer is a record. That means the returned value, the structure that was filled in, or the pixels of a small memory bitmap read back with `GetBitmapBits`. Do not record a handle or anything else Windows is free to choose; record what can be derived from it instead.
- Build it, and record it on each display whose answer might differ, as [[guide:reproducing]] describes:

```shell
node scripts/oracle/build-probes.mjs <name>
node scripts/oracle/record.mjs <name>
node scripts/oracle/record.mjs <name> --display ega
```

- A probe whose answer belongs to the display driver is added to `PER_DISPLAY` in `scripts/oracle/per-display.mjs`, so that each display's recording keeps a name of its own. Otherwise, rename a second display's recording to `<name>-<display>.json` before recording the next.
- Commit the fixture. It is the only part of the pipeline that cannot be made again without the Windows media.

Some questions have no answer a program can read, such as how the TrueType interpreter rounded a value. For those, `scripts/oracle/fabricate.mjs` patches a font Windows already has so that the value is drawn where it can be seen. `record.mjs --font <fabrication>` then records against that font into `oracle/fixtures/fabricated/`.

## Replaying it

`test/oracle/replay.ts` turns each record back into a call on winbox.js. An adapter in `ADAPTERS`, keyed by the record's function name, takes the parsed arguments, calls the implementation, and returns the result formatted exactly as the probe formatted it. A record with no adapter is counted as not replayed, not as agreeing. The site shows those counts, so a probe without adapters is visible for what it is.

```shell
npx jest test/oracle/api_conformance_test.ts -t "<name> against"
```

A disagreement that cannot be fixed yet goes into `KNOWN_GAPS` in the same file. Its key is `probe:function`, or `probe-display:function` for one display. Its value says what is wrong and by how many records. The test then expects that function to fail, and it fails the suite once the function starts agreeing, so the entry must come out when the fix lands. A function with an open gap cannot be marked exact.

The full suite, `npx jest`, must pass before anything is committed. When it replays every fixture, it rewrites `kb/data/conformance.json`, the report the site's counts and badges come from. Commit that file with the fixture.

## Writing a page

Pages are Markdown files in `kb/`. `kb/README.md` has the full schema.

- A function's page is `kb/<module>/<name>.md`. A topic is in `kb/topics/`, a file format in `kb/formats/`, and a guide in `kb/guides/`.
- The front matter names the page, and a function's page gives its ordinal and its status for each Windows version. The build checks the ordinal against the Windows 3.1 binaries.
- A status must be backed by the recordings. `exact` needs at least one cited probe, and every record of every cited probe must agree with no known gap. `partial` needs a cited probe that has been recorded. `unrecorded` means winbox.js implements the function but nothing has recorded Windows doing it. `stub` means winbox.js does not implement it. The build refuses a page whose status the conformance report does not support.
- Put an evidence label before each claim: `[[measured]]` for a recording, `[[read out]]` for a binary (cite the module, segment and offset), `[[documented]]` for a published specification, `[[inferred]]` for reasoning nothing has confirmed, and `[[refused]]` for a reading that was tried and failed (give its count). Something nobody knows yet is written as "Not yet measured".
- Link with references the build resolves, or it fails. The forms are `[[fn:GDI.TextOut]]`, `[[topic:turned-text]]`, `[[format:fnt]]`, `[[guide:reproducing]]`, `[[probe:smearmod]]`, and `[[fonts:8u]]` for a section of `FONTS.md`. Every page a reference lands on lists the pages that link to it.
- `FONTS.md` is the long-form working notes behind the font pages. A font finding goes into both: the derivation in `FONTS.md`, and the rule with its evidence on the page.

Check a page with:

```shell
npm run kb
npx jest test/kb
```

The first command builds the site into `dist/kb/`, along with its search index. Open `dist/kb/index.html` to read the result.

## What never goes on the site

- The Microsoft SDK's reference text. Link to it or describe the behaviour in your own words. A function's signature is shown only as names and types.
- Windows binaries, fonts and drivers. Pages cite the module, segment and offset instead.
- Disassembly listings. A few instructions may be quoted where they are the evidence, never a routine.
- Third-party source code, including any font scaler source consulted while reading a binary. It is neither quoted nor linked, and it stays out of the repository.
- Glyph bitmaps, except where one is the evidence for a claim and is shown to demonstrate it. Never publish a face in bulk.

Content on the site is licensed CC BY-SA 4.0, and probes and fixtures are published with it. By contributing a page or a probe, you license it the same way.
