/*
 * What MMSYSTEM's waveform, MIDI and auxiliary calls answer before a driver
 * hears of them -- handles that are no device's, pointers and sizes it
 * refuses, flags it refuses, error numbers it has no text for -- on an
 * installation with no sound driver and (`--display vgasound`) on the one
 * with the Sound Blaster.
 *
 * * `handle`: each call on a handle, given one that is no device's
 *   (1234h) and nought.
 * * `id`: each call on a device's number, for device 0, device 5 and the
 *   mapper's, and with sizes of nought.
 * * `open`: opening with flags, callbacks and pointers MMSYSTEM refuses, and
 *   the handle each leaves.
 * * `text`: the error texts for numbers in and out of each kind's range, in
 *   buffers of one byte, five, and none.
 */

#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMNODEV.OUT"

static PCMWAVEFORMAT format;
static WAVEHDR waveHeader;
static MIDIHDR midiHeader;
static char data[64];
static WORD patches[128];

static void result(LPCSTR function, LPCSTR args, DWORD value)
{
    wsprintf(probeResult, "%lu", value);
    probe(function, args, probeResult);
}

static void handles(UINT h)
{
    char args[32];
    MMTIME time;
    DWORD dword = 0x12345678L;
    UINT id = 0x4321;

#define ARGS(name) (wsprintf(args, "%s,%x", (LPSTR)name, h), (LPSTR)args)

    result("handle", ARGS("waveOutClose"), waveOutClose((HWAVEOUT)h));
    result("handle", ARGS("waveOutPrepareHeader"), waveOutPrepareHeader((HWAVEOUT)h, &waveHeader, sizeof(waveHeader)));
    result("handle", ARGS("waveOutUnprepareHeader"), waveOutUnprepareHeader((HWAVEOUT)h, &waveHeader, sizeof(waveHeader)));
    result("handle", ARGS("waveOutWrite"), waveOutWrite((HWAVEOUT)h, &waveHeader, sizeof(waveHeader)));
    result("handle", ARGS("waveOutPause"), waveOutPause((HWAVEOUT)h));
    result("handle", ARGS("waveOutRestart"), waveOutRestart((HWAVEOUT)h));
    result("handle", ARGS("waveOutReset"), waveOutReset((HWAVEOUT)h));
    result("handle", ARGS("waveOutBreakLoop"), waveOutBreakLoop((HWAVEOUT)h));
    time.wType = TIME_BYTES;
    result("handle", ARGS("waveOutGetPosition"), waveOutGetPosition((HWAVEOUT)h, &time, sizeof(time)));
    result("handle", ARGS("waveOutGetPitch"), waveOutGetPitch((HWAVEOUT)h, &dword));
    result("handle", ARGS("waveOutSetPitch"), waveOutSetPitch((HWAVEOUT)h, 0x10000L));
    result("handle", ARGS("waveOutGetPlaybackRate"), waveOutGetPlaybackRate((HWAVEOUT)h, &dword));
    result("handle", ARGS("waveOutSetPlaybackRate"), waveOutSetPlaybackRate((HWAVEOUT)h, 0x10000L));
    result("handle", ARGS("waveOutGetID"), waveOutGetID((HWAVEOUT)h, &id));
    result("handle", ARGS("waveOutMessage"), waveOutMessage((HWAVEOUT)h, 0x4000, 1L, 2L));
    wsprintf(probeResult, "%lx,%x", dword, id);
    probe("handle", ARGS("waveOut-left"), probeResult);

    result("handle", ARGS("waveInClose"), waveInClose((HWAVEIN)h));
    result("handle", ARGS("waveInPrepareHeader"), waveInPrepareHeader((HWAVEIN)h, &waveHeader, sizeof(waveHeader)));
    result("handle", ARGS("waveInUnprepareHeader"), waveInUnprepareHeader((HWAVEIN)h, &waveHeader, sizeof(waveHeader)));
    result("handle", ARGS("waveInAddBuffer"), waveInAddBuffer((HWAVEIN)h, &waveHeader, sizeof(waveHeader)));
    result("handle", ARGS("waveInStart"), waveInStart((HWAVEIN)h));
    result("handle", ARGS("waveInStop"), waveInStop((HWAVEIN)h));
    result("handle", ARGS("waveInReset"), waveInReset((HWAVEIN)h));
    result("handle", ARGS("waveInGetPosition"), waveInGetPosition((HWAVEIN)h, &time, sizeof(time)));
    result("handle", ARGS("waveInGetID"), waveInGetID((HWAVEIN)h, &id));
    result("handle", ARGS("waveInMessage"), waveInMessage((HWAVEIN)h, 0x4000, 1L, 2L));

    result("handle", ARGS("midiOutClose"), midiOutClose((HMIDIOUT)h));
    result("handle", ARGS("midiOutPrepareHeader"), midiOutPrepareHeader((HMIDIOUT)h, &midiHeader, sizeof(midiHeader)));
    result("handle", ARGS("midiOutUnprepareHeader"), midiOutUnprepareHeader((HMIDIOUT)h, &midiHeader, sizeof(midiHeader)));
    result("handle", ARGS("midiOutShortMsg"), midiOutShortMsg((HMIDIOUT)h, 0x403c90L));
    result("handle", ARGS("midiOutLongMsg"), midiOutLongMsg((HMIDIOUT)h, &midiHeader, sizeof(midiHeader)));
    result("handle", ARGS("midiOutReset"), midiOutReset((HMIDIOUT)h));
    result("handle", ARGS("midiOutCachePatches"), midiOutCachePatches((HMIDIOUT)h, 0, patches, MIDI_CACHE_ALL));
    result("handle", ARGS("midiOutCacheDrumPatches"), midiOutCacheDrumPatches((HMIDIOUT)h, 0, patches, MIDI_CACHE_ALL));
    result("handle", ARGS("midiOutGetID"), midiOutGetID((HMIDIOUT)h, &id));
    result("handle", ARGS("midiOutMessage"), midiOutMessage((HMIDIOUT)h, 0x4000, 1L, 2L));

    result("handle", ARGS("midiInClose"), midiInClose((HMIDIIN)h));
    result("handle", ARGS("midiInPrepareHeader"), midiInPrepareHeader((HMIDIIN)h, &midiHeader, sizeof(midiHeader)));
    result("handle", ARGS("midiInUnprepareHeader"), midiInUnprepareHeader((HMIDIIN)h, &midiHeader, sizeof(midiHeader)));
    result("handle", ARGS("midiInAddBuffer"), midiInAddBuffer((HMIDIIN)h, &midiHeader, sizeof(midiHeader)));
    result("handle", ARGS("midiInStart"), midiInStart((HMIDIIN)h));
    result("handle", ARGS("midiInStop"), midiInStop((HMIDIIN)h));
    result("handle", ARGS("midiInReset"), midiInReset((HMIDIIN)h));
    result("handle", ARGS("midiInGetID"), midiInGetID((HMIDIIN)h, &id));
    result("handle", ARGS("midiInMessage"), midiInMessage((HMIDIIN)h, 0x4000, 1L, 2L));
    wsprintf(probeResult, "%x", id);
    probe("handle", ARGS("midi-left"), probeResult);
#undef ARGS
}

static void ids(UINT device)
{
    char args[32];
    char caps[128];
    DWORD volume = 0x12345678L;

#define ARGS(name) (wsprintf(args, "%s,%x", (LPSTR)name, device), (LPSTR)args)

    result("id", ARGS("waveOutGetDevCaps"), waveOutGetDevCaps(device, (LPWAVEOUTCAPS)caps, sizeof(WAVEOUTCAPS)));
    result("id", ARGS("waveOutGetDevCaps-0"), waveOutGetDevCaps(device, (LPWAVEOUTCAPS)caps, 0));
    result("id", ARGS("waveInGetDevCaps"), waveInGetDevCaps(device, (LPWAVEINCAPS)caps, sizeof(WAVEINCAPS)));
    result("id", ARGS("midiOutGetDevCaps"), midiOutGetDevCaps(device, (LPMIDIOUTCAPS)caps, sizeof(MIDIOUTCAPS)));
    result("id", ARGS("midiOutGetDevCaps-0"), midiOutGetDevCaps(device, (LPMIDIOUTCAPS)caps, 0));
    result("id", ARGS("midiInGetDevCaps"), midiInGetDevCaps(device, (LPMIDIINCAPS)caps, sizeof(MIDIINCAPS)));
    result("id", ARGS("auxGetDevCaps"), auxGetDevCaps(device, (LPAUXCAPS)caps, sizeof(AUXCAPS)));
    result("id", ARGS("auxGetDevCaps-0"), auxGetDevCaps(device, (LPAUXCAPS)caps, 0));
    result("id", ARGS("waveOutGetVolume"), waveOutGetVolume(device, &volume));
    /* The MIDI Mapper, asked its volume while it is closed, answers a
     * doubleword of its frame it never set (`wbmapper`): not asked. */
    if (device != 0xffff) {
        result("id", ARGS("midiOutGetVolume"), midiOutGetVolume(device, &volume));
    }
    result("id", ARGS("auxGetVolume"), auxGetVolume(device, &volume));
    result("id", ARGS("auxSetVolume"), auxSetVolume(device, 0x80008000L));
    result("id", ARGS("auxOutMessage"), auxOutMessage(device, 0x4000, 1L, 2L));
#undef ARGS
}

static void text(LPCSTR kind, UINT error, int size)
{
    char buffer[128];
    UINT answer;

    lstrcpy(buffer, "untouched");
    answer = kind[0] == 'w' ? waveOutGetErrorText(error, buffer, size) : midiOutGetErrorText(error, buffer, size);
    wsprintf(probeArgs, "%s,%u,%d", kind, error, size);
    wsprintf(probeResult, "%u,%s", answer, (LPSTR)buffer);
    probe("text", probeArgs, probeResult);
}

static void opened(LPCSTR what, UINT answer, UINT handle)
{
    wsprintf(probeResult, "%u,%s", answer,
             handle == 0x1234 ? (LPSTR)"untouched" : handle == 0 ? (LPSTR)"zero" : (LPSTR)"nonzero");
    probe("open", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWAVEOUT out;
    HMIDIOUT midi;
    HMIDIIN midiIn;
    UINT errors[] = {0, 11, 12, 31, 32, 35, 36, 64, 69, 70, 256};
    int i;

    probeOpen(OUTPUT);

    format.wf.wFormatTag = WAVE_FORMAT_PCM;
    format.wf.nChannels = 1;
    format.wf.nSamplesPerSec = 11025;
    format.wf.nAvgBytesPerSec = 11025;
    format.wf.nBlockAlign = 1;
    format.wBitsPerSample = 8;
    waveHeader.lpData = data;
    waveHeader.dwBufferLength = sizeof(data);
    midiHeader.lpData = data;
    midiHeader.dwBufferLength = sizeof(data);

    handles(0x1234);
    handles(0);

    ids(0);
    ids(5);
    ids(0xffff);

    out = (HWAVEOUT)0x1234;
    opened("wave-flags", waveOutOpen(&out, 0, (LPWAVEFORMAT)&format, 0L, 0L, 4L), (UINT)out);
    out = (HWAVEOUT)0x1234;
    opened("wave-window", waveOutOpen(&out, 0, (LPWAVEFORMAT)&format, 0x1234L, 0L, CALLBACK_WINDOW), (UINT)out);
    out = (HWAVEOUT)0x1234;
    opened("wave-window-high", waveOutOpen(&out, 0, (LPWAVEFORMAT)&format, 0x10000L, 0L, CALLBACK_WINDOW), (UINT)out);
    out = (HWAVEOUT)0x1234;
    opened("wave-task", waveOutOpen(&out, 0, (LPWAVEFORMAT)&format, 0x1234L, 0L, CALLBACK_TASK), (UINT)out);
    out = (HWAVEOUT)0x1234;
    opened("wave-task-own", waveOutOpen(&out, 5, (LPWAVEFORMAT)&format, (DWORD)GetCurrentTask(), 0L, CALLBACK_TASK), (UINT)out);
    out = (HWAVEOUT)0x1234;
    opened("wave-function", waveOutOpen(&out, 0, (LPWAVEFORMAT)&format, (DWORD)(FARPROC)WinMain, 0L, CALLBACK_FUNCTION), (UINT)out);
    out = (HWAVEOUT)0x1234;
    opened("wave-kind", waveOutOpen(&out, 0, (LPWAVEFORMAT)&format, 0L, 0L, 0x40000L), (UINT)out);
    out = (HWAVEOUT)0x1234;
    opened("wave-device", waveOutOpen(&out, 5, (LPWAVEFORMAT)&format, 0L, 0L, 0L), (UINT)out);

    midi = (HMIDIOUT)0x1234;
    opened("midi-flags", midiOutOpen(&midi, 0, 0L, 0L, 1L), (UINT)midi);
    midi = (HMIDIOUT)0x1234;
    opened("midi-window", midiOutOpen(&midi, 0, 0x1234L, 0L, CALLBACK_WINDOW), (UINT)midi);
    midi = (HMIDIOUT)0x1234;
    opened("midi-device", midiOutOpen(&midi, 5, 0L, 0L, 0L), (UINT)midi);
    midiIn = (HMIDIIN)0x1234;
    opened("midiin-device", midiInOpen(&midiIn, 5, 0L, 0L, 0L), (UINT)midiIn);
    midiIn = (HMIDIIN)0x1234;
    opened("midiin-mapper", midiInOpen(&midiIn, 0xffff, 0L, 0L, 0L), (UINT)midiIn);

    for (i = 0; i < sizeof(errors) / sizeof(errors[0]); i++) {
        text("wave", errors[i], 128);
        text("midi", errors[i], 128);
    }
    text("wave", 2, 1);
    text("wave", 2, 5);
    text("wave", 2, 0);
    text("midi", 65, 5);
    text("wave", 99, 1);

    probeFinish();

    return 0;
}
