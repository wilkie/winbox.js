/*
 * MIDI on an installation with a sound card -- the Sound Blaster 1.5's MIDI
 * port and the Ad Lib synthesizer its driver brought, put in by Control
 * Panel (`--display vgasound`) -- for what a MIDI driver of winbox.js's own
 * must do.
 *
 * * `count`: how many output and input devices there are.
 * * `caps`: each output and input device's capabilities, field by field,
 *   the mapper's, and what asking a device there is not answers.
 * * `open`: what opening each output device, and the mapper, answers, by
 *   number, with a window for callbacks; `message` each message the window
 *   was sent, in order -- MM_MOM_OPEN, _DONE and _CLOSE -- whether its
 *   wParam was the device's handle and its lParam the header.
 * * `short`: a note played and stopped, a controller and a running status
 *   message, sent with midiOutShortMsg: what each answered.
 * * `long`: a system-exclusive message sent with midiOutLongMsg, its
 *   header's flags after each step, and what each call answered.
 * * `error`: a long message unprepared, unpreparing while it is queued,
 *   closing with one queued, and using a closed handle.
 * * `control`: volume, reset, the device's number, cached patches.
 */

#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MIDIDEV.OUT"

static MIDIHDR header;
static HMIDIOUT device;
static HWND window;
static int messages;
static BOOL done;
static BYTE sysex[] = {0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7};

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    LPCSTR name = message == MM_MOM_OPEN ? "MM_MOM_OPEN"
                : message == MM_MOM_DONE ? "MM_MOM_DONE"
                : message == MM_MOM_CLOSE ? "MM_MOM_CLOSE"
                : NULL;

    if (name) {
        wsprintf(probeArgs, "%d", ++messages);
        wsprintf(probeResult, "%s,%s,%s", name,
                 (HMIDIOUT)wParam == device ? (LPSTR)"handle" : (LPSTR)"other",
                 lParam == (LPARAM)(LPMIDIHDR)&header ? (LPSTR)"header"
                 : lParam == 0 ? (LPSTR)"zero" : (LPSTR)"other");
        probe("message", probeArgs, probeResult);

        if (message == MM_MOM_DONE) {
            done = TRUE;
        }

        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(DWORD ms, BOOL untilDone)
{
    DWORD start = timeGetTime();
    MSG msg;

    for (;;) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        if ((untilDone && done) || timeGetTime() - start >= ms) {
            return;
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
    probe("long", when, probeResult);
}

static void outCaps(UINT id, LPCSTR name)
{
    MIDIOUTCAPS caps;
    UINT result;

    _fmemset(&caps, 0, sizeof(caps));
    result = midiOutGetDevCaps(id, &caps, sizeof(caps));

    if (result) {
        answer("caps", name, result);
        return;
    }

    wsprintf(probeResult,
             "0,mid=%u,pid=%u,version=%x,name=%s,technology=%u,voices=%u,notes=%u,mask=%x,"
             "support=%lx",
             caps.wMid, caps.wPid, caps.vDriverVersion, (LPSTR)caps.szPname, caps.wTechnology,
             caps.wVoices, caps.wNotes, caps.wChannelMask, caps.dwSupport);
    probe("caps", name, probeResult);
}

static void inCaps(UINT id, LPCSTR name)
{
    MIDIINCAPS caps;
    UINT result;

    _fmemset(&caps, 0, sizeof(caps));
    result = midiInGetDevCaps(id, &caps, sizeof(caps));

    if (result) {
        answer("caps", name, result);
        return;
    }

    wsprintf(probeResult, "0,mid=%u,pid=%u,version=%x,name=%s", caps.wMid, caps.wPid,
             caps.vDriverVersion, (LPSTR)caps.szPname);
    probe("caps", name, probeResult);
}

/* A device opened with the window, a note played on it, and closed. */
static void play(UINT id, LPCSTR name)
{
    char what[32];
    UINT result;

    device = 0;
    result = midiOutOpen(&device, id, (DWORD)(UINT)window, 0L, CALLBACK_WINDOW);
    answer("open", name, result);

    if (result) {
        return;
    }

    pump(200, FALSE);

    wsprintf(what, "%s,note-on", name);
    answer("short", what, midiOutShortMsg(device, 0x00403c90L));
    wsprintf(what, "%s,running", name);
    answer("short", what, midiOutShortMsg(device, 0x0000403eL));
    wsprintf(what, "%s,controller", name);
    answer("short", what, midiOutShortMsg(device, 0x00007bb0L));
    wsprintf(what, "%s,note-off", name);
    answer("short", what, midiOutShortMsg(device, 0x00403c80L));
    wsprintf(what, "%s,reset", name);
    answer("control", what, midiOutReset(device));
    wsprintf(what, "%s,close", name);
    answer("close", what, midiOutClose(device));
    pump(200, FALSE);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    UINT result, count, id;
    DWORD value;
    char name[32];

    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "MidiDev";
    RegisterClass(&wc);
    window = CreateWindow("MidiDev", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    count = midiOutGetNumDevs();
    answer("count", "midiout", count);
    answer("count", "midiin", midiInGetNumDevs());

    for (id = 0; id <= count; id++) {
        wsprintf(name, "midiout-%u", id);
        outCaps(id, name);
    }

    outCaps(MIDI_MAPPER, "midiout-mapper");
    inCaps(0, "midiin-0");
    inCaps(1, "midiin-1");

    for (id = 0; id < count; id++) {
        wsprintf(name, "%u", id);
        play(id, name);
    }

    play(MIDI_MAPPER, "mapper");

    /* A system-exclusive message on device 0 through its life. */
    result = midiOutOpen(&device, 0, (DWORD)(UINT)window, 0L, CALLBACK_WINDOW);
    answer("open", "long", result);
    pump(200, FALSE);
    _fmemset(&header, 0, sizeof(header));
    header.lpData = (LPSTR)sysex;
    header.dwBufferLength = sizeof(sysex);
    flags("new");
    answer("error", "long-unprepared", midiOutLongMsg(device, &header, sizeof(header)));
    answer("long", "prepare", midiOutPrepareHeader(device, &header, sizeof(header)));
    flags("prepared");
    done = FALSE;
    answer("long", "send", midiOutLongMsg(device, &header, sizeof(header)));
    flags("sent");
    pump(1000, TRUE);
    wsprintf(probeResult, "%s", done ? (LPSTR)"done" : (LPSTR)"not done");
    probe("long", "done-message", probeResult);
    flags("after");
    answer("long", "unprepare", midiOutUnprepareHeader(device, &header, sizeof(header)));
    flags("unprepared");

    value = 0x12345678L;
    result = midiOutGetVolume(0, &value);
    wsprintf(probeResult, "%u,%lx", result, value);
    probe("control", "get-volume", probeResult);
    answer("control", "set-volume", midiOutSetVolume(0, 0x80008000L));
    value = 0x1234;
    result = midiOutGetID(device, (UINT FAR *)&value);
    wsprintf(probeResult, "%u,%x", result, (UINT)value);
    probe("control", "get-id", probeResult);

    answer("close", "long", midiOutClose(device));
    pump(200, FALSE);
    answer("error", "short-closed", midiOutShortMsg(device, 0x00403c90L));
    answer("error", "close-closed", midiOutClose(device));

    DestroyWindow(window);
    probeFinish();

    return 0;
}
