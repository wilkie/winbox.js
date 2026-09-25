'use strict';

/** @namespace Sound */

import { Module } from './module.js';

import {
  BYTE,
  UBYTE,
  INT,
  UINT,
  FARPTR,
  DWORD,
  HLOCAL,
  HGLOBAL,
  HANDLE,
  Struct,
  BOOL,
  NEARPTR,
  LPCSTR,
  HWND,
} from './types.js';

import { midiOutGetNumDevs } from './mmsystem/midiOutGetNumDevs.js';
import { waveOutGetNumDevs } from './mmsystem/waveOutGetNumDevs.js';
import { waveOutOpen } from './mmsystem/waveOutOpen.js';

/**
 * The Win16 Sound system library.
 *
 * @memberof Win16
 */
export class Sound extends Module {
  static get name(): string {
    return 'SOUND';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\SOUND.DRV';
  }

  static get exports() {
    return [
      // 0 // "Multimedia Sound device driver "
      null,
      [Sound.stub, 'OpenSound', 0, [], INT],
      [Sound.stub, 'CloseSound', 0, []],
      [Sound.stub, 'SetVoiceQueueSize', 4],
      [Sound.stub, 'SetVoiceNote', 8],
      [Sound.stub, 'SetVoiceAccent', 10],
      [Sound.stub, 'SetVoiceEnvelope', 6],
      [Sound.stub, 'SetSoundNoise', 4],
      [Sound.stub, 'SetVoiceSound', 8],
      [Sound.stub, 'StartSound', 0],
      // 10 //
      [Sound.stub, 'StopSound', 0],
      [Sound.stub, 'WaitSoundState', 2],
      [Sound.stub, 'SyncAllVoices', 0],
      [Sound.stub, 'CountVoiceNotes', 2],
      [Sound.stub, 'GetThresholdEvent', 0],
      [Sound.stub, 'GetThresholdStatus', 0],
      [Sound.stub, 'SetVoiceThreshold', 4],
      [Sound.stub, 'DoBeep', 2],
      [Sound.stub, 'WEP', 2],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}
