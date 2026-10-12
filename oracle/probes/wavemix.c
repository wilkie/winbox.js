/*
 * Microsoft's WaveMix (WAVMIX16.DLL, "Wavmix.dll V 2", Oct 6 1994, as
 * SimTower ships it) on an installation with a sound card -- the Sound
 * Blaster 1.5, put in by Control Panel (`--display vgasound`) -- used as
 * SimTower uses it: a session, waves opened, channels, the device taken,
 * waves played and their ends told to a window. The library is not
 * Windows': the recorder puts SimTower's copy in `C:\WINDOWS\SYSTEM`
 * (`record.mjs`, `FROM_CORPUS`), and the probe writes `WAVEMIX.INI`'s
 * `[general] ShowDevices=0` first, as WaveMix wants the file there and
 * makes no session without it (seg1 `35fe`).
 *
 * * `load`: whether the library loaded; `info`, what WaveMixGetInfo
 *   answers -- its size, version and date.
 * * `init`: whether WaveMixInit made a session.
 * * `wave`: a half second of a square wave opened from a file, and a file
 *   that is not there.
 * * `channel`: channel 0 opened, again, and channel 8.
 * * `error`: playing before the device is taken; on a channel not open.
 * * `activate`: the device taken, and again.
 * * `play`: the wave played on channel 0, and, separately, on 0 and 1 at
 *   once and once looped: what Play answered and each MM_WOM_DONE the window
 *   was posted -- its channel, whether its lParam was the wave -- and how
 *   long after Play it came, in tenths of a second.
 * * `flush`: a channel flushed while it plays, and whether its end is told.
 * * `close`: the device given back, the channels closed, the wave freed,
 *   the session closed.
 */

#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\WAVEMIX.OUT"
#define WAVEFILE "C:\\ORACLE\\TONE.WAV"
#define RATE 11025
#define LENGTH (RATE / 2)

typedef struct {
    WORD wSize;
    WORD wVersion;
    char szDate[12];
    DWORD dwFormats;
} WAVEMIXINFO;

typedef struct {
    WORD wSize;
    HANDLE hMixSession;
    int iChannel;
    LPVOID lpMixWave;
    HWND hWndNotify;
    DWORD dwFlags;
    WORD wLoops;
} MIXPLAYPARAMS;

#define WMIX_FILE 0x0001L
#define WMIX_CLEARQUEUE 0x0001L
#define WMIX_HIPRIORITY 0x0004L

typedef HANDLE(FAR PASCAL *INITPROC)(void);
typedef UINT(FAR PASCAL *ACTIVATEPROC)(HANDLE, BOOL);
typedef LPVOID(FAR PASCAL *OPENWAVEPROC)(HANDLE, LPCSTR, HINSTANCE, DWORD);
typedef UINT(FAR PASCAL *CHANNELPROC)(HANDLE, int, DWORD);
typedef UINT(FAR PASCAL *PLAYPROC)(MIXPLAYPARAMS FAR *);
typedef UINT(FAR PASCAL *FREEWAVEPROC)(HANDLE, LPVOID);
typedef UINT(FAR PASCAL *CLOSESESSIONPROC)(HANDLE);
typedef UINT(FAR PASCAL *INFOPROC)(WAVEMIXINFO FAR *);

static INITPROC Init;
static ACTIVATEPROC Activate;
static OPENWAVEPROC OpenWave;
static CHANNELPROC OpenChannel, FlushChannel, CloseChannel;
static PLAYPROC Play;
static FREEWAVEPROC FreeWave;
static CLOSESESSIONPROC CloseSession;
static INFOPROC GetInfo;

static HWND window;
static LPVOID tone;
static DWORD started;
static int ends;

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == MM_WOM_DONE) {
        wsprintf(probeArgs, "%d", ++ends);
        wsprintf(probeResult, "channel=%u,%s,%lu", wParam,
                 (LPVOID)lParam == tone ? (LPSTR)"wave" : (LPSTR)"other",
                 (timeGetTime() - started + 50) / 100);
        probe("end", probeArgs, probeResult);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

/* Messages handled until `count` ends have been told or `ms` have passed. */
static void pump(DWORD ms, int count)
{
    DWORD start = timeGetTime();
    MSG msg;

    for (;;) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        if (ends >= count || timeGetTime() - start >= ms) {
            return;
        }
    }
}

static void answer(LPCSTR function, LPCSTR what, UINT value)
{
    wsprintf(probeResult, "%u", value);
    probe(function, what, probeResult);
}

static UINT play(HANDLE session, int channel, WORD loops)
{
    MIXPLAYPARAMS params;

    params.wSize = sizeof(params);
    params.hMixSession = session;
    params.iChannel = channel;
    params.lpMixWave = tone;
    params.hWndNotify = window;
    params.dwFlags = WMIX_CLEARQUEUE | WMIX_HIPRIORITY;
    params.wLoops = loops;

    return Play(&params);
}

/* A half second of a square wave, 11,025 eight-bit samples a second, one
 * channel, written as a RIFF file. */
static void writeTone(void)
{
    static const BYTE head[44] = {
        'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'A', 'V', 'E',
        'f', 'm', 't', ' ', 16, 0, 0, 0, 1, 0, 1, 0,
        0x11, 0x2b, 0, 0, 0x11, 0x2b, 0, 0, 1, 0, 8, 0,
        'd', 'a', 't', 'a', 0, 0, 0, 0,
    };
    BYTE bytes[44];
    BYTE block[441];
    HFILE file;
    DWORD riff = 36 + LENGTH;
    int i;

    _fmemcpy(bytes, head, sizeof(bytes));
    bytes[4] = (BYTE)riff;
    bytes[5] = (BYTE)(riff >> 8);
    bytes[40] = (BYTE)LENGTH;
    bytes[41] = (BYTE)(LENGTH >> 8);

    /* 441 samples of 25 cycles, each of 18 samples, high then low. */
    for (i = 0; i < 441; i++) {
        block[i] = (BYTE)((i % 18) < 9 ? 0xc0 : 0x40);
    }

    file = _lcreat(WAVEFILE, 0);
    _lwrite(file, (LPCSTR)bytes, sizeof(bytes));

    for (i = 0; i < LENGTH / 441; i++) {
        _lwrite(file, (LPCSTR)block, sizeof(block));
    }

    _lwrite(file, (LPCSTR)block, LENGTH % 441);
    _lclose(file);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    WAVEMIXINFO info;
    HINSTANCE library;
    HANDLE session;
    UINT result;

    probeOpen(OUTPUT);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "WaveMixProbe";
    RegisterClass(&wc);
    window = CreateWindow("WaveMixProbe", "", WS_OVERLAPPED, 0, 0, 10, 10, NULL, NULL, instance,
                          NULL);

    writeTone();
    answer("ini", "ShowDevices",
           WritePrivateProfileString("general", "ShowDevices", "0", "WAVEMIX.INI"));

    library = LoadLibrary("WAVMIX16.DLL");
    probe("load", "WAVMIX16.DLL", (UINT)library >= 32 ? "loaded" : "not loaded");

    if ((UINT)library < 32) {
        probeFinish();
        return 0;
    }

    Init = (INITPROC)GetProcAddress(library, "WaveMixInit");
    Activate = (ACTIVATEPROC)GetProcAddress(library, "WaveMixActivate");
    OpenWave = (OPENWAVEPROC)GetProcAddress(library, "WaveMixOpenWave");
    OpenChannel = (CHANNELPROC)GetProcAddress(library, "WaveMixOpenChannel");
    FlushChannel = (CHANNELPROC)GetProcAddress(library, "WaveMixFlushChannel");
    CloseChannel = (CHANNELPROC)GetProcAddress(library, "WaveMixCloseChannel");
    Play = (PLAYPROC)GetProcAddress(library, "WaveMixPlay");
    FreeWave = (FREEWAVEPROC)GetProcAddress(library, "WaveMixFreeWave");
    CloseSession = (CLOSESESSIONPROC)GetProcAddress(library, "WaveMixCloseSession");
    GetInfo = (INFOPROC)GetProcAddress(library, "WaveMixGetInfo");

    _fmemset(&info, 0, sizeof(info));
    info.wSize = sizeof(info);
    result = GetInfo(&info);
    wsprintf(probeResult, "%u,version=%x,date=%s,formats=%lx", result, info.wVersion,
             (LPSTR)info.szDate, info.dwFormats);
    probe("info", "", probeResult);

    session = Init();
    probe("init", "", session ? "session" : "none");

    if (!session) {
        FreeLibrary(library);
        probeFinish();
        return 0;
    }

    tone = OpenWave(session, WAVEFILE, NULL, WMIX_FILE);
    probe("wave", "file", tone ? "opened" : "none");
    probe("wave", "missing", OpenWave(session, "C:\\ORACLE\\NONE.WAV", NULL, WMIX_FILE)
                                 ? "opened" : "none");

    answer("error", "play-no-channel", play(session, 0, 0));
    answer("channel", "open-0", OpenChannel(session, 0, 0L));
    answer("channel", "open-0-again", OpenChannel(session, 0, 0L));
    answer("channel", "open-8", OpenChannel(session, 8, 0L));
    answer("channel", "open-1", OpenChannel(session, 1, 0L));
    answer("error", "play-inactive", play(session, 0, 0));

    answer("activate", "on", Activate(session, TRUE));
    answer("activate", "on-again", Activate(session, TRUE));

    ends = 0;
    started = timeGetTime();
    answer("play", "once", play(session, 0, 0));
    pump(3000, 1);

    ends = 0;
    started = timeGetTime();
    answer("play", "channel-0", play(session, 0, 0));
    answer("play", "channel-1", play(session, 1, 0));
    pump(3000, 2);

    ends = 0;
    started = timeGetTime();
    answer("play", "looped", play(session, 0, 1));
    pump(4000, 1);

    ends = 0;
    started = timeGetTime();
    answer("flush", "play", play(session, 0, 0));
    pump(100, 1);
    answer("flush", "flush", FlushChannel(session, 0, 0L));
    pump(1000, 1);
    wsprintf(probeResult, "%d", ends);
    probe("flush", "ends", probeResult);

    answer("close", "deactivate", Activate(session, FALSE));
    answer("close", "channel-0", CloseChannel(session, 0, 0L));
    answer("close", "channel-1", CloseChannel(session, 1, 0L));
    answer("close", "wave", FreeWave(session, tone));
    answer("close", "session", CloseSession(session));

    FreeLibrary(library);
    DestroyWindow(window);
    probeFinish();

    return 0;
}
