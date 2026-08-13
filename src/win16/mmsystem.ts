'use strict';

/** @namespace MMSystem */

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
 * The Win16 Multimedia System library.
 *
 * @memberof Win16
 */
export class MMSystem extends Module {
  declare static CALLBACK_FUNCTION: any;
  declare static CALLBACK_TASK: any;
  declare static CALLBACK_WINDOW: any;
  declare static JOYERR_BASE: any;
  declare static MCIERR_BASE: any;
  declare static MIDIERR_BASE: any;
  declare static MMSYSERR_ALLOCATED: any;
  declare static MMSYSERR_BADDEVICEID: any;
  declare static MMSYSERR_BADERRNUM: any;
  declare static MMSYSERR_BASE: any;
  declare static MMSYSERR_ERROR: any;
  declare static MMSYSERR_INVALFLAG: any;
  declare static MMSYSERR_INVALHANDLE: any;
  declare static MMSYSERR_INVALPARAM: any;
  declare static MMSYSERR_LASTERROR: any;
  declare static MMSYSERR_NODRIVER: any;
  declare static MMSYSERR_NOERROR: any;
  declare static MMSYSERR_NOMEM: any;
  declare static MMSYSERR_NOTENABLED: any;
  declare static MMSYSERR_NOTSUPPORTED: any;
  declare static TIMERR_BASE: any;
  declare static WAVERR_BASE: any;
  declare static WAVE_ALLOWSYNC: any;
  declare static WAVE_FORMAT_PCM: any;
  declare static WAVE_FORMAT_QUERY: any;
  declare static WAVE_MAPPER: any;
  static get name(): string {
    return 'MMSYSTEM';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\MMSYSTEM.DLL';
  }

  static get exports() {
    return [
      // 0 // "System APIs for Multimedia"
      null,
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'sndPlaySound', 0],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'mmsystemGetVersion', 0],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 10 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 20 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 30 //
      [MMSystem.stub, 'OutputDebugStr', 0],
      [MMSystem.stub, 'DriverCallback', 0],
      [MMSystem.stub, 'StackEnter', 0],
      [MMSystem.stub, 'StackLeave', 0],
      [MMSystem.stub, 'mmDrvInstall', 0],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 40 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 50 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 60 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 70 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 80 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 90 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 100 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'joyGetNumDevs'],
      [MMSystem.stub, 'joyGetNumCaps'],
      [MMSystem.stub, 'joyGetPos'],
      [MMSystem.stub, 'joyGetThreshold'],
      [MMSystem.stub, 'joyReleaseCapture'],
      [MMSystem.stub, 'joySetCapture'],
      [MMSystem.stub, 'joySetThreshold'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'joySetCalibration'],
      // 110 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 120 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 130 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 140 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 150 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 160 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 170 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 180 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 190 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 200 //
      [MMSystem.stub, 'unknown'],
      [midiOutGetNumDevs, 'midiOutGetNumDevs', 0, [], UINT],
      [MMSystem.stub, 'midiOutGetDevCaps'],
      [MMSystem.stub, 'midiOutGetErrorText'],
      [MMSystem.stub, 'midiOutOpen'],
      [MMSystem.stub, 'midiOutClose'],
      [MMSystem.stub, 'midiOutPrepareHeader'],
      [MMSystem.stub, 'midiOutUnprepareHeader'],
      [MMSystem.stub, 'midiOutShortMsg'],
      [MMSystem.stub, 'midiOutLongMsg'],
      // 210 //
      [MMSystem.stub, 'midiOutReset'],
      [MMSystem.stub, 'midiOutGetVolume'],
      [MMSystem.stub, 'midiOutSetVolume'],
      [MMSystem.stub, 'midiOutCachePatches'],
      [MMSystem.stub, 'midiOutCacheDrumPatches'],
      [MMSystem.stub, 'midiOutGetID'],
      [MMSystem.stub, 'midiOutMessage'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 220 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 230 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 240 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 250 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 260 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 270 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 280 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 290 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 300 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'midiInGetNumDevs'],
      [MMSystem.stub, 'midiInGetDevCaps'],
      [MMSystem.stub, 'midiInGetErrorText'],
      [MMSystem.stub, 'midiInOpen'],
      [MMSystem.stub, 'midiInClose'],
      [MMSystem.stub, 'midiInPrepareHeader'],
      [MMSystem.stub, 'midiInUnprepareHeader'],
      [MMSystem.stub, 'midiInAddBuffer'],
      [MMSystem.stub, 'midiInStart'],
      // 310 //
      [MMSystem.stub, 'midiInStop'],
      [MMSystem.stub, 'midiInReset'],
      [MMSystem.stub, 'midiInGetID'],
      [MMSystem.stub, 'midiInMessage'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 320 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 330 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 340 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 350 //
      [MMSystem.stub, 'auxGetNumDevs'],
      [MMSystem.stub, 'auxGetDevCaps'],
      [MMSystem.stub, 'auxGetVolume'],
      [MMSystem.stub, 'auxSetVolume'],
      [MMSystem.stub, 'auxOutMessage'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 360 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 370 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 380 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 390 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 400 //
      [MMSystem.stub, 'unknown'],
      [waveOutGetNumDevs, 'waveOutGetNumDevs', 0, [], UINT],
      [MMSystem.stub, 'waveOutGetDevCaps'],
      [MMSystem.stub, 'waveOutGetErrorText'],
      [waveOutOpen, 'waveOutOpen', 22, [FARPTR, UINT, [WAVEFORMAT], DWORD, DWORD, DWORD], UINT],
      [MMSystem.stub, 'waveOutClose'],
      [MMSystem.stub, 'waveOutPrepareHeader'],
      [MMSystem.stub, 'waveOutUnprepareHeader'],
      [MMSystem.stub, 'waveOutWrite'],
      [MMSystem.stub, 'waveOutPause'],
      // 410 //
      [MMSystem.stub, 'waveOutRestart'],
      [MMSystem.stub, 'waveOutReset'],
      [MMSystem.stub, 'waveOutGetPosition'],
      [MMSystem.stub, 'waveOutGetPitch'],
      [MMSystem.stub, 'waveOutSetPitch'],
      [MMSystem.stub, 'waveOutGetVolume'],
      [MMSystem.stub, 'waveOutSetVolume'],
      [MMSystem.stub, 'waveOutGetPlaybackRate'],
      [MMSystem.stub, 'waveOutSetPlaybackRate'],
      [MMSystem.stub, 'waveOutBreakLoop'],
      // 420 //
      [MMSystem.stub, 'waveOutGetID'],
      [MMSystem.stub, 'waveOutMessage'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 430 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 440 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 450 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 460 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 470 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 480 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 490 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 500 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'waveInGetNumDevs'],
      [MMSystem.stub, 'waveInGetDevCaps'],
      [MMSystem.stub, 'waveInGetErrorText'],
      [MMSystem.stub, 'waveInOpen'],
      [MMSystem.stub, 'waveInClose'],
      [MMSystem.stub, 'waveInPrepareHeader'],
      [MMSystem.stub, 'waveInUnprepareHeader'],
      [MMSystem.stub, 'waveInAddBuffer'],
      [MMSystem.stub, 'waveInStart'],
      // 510 //
      [MMSystem.stub, 'waveInStop'],
      [MMSystem.stub, 'waveInReset'],
      [MMSystem.stub, 'waveInGetPosition'],
      [MMSystem.stub, 'waveInGetID'],
      [MMSystem.stub, 'waveInMessage'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 520 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 530 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 540 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 550 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 560 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 570 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 580 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 590 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 600 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'timeGetSystemTime'],
      [MMSystem.stub, 'timeSetEvent'],
      [MMSystem.stub, 'timeKillEvent'],
      [MMSystem.stub, 'timeGetDevCaps'],
      [MMSystem.stub, 'timeBeginPeriod'],
      [MMSystem.stub, 'timeEndPeriod'],
      [MMSystem.stub, 'timeGetTime'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 610 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 620 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 630 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 640 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 650 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 660 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 670 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 680 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 690 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'unknown'],
      // 700 //
      [MMSystem.stub, 'unknown'],
      [MMSystem.stub, 'mciSendCommand'],
      [MMSystem.stub, 'mciSendString'],
      [MMSystem.stub, 'mciGetDeviceID'],
      [MMSystem.stub, 'mciParseCommand'],
      [MMSystem.stub, 'mciLoadCommandResource'],
      [MMSystem.stub, 'mciGetErrorString'],
      [MMSystem.stub, 'mciSetDriverData'],
      [MMSystem.stub, 'mciGetDriverData'],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

/**
 * The **WAVEFORMAT** structure describes the format of waveform data. Only
 * format information common to all waveform data formats is included in this
 * structure. For formats that require additional information, this structure is
 * included as a field in another data structure along with the additional
 * information.
 */
export class WAVEFORMAT extends Struct {
  constructor() {
    super([
      ['wFormatTag', UINT], // format type. WAVE_FORMAT_PCM
      ['nChannels', UINT], // channels
      ['nSamplesPerSec', DWORD], // sample rate (samples per second)
      ['nAvgBytesPerSec', DWORD], // transfer rate (bytes per second)
      ['nBlockAlign', UINT], // block alignment in bytes
    ]);
  }
}

// waveOutOpen Constants
// ---------------------

/**
 * If this flag is specified, the device is be queried to determine if it
 * supports the given format but is not actually opened.
 *
 * @static
 * @constant {number}
 * @memberof MMSystem
 */
MMSystem.WAVE_FORMAT_QUERY = 0x0001;

/**
 * Allows a synchronous (blocking) waveform driver to be opened. If this flag is
 * not set while opening a synchronous driver, the open will fail.
 *
 * @static
 * @constant {number}
 * @memberof MMSystem
 */
MMSystem.WAVE_ALLOWSYNC = 0x0002;

/**
 * If this flag is specified, dwCallback is assumed to be a window handle.
 *
 * @static
 * @constant {number}
 * @memberof MMSystem
 */
MMSystem.CALLBACK_WINDOW = 0x10000;

MMSystem.CALLBACK_TASK = 0x20000;

/**
 * If this flag is specified, dwCallback is assumed to be a callback procedure
 * address.
 *
 * @static
 * @constant {number}
 * @memberof MMSystem
 */
MMSystem.CALLBACK_FUNCTION = 0x30000;

/**
 * Specifies that the wave format being queried or opened is PCM.
 *
 * @static
 * @constant {number}
 * @memberof MMSystem
 */
MMSystem.WAVE_FORMAT_PCM = 0x1;

/**
 * Specifies the device id is the wave mapper device.
 *
 * @static
 * @constant {number}
 * @memberof MMSystem
 */
MMSystem.WAVE_MAPPER = 0xffff; // -1

// General Error Values
// --------------------

MMSystem.MMSYSERR_BASE = 0x0; // 0
MMSystem.WAVERR_BASE = 0x20; // 32
MMSystem.MIDIERR_BASE = 0x40; // 64
MMSystem.TIMERR_BASE = 0x60; // 96
MMSystem.JOYERR_BASE = 0xa0; // 160
MMSystem.MCIERR_BASE = 0x100; // 256

MMSystem.MMSYSERR_NOERROR = 0x0;
MMSystem.MMSYSERR_ERROR = MMSystem.MMSYSERR_BASE + 1;
MMSystem.MMSYSERR_BADDEVICEID = MMSystem.MMSYSERR_BASE + 2;
MMSystem.MMSYSERR_NOTENABLED = MMSystem.MMSYSERR_BASE + 3;
MMSystem.MMSYSERR_ALLOCATED = MMSystem.MMSYSERR_BASE + 4;
MMSystem.MMSYSERR_INVALHANDLE = MMSystem.MMSYSERR_BASE + 5;
MMSystem.MMSYSERR_NODRIVER = MMSystem.MMSYSERR_BASE + 6;
MMSystem.MMSYSERR_NOMEM = MMSystem.MMSYSERR_BASE + 7;
MMSystem.MMSYSERR_NOTSUPPORTED = MMSystem.MMSYSERR_BASE + 8;
MMSystem.MMSYSERR_BADERRNUM = MMSystem.MMSYSERR_BASE + 9;
MMSystem.MMSYSERR_INVALFLAG = MMSystem.MMSYSERR_BASE + 10;
MMSystem.MMSYSERR_INVALPARAM = MMSystem.MMSYSERR_BASE + 11;
MMSystem.MMSYSERR_LASTERROR = MMSystem.MMSYSERR_BASE + 11;
