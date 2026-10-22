/*
 * What KERNEL tells of a local heap and an instance's data, and the notify
 * procedure it keeps for a heap:
 *
 * * `heap`: `LocalHeapSize` (`KRNL386.EXE` seg2 `2a01`), the heap's last
 *   arena less its first, and `LocalCountFree` (seg2 `29c9`), its free
 *   blocks' sizes less ten each, in hexadecimal: as the probe starts, with a
 *   fixed block of 100 bytes and a moveable one of 300h, and with both freed.
 * * `notify`: `LocalNotify` (seg2 `0278`, `28a0`), which swaps the far
 *   pointer at offset 1Eh of the heap's information: the offset of the one
 *   there first, and (`notifyseg`) whether its segment is nought; then,
 *   given that back, whether it answers the probe's own procedure.
 * * `instance`: `GetInstanceData` (seg2 `08a9`), asked by a second instance
 *   of the probe of the first: what it answers for 16 bytes and what they
 *   are, where the first wrote its name, and for none.
 *
 * The two count and size functions are not in the import library, and are
 * found by their ordinals, 161 and 162.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LOCINFO.OUT"

typedef UINT(FAR PASCAL *COUNTPROC)(void);
typedef FARPROC(FAR PASCAL *NOTIFYPROC)(FARPROC);

static char secret[16] = "second instance";

static void reopen(void)
{
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0L, 2);
}

BOOL CALLBACK __export Notified(WORD message, HLOCAL handle, WORD argument)
{
    (void)message;
    (void)handle;
    (void)argument;
    return FALSE;
}

static void heap(COUNTPROC heapSize, COUNTPROC countFree, LPCSTR what)
{
    wsprintf(probeResult, "%x %x", heapSize(), countFree());
    probe("heap", what, probeResult);
}

static void second(HINSTANCE previous)
{
    int answer;

    reopen();

    lstrcpy(secret, "nothing");
    answer = GetInstanceData(previous, (BYTE *)secret, sizeof(secret));
    secret[sizeof(secret) - 1] = 0;
    wsprintf(probeResult, "%d %s", answer, (LPSTR)secret);
    probe("instance", "16 bytes", probeResult);

    answer = GetInstanceData(previous, (BYTE *)secret, 0);
    wsprintf(probeResult, "%d", answer);
    probe("instance", "none", probeResult);

    _lclose(probeHandle);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE kernel = GetModuleHandle("KERNEL");
    COUNTPROC countFree = (COUNTPROC)GetProcAddress(kernel, MAKEINTRESOURCE(161));
    COUNTPROC heapSize = (COUNTPROC)GetProcAddress(kernel, MAKEINTRESOURCE(162));
    NOTIFYPROC localNotify = (NOTIFYPROC)GetProcAddress(kernel, MAKEINTRESOURCE(14));
    FARPROC ours;
    FARPROC first;
    FARPROC back;
    HLOCAL fixed;
    HLOCAL moveable;
    MSG msg;

    if (previous) {
        second(previous);
        return 0;
    }

    probeOpen(OUTPUT);

    heap(heapSize, countFree, "start");
    fixed = LocalAlloc(LMEM_FIXED, 100);
    moveable = LocalAlloc(LMEM_MOVEABLE, 0x300);
    heap(heapSize, countFree, "two blocks");
    LocalFree(moveable);
    LocalFree(fixed);
    heap(heapSize, countFree, "freed");

    ours = MakeProcInstance((FARPROC)Notified, instance);
    first = localNotify(ours);
    wsprintf(probeResult, "%x", LOWORD((DWORD)first));
    probe("notify", "first", probeResult);
    probe("notifyseg", "first", HIWORD((DWORD)first) ? "segment" : "nought");
    back = localNotify(first);
    probe("notify", "given back", back == ours ? "ours" : "other");

    lstrcpy(secret, "first instance");
    _lclose(probeHandle);

    if (WinExec("LOCINFO.EXE", SW_SHOWNORMAL) >= 32) {
        while (GetModuleUsage(instance) > 1) {
            if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
                DispatchMessage(&msg);
            }
        }
    }

    reopen();
    probeFinish();

    (void)command;
    (void)show;
    return 0;
}
