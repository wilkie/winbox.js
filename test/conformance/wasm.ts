import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Rust core, compiled to WebAssembly (`pnpm build:wasm`), when
 * `CONFORMANCE_CORE=wasm` asks for the suites to be run through it: each
 * vector's one instruction is then the Rust core's where it runs it, and the
 * JavaScript core's where it leaves it (`CPU.runFor`). Null otherwise.
 */
const WASM = join(
  __dirname,
  '..',
  '..',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'winbox_wasm.wasm'
);

export const wasmModule: WebAssembly.Module | null = (() => {
  if (process.env.CONFORMANCE_CORE !== 'wasm') {
    return null;
  }

  if (!existsSync(WASM)) {
    throw new Error(`CONFORMANCE_CORE=wasm, but ${WASM} is not built: pnpm build:wasm`);
  }

  return new WebAssembly.Module(readFileSync(WASM));
})();
