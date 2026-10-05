/*
 * MIDI played to the Ad Lib's own driver, MSADLIB.DRV, opened by its device
 * number, on the installation with a sound card (`--display vgasound`): the
 * reference for what a synthesizer of WinBox's own must write to an OPL2
 * for the same messages.
 *
 * The answers here are only half of it. The other half is what DOSBox's
 * OPL was sent, captured as it plays (`record.mjs --capture`): the raw
 * register writes, `.dro`, decoded into `oracle/fixtures/opl/`, and the
 * sound itself, `.wav`. The probe writes `capture` once it is ready and
 * waits three seconds for the recorder to start both.
 *
 * * `system`: GetWinFlags, which sets the driver's write delay, and the
 *   delay `SYSTEM.INI` gives it, if any.
 * * `device`: which output device is the Ad Lib, by its name.
 * * `send`: each message, by step and in hex, and what midiOutShortMsg,
 *   midiOutLongMsg or midiOutReset answered.
 * * `at`: when each was sent, in milliseconds after the first note -- for
 *   lining the probe's steps up with the capture's, whose clock starts at
 *   its first note. Not an answer: its milliseconds are DOSBox's.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\ADLIBOUT.OUT"

static HMIDIOUT device;
static UINT adlib;
static DWORD start;
static BOOL started;
static int step;

static void pump(DWORD ms)
{
    DWORD from = timeGetTime();
    MSG msg;

    while (timeGetTime() - from < ms) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }
}

/* When a step is taken, after the first note. */
static void at(LPCSTR what)
{
    DWORD now = timeGetTime();

    if (!started) {
        started = TRUE;
        start = now;
    }

    wsprintf(probeArgs, "%d,%s", ++step, what);
    wsprintf(probeResult, "%lu", now - start);
    probe("at", probeArgs, probeResult);
}

static void answered(LPCSTR what, UINT result)
{
    wsprintf(probeArgs, "%d,%s", step, what);
    wsprintf(probeResult, "%u", result);
    probe("send", probeArgs, probeResult);
}

/* A short message: status, then the two data bytes. */
static void sendRaw(LPCSTR what, DWORD message)
{
    char name[64];

    wsprintf(name, "%s,%06lx", what, message);
    at(name);
    answered(name, midiOutShortMsg(device, message));
}

static void send(LPCSTR what, BYTE status, BYTE one, BYTE two)
{
    sendRaw(what, (DWORD)status | ((DWORD)one << 8) | ((DWORD)two << 16));
}

static void note(BYTE channel, BYTE key, BYTE velocity, DWORD hold, DWORD after)
{
    send("on", (BYTE)(0x90 | channel), key, velocity);
    pump(hold);
    send("off", (BYTE)(0x80 | channel), key, 0);
    pump(after);
}

static void longMsg(LPCSTR what, BYTE FAR *bytes, UINT length)
{
    MIDIHDR header;

    _fmemset(&header, 0, sizeof(header));
    header.lpData = (LPSTR)bytes;
    header.dwBufferLength = length;
    midiOutPrepareHeader(device, &header, sizeof(header));
    at(what);
    answered(what, midiOutLongMsg(device, &header, sizeof(header)));
    midiOutUnprepareHeader(device, &header, sizeof(header));
}

static void reset(LPCSTR what)
{
    at(what);
    answered(what, midiOutReset(device));
}

static UINT openAdlib(LPCSTR what)
{
    UINT result = midiOutOpen(&device, adlib, 0L, 0L, CALLBACK_NULL);

    wsprintf(probeResult, "%u", result);
    probe("open", what, probeResult);
    return result;
}

static void closeAdlib(LPCSTR what)
{
    wsprintf(probeResult, "%u", midiOutClose(device));
    probe("close", what, probeResult);
}

static BYTE chord[] = {0x90, 60, 100, 64, 100, 67, 100};
static BYTE unchord[] = {0x80, 60, 0, 64, 0, 67, 0};
static BYTE exclusive[] = {0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7, 0x90, 72, 90};
static BYTE unexclusive[] = {0x80, 72, 0};

/* Ad Lib's percussion keys, from its key map: bass drum, snare, closed and
 * open hi-hat, toms, crash and ride cymbal, cowbell, and the last. */
static BYTE drums[] = {35, 36, 38, 40, 42, 46, 41, 45, 50, 49, 51, 56, 81};

/* Patches across the bank: one with a transposition (1), organ, bass,
 * strings, brass, pipe, and the last. */
static BYTE patches[] = {0, 1, 2, 19, 33, 40, 56, 73, 118, 127};

static UINT bends[] = {0x2000, 0x2001, 0x2040, 0x2100, 0x2800, 0x3000, 0x3fff,
                       0x1fff, 0x1800, 0x1000, 0x0000, 0x2000};

static BYTE velocities[] = {1, 2, 3, 16, 32, 64, 96, 127};

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    MIDIOUTCAPS caps;
    UINT count, id, i;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%lx", GetWinFlags());
    probe("system", "winflags", probeResult);
    wsprintf(probeResult, "%d",
             GetPrivateProfileInt("adlib.drv", "WriteDelay", -1, "system.ini"));
    probe("system", "writedelay", probeResult);

    count = midiOutGetNumDevs();
    adlib = 0xffff;

    for (id = 0; id < count; id++) {
        if (midiOutGetDevCaps(id, &caps, sizeof(caps)) == 0 &&
            lstrcmp(caps.szPname, "Ad Lib") == 0) {
            adlib = id;
        }
    }

    wsprintf(probeResult, "%u of %u", adlib, count);
    probe("device", "Ad Lib", probeResult);

    if (adlib == 0xffff || openAdlib("first")) {
        probeFinish();
        return 0;
    }

    probe("capture", "ready", "");
    pump(3000);

    probeNote("a note");
    note(0, 60, 100, 600, 400);
    send("on", 0x90, 62, 100);
    pump(300);
    send("off-by-velocity", 0x90, 62, 0);
    pump(400);

    probeNote("percussion, channel 16");

    for (i = 0; i < sizeof(drums); i++) {
        note(15, drums[i], 100, 250, 150);
    }

    send("outside-map", 0x9f, 34, 100);
    send("outside-map", 0x9f, 82, 100);
    pump(200);

    probeNote("programs");

    for (i = 0; i < sizeof(patches); i++) {
        send("program", 0xc0, patches[i], 0);
        note(0, 60, 100, 300, 200);
    }

    send("program", 0xc0, 0, 0);

    probeNote("pitch bend");
    send("on", 0x90, 60, 100);

    for (i = 0; i < sizeof(bends) / sizeof(bends[0]); i++) {
        pump(150);
        send("bend", 0xe0, (BYTE)(bends[i] & 0x7f), (BYTE)(bends[i] >> 7));
    }

    pump(150);
    send("off", 0x80, 60, 0);
    send("bend-idle", 0xe0, 0, 0x50);
    pump(100);
    note(0, 60, 100, 300, 100);
    send("bend", 0xe0, 0, 0x40);
    pump(200);

    probeNote("velocity");

    for (i = 0; i < sizeof(velocities); i++) {
        note(0, 60, velocities[i], 200, 100);
    }

    probeNote("controllers");
    send("on", 0x90, 60, 100);
    pump(200);
    send("volume", 0xb0, 7, 0);
    pump(200);
    send("volume", 0xb0, 7, 127);
    send("modulation", 0xb0, 1, 64);
    send("pan", 0xb0, 10, 0);
    send("sustain", 0xb0, 64, 127);
    pump(200);
    send("off", 0x80, 60, 0);
    pump(300);
    send("sustain", 0xb0, 64, 0);
    send("on", 0x90, 60, 100);
    send("on", 0x90, 64, 100);
    pump(200);
    send("sound-off", 0xb0, 120, 0);
    send("reset-controllers", 0xb0, 121, 0);
    pump(300);
    send("notes-off", 0xb0, 123, 0);
    pump(300);
    send("on", 0x90, 60, 100);
    pump(100);
    send("omni-off", 0xb0, 124, 0);
    pump(100);
    send("on", 0x90, 60, 100);
    pump(100);
    send("poly", 0xb0, 127, 0);
    pump(300);

    probeNote("voices");

    for (i = 0; i < 8; i++) {
        send("on", 0x90, (BYTE)(48 + 2 * i), 100);
        pump(100);
    }

    pump(400);

    for (i = 0; i < 8; i++) {
        send("off", 0x80, (BYTE)(48 + 2 * i), 0);
    }

    pump(300);
    send("program", 0xc1, 40, 0);

    for (i = 0; i < 10; i++) {
        send("on", (BYTE)(0x90 | (i & 1)), (BYTE)(60 + i), 100);
        pump(80);
    }

    send("drum", 0x9f, 38, 100);
    pump(300);

    for (i = 0; i < 10; i++) {
        send("off", (BYTE)(0x80 | (i & 1)), (BYTE)(60 + i), 0);
    }

    send("drum-off", 0x8f, 38, 0);
    pump(300);

    probeNote("again");
    send("on", 0x90, 64, 100);
    pump(200);
    send("again", 0x90, 64, 80);
    pump(200);
    send("off", 0x80, 64, 0);
    pump(300);

    probeNote("running status");
    send("on", 0x90, 60, 100);
    sendRaw("running", 0x00006443L);
    pump(300);
    send("off", 0x80, 60, 0);
    sendRaw("running", 0x00000043L);
    pump(300);

    probeNote("long");
    longMsg("chord", chord, sizeof(chord));
    pump(400);
    longMsg("unchord", unchord, sizeof(unchord));
    pump(200);
    longMsg("exclusive", exclusive, sizeof(exclusive));
    pump(300);
    longMsg("unexclusive", unexclusive, sizeof(unexclusive));
    pump(300);

    probeNote("reset with a transposed patch");
    send("program", 0xc0, 1, 0);
    send("on", 0x90, 60, 100);
    send("drum", 0x9f, 36, 100);
    pump(300);
    reset("reset");
    pump(500);
    send("notes-off", 0xb0, 123, 0);
    pump(300);
    send("program", 0xc0, 0, 0);
    pump(300);

    probeNote("reopened");
    closeAdlib("held");
    openAdlib("again");
    pump(300);
    note(0, 67, 100, 300, 300);

    probeNote("a sequence");
    send("program", 0xc0, 0, 0);
    send("program", 0xc1, 32, 0);

    for (i = 0; i < 8; i++) {
        send("bass", 0x91, (BYTE)((i & 2) ? 41 : 36), 100);
        send("melody", 0x90, (BYTE)(60 + (i % 4) * 2), 90);

        if ((i & 1) == 0) {
            send("kick", 0x9f, 35, 110);
        } else {
            send("snare", 0x9f, 38, 100);
        }

        send("hat", 0x9f, 42, 80);
        pump(250);
        send("melody-off", 0x80, (BYTE)(60 + (i % 4) * 2), 0);
        send("bass-off", 0x81, (BYTE)((i & 2) ? 41 : 36), 0);
        send("hat-off", 0x8f, 42, 0);
        send((i & 1) == 0 ? "kick-off" : "snare-off", 0x8f, (BYTE)((i & 1) == 0 ? 35 : 38), 0);
        pump(250);
    }

    pump(500);
    closeAdlib("last");
    probe("capture", "done", "");
    probeFinish();

    return 0;
}
