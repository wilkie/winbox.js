'use strict';

/** @namespace Sound */

import { Module } from './module.js';

import { DWORD, INT } from './types.js';

/**
 * What the installation's `SOUND.DRV`, the speaker's, answers, as `sndplay`
 * records it: `OpenSound` a voice, every time; a note of 99 an invalid
 * note, -5; and every other call nought, `CountVoiceNotes` too, however many
 * notes are queued. Nothing is played. A note is taken to be one of 0, a
 * rest, to 84, as documented.
 */
const answered = () => 0;

const S_SERDNT = -5;

function SetVoiceNote(voice: number, value: number) {
  void voice;

  return value < 0 || value > 84 ? S_SERDNT : 0;
}

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
      [() => 1, 'OpenSound', 0, [], INT],
      [() => undefined, 'CloseSound', 0, []],
      [answered, 'SetVoiceQueueSize', 4, [INT, INT], INT],
      [SetVoiceNote, 'SetVoiceNote', 8, [INT, INT, INT, INT], INT],
      [answered, 'SetVoiceAccent', 10, [INT, INT, INT, INT, INT], INT],
      [answered, 'SetVoiceEnvelope', 6, [INT, INT, INT], INT],
      [answered, 'SetSoundNoise', 4, [INT, INT], INT],
      [answered, 'SetVoiceSound', 8, [INT, DWORD, INT], INT],
      [answered, 'StartSound', 0, [], INT],
      // 10 //
      [answered, 'StopSound', 0, [], INT],
      [answered, 'WaitSoundState', 2, [INT], INT],
      [answered, 'SyncAllVoices', 0, [], INT],
      [answered, 'CountVoiceNotes', 2, [INT], INT],
      [Sound.stub, 'GetThresholdEvent', 0],
      [answered, 'GetThresholdStatus', 0, [], INT],
      [answered, 'SetVoiceThreshold', 4, [INT, INT], INT],
      [Sound.stub, 'DoBeep', 2],
      [Sound.stub, 'WEP', 2],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}
