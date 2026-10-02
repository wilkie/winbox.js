import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Rust core, compiled to WebAssembly (`pnpm build:wasm`), when
 * `WINBOX_CORE=wasm` asks for the tests to be run through it: every machine
 * a test makes runs it beside the JavaScript core (`Machine.defaultCore`),
 * and the conformance suites give it each vector's one instruction. An
 * instruction is then the Rust core's where it runs it, and the JavaScript
 * core's where it leaves it (`CPU.runFor`). Null otherwise.
 */
const WASM = join(
  __dirname,
  '..',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'winbox_wasm.wasm'
);

export const wasmModule: WebAssembly.Module | null = (() => {
  if (process.env.WINBOX_CORE !== 'wasm') {
    return null;
  }

  if (!existsSync(WASM)) {
    throw new Error(`WINBOX_CORE=wasm, but ${WASM} is not built: pnpm build:wasm`);
  }

  return new WebAssembly.Module(readFileSync(WASM));
})();
