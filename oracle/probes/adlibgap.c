/*
 * Where the time goes between two MIDI messages, as `adlibout` and
 * `adlibmap` send them on the installation with a sound card (`--display
 * vgasound`): each part of a step of theirs -- the time read, the record's
 * fields formatted, the record written and the file closed, opened again
 * and sought to its end (`PROBE_FLUSH`), a message looked for, and each
 * kind of message they send the Ad Lib, directly and through the MIDI
 * Mapper -- made ten times over with a mark after each part; and each
 * closed and opened again, three times.
 *
 * A mark is a read of the OPL's status port, 388h, which the Ad Lib's
 * driver reads only as it looks for its card; DOSBox's build that traces
 * the OPL's ports (`record.mjs --capture --dosbox`) gives each its time to
 * the microsecond, kept as `oracle/fixtures/opl/adlibgap-trace.json`. At a
 * fixed 3,000 cycles a millisecond, the time from one mark to the next is
 * the instructions Windows ran for the part. Two marks in a row time a
 * mark itself, and a pass of `cpurate`'s `alu` workload, 589,815
 * instructions, times the program's own instructions.
 *
 * The records written within the marks go to a file of their own, so that
 * the probe's records hold no times:
 *
 * * `device`: the Ad Lib's device ID, and how many there are.
 * * `part`: each part in the order it is made, by its number; and what its
 *   call answered the first time.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\ADLIBGAP.OUT"
#define SCRATCH "C:\\ORACLE\\ADLIBGAP.TMP"
#define TIMES 10
#define PARTS 64

static HMIDIOUT device;
static HFILE scratch;
static MIDIHDR header;
static BYTE chord[] = {0x90, 60, 100, 64, 100, 67, 100};

/* Each part's name and what it answered, the first time it was made. */
static LPCSTR names[PARTS];
static DWORD answers[PARTS];
static int parts;
static int pass;

static void mark(void)
{
    _asm {
        mov dx, 388h
        in al, dx
    }
}

/* A part made: its answer kept, the first time, then a mark. */
static void made(LPCSTR name, DWORD answer)
{
    if (pass == 0 && parts < PARTS) {
        names[parts] = name;
        answers[parts++] = answer;
    }

    mark();
}

static void passAlu(void)
{
    _asm {
        mov cx, 65535
        mov bx, 3
        mov dx, 5
    top:
        add ax, bx
        sub ax, cx
        xor ax, dx
        and ax, bx
        or ax, cx
        shl ax, 1
        inc ax
        dec ax
        loop top
    }
}

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

static void send(LPCSTR name, DWORD message)
{
    made(name, midiOutShortMsg(device, message));
}

/* The parts of a record written, as `probe` writes one with
 * `PROBE_FLUSH`, and of the time read and the fields formatted. */
static void recordParts(void)
{
    char line[128];
    LPSTR at;
    DWORD now;
    MSG msg;

    now = timeGetTime();
    made("timeGetTime", 0);
    made("wsprintf 1,on,643c90", wsprintf(probeArgs, "%d,%s", 1, (LPSTR)"on,643c90"));
    made("wsprintf 123,off-by-velocity,003e90",
         wsprintf(probeArgs, "%d,%s", 123, (LPSTR)"off-by-velocity,003e90"));
    made("wsprintf %lu 0", wsprintf(probeResult, "%lu", now - now));
    made("wsprintf %lu 32153", wsprintf(probeResult, "%lu", 32153L));
    made("wsprintf %u 0", wsprintf(probeResult, "%u", 0));
    at = probeEscape(line, "at");
    *at++ = '\t';
    at = probeEscape(at, "1,on,643c90");
    *at++ = '\t';
    at = probeEscape(at, "0");
    *at++ = '\r';
    *at++ = '\n';
    made("record formatted", 0);
    made("_lwrite 18", _lwrite(scratch, line, (int)(at - line)));
    made("_lwrite 40", _lwrite(scratch, "at\t123,off-by-velocity,003e90\t32153\r\n...", 40));
    made("_lclose", _lclose(scratch));
    scratch = _lopen(SCRATCH, OF_WRITE);
    made("_lopen", 0);
    made("_llseek", _llseek(scratch, 0L, 2));
    made("PeekMessage", PeekMessage(&msg, NULL, 0, 0, PM_REMOVE));
}

/* Each kind of message `adlibout` sends, in an order that leaves the Ad
 * Lib as it found it. */
static void messageParts(void)
{
    send("volume b0 07 00", 0x0007b0L);
    send("on 90 3c 64", 0x643c90L);
    send("on again 90 3c 64", 0x643c90L);
    send("on second 90 40 64", 0x644090L);
    send("off-by-velocity 90 40 00", 0x004090L);
    send("off 80 3c 00", 0x003c80L);
    send("off not sounding 80 3c 00", 0x003c80L);
    send("on velocity 90 3c 10", 0x103c90L);
    send("off 80 3c 00", 0x003c80L);
    send("drum on 9f 23 64", 0x64239fL);
    send("drum off 8f 23 00", 0x00238fL);
    send("drum on 9f 2a 64", 0x642a9fL);
    send("drum off 8f 2a 00", 0x002a8fL);
    send("outside-map 9f 22 64", 0x64229fL);
    send("program c0 01", 0x0001c0L);
    send("program c0 00", 0x0000c0L);
    send("on 90 3c 64", 0x643c90L);
    send("bend e0 00 50", 0x5000e0L);
    send("bend e0 00 40", 0x4000e0L);
    send("program sounding c0 00", 0x0000c0L);
    send("on 90 3c 64", 0x643c90L);
    send("on 90 3e 64", 0x643e90L);
    send("on 90 40 64", 0x644090L);
    send("on 90 41 64", 0x644190L);
    send("on 90 43 64", 0x644390L);
    send("on 90 45 64", 0x644590L);
    send("on stealing 90 47 64", 0x644790L);
    send("notes-off b0 7b 00", 0x007bb0L);
    send("bend idle e0 00 50", 0x5000e0L);
    send("bend idle e0 00 40", 0x4000e0L);
    send("on 90 3c 64", 0x643c90L);
    made("midiOutReset sounding", midiOutReset(device));
    made("midiOutReset", midiOutReset(device));
    _fmemset(&header, 0, sizeof(header));
    header.lpData = (LPSTR)chord;
    header.dwBufferLength = sizeof(chord);
    made("midiOutPrepareHeader", midiOutPrepareHeader(device, &header, sizeof(header)));
    made("midiOutLongMsg chord", midiOutLongMsg(device, &header, sizeof(header)));
    made("midiOutUnprepareHeader", midiOutUnprepareHeader(device, &header, sizeof(header)));
    made("midiOutReset chord", midiOutReset(device));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    MIDIOUTCAPS caps;
    UINT count, id, adlib;
    int part;

    probeOpen(OUTPUT);

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

    if (adlib == 0xffff || midiOutOpen(&device, adlib, 0L, 0L, CALLBACK_NULL)) {
        probeFinish();
        return 0;
    }

    scratch = _lcreat(SCRATCH, 0);

    probe("capture", "ready", "");
    pump(3000);

    /* A mark's own time, then the program's instructions. */
    for (pass = 0; pass < TIMES; pass++) {
        mark();
        mark();
    }

    for (pass = 0; pass < 3; pass++) {
        mark();
        passAlu();
        mark();
    }

    /* Each part ten times over, from a mark. */
    for (pass = 0; pass < TIMES; pass++) {
        mark();
        recordParts();
        messageParts();
        pump(20);
    }

    /* The device closed and opened again, three times. */
    for (pass = 0; pass < 3; pass++) {
        mark();
        made("reopen midiOutClose", midiOutClose(device));
        made("reopen midiOutOpen", midiOutOpen(&device, adlib, 0L, 0L, CALLBACK_NULL));
        pump(20);
    }

    midiOutClose(device);
    _lclose(scratch);

    wsprintf(probeResult, "%u", midiOutOpen(&device, MIDI_MAPPER, 0L, 0L, CALLBACK_NULL));
    probe("open", "mapper", probeResult);

    /* Through the mapper: a channel it sends nowhere, then channel 13. */
    for (pass = 0; pass < TIMES; pass++) {
        mark();
        send("mapper on 90 3c 64", 0x643c90L);
        send("mapper volume b0 07 00", 0x0007bcL);
        send("mapper on 9c 3c 64", 0x643c9cL);
        send("mapper off 8c 3c 00", 0x003c8cL);
        send("mapper drum on 9f 23 64", 0x64239fL);
        send("mapper drum off 8f 23 00", 0x00238fL);
        send("mapper program cc 01", 0x0001ccL);
        send("mapper program cc 00", 0x0000ccL);
        made("mapper midiOutReset", midiOutReset(device));
        pump(20);
    }

    for (pass = 0; pass < 3; pass++) {
        mark();
        made("reopen mapper midiOutClose", midiOutClose(device));
        made("reopen mapper midiOutOpen", midiOutOpen(&device, MIDI_MAPPER, 0L, 0L, CALLBACK_NULL));
        pump(20);
    }

    midiOutClose(device);
    pump(500);

    for (part = 0; part < parts; part++) {
        wsprintf(probeArgs, "%d,%s", part + 1, names[part]);
        wsprintf(probeResult, "%lu", answers[part]);
        probe("part", probeArgs, probeResult);
    }

    probe("capture", "done", "");
    probeFinish();

    return 0;
}
