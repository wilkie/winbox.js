/*
 * Long messages through the MIDI Mapper, on the installation with a sound
 * card (`--display vgasound`), its "Ad Lib" setup current: system-exclusive
 * messages, as a sequencer sends a Roland GS reset, whole, split over two
 * headers, and a system real-time byte and an end of exclusive alone.
 *
 * The mapper is opened to call a window back. Each long message is sent
 * on its own header, prepared first and unprepared after.
 *
 * * `open`, `close`: what midiOutOpen and midiOutClose answered.
 * * `prepare`, `unprepare`: what they answered, and the header's flags
 *   after, in hex.
 * * `long`: what midiOutLongMsg answered, the header's flags as it
 *   returned, in hex, and how many MM_MOM_DONE messages for that header
 *   the window had been sent by then and after a tenth of a second.
 * * `done`: each MM_MOM_DONE the window was sent, in order: whether its
 *   wParam was the mapper's handle, and which header it named.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MAPLONG.OUT"

static HWND window;
static HMIDIOUT out;
static MIDIHDR headers[5];
static int doneFor[5];
static int dones;

static const BYTE reset[] = {0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7};
static const BYTE first[] = {0xf0, 0x41, 0x10};
static const BYTE second[] = {0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7};
static const BYTE clock[] = {0xf8};
static const BYTE end[] = {0xf7};

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == MM_MOM_DONE) {
        int which;

        for (which = 0; which < 5; which++) {
            if ((LPMIDIHDR)lParam == &headers[which]) {
                break;
            }
        }

        if (which < 5) {
            doneFor[which]++;
        }

        wsprintf(probeArgs, "%d", ++dones);
        wsprintf(probeResult, "%s %d", (LPSTR)((HMIDIOUT)wParam == out ? "mapper" : "other"),
                 which);
        probe("done", probeArgs, probeResult);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void pump(DWORD ms)
{
    DWORD start = timeGetTime();
    MSG msg;

    do {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    } while (timeGetTime() - start < ms);
}

static void sent(LPCSTR what, int which, const BYTE *bytes, UINT size)
{
    LPMIDIHDR header = &headers[which];
    UINT answer;
    int then;
    char result[64];

    _fmemset(header, 0, sizeof(*header));
    header->lpData = (LPSTR)bytes;
    header->dwBufferLength = size;
    answer = midiOutPrepareHeader(out, header, sizeof(*header));
    wsprintf(probeResult, "%u %lx", answer, header->dwFlags);
    probe("prepare", what, probeResult);

    answer = midiOutLongMsg(out, header, sizeof(*header));
    then = doneFor[which];
    wsprintf(result, "%u %lx", answer, header->dwFlags);
    pump(100);
    wsprintf(result + lstrlen(result), " %d %d", then, doneFor[which]);
    probe("long", what, result);
}

static void unprepared(LPCSTR what, int which)
{
    UINT answer = midiOutUnprepareHeader(out, &headers[which], sizeof(MIDIHDR));

    wsprintf(probeResult, "%u %lx", answer, headers[which].dwFlags);
    probe("unprepare", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    UINT answer;

    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "MapLong";
    RegisterClass(&wc);
    window = CreateWindow("MapLong", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    answer = midiOutOpen(&out, MIDI_MAPPER, (DWORD)(UINT)window, 0, CALLBACK_WINDOW);
    wsprintf(probeResult, "%u", answer);
    probe("open", "mapper", probeResult);
    pump(100);

    sent("reset", 0, reset, sizeof(reset));
    sent("first part", 1, first, sizeof(first));
    sent("second part", 2, second, sizeof(second));
    sent("clock", 3, clock, sizeof(clock));
    sent("end", 4, end, sizeof(end));

    unprepared("reset", 0);
    unprepared("first part", 1);
    unprepared("second part", 2);
    unprepared("clock", 3);
    unprepared("end", 4);

    answer = midiOutClose(out);
    wsprintf(probeResult, "%u", answer);
    probe("close", "mapper", probeResult);
    pump(100);

    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
