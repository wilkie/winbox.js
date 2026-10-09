/*
 * General MIDI played through the MIDI Mapper on the installation with a
 * sound card (`--display vgasound`), recorded with the mapper's "Ad Lib
 * general" setup current (`record.mjs --midimap "Ad Lib general"`): the
 * setup a General MIDI file wants, which sends all sixteen channels to the
 * Ad Lib and swaps channels 10 and 16, so that General MIDI's drums reach
 * the Ad Lib's percussion channel. As `adlibmap`, what DOSBox's OPL was
 * sent is captured as it plays (`record.mjs --capture`) into
 * `oracle/fixtures/opl/`, after the probe's `capture` record and a pause.
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

#define OUTPUT "C:\\ORACLE\\ADLIBGM.OUT"

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

static void message(LPCSTR what, DWORD message)
{
    char name[64];

    wsprintf(name, "%s,%06lx", what, message);
    at(name);
    answered(name, midiOutShortMsg(device, message));
}

static void send(LPCSTR what, BYTE status, BYTE one, BYTE two)
{
    message(what, (DWORD)status | ((DWORD)one << 8) | ((DWORD)two << 16));
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
    MIDIOUTCAPS caps;
    UINT i;

    probeOpen(OUTPUT);

    /* The mapper's channels: those its current setup sends somewhere. */
    if (openMapper("first")) {
        probeFinish();
        return 0;
    }

    i = midiOutGetDevCaps(MIDI_MAPPER, &caps, sizeof caps);
    wsprintf(probeResult, "%u,mask=%x", i, caps.wChannelMask);
    probe("caps", "mapper", probeResult);

    probe("capture", "ready", "");
    pump(3000);

    probeNote("channel 1");
    note(0, 60, 100, 400, 200);

    probeNote("channels 2 to 9, each its own program");

    for (i = 1; i < 9; i++) {
        send("program", (BYTE)(0xc0 | i), (BYTE)(8 * i), 0);
        note((BYTE)i, (BYTE)(48 + 3 * i), 100, 200, 100);
    }

    probeNote("channel 10, General MIDI's drums");
    note(9, 35, 100, 200, 100);
    note(9, 38, 100, 200, 100);
    note(9, 42, 100, 200, 100);
    note(9, 46, 100, 200, 100);
    note(9, 49, 100, 200, 100);

    probeNote("channel 10 by running status");
    send("on", 0x99, 36, 110);
    pump(150);
    message("running", 0x007f28L);
    pump(150);
    message("running", 0x000024L);
    message("running", 0x000028L);
    pump(150);

    probeNote("channel 16, a melodic channel there");
    send("program", 0xcf, 73, 0);
    note(15, 72, 100, 300, 100);

    probeNote("channels 11 to 15");

    for (i = 10; i < 15; i++) {
        note((BYTE)i, (BYTE)(55 + 2 * i), 90, 150, 50);
    }

    probeNote("volume and bend on channel 1");
    send("volume", 0xb0, 7, 64);
    send("on", 0x90, 64, 100);
    pump(200);
    send("bend", 0xe0, 0, 0x60);
    pump(200);
    send("bend", 0xe0, 0, 0x40);
    pump(200);
    send("off", 0x80, 64, 0);
    send("volume", 0xb0, 7, 127);
    pump(200);

    probeNote("a General MIDI sequence");
    send("program", 0xc0, 0, 0);
    send("program", 0xc1, 33, 0);

    for (i = 0; i < 8; i++) {
        send("bass", 0x91, (BYTE)((i & 2) ? 41 : 36), 100);
        send("melody", 0x90, (BYTE)(60 + (i % 4) * 2), 90);
        send((i & 1) == 0 ? "kick" : "snare", 0x99, (BYTE)((i & 1) == 0 ? 35 : 38), 100);
        send("hat", 0x99, 42, 80);
        pump(250);
        send("melody-off", 0x80, (BYTE)(60 + (i % 4) * 2), 0);
        send("bass-off", 0x81, (BYTE)((i & 2) ? 41 : 36), 0);
        send((i & 1) == 0 ? "kick-off" : "snare-off", 0x89, (BYTE)((i & 1) == 0 ? 35 : 38), 0);
        send("hat-off", 0x89, 42, 0);
        pump(250);
    }

    probeNote("reset");

    for (i = 0; i < 3; i++) {
        send("on", (BYTE)(0x90 + i), (BYTE)(60 + 4 * i), 100);
    }

    pump(300);
    at("reset");
    answered("reset", midiOutReset(device));
    pump(500);

    closeMapper("last");
    probe("capture", "done", "");
    probeFinish();

    return 0;
}
