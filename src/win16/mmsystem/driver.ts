'use strict';

import { readProfile } from '../kernel/profiles.js';
import { DefDriverProc, OpenDriver } from '../user/drivers.js';

/**
 * MMSYSTEM as an installable driver: `SYSTEM.INI`'s `[boot]` names it in
 * `drivers=`, and USER loads it so as Windows starts.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg4 `28`, seg2 `101`):
 *
 * * `DRV_LOAD`, the first time, readies the multimedia drivers: it opens
 *   `timer`, then the wave, MIDI and auxiliary drivers `[drivers]` names --
 *   `wave`, `wave1` to `wave9` and the like -- then their mappers if any of
 *   them has a device, then `joystick`. It answers what that answers, 1;
 *   afterwards, 1.
 * * `DRV_ENABLE` ends the first time, and answers 1. `DRV_OPEN`,
 *   `DRV_CLOSE`, `DRV_DISABLE`, `DRV_FREE`, `DRV_EXITSESSION` and
 *   `DRV_EXITAPPLICATION` answer 1; the rest, as `DefDriverProc` would.
 *
 * `timer` opening first is why it comes first in USER's list of drivers:
 * it is linked while MMSYSTEM, whose load opened it, is not yet.
 *
 * Not followed: wave, MIDI and auxiliary drivers, which winbox.js's MMSYSTEM
 * does not take from files -- the installation names none, and so opens no
 * mapper; and what MMSYSTEM does with a joystick driver once opened, which
 * the installation does not have.
 */
export async function DriverProc(
  this: any,
  dwDriverIdentifier: number,
  hDriver: number,
  wMessage: number,
  lParam1: number,
  lParam2: number
) {
  const state = (this._mmsystemDriver ??= { pending: true, timer: 0, joystick: 0 });

  switch (wMessage) {
    case 1: {
      if (!state.pending) {
        return 1;
      }

      state.timer = await OpenDriver.call(this, 'timer', null, 0);

      /* The drivers of devices it would install, looked for as MMSYSTEM
       * looks: none here. */
      const profile = await readProfile(this, 'system.ini');

      for (const kind of ['wave', 'midi', 'aux']) {
        for (const key of [kind, ...Array.from({ length: 9 }, (_, i) => `${kind}${i + 1}`)]) {
          if (profile.get('Drivers', key)) {
            this.debug?.('MMSYSTEM does not load device driver', key);
          }
        }
      }

      state.joystick = await OpenDriver.call(this, 'joystick', null, 0);

      return 1;
    }

    case 2:
      state.pending = false;
      return 1;

    case 3:
    case 4:
    case 5:
    case 6:
    case 0xb:
    case 0xc:
      return 1;

    default:
      return DefDriverProc.call(this, dwDriverIdentifier, hDriver, wMessage, lParam1, lParam2);
  }
}
