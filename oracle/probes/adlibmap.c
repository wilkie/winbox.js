/*
 * MIDI played through the MIDI Mapper on the installation with a sound card
 * (`--display vgasound`), to the Ad Lib its current setup, "Ad Lib", sends
 * channels 13 to 16 to: the path a program takes that opens `MIDI_MAPPER`.
 * As `adlibout`, what DOSBox's OPL was sent is captured as it plays
 * (`record.mjs --capture`) into `oracle/fixtures/opl/`, after the probe's
 * `capture` record and a pause.
 *
 * * `open`, `close`: the mapper opened and closed.
 * * `send`: each message, by step and in hex, and what midiOutShortMsg or
 *   midiOutReset answered.
 * * `at`: when each was sent, in milliseconds after the first note, for
 *   lining the probe's steps up with the capture's. Not an answer.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\ADLIBMAP.OUT"

static HMIDIOUT device;
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

static void send(LPCSTR what, BYTE status, BYTE one, BYTE two)
{
    DWORD message = (DWORD)status | ((DWORD)one << 8) | ((DWORD)two << 16);
    char name[64];

    wsprintf(name, "%s,%06lx", what, message);
    at(name);
    answered(name, midiOutShortMsg(device, message));
}

static void note(BYTE channel, BYTE key, BYTE velocity, DWORD hold, DWORD after)
{
    send("on", (BYTE)(0x90 | channel), key, velocity);
    pump(hold);
    send("off", (BYTE)(0x80 | channel), key, 0);
    pump(after);
}

static UINT openMapper(LPCSTR what)
{
    UINT result = midiOutOpen(&device, MIDI_MAPPER, 0L, 0L, CALLBACK_NULL);

    wsprintf(probeResult, "%u", result);
    probe("open", what, probeResult);
    return result;
}

static void closeMapper(LPCSTR what)
{
    wsprintf(probeResult, "%u", midiOutClose(device));
    probe("close", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT i;

    probeOpen(OUTPUT);

    if (openMapper("first")) {
        probeFinish();
        return 0;
    }

    probe("capture", "ready", "");
    pump(3000);

    probeNote("channel 13");
    note(12, 60, 100, 500, 300);

    probeNote("channel 1, which the setup sends nowhere");
    note(0, 62, 100, 300, 300);

    probeNote("channel 16, percussion");
    note(15, 35, 100, 250, 150);
    note(15, 38, 100, 250, 150);
    note(15, 42, 100, 250, 150);

    probeNote("programs on channels 13 to 15");
    send("program", 0xcc, 40, 0);
    note(12, 60, 100, 300, 100);
    send("program", 0xcd, 32, 0);
    note(13, 48, 100, 300, 100);
    send("program", 0xce, 73, 0);
    note(14, 72, 100, 300, 100);

    probeNote("pitch bend on channel 13");
    send("on", 0x9c, 60, 100);
    pump(200);
    send("bend", 0xec, 0, 0x60);
    pump(200);
    send("bend", 0xec, 0, 0x40);
    pump(200);
    send("off", 0x8c, 60, 0);
    pump(200);

    probeNote("more notes than voices");

    for (i = 0; i < 9; i++) {
        send("on", (BYTE)(0x9c + i % 3), (BYTE)(55 + 2 * i), 100);
        pump(80);
    }

    pump(300);
    send("notes-off", 0xbc, 123, 0);
    pump(300);

    probeNote("reset");

    for (i = 0; i < 3; i++) {
        send("on", (BYTE)(0x9c + i), (BYTE)(60 + 4 * i), 100);
    }

    pump(300);
    at("reset");
    answered("reset", midiOutReset(device));
    pump(300);

    probeNote("reopened");
    closeMapper("first");
    openMapper("again");
    pump(300);

    probeNote("a sequence");
    send("program", 0xcc, 0, 0);
    send("program", 0xcd, 32, 0);

    for (i = 0; i < 8; i++) {
        send("bass", 0x9d, (BYTE)((i & 2) ? 41 : 36), 100);
        send("melody", 0x9c, (BYTE)(60 + (i % 4) * 2), 90);
        send((i & 1) == 0 ? "kick" : "snare", 0x9f, (BYTE)((i & 1) == 0 ? 35 : 38), 100);
        pump(250);
        send("melody-off", 0x8c, (BYTE)(60 + (i % 4) * 2), 0);
        send("bass-off", 0x8d, (BYTE)((i & 2) ? 41 : 36), 0);
        send((i & 1) == 0 ? "kick-off" : "snare-off", 0x8f, (BYTE)((i & 1) == 0 ? 35 : 38), 0);
        pump(250);
    }

    pump(500);
    closeMapper("last");
    probe("capture", "done", "");
    probeFinish();

    return 0;
}
