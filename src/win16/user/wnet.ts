'use strict';

/**
 * The network, of which there is none: USER hands these calls to a network
 * driver, and with none installed they answer that the network does not do
 * it. **Recorded** by `netcaps`: `WNetGetConnection` answers
 * `WN_NOT_SUPPORTED` (1) for every drive and writes nothing, and
 * `WNetGetCaps` answers nought for every index. File Manager took the stub's
 * success for a network drive at every letter.
 */

import { USER_STRINGS } from './strings.js';
import { wsprintf } from './wsprintf.js';

const WN_NOT_SUPPORTED = 1;

export function WNetGetConnection(this: any, _lpszLocalName: any, _lpszRemoteName: number, _cbRemoteName: number) {
  return WN_NOT_SUPPORTED;
}

export function WNetGetCaps(this: any, _nIndex: number) {
  return 0;
}

/**
 * The rest of USER's network calls: each goes to the network driver's
 * function from the table USER fills as Windows starts, and with none
 * answers 1, `WN_NOT_SUPPORTED` (`USER.EXE` seg22 `0770`-`0790`).
 * **Recorded** by `wnetall`. Not followed: the checks most make of their
 * arguments first, a pointer by touching it and a window by its class's
 * signature, which answer 4 or 5 for one that fails.
 */
export function WNetNotSupported(this: any) {
  return WN_NOT_SUPPORTED;
}

/** USER's string of network errors, the first: the format for one with no string of its own. */
const NETWORK_ERRORS = 0x113;

/** Where the code is put for `wsprintf` to read, in USER's data. */
const SCRATCH = 0xfffe;

/**
 * A network error's text (`USER.EXE` seg22 `005c`-`00e1`): for
 * `WN_NET_ERROR`, 2, the driver's own first, which with none there is
 * not; else USER's string 113h plus the code, as `LoadString` copies it;
 * where that copies nothing, string 113h filled with the code by
 * `wsprintf`, however small the buffer. The answer is the length.
 * **Recorded** by `wnetall`.
 */
export function WNetErrorText(this: any, wError: number, lpBuffer: number, cbBuffer: number) {
  const code = wError & 0xffff;
  const size = (cbBuffer << 16) >> 16;
  const text = USER_STRINGS.get((NETWORK_ERRORS + code) & 0xffff);
  const core = this.machine.cpu.core;
  const write = (bytes: number[]) =>
    bytes.forEach((byte, i) =>
      core.write8(lpBuffer >>> 16, ((lpBuffer & 0xffff) + i) & 0xffff, byte)
    );

  if (text !== undefined && size > 0 && lpBuffer) {
    const copied = Math.min(text.length, size - 1);

    if (copied) {
      write([...Array.from(text.slice(0, copied), (c) => c.charCodeAt(0)), 0]);
      return copied;
    }

    write([0]);
  }

  const data = this._moduleData?.USER ?? 0;

  core.write16(data, SCRATCH, code);

  return wsprintf.call(this, lpBuffer, USER_STRINGS.get(NETWORK_ERRORS) ?? '', ((data << 16) | SCRATCH) >>> 0);
}
