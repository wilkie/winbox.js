'use strict';

/** @namespace Sound */

import { Module } from './module.js';

import { MMSystem } from './mmsystem.js';
import { DWORD, INT, LPCSTR } from './types.js';

/**
 * What the installation's `SOUND.DRV`, the speaker's, answers, as `sndplay`
 * records it: a note of 99 an invalid note, -5; and every other call
 * nought, `CountVoiceNotes` too, however many notes are queued. Nothing is
 * played. A note is taken to be one of 0, a rest, to 84, as documented.
 */
const answered = () => 0;

const S_SERDNT = -5;

function SetVoiceNote(voice: number, value: number) {
  void voice;

  return value < 0 || value > 84 ? S_SERDNT : 0;
}

/** `S_SERDVNA`: the device is another task's. */
const S_SERDVNA = -1;

/** Where the driver keeps the task that has it open (`[90h]`). */
const OWNER = 0x90;

/** The word of threshold flags `GetThresholdEvent` points at (`[84h]`). */
const THRESHOLD = 0x84;

/** The driver's data segment's selector. */
function soundData(system: any): number {
  return system._moduleData?.SOUND ?? 0;
}

/** The task that has the driver open, nought for none. */
function owner(system: any): number {
  const segment = soundData(system);

  return segment ? system.machine.cpu.core.read16(segment, OWNER) : 0;
}

/**
 * The driver for the task that asks, as long as no other has it: 1, a
 * voice, or -1, `S_SERDVNA`, where it is open already, the asker's or
 * another's (`SOUND.DRV` seg1 `03f8`-`0409`, `046c`). **Recorded** by
 * `snddrv`: a second `OpenSound` -1, and 1 again once closed.
 */
export function OpenSound(this: any) {
  const segment = soundData(this);
  const task = this.scheduler?.active ?? 0;

  if (!segment || owner(this) || !task) {
    return S_SERDVNA;
  }

  this.machine.cpu.core.write16(segment, OWNER, task);

  return 1;
}

/** The driver let go, where the task that has it asks (seg1 `04af`-`04bb`). */
export function CloseSound(this: any) {
  const segment = soundData(this);
  const task = this.scheduler?.active ?? 0;

  if (segment && task && owner(this) === task) {
    this.machine.cpu.core.write16(segment, OWNER, 0);
  }
}

/**
 * A pointer to the word of threshold flags `GetThresholdStatus` answers and
 * clears, in the driver's data, for the task that has it open; for any
 * other AX nought, and DX as the caller left it (seg1 `06e5`-`06fb`).
 * **Recorded** by `snddrv`: offset 84h, and the word nought.
 */
export function GetThresholdEvent(this: any) {
  const segment = soundData(this);
  const task = this.scheduler?.active ?? 0;

  if (segment && task && owner(this) === task) {
    return ((segment << 16) | THRESHOLD) >>> 0;
  }

  return ((this.machine.cpu.core.dx & 0xffff) << 16) >>> 0;
}

/**
 * The beep `MessageBeep` asks the driver for (`USER.EXE` seg1 `1bc9`), read
 * out of `SOUND.DRV` (seg1 `000a`-`0052`): -1, the speaker's; any other
 * names a sound by its icon, the second hexadecimal digit -- nought
 * `SystemDefault`, then `SystemHand`, `SystemQuestion`,
 * `SystemExclamation` and `SystemAsterisk`, more `SystemDefault` --
 * played with MMSYSTEM's `sndPlaySound` and `SND_ASYNC`; where that answers
 * nought, the speaker. What it leaves in AX is no answer.
 *
 * Not followed: the speaker, which WinBox does not sound.
 */
export async function DoBeep(this: any, nAlert: number) {
  const kind = nAlert & 0xffff;
  const segment = soundData(this);

  if (kind === 0xffff || !segment) {
    return;
  }

  /* The names, where the driver keeps them in its data (10h on). */
  const core = this.machine.cpu.core;
  let at = SOUND_NAMES_AT;
  const offsets = SOUND_NAMES.map((name) => {
    const offset = at;

    for (let i = 0; i <= name.length; i++) {
      core.write8(segment, at++, i < name.length ? name.charCodeAt(i) : 0);
    }

    return offset;
  });
  const index = (kind & 0xf0) >> 4;
  const which = index < SOUND_NAMES.length ? index : 0;
  const entry = MMSystem.exports.find((one: any) => one?.[1] === 'sndPlaySound');

  if (entry && typeof entry[0] === 'function') {
    const name = entry[3]?.[0] === LPCSTR ? SOUND_NAMES[which] : (segment << 16) | offsets[which];

    await entry[0].call(this, name, SND_ASYNC);
  }
}

/** The sounds' names, as the driver keeps them in its data from 10h. */
const SOUND_NAMES = [
  'SystemDefault',
  'SystemHand',
  'SystemQuestion',
  'SystemExclamation',
  'SystemAsterisk',
];

const SOUND_NAMES_AT = 0x10;

/** `sndPlaySound`'s flag to play and go on. */
const SND_ASYNC = 1;

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
      [OpenSound, 'OpenSound', 0, [], INT],
      [CloseSound, 'CloseSound', 0, []],
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
      [GetThresholdEvent, 'GetThresholdEvent', 0, [], DWORD],
      [answered, 'GetThresholdStatus', 0, [], INT],
      [answered, 'SetVoiceThreshold', 4, [INT, INT], INT],
      [DoBeep, 'DoBeep', 2, [INT]],
      [() => 1, 'WEP', 2, [INT], INT],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}
