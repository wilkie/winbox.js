/*
 * MCI's sequencer, MCISEQ.DRV, playing a MIDI file with system-exclusive
 * messages in it, on the installation with a sound card (`--display
 * vgasound`), through the MIDI Mapper and its "Ad Lib" setup: as games
 * made with Klik & Play play files that begin with a Roland GS reset.
 *
 * The probe writes its own file, at 96 ticks a quarter and 120 a minute,
 * with Microsoft's mark first: at tick 0 a GS reset (`F0 41 10 42 12 40 00
 * 7F 00 41 F7`) and a note on channel 13, which the setup sends to the Ad
 * Lib; at tick 48 a General MIDI on (`F0 7E 7F 09 01 F7`); at 96 the note
 * let go and, written as an escape (`F7`), a clock byte; the track's end at
 * 96.
 *
 * * `mci`: the command, and what mciSendString answered, in hex, and the
 *   text it gave back, in brackets.
 * * `took`: how long a play waited for took, by timeGetTime, to the
 *   nearest 100 milliseconds; and how long a play not waited for took to
 *   notify. Not an answer.
 * * `notify`: the notification's code -- 1 successful, 2 superseded, 4
 *   aborted, 8 failure -- or `none` within three seconds.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\SEQSYSEX.OUT"

static const BYTE song[] = {
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
    0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x33,
    /* the mark, and the tempo */
    0x00, 0xff, 0x7f, 0x03, 0x00, 0x00, 0x41,
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    /* the GS reset */
    0x00, 0xf0, 0x0a, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7,
    /* a note on channel 13 */
    0x00, 0x9c, 0x3c, 0x64,
    /* General MIDI on, at 48 */
    0x30, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7,
    /* the note let go at 96, then a clock byte as an escape */
    0x30, 0x8c, 0x3c, 0x40,
    0x00, 0xf7, 0x01, 0xf8,
    0x00, 0xff, 0x2f, 0x00,
};

static HWND window;
static BOOL notified;
static UINT code;

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == MM_MCINOTIFY) {
        notified = TRUE;
        code = wParam;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void mci(LPCSTR command)
{
    char text[128];
    DWORD answer;

    lstrcpy(text, "untouched");
    answer = mciSendString(command, text, sizeof(text), window);
    wsprintf(probeResult, "%lx [%s]", answer, (LPSTR)text);
    probe("mci", command, probeResult);
}

static void played(LPCSTR command)
{
    DWORD from = timeGetTime();

    mci(command);
    wsprintf(probeResult, "%lu", ((timeGetTime() - from) + 50) / 100 * 100);
    probe("took", command, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HFILE file;
    DWORD from;
    MSG msg;

    probeOpen(OUTPUT);

    file = _lcreat("C:\\ORACLE\\SYSEX.MID", 0);
    _lwrite(file, (LPCSTR)song, sizeof(song));
    _lclose(file);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "SeqSysex";
    RegisterClass(&wc);
    window = CreateWindow("SeqSysex", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    mci("open C:\\ORACLE\\SYSEX.MID type sequencer alias song");
    mci("set song time format milliseconds");
    mci("status song length");
    played("play song wait");
    mci("status song position");
    mci("status song mode");

    mci("seek song to start");
    notified = FALSE;
    from = timeGetTime();
    mci("play song notify");

    while (!notified && timeGetTime() - from < 3000) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    if (notified) {
        wsprintf(probeResult, "%u", code);
        probe("notify", "play", probeResult);
        wsprintf(probeResult, "%lu", ((timeGetTime() - from) + 50) / 100 * 100);
        probe("took", "play song notify", probeResult);
    } else {
        probe("notify", "play", "none");
    }

    mci("status song position");
    mci("play song from 250 to 400 wait");
    mci("status song position");
    mci("close song");

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
