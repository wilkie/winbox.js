/*
 * MCI's waveaudio device playing in the background a file longer than its
 * buffers hold, on an installation with a sound card (`--display
 * vgasound`): when MCIWAVE's task fills its buffers again.
 *
 * The probe writes its own file first: six seconds of silence at 11025 a
 * second, eight bits, one channel -- six of the driver's buffers of a
 * second each, where it is opened with four. Commands go through
 * mciSendString with a window for notifications, the time format
 * milliseconds.
 *
 * * `mci`: the command's number, in order, and the command string; what
 *   mciSendString answered, in hex, and the text it gave back, in brackets.
 * * `wait`: how long, in whole seconds from the play, until its
 *   notification came -- the program waiting in GetMessage (`get`), polling
 *   with PeekMessage (`peek`), or first busy for five seconds without
 *   letting any other task run (`busy`) -- or `none` within twelve seconds.
 * * `busy`: where the device was, in whole seconds, after the five busy
 *   seconds, read before the program lets other tasks run.
 * * `notify`: each MM_MCINOTIFY the window was sent, in order: its code --
 *   1 successful, 2 superseded, 4 aborted, 8 failure.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MCITASK.OUT"
#define SAMPLES 66150L

static const BYTE WAVE_HEAD[44] = {
    'R', 'I', 'F', 'F', 0x8a, 0x02, 1, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ',
    16,  0,   0,   0,   1,    0,    1, 0, 0x11, 0x2b, 0, 0, 0x11, 0x2b, 0, 0,
    1,   0,   8,   0,   'd',  'a',  't', 'a', 0x66, 0x02, 1, 0,
};

static HWND window;
static int notes;
static BOOL notified;

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == MM_MCINOTIFY) {
        wsprintf(probeArgs, "%d", ++notes);
        wsprintf(probeResult, "%u", wParam);
        probe("notify", probeArgs, probeResult);
        notified = TRUE;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static char text[128];

static void mci(LPCSTR command)
{
    static int step;
    char name[160];
    DWORD answered;

    lstrcpy(text, "untouched");
    answered = mciSendString(command, text, sizeof(text), window);
    wsprintf(probeResult, "%lx [%s]", answered, (LPSTR)text);
    wsprintf(name, "%d %s", ++step, command);
    probe("mci", name, probeResult);
}

static void waited(LPCSTR what, DWORD start)
{
    if (notified) {
        wsprintf(probeResult, "%lu", (timeGetTime() - start + 500) / 1000);
    } else {
        lstrcpy(probeResult, "none");
    }

    probe("wait", what, probeResult);
}

/* The program waiting in GetMessage, a timer's tick bounding the wait. */
static void getUntil(LPCSTR what, DWORD start)
{
    MSG msg;

    SetTimer(window, 1, 500, NULL);

    while (!notified && timeGetTime() - start < 12000 && GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    KillTimer(window, 1);
    waited(what, start);
}

/* The program polling with PeekMessage. */
static void peekUntil(LPCSTR what, DWORD start)
{
    MSG msg;

    while (!notified && timeGetTime() - start < 12000) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    waited(what, start);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HFILE file;
    static BYTE quiet[1024];
    DWORD start;
    DWORD at;
    LPCSTR digit;
    long i;

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof(quiet); i++) {
        quiet[i] = 0x80;
    }

    file = _lcreat("C:\\ORACLE\\SIX.WAV", 0);
    _lwrite(file, (LPCSTR)WAVE_HEAD, sizeof(WAVE_HEAD));

    for (i = 0; i < SAMPLES / sizeof(quiet); i++) {
        _lwrite(file, (LPCSTR)quiet, sizeof(quiet));
    }

    _lwrite(file, (LPCSTR)quiet, (UINT)(SAMPLES % sizeof(quiet)));
    _lclose(file);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "MciTask";
    RegisterClass(&wc);
    window = CreateWindow("MciTask", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance, NULL);

    mci("open C:\\ORACLE\\SIX.WAV type waveaudio alias w");
    mci("set w time format milliseconds");
    mci("status w length");

    /* Waiting in GetMessage. */
    notified = FALSE;
    start = timeGetTime();
    mci("play w notify");
    getUntil("get", start);
    mci("status w position");

    /* Polling with PeekMessage. */
    mci("seek w to start");
    notified = FALSE;
    start = timeGetTime();
    mci("play w notify");
    peekUntil("peek", start);
    mci("status w position");

    /* Busy for five seconds first, no other task let run. */
    mci("seek w to start");
    notified = FALSE;
    start = timeGetTime();
    mci("play w notify");

    while (timeGetTime() - start < 5000) {
    }

    mciSendString("status w position", text, sizeof(text), NULL);
    at = 0;

    for (digit = text; *digit >= '0' && *digit <= '9'; digit++) {
        at = at * 10 + (*digit - '0');
    }

    wsprintf(probeResult, "%lu", (at + 500) / 1000);
    probe("busy", "position", probeResult);
    peekUntil("busy", start);
    mci("status w position");

    mci("close w");
    DestroyWindow(window);
    probeFinish();

    return 0;
}
