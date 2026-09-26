'use strict';

/**
 * The network, of which there is none: USER hands these calls to a network
 * driver, and with none installed they answer that the network does not do
 * it. **Recorded** by `netcaps`: `WNetGetConnection` answers
 * `WN_NOT_SUPPORTED` (1) for every drive and writes nothing, and
 * `WNetGetCaps` answers nought for every index. File Manager took the stub's
 * success for a network drive at every letter.
 */

const WN_NOT_SUPPORTED = 1;

export function WNetGetConnection(this: any, _lpszLocalName: any, _lpszRemoteName: number, _cbRemoteName: number) {
  return WN_NOT_SUPPORTED;
}

export function WNetGetCaps(this: any, _nIndex: number) {
  return 0;
}
