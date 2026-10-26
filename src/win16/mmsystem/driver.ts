'use strict';

import { DefDriverProc, OpenDriver } from '../user/drivers.js';
import { Kind, count, openAuxiliary, openWaveAndMidi } from './devices.js';
import { openJoysticks } from './joystick.js';
import { makeStacks } from './stacks.js';

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
 * The wave, MIDI and auxiliary drivers are opened and installed as
 * `devices.ts` says, the interrupt stacks made as `stacks.ts` says, and the
 * joystick's driver opened as `joystick.ts` says. Not followed: the window
 * MMSYSTEM makes for itself.
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

      /* The waveform and MIDI drivers, then the interrupt stacks if any
       * device came of them, then the auxiliary drivers (seg2 `101`). */
      await openWaveAndMidi(this);

      if (
        count(this, Kind.WaveOut) +
        count(this, Kind.WaveIn) +
        count(this, Kind.MidiOut) +
        count(this, Kind.MidiIn)
      ) {
        await makeStacks(this);
      }

      await openAuxiliary(this);

      state.joystick = await OpenDriver.call(this, 'joystick', null, 0);
      await openJoysticks(this, state.joystick);

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
