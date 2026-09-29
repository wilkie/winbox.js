'use strict';

import { DOS } from '../../src/dos.js';
import { Machine } from '../../src/emulator/machine.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { Win16 } from '../../src/win16.js';
import { loadLibrary } from '../../src/win16/library.js';
import { MciSeq, MciWave } from '../../src/win16/mmsystem/mci-drivers.js';
import { mmsystemString } from '../../src/win16/mmsystem/devices.js';
import { Timer } from '../../src/win16/timer.js';

/**
 * The modules winbox.js keeps itself are found by their files' names with no
 * file on the drive: no Windows file is shipped.
 */
describe('modules winbox.js keeps', () => {
  it('load by their files names from an empty drive', async function () {
    const machine = new Machine();
    const fileSystem: any = new FAT16(machine.disks[0]);

    await fileSystem.format();

    const win16: any = new Win16(new DOS(machine), machine, {});
    /* Its instance, as LoadLibrary answers it (`modhand`): 32 or more. */
    const handleOf = (module: any) => win16._modules.instanceFromPath(module.path);

    expect(await loadLibrary(win16, 'MCIWAVE.DRV', null)).toEqual(handleOf(MciWave));
    expect(await loadLibrary(win16, 'mciseq.drv', null)).toEqual(handleOf(MciSeq));
    expect(await loadLibrary(win16, 'C:\\WINDOWS\\SYSTEM\\TIMER.DRV', null)).toEqual(
      handleOf(Timer)
    );
    expect(handleOf(MciWave)).toBeGreaterThanOrEqual(32);
    expect(await loadLibrary(win16, 'MCICDA.DRV', null)).toBeLessThan(32);
  });

  it('carry their own strings, with no installation: MMSYSTEM', async function () {
    expect(await mmsystemString(null, 0)).toEqual('The specified command was carried out.');
    expect(await mmsystemString(null, 0x10a)).toEqual(
      'There is an undetectable problem in loading the specified device driver.'
    );
    expect(await mmsystemString(null, 0x20a)).toEqual('waveaudio');
    expect(await mmsystemString(null, 0x100)).toBeNull();
  });
});
