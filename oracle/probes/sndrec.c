/*
 * Sound Recorder changing a waveform file and saving it: `SOUNDREC.EXE`
 * started on a file the probe writes, commands of its Effects menu posted
 * to it, then its File menu's Save, and the file read back. What Sound
 * Recorder writes is MMSYSTEM's `mmio` functions at work: a RIFF `WAVE`
 * made with `mmioCreateChunk` and `mmioAscend`. Recorded on the
 * installation with sound, where Sound Recorder has a device to play on.
 *
 * Three files: `TONE.WAV`, 101 samples of a ramp, reversed and made
 * louder; `TWO.WAV`, 3001 samples of a square wave, made faster and given
 * an echo; `THREE.WAV`, 1500 of a slower one, made quieter and slower.
 *
 * * `exec`: WinExec's answer, `inst` for an instance.
 * * `window`: whether Sound Recorder's window was found.
 * * `texts`: its title, status, position and length as it shows them.
 * * `command`: a menu command's text, found by its start without its `&`,
 *   and posted.
 * * `box`: any box shown meanwhile, once, its title and its first static's
 *   text; OK is posted to it.
 * * `closed`: whether Sound Recorder has gone once `WM_CLOSE` is posted.
 * * `bytes`, `length`, `block`: the file as Sound Recorder left it: its
 *   first 64 bytes in hexadecimal, its length, and each 256 bytes after
 *   them summed and exclusive-ored.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SNDREC.OUT"

static HWND recorder;

/* The boxes recorded: each once, however long it stays. */
static HWND seen[16];
static int seenCount;

/* A box of another program's: recorded once, and OK posted to it. A
 * message box takes no posted OK, so on the installation without sound
 * Sound Recorder's box about it stays, and the commands are taken all the
 * same. */
BOOL CALLBACK _export Box(HWND window, LPARAM lParam)
{
    char className[32];
    char title[80];
    char text[160];
    HWND child;
    int i;

    (void)lParam;

    if (!IsWindowVisible(window) || window == recorder) {
        return TRUE;
    }

    GetClassName(window, className, sizeof(className));

    if (lstrcmp(className, "#32770") != 0) {
        return TRUE;
    }

    for (i = 0; i < seenCount; i++) {
        if (seen[i] == window) {
            PostMessage(window, WM_COMMAND, IDOK, 0L);
            return TRUE;
        }
    }

    if (seenCount < 16) {
        seen[seenCount++] = window;
    }

    GetWindowText(window, title, sizeof(title));
    text[0] = '\0';

    for (child = GetWindow(window, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetClassName(child, className, sizeof(className));

        if (lstrcmpi(className, "Static") == 0 && GetWindowTextLength(child) > 0) {
            GetWindowText(child, text, sizeof(text));
            break;
        }
    }

    wsprintf(probeResult, "%s|%s", (LPSTR)title, (LPSTR)text);
    probe("box", "", probeResult);
    PostMessage(window, WM_COMMAND, IDOK, 0L);
    return TRUE;
}

static FARPROC boxes;

/* Lets the others run for a while, pressing OK in any box they show. */
static void settle(DWORD milliseconds)
{
    DWORD start = GetTickCount();
    DWORD swept = start;
    MSG msg;

    while (GetTickCount() - start < milliseconds) {
        if (GetTickCount() - swept > 250) {
            EnumWindows((WNDENUMPROC)boxes, 0L);
            swept = GetTickCount();
        }

        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }
}

/* A sample of a file: `TONE.WAV`'s a ramp, `TWO.WAV`'s a square wave of
 * sixteen samples' period, `THREE.WAV`'s a slower one. */
static BYTE sample(int kind, int i)
{
    switch (kind) {
    case 0:
        return (BYTE)(0x30 + i);
    case 1:
        return (BYTE)(i & 8 ? 0xa0 : 0x60);
    default:
        return (BYTE)(i & 64 ? 0xc0 : 0x40);
    }
}

static void writeWave(LPCSTR path, int count, int kind)
{
    BYTE head[44];
    BYTE samples[256];
    HFILE file;
    long data = count;
    long riff = 36 + count + (count & 1);
    int i, at;

    _fmemcpy(head, "RIFF....WAVEfmt ", 16);
    head[4] = (BYTE)riff;
    head[5] = (BYTE)(riff >> 8);
    head[6] = head[7] = 0;
    head[16] = 16;
    head[17] = head[18] = head[19] = 0;
    head[20] = 1;
    head[21] = 0;
    head[22] = 1;
    head[23] = 0;
    head[24] = 0x11;
    head[25] = 0x2b;
    head[26] = head[27] = 0;
    head[28] = 0x11;
    head[29] = 0x2b;
    head[30] = head[31] = 0;
    head[32] = 1;
    head[33] = 0;
    head[34] = 8;
    head[35] = 0;
    _fmemcpy(head + 36, "data", 4);
    head[40] = (BYTE)data;
    head[41] = (BYTE)(data >> 8);
    head[42] = head[43] = 0;

    file = _lcreat(path, 0);
    _lwrite(file, (LPCSTR)head, sizeof(head));

    for (at = 0; at < count; at += 256) {
        int n = count - at < 256 ? count - at : 256;

        for (i = 0; i < n; i++) {
            samples[i] = sample(kind, at + i);
        }

        _lwrite(file, (LPCSTR)samples, n);
    }

    if (count & 1) {
        samples[0] = 0;
        _lwrite(file, (LPCSTR)samples, 1);
    }

    _lclose(file);
}

/* A file as Sound Recorder left it: its first 64 bytes in hexadecimal, its
 * length, and each 256 bytes after the first 64 summed and exclusive-ored. */
static void bytes(LPCSTR name, LPCSTR path)
{
    BYTE data[256];
    HFILE file = _lopen(path, OF_READ);
    long length;
    int count, i, block;

    if (file == HFILE_ERROR) {
        probe("bytes", name, "none");
        return;
    }

    length = _llseek(file, 0L, 2);
    _llseek(file, 0L, 0);
    count = _lread(file, data, 64);

    for (i = 0; i < count; i++) {
        wsprintf(probeResult + i * 2, "%02x", data[i]);
    }

    wsprintf(probeArgs, "%s@0", (LPSTR)name);
    probe("bytes", probeArgs, probeResult);
    wsprintf(probeResult, "%lx", length);
    probe("length", name, probeResult);

    for (block = 0;; block++) {
        UINT sum = 0;
        BYTE xor = 0;

        count = _lread(file, data, sizeof(data));

        if (count <= 0) {
            break;
        }

        for (i = 0; i < count; i++) {
            sum += data[i];
            xor ^= data[i];
        }

        wsprintf(probeArgs, "%s@%lx", (LPSTR)name, 64L + 256L * block);
        wsprintf(probeResult, "%x,%x,%02x", count, sum, xor);
        probe("block", probeArgs, probeResult);
    }

    _lclose(file);
}

static void texts(LPCSTR when)
{
    char status[64], position[64], length[64], title[80];

    GetWindowText(recorder, title, sizeof(title));
    GetDlgItemText(recorder, 200, status, sizeof(status));
    GetDlgItemText(recorder, 201, position, sizeof(position));
    GetDlgItemText(recorder, 202, length, sizeof(length));
    wsprintf(probeResult, "%s|%s|%s|%s", (LPSTR)title, (LPSTR)status, (LPSTR)position,
             (LPSTR)length);
    probe("texts", when, probeResult);
}

/* A menu's text without its `&`. */
static void plain(LPSTR out, LPCSTR in)
{
    for (; *in; in++) {
        if (*in != '&') {
            *out++ = *in;
        }
    }

    *out = '\0';
}

/* A command of a menu of the bar's, by the start of its text without its
 * `&`, posted. */
static void command(int menu, LPCSTR start)
{
    HMENU popup = GetSubMenu(GetMenu(recorder), menu);
    int count = GetMenuItemCount(popup);
    char text[80];
    char bare[80];
    int i;

    for (i = 0; i < count; i++) {
        GetMenuString(popup, i, text, sizeof(text), MF_BYPOSITION);
        plain(bare, text);

        if (_fstrncmp(bare, start, lstrlen(start)) == 0) {
            probe("command", start, text);
            PostMessage(recorder, WM_COMMAND, GetMenuItemID(popup, i), 0L);
            settle(3000);
            texts(start);
            return;
        }
    }

    probe("command", start, "none");
}

/* Sound Recorder's windows already found: where it has no sound, each
 * stays behind its box. */
static HWND before[4];
static int beforeCount;

/* A window of Sound Recorder's class not found before. */
BOOL CALLBACK _export Fresh(HWND window, LPARAM lParam)
{
    char className[32];
    int i;

    (void)lParam;
    GetClassName(window, className, sizeof(className));

    if (lstrcmp(className, "SoundRec") != 0) {
        return TRUE;
    }

    for (i = 0; i < beforeCount; i++) {
        if (before[i] == window) {
            return TRUE;
        }
    }

    recorder = window;
    return FALSE;
}

static FARPROC fresh;

static void session(LPCSTR path, LPCSTR name, LPCSTR first, LPCSTR second)
{
    char line[128];
    UINT answer;
    int tries;

    wsprintf(line, "C:\\WINDOWS\\SOUNDREC.EXE %s", (LPSTR)path);
    answer = WinExec(line, SW_SHOWNORMAL);
    probe("exec", name, answer > 32 ? "inst" : "error");

    recorder = NULL;

    for (tries = 0; tries < 40 && !recorder; tries++) {
        settle(250);
        EnumWindows((WNDENUMPROC)fresh, 0L);
    }


    settle(2000);
    probe("window", name, recorder ? "found" : "none");

    if (!recorder) {
        return;
    }

    texts(name);
    command(2, first);
    command(2, second);
    command(0, "Save");
    PostMessage(recorder, WM_CLOSE, 0, 0L);
    settle(3000);
    probe("closed", name, IsWindow(recorder) ? "no" : "yes");

    /* One that stays is not taken for the next; a handle given back may be
     * the next's. */
    if (IsWindow(recorder) && beforeCount < 4) {
        before[beforeCount++] = recorder;
    }

    bytes(name, path);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR line, int show)
{
    probeOpen(OUTPUT);
    boxes = MakeProcInstance((FARPROC)Box, instance);
    fresh = MakeProcInstance((FARPROC)Fresh, instance);

    writeWave("C:\\ORACLE\\TONE.WAV", 101, 0);
    writeWave("C:\\ORACLE\\TWO.WAV", 3001, 1);
    writeWave("C:\\ORACLE\\THREE.WAV", 1500, 2);
    bytes("tone-before", "C:\\ORACLE\\TONE.WAV");
    bytes("two-before", "C:\\ORACLE\\TWO.WAV");

    session("C:\\ORACLE\\TONE.WAV", "tone", "Reverse", "Increase Volume");
    session("C:\\ORACLE\\TWO.WAV", "two", "Increase Speed", "Add Echo");
    session("C:\\ORACLE\\THREE.WAV", "three", "Decrease Volume", "Decrease Speed");

    probeFinish();

    (void)previous;
    (void)line;
    (void)show;
    return 0;
}
