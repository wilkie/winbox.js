import { segmentSelector } from '../selectors.js';

export function GetProcAddress(hinst, lpszProcName) {
  const module = this.handles.resolve(hinst);

  /* Only the system's own modules answer: a program's module and the
   * libraries it brings are not searched yet. */
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

  const info = this.modules.load(module).lookup(ordinal);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}
