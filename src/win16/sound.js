"use strict";

/** @namespace Sound */

import { Module } from './module.js';

import { BYTE, UBYTE, INT, UINT, FARPTR,
         DWORD, HLOCAL, HGLOBAL, HANDLE, Struct,
         BOOL, NEARPTR, LPCSTR, HWND } from './types.js';

import { midiOutGetNumDevs } from './mmsystem/midiOutGetNumDevs.js';
import { waveOutGetNumDevs } from './mmsystem/waveOutGetNumDevs.js';
import { waveOutOpen } from './mmsystem/waveOutOpen.js';

/**
 * The Win16 Sound system library.
 *
 * @memberof Win16
 */
export class Sound extends Module {
    static get name() {
        return "SOUND";
    }

    static get path() {
        return "C:\\WINDOWS\\SYSTEM\\SOUND.DRV";
    }

    static get exports() {
        return [
            // 0 // "Multimedia Sound device driver "
            null,
            [Sound.stub, "OpenSound", 0, [], INT],
            [Sound.stub, "CloseSound", 0, []],
            [Sound.stub, "SetVoiceQueueSize"],
            [Sound.stub, "SetVoiceNote"],
            [Sound.stub, "SetVoiceAccent", 0],
            [Sound.stub, "SetVoiceEnvelope"],
            [Sound.stub, "SetSoundNoise"],
            [Sound.stub, "SetVoiceSound"],
            [Sound.stub, "StartSound"],
            // 10 //
            [Sound.stub, "StopSound"],
            [Sound.stub, "WaitSoundState"],
            [Sound.stub, "SyncAllVoices"],
            [Sound.stub, "CountVoiceNotes"],
            [Sound.stub, "GetThresholdEvent"],
            [Sound.stub, "GetThresholdStatus"],
            [Sound.stub, "SetVoiceThreshold"],
            [Sound.stub, "DoBeep"],
        ];
    }

    static stub() {
        console.log("Stub called!");
    }
}
