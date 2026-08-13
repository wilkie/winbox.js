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

### Filtering tests

To run a single file or a single name:

```shell
pnpm test test/emulator/alu_test.ts
pnpm test -t 'should detect zero'
```

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
