/*
 * MCI's waveaudio device playing in the background, on an installation with
 * a sound card (`--display vgasound`): what a program sees while a play it
 * did not wait for goes on.
 *
 * The probe writes its own file first: two seconds of silence at 11025 a
 * second, eight bits, one channel. Commands go through mciSendString with a
 * window for notifications, the time format milliseconds.
 *
 * * `mci`: the command's number, in order, and the command string; what
 *   mciSendString answered, in hex, and the text it gave back, in brackets.
 *   Positions read while the device plays are given only as whether they
 *   moved (`moving`) or held still (`still`) over a fifth of a second, and
 *   where they ended.
 * * `notify`: each MM_MCINOTIFY the window was sent, in order: its code --
 *   1 successful, 2 superseded, 4 aborted, 8 failure -- and whether its
 *   lParam was the device's ID.
 * * `wait`: how long, in tenths of a second, until a play's notification
 *   came, or `none` within four seconds.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MCIPLAY.OUT"
#define SAMPLES 22050

static const BYTE WAVE_HEAD[44] = {
    'R', 'I', 'F', 'F', 0x24, 0x56, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ',
    16,  0,   0,   0,   1,    0,    1, 0, 0x11, 0x2b, 0, 0, 0x11, 0x2b, 0, 0,
    1,   0,   8,   0,   'd',  'a',  't', 'a', 0x22, 0x56, 0, 0,
};

static HWND window;
static UINT device;
static int notes;
static BOOL notified;

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == MM_MCINOTIFY) {
        wsprintf(probeArgs, "%d", ++notes);
        wsprintf(probeResult, "%u,%s", wParam,
                 (UINT)LOWORD(lParam) == device ? (LPSTR)"device" : (LPSTR)"other");
        probe("notify", probeArgs, probeResult);
        notified = TRUE;
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

static DWORD answered;
static char text[128];

static void mci(LPCSTR command)
{
    static int step;
    char name[160];

    lstrcpy(text, "untouched");
    answered = mciSendString(command, text, sizeof(text), window);
    wsprintf(probeResult, "%lx [%s]", answered, (LPSTR)text);
    wsprintf(name, "%d %s", ++step, command);
    probe("mci", name, probeResult);
}

/* The position read twice a fifth of a second apart: whether it moved. */
static void motion(LPCSTR when)
{
    char first[32];
    DWORD a, b;

    mciSendString("status w position", first, sizeof(first), NULL);
    a = 0;
    {
        LPCSTR at = first;

        while (*at >= '0' && *at <= '9') {
            a = a * 10 + (*at++ - '0');
        }
    }
    pump(200);
    mciSendString("status w position", text, sizeof(text), NULL);
    b = 0;
    {
        LPCSTR at = text;

        while (*at >= '0' && *at <= '9') {
            b = b * 10 + (*at++ - '0');
        }
    }
    probe("motion", when, b > a ? "moving" : b == a ? "still" : "back");
}

/* How long until a notification came. */
static void waitFor(LPCSTR what)
{
    DWORD start = timeGetTime();

    while (!notified && timeGetTime() - start < 4000) {
        pump(10);
    }

    if (notified) {
        wsprintf(probeResult, "%lu", (timeGetTime() - start + 50) / 100);
    } else {
        lstrcpy(probeResult, "none");
    }

    probe("wait", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HFILE file;
    static BYTE quiet[1024];
    int i;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof(quiet); i++) {
        quiet[i] = 0x80;
    }

    file = _lcreat("C:\\ORACLE\\TWO.WAV", 0);
    _lwrite(file, (LPCSTR)WAVE_HEAD, sizeof(WAVE_HEAD));

    for (i = 0; i < SAMPLES / sizeof(quiet); i++) {
        _lwrite(file, (LPCSTR)quiet, sizeof(quiet));
    }

    _lwrite(file, (LPCSTR)quiet, SAMPLES % sizeof(quiet));
    _lclose(file);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "MciPlay";
    RegisterClass(&wc);
    window = CreateWindow("MciPlay", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    mci("open C:\\ORACLE\\TWO.WAV type waveaudio alias w");
    device = mciGetDeviceID("w");
    mci("set w time format milliseconds");
    mci("status w length");
    mci("status w mode");

    /* Played to its end, not waited for. */
    notified = FALSE;
    mci("play w notify");
    mci("status w mode");
    motion("playing");
    waitFor("play-to-end");
    mci("status w mode");
    mci("status w position");

    /* Paused and resumed. */
    mci("seek w to start");
    notified = FALSE;
    mci("play w notify");
    pump(300);
    mci("pause w");
    mci("status w mode");
    motion("paused");
    mci("resume w");
    mci("status w mode");
    motion("resumed");
    waitFor("resumed-to-end");
    mci("status w position");

    /* Stopped part-way. */
    mci("seek w to start");
    notified = FALSE;
    mci("play w notify");
    pump(300);
    mci("stop w");
    pump(200);
    mci("status w mode");
    motion("stopped");
    wsprintf(probeResult, "%s", notified ? (LPSTR)"yes" : (LPSTR)"no");
    probe("wait", "stop-notified", probeResult);

    /* Played again over a play: the first superseded. */
    mci("seek w to start");
    notified = FALSE;
    mci("play w notify");
    pump(300);
    mci("play w from 0 notify");
    pump(200);
    notified = FALSE;
    waitFor("second-to-end");

    /* Played from and to. */
    notified = FALSE;
    mci("play w from 500 to 1000 notify");
    waitFor("from-to");
    mci("status w position");

    /* Closed while playing. */
    mci("seek w to start");
    notified = FALSE;
    mci("play w notify");
    pump(300);
    mci("close w");
    pump(300);
    wsprintf(probeResult, "%s", notified ? (LPSTR)"yes" : (LPSTR)"no");
    probe("wait", "close-notified", probeResult);

    DestroyWindow(window);
    probeFinish();

    return 0;
}
