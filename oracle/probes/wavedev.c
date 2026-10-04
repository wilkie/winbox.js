/*
 * Waveform output on an installation with a sound card -- the Sound Blaster
 * 1.5 driver, put in by Control Panel (`--display vgasound`) -- for what a
 * wave driver of winbox.js's own must do.
 *
 * * `count`: how many output and input devices there are.
 * * `caps`: each device's capabilities, field by field, and what asking a
 *   device there is not answers.
 * * `query`: whether device 0 takes a format, asked with WAVE_FORMAT_QUERY:
 *   rate, channels and bits, and two it should not.
 * * `open`, `close`: what they answer, and `message` each message the
 *   window given for callbacks was sent, in order: MM_WOM_OPEN, _DONE and
 *   _CLOSE, whether its wParam was the device's handle and its lParam the
 *   header.
 * * `header`: a header's flags after each step -- prepared, written, played,
 *   unprepared -- and what each call answered.
 * * `play`: a second of silence played: how long until it was done, in
 *   tenths of a second, rounded, and the position after, in each kind of
 *   time.
 * * `error`: what writing an unprepared header, unpreparing or closing while
 *   playing, and using a closed handle answer.
 * * `reset`, `pause`: what they answer, and what they do to a header
 *   playing.
 * * `control`: volume, pitch, playback rate and the device's number.
 * * And opened with no callback at all, a tenth of a second played, its
 *   header polled for its done flag.
 */

#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\WAVEDEV.OUT"
#define SECOND 11025

static PCMWAVEFORMAT format;
static WAVEHDR header;
static HWAVEOUT device;
static HWND window;
static int messages;
static BOOL done;
static char huge *samples;

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    LPCSTR name = message == MM_WOM_OPEN ? "MM_WOM_OPEN"
                : message == MM_WOM_DONE ? "MM_WOM_DONE"
                : message == MM_WOM_CLOSE ? "MM_WOM_CLOSE"
                : NULL;

    if (name) {
        wsprintf(probeArgs, "%d", ++messages);
        wsprintf(probeResult, "%s,%s,%s", name,
                 (HWAVEOUT)wParam == device ? (LPSTR)"handle" : (LPSTR)"other",
                 lParam == (LPARAM)(LPWAVEHDR)&header ? (LPSTR)"header"
                 : lParam == 0 ? (LPSTR)"zero" : (LPSTR)"other");
        probe("message", probeArgs, probeResult);

        if (message == MM_WOM_DONE) {
            done = TRUE;
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* Messages handled until `done` or `ms` have passed: how long it took. */
static DWORD pump(DWORD ms, BOOL untilDone)
{
    DWORD start = timeGetTime();
    MSG msg;

    for (;;) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        if ((untilDone && done) || timeGetTime() - start >= ms) {
            return timeGetTime() - start;
        }
    }
}

static void answer(LPCSTR function, LPCSTR what, UINT value)
{
    wsprintf(probeResult, "%u", value);
    probe(function, what, probeResult);
}

static void flags(LPCSTR when)
{
    wsprintf(probeResult, "%lx", header.dwFlags);
    probe("header", when, probeResult);
}

static void outCaps(UINT id, LPCSTR name)
{
    WAVEOUTCAPS caps;
    UINT result;

    _fmemset(&caps, 0, sizeof(caps));
    result = waveOutGetDevCaps(id, &caps, sizeof(caps));

    if (result) {
        answer("caps", name, result);
        return;
    }

    wsprintf(probeResult, "0,mid=%u,pid=%u,version=%x,name=%s,formats=%lx,channels=%u,support=%lx",
             caps.wMid, caps.wPid, caps.vDriverVersion, (LPSTR)caps.szPname, caps.dwFormats,
             caps.wChannels, caps.dwSupport);
    probe("caps", name, probeResult);
}

static void inCaps(UINT id, LPCSTR name)
{
    WAVEINCAPS caps;
    UINT result;

    _fmemset(&caps, 0, sizeof(caps));
    result = waveInGetDevCaps(id, &caps, sizeof(caps));

    if (result) {
        answer("caps", name, result);
        return;
    }

    wsprintf(probeResult, "0,mid=%u,pid=%u,version=%x,name=%s,formats=%lx,channels=%u",
             caps.wMid, caps.wPid, caps.vDriverVersion, (LPSTR)caps.szPname, caps.dwFormats,
             caps.wChannels);
    probe("caps", name, probeResult);
}

static void query(WORD tag, DWORD rate, WORD channels, WORD bits)
{
    format.wf.wFormatTag = tag;
    format.wf.nChannels = channels;
    format.wf.nSamplesPerSec = rate;
    format.wf.nBlockAlign = channels * (bits / 8);
    format.wf.nAvgBytesPerSec = rate * format.wf.nBlockAlign;
    format.wBitsPerSample = bits;

    wsprintf(probeArgs, "tag=%u,rate=%lu,channels=%u,bits=%u", tag, rate, channels, bits);
    wsprintf(probeResult, "%u",
             waveOutOpen(NULL, 0, (LPWAVEFORMAT)&format, 0L, 0L, WAVE_FORMAT_QUERY));
    probe("query", probeArgs, probeResult);
}

static void position(WORD kind, LPCSTR name)
{
    MMTIME time;
    UINT result;

    _fmemset(&time, 0, sizeof(time));
    time.wType = kind;
    result = waveOutGetPosition(device, &time, sizeof(time));

    if (time.wType == TIME_SMPTE) {
        wsprintf(probeResult, "%u,type=%u,%u:%u:%u:%u", result, time.wType, time.u.smpte.hour,
                 time.u.smpte.min, time.u.smpte.sec, time.u.smpte.frame);
    } else {
        wsprintf(probeResult, "%u,type=%u,%lu", result, time.wType, time.u.ms);
    }

    probe("position", name, probeResult);
}

/* The standard format: 11025 samples a second, one channel, eight bits. */
static void standard(void)
{
    format.wf.wFormatTag = WAVE_FORMAT_PCM;
    format.wf.nChannels = 1;
    format.wf.nSamplesPerSec = SECOND;
    format.wf.nAvgBytesPerSec = SECOND;
    format.wf.nBlockAlign = 1;
    format.wBitsPerSample = 8;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const DWORD RATES[] = {8000, 11025, 22050, 44100};
    WNDCLASS wc;
    UINT result;
    DWORD took, value;
    HGLOBAL memory;
    int r, c, b;

    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "WaveDev";
    RegisterClass(&wc);
    window = CreateWindow("WaveDev", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_SHARE, SECOND);
    samples = (char huge *)GlobalLock(memory);

    for (value = 0; value < SECOND; value++) {
        samples[value] = (char)0x80;
    }

    answer("count", "waveout", waveOutGetNumDevs());
    answer("count", "wavein", waveInGetNumDevs());

    outCaps(0, "waveout-0");
    outCaps(1, "waveout-1");
    outCaps(WAVE_MAPPER, "waveout-mapper");
    inCaps(0, "wavein-0");

    for (r = 0; r < 4; r++) {
        for (c = 1; c <= 2; c++) {
            for (b = 8; b <= 16; b += 8) {
                query(WAVE_FORMAT_PCM, RATES[r], c, b);
            }
        }
    }

    query(WAVE_FORMAT_PCM, 5000, 1, 8);
    query(WAVE_FORMAT_PCM, 48000, 1, 8);
    query(2, 11025, 1, 4);

    /* Opened with the window for its messages. */
    standard();
    result = waveOutOpen(&device, 0, (LPWAVEFORMAT)&format, (DWORD)(UINT)window, 0L,
                         CALLBACK_WINDOW);
    answer("open", "window", result);
    pump(300, FALSE);

    answer("open", "again", waveOutOpen(NULL, 0, (LPWAVEFORMAT)&format, 0L, 0L, 0L));

    /* A header through its life. */
    _fmemset(&header, 0, sizeof(header));
    header.lpData = (LPSTR)samples;
    header.dwBufferLength = SECOND;
    flags("new");
    answer("error", "write-unprepared", waveOutWrite(device, &header, sizeof(header)));
    flags("after-unprepared-write");
    answer("header", "prepare", waveOutPrepareHeader(device, &header, sizeof(header)));
    flags("prepared");
    answer("header", "prepare-again", waveOutPrepareHeader(device, &header, sizeof(header)));
    flags("prepared-again");

    done = FALSE;
    answer("play", "write", waveOutWrite(device, &header, sizeof(header)));
    flags("written");
    answer("error", "unprepare-playing", waveOutUnprepareHeader(device, &header, sizeof(header)));
    flags("after-unprepare-playing");
    answer("error", "close-playing", waveOutClose(device));

    took = pump(3000, TRUE);
    wsprintf(probeResult, "%s,%lu", done ? (LPSTR)"done" : (LPSTR)"not done", (took + 50) / 100);
    probe("play", "second-tenths", probeResult);
    flags("played");
    wsprintf(probeResult, "%lu", header.dwBytesRecorded);
    probe("header", "bytes-recorded", probeResult);

    position(TIME_BYTES, "bytes");
    position(TIME_SAMPLES, "samples");
    position(TIME_MS, "ms");
    position(TIME_SMPTE, "smpte");
    position(TIME_MIDI, "midi");

    /* Played again, and reset a tenth of a second in. */
    done = FALSE;
    answer("reset", "write", waveOutWrite(device, &header, sizeof(header)));
    pump(100, FALSE);
    answer("reset", "reset", waveOutReset(device));
    flags("after-reset");
    took = pump(500, TRUE);
    wsprintf(probeResult, "%s", done ? (LPSTR)"done" : (LPSTR)"not done");
    probe("reset", "done-message", probeResult);
    position(TIME_BYTES, "after-reset");

    /* Paused and restarted. */
    done = FALSE;
    answer("pause", "pause", waveOutPause(device));
    answer("pause", "write-paused", waveOutWrite(device, &header, sizeof(header)));
    pump(300, FALSE);
    flags("written-paused");
    position(TIME_BYTES, "paused");
    answer("pause", "restart", waveOutRestart(device));
    took = pump(3000, TRUE);
    wsprintf(probeResult, "%s,%lu", done ? (LPSTR)"done" : (LPSTR)"not done", (took + 50) / 100);
    probe("pause", "restarted-tenths", probeResult);

    value = 0x12345678L;
    result = waveOutGetVolume(0, &value);
    wsprintf(probeResult, "%u,%lx", result, value);
    probe("control", "get-volume", probeResult);
    answer("control", "set-volume", waveOutSetVolume(0, 0x80008000L));
    value = 0x12345678L;
    result = waveOutGetPitch(device, &value);
    wsprintf(probeResult, "%u,%lx", result, value);
    probe("control", "get-pitch", probeResult);
    answer("control", "set-pitch", waveOutSetPitch(device, 0x00010000L));
    value = 0x12345678L;
    result = waveOutGetPlaybackRate(device, &value);
    wsprintf(probeResult, "%u,%lx", result, value);
    probe("control", "get-rate", probeResult);
    answer("control", "set-rate", waveOutSetPlaybackRate(device, 0x00010000L));
    value = 0x1234;
    result = waveOutGetID(device, (UINT FAR *)&value);
    wsprintf(probeResult, "%u,%x", result, (UINT)value);
    probe("control", "get-id", probeResult);

    answer("header", "unprepare", waveOutUnprepareHeader(device, &header, sizeof(header)));
    flags("unprepared");
    answer("header", "unprepare-again", waveOutUnprepareHeader(device, &header, sizeof(header)));

    answer("close", "close", waveOutClose(device));
    pump(300, FALSE);
    answer("error", "write-closed", waveOutWrite(device, &header, sizeof(header)));
    answer("error", "close-closed", waveOutClose(device));

    /* Opened with no callback, played, and polled for its done flag. */
    standard();
    result = waveOutOpen(&device, 0, (LPWAVEFORMAT)&format, 0L, 0L, 0L);
    answer("open", "none", result);
    _fmemset(&header, 0, sizeof(header));
    header.lpData = (LPSTR)samples;
    header.dwBufferLength = SECOND / 10;
    waveOutPrepareHeader(device, &header, sizeof(header));
    waveOutWrite(device, &header, sizeof(header));

    /* Polled with the processor given up between looks: a loop that never
     * gives it up sees the flag set or not as the host's timing has it. */
    for (took = timeGetTime(); !(header.dwFlags & WHDR_DONE) && timeGetTime() - took < 2000;) {
        pump(10, FALSE);
    }

    flags("polled");
    waveOutUnprepareHeader(device, &header, sizeof(header));
    answer("close", "none", waveOutClose(device));

    GlobalUnlock(memory);
    GlobalFree(memory);
    DestroyWindow(window);
    probeFinish();

    return 0;
}
