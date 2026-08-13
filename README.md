# WinBox.js

This project is an ambitious clean-room implementation of the Windows 3.1 kernel
and userspace libraries. This provides an HTML-powered windowing engine that
mimics the Windows 3.1 interface to provide a preservation quality software
archival solution.

The goals are many but mainly focused around:

- High compatibility with many popular-in-their-time applications and games.
- Modern HTML accessibility, including support for screen-readers.
- Wrapping older win16 libraries and using them in your own modern web-applications.
- Support for building new, potentially anachronistic, pseudo-win16 applications using the 16-bit windows API.

## Development

The project is written in TypeScript, built with [Vite](https://vite.dev/), and
managed with [pnpm](https://pnpm.io/). You will need **Node 22 or newer**; the
version is pinned in `.nvmrc`, so with `nvm` installed you can run:

```shell
nvm use
```

`pnpm` ships with Node via corepack. Enable it once, then install the
dependencies:

```shell
corepack enable pnpm
pnpm install
```

To poke at the windowing engine in a real browser, start the dev server. It
serves the demo page in `index.html` with hot module replacement:

```shell
pnpm dev
```

## Building

To build a web bundle:

```shell
pnpm build
```

This produces two files in the `dist` directory. The `winbox.js` file is the web
bundle, a single file containing the entire source for the entire project
namespace. The `winbox.css` file contains the entire css stylesheets that makes
things look the way they do. Both are emitted with source maps.

The Vite configuration is within `vite.config.ts`. Stylesheets are compiled from
the Sass sources in `css/`, which `src/shim.ts` pulls into the bundle.

### Task running

Builds, lints, typechecks and tests are wired into
[Turbo](https://turborepo.com/), which runs them in parallel and caches results.
Repeating an unchanged task is close to instant:

```shell
pnpm turbo run lint typecheck test build
```

The individual tasks are also plain scripts, if you prefer:

| Command           | What it does                                |
| ----------------- | ------------------------------------------- |
| `pnpm dev`        | Dev server with the demo page               |
| `pnpm build`      | Production bundle into `dist/`              |
| `pnpm typecheck`  | `tsc --noEmit` over `src`, `test` and `e2e` |
| `pnpm lint`       | ESLint over the TypeScript sources          |
| `pnpm lint:fix`   | ESLint with autofix                         |
| `pnpm lint:css`   | Stylelint over the Sass sources             |
| `pnpm format`     | Prettier over the repository                |
| `pnpm test`       | Jest unit tests                             |
| `pnpm test:e2e`   | Playwright browser tests                    |
| `pnpm build:docs` | API documentation into `docs/`              |

## Documentation

To create a web-based HTML version of the documentation:

```shell
pnpm build:docs
```

This creates an HTML document and associated files in the `docs` directory.
If you open the `index.html` file in your local web browser, you can access a
searchable version of the project documentation.

This documentation is all parsed from the comment blocks that start with a slash
and two asterisks (`/**`) and are all already accessible in the code themselves.

## Testing

There are two suites. Unit tests for the emulator run in
[Jest](https://jestjs.io/) under Node:

```shell
pnpm test
```

Browser-level tests run in [Playwright](https://playwright.dev/) against the
demo page, in both Chromium and Firefox:

```shell
pnpm exec playwright install    # once, to fetch the browsers
pnpm test:e2e
```

> **Known failure:** the emulator unit suite is currently red, and was already
> red before the TypeScript migration. The ALU moved onto the CPU core
> (`I286`/`I386`), but the `MockCPU` helper still constructs `new ALU(cpu)` with
> the `CPU` wrapper, and `CPU#alu` is never assigned. Nearly every ALU and
> `cpu_execute` test therefore throws on `this._cpu._flags`. Pointing the helper
> at `cpu.core` recovers roughly 200 of them; the rest need a closer look at
> where flag state should live.

### CPU conformance

The emulator is measured against hardware. The
[SingleStepTests 80286 suite](https://github.com/SingleStepTests/80286) records
the complete register, flag and memory state before and after each instruction,
captured from a real Harris N80C286. Our core is put into the recorded initial
state, executes one instruction, and is compared against what the silicon did.

The vectors are ~310 MiB and are not committed, so fetch them first:

```shell
pnpm test:conformance:fetch       # a representative subset, ~135 MiB
pnpm test:conformance
```

`node scripts/fetch-cpu-tests.mjs --all` fetches everything, `--list` shows what
the suite publishes, and naming opcodes fetches only those.

The run writes `test/conformance/report.md` with a per-opcode table and a
representative failure for each kind, and checks every opcode against
`test/conformance/baseline.json`. The core does not pass these tests yet, so the
baseline is what guards against regression: passing fewer than the recorded
count fails the run. Re-record after an improvement:

```shell
CONFORMANCE_UPDATE=1 pnpm test:conformance
```

Regression checking only applies when `CONFORMANCE_SAMPLE` matches the sample
the baseline was recorded at, since pass rates are not uniform across an
opcode's vectors.

### Filtering tests

To run a single file or a single name:

```shell
pnpm test test/emulator/alu_test.ts
pnpm test -t 'should detect zero'
```

### Reproducing a test run

Tests draw their operands from a seeded generator, and the seed is printed at
the start of every run:

```
Random seed: 2748491327 (re-run with WINBOX_TEST_SEED=2748491327 to reproduce)
```

Each test re-seeds from its own name, so a test draws the same values whether it
runs alone or in the middle of the full suite — `pnpm test -t 'name'` reproduces
exactly what CI saw.

Jest also has a watch mode that re-runs affected tests as you edit:

```shell
pnpm test:watch
```

For the browser suite, Playwright's UI mode is the equivalent:

```shell
pnpm test:e2e --ui
```

## Code style

Formatting is handled by [Prettier](https://prettier.io/) and is not something
to think about; run `pnpm format` or let your editor do it on save.

ESLint currently reports a large number of _warnings_. These are migration debt
from the mechanical JavaScript to TypeScript conversion (unused variables,
`var`, dead stores) and are deliberately not errors, so that a clean `pnpm lint`
still means something in CI. Errors are reserved for newly introduced problems.

Likewise, `tsconfig.json` runs with `strict` and `noImplicitAny` off. Class
members carry `declare` annotations that the migration generated, and are typed
`any`. Tightening these one flag and one module at a time is the intended path.
