/*
 * The multimedia devices of an installation with no sound driver -- the
 * recording one's `SYSTEM.INI` names only the timer and the MIDI mapper --
 * and what opening one answers.
 *
 * * `count`: each kind's number of devices.
 * * `open`: what opening a waveform device answers, for output and input,
 *   by number and through the mapper, querying a format and opening for
 *   real, and whether the handle was written.
 * * `caps`: what asking a device's capabilities answers.
 * * `text`: the error text for each answer, and what that answers.
 */

#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMDEVS.OUT"

static PCMWAVEFORMAT format;

static void answer(LPCSTR what, UINT value)
{
    wsprintf(probeResult, "%u", value);
    probe("open", what, probeResult);
}

static void text(UINT error)
{
    char buffer[128];
    UINT result;

    lstrcpy(buffer, "untouched");
    result = waveOutGetErrorText(error, buffer, sizeof(buffer));
    wsprintf(probeArgs, "out,%u", error);
    wsprintf(probeResult, "%u,%s", result, (LPSTR)buffer);
    probe("text", probeArgs, probeResult);

    lstrcpy(buffer, "untouched");
    result = waveInGetErrorText(error, buffer, sizeof(buffer));
    wsprintf(probeArgs, "in,%u", error);
    wsprintf(probeResult, "%u,%s", result, (LPSTR)buffer);
    probe("text", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWAVEOUT out;
    HWAVEIN in;
    WAVEOUTCAPS outCaps;
    WAVEINCAPS inCaps;
    UINT result;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%u", waveOutGetNumDevs());
    probe("count", "waveout", probeResult);
    wsprintf(probeResult, "%u", waveInGetNumDevs());
    probe("count", "wavein", probeResult);
    wsprintf(probeResult, "%u", midiOutGetNumDevs());
    probe("count", "midiout", probeResult);
    wsprintf(probeResult, "%u", midiInGetNumDevs());
    probe("count", "midiin", probeResult);
    wsprintf(probeResult, "%u", auxGetNumDevs());
    probe("count", "aux", probeResult);

    format.wf.wFormatTag = WAVE_FORMAT_PCM;
    format.wf.nChannels = 1;
    format.wf.nSamplesPerSec = 11025;
    format.wf.nAvgBytesPerSec = 11025;
    format.wf.nBlockAlign = 1;
    format.wBitsPerSample = 8;

    answer("out-query-mapper",
           waveOutOpen(NULL, WAVE_MAPPER, (LPWAVEFORMAT)&format, 0L, 0L, WAVE_FORMAT_QUERY));
    answer("out-query-0", waveOutOpen(NULL, 0, (LPWAVEFORMAT)&format, 0L, 0L, WAVE_FORMAT_QUERY));
    out = (HWAVEOUT)0x1234;
    result = waveOutOpen(&out, 0, (LPWAVEFORMAT)&format, 0L, 0L, 0L);
    answer("out-open-0", result);
    probe("open", "out-open-0-handle", out == (HWAVEOUT)0x1234 ? "untouched" : out == 0 ? "zero" : "nonzero");
    out = (HWAVEOUT)0x1234;
    result = waveOutOpen(&out, WAVE_MAPPER, (LPWAVEFORMAT)&format, 0L, 0L, 0L);
    answer("out-open-mapper", result);
    probe("open", "out-open-mapper-handle", out == (HWAVEOUT)0x1234 ? "untouched" : out == 0 ? "zero" : "nonzero");

    answer("in-query-mapper",
           waveInOpen(NULL, WAVE_MAPPER, (LPWAVEFORMAT)&format, 0L, 0L, WAVE_FORMAT_QUERY));
    in = (HWAVEIN)0x1234;
    result = waveInOpen(&in, 0, (LPWAVEFORMAT)&format, 0L, 0L, 0L);
    answer("in-open-0", result);
    probe("open", "in-open-0-handle", in == (HWAVEIN)0x1234 ? "untouched" : in == 0 ? "zero" : "nonzero");
    in = (HWAVEIN)0x1234;
    result = waveInOpen(&in, WAVE_MAPPER, (LPWAVEFORMAT)&format, 0L, 0L, 0L);
    answer("in-open-mapper", result);
    probe("open", "in-open-mapper-handle", in == (HWAVEIN)0x1234 ? "untouched" : in == 0 ? "zero" : "nonzero");

    wsprintf(probeResult, "%u", waveOutGetDevCaps(0, &outCaps, sizeof(outCaps)));
    probe("caps", "waveout-0", probeResult);
    wsprintf(probeResult, "%u", waveInGetDevCaps(0, &inCaps, sizeof(inCaps)));
    probe("caps", "wavein-0", probeResult);

    text(0);
    text(2);
    text(6);
    text(32);

    probeFinish();

    return 0;
}
