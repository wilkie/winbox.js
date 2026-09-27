import { exportedConstant } from '../linker.js';
import { segmentSelector } from '../selectors.js';

export function GetProcAddress(hinst, lpszProcName) {
  const module = this.handles.resolve(hinst);

  /* A library loaded from its file: its own name tables and entry points. */
  if (module?.loader && typeof module.loader.ordinalOf === 'function') {
    const loader = module.loader;
    const ordinal =
      lpszProcName instanceof String || typeof lpszProcName == 'string'
        ? loader.ordinalOf(String(lpszProcName))
        : lpszProcName & 0xffff;
    const info = ordinal ? loader.lookup(ordinal) : null;

    return info && info.segment !== undefined
      ? ((segmentSelector(info.segment) << 16) | info.offset) >>> 0
      : 0;
  }

  /* A program's own module is not searched yet. */
  if (!module || !Array.isArray(module.exports)) {
    return 0;
  }

  const exports = module.exports;
  let ordinal: number;

  if (lpszProcName instanceof String || typeof lpszProcName == 'string') {
    const name = String(lpszProcName).toUpperCase();

    ordinal = exports.findIndex((entry) => entry && String(entry[1]).toUpperCase() === name);
  } else {
    ordinal = lpszProcName & 0xffff;
  }

  /* An ordinal the module does not export has no address. */
  if (ordinal <= 0 || !exports[ordinal]) {
    return 0;
  }

  /* A number rather than a function -- `__WINFLAGS`, `__AHINCR` -- is its
   * own value. */
  const constant = exportedConstant(module.name, ordinal);

  if (constant !== undefined) {
    return constant & 0xffff;
  }

  const info = this.modules.load(module).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}
