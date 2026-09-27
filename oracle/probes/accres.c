/*
 * `AccessResource` and `SizeofResource`, on resources the probe carries in
 * `accres.rc`: raw data of 1, 17 and 300 bytes, and one by name.
 *
 * * `size`: what `SizeofResource` answers.
 * * `access`: whether `AccessResource` gave a file (`ok`, or its answer),
 *   where in the file it left the pointer, how many of 8 bytes it read there,
 *   and the first of them, up to 4 and no further than the resource, in
 *   hexadecimal, and whether they are the bytes `LockResource` gives (`same`
 *   or `differ`).
 * * `twice`: whether two calls for one resource give two handles.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ACCRES.OUT"

static HINSTANCE self;

static void one(LPCSTR name, LPCSTR id)
{
    HRSRC found;
    HGLOBAL loaded;
    BYTE FAR *locked;
    BYTE read[8];
    char hex[20];
    int handle;
    LONG at;
    DWORD size;
    UINT got;
    UINT compared;
    UINT index;

    found = FindResource(self, id, RT_RCDATA);

    if (!found) {
        probe("size", name, "none");
        return;
    }

    wsprintf(probeResult, "%lu", SizeofResource(self, found));
    probe("size", name, probeResult);

    handle = AccessResource(self, found);

    if (handle < 0) {
        wsprintf(probeResult, "%d", handle);
        probe("access", name, probeResult);
        return;
    }

    size = SizeofResource(self, found);
    at = _llseek(handle, 0L, 1);
    got = _lread(handle, read, sizeof(read));
    _lclose(handle);

    loaded = LoadResource(self, found);
    locked = (BYTE FAR *)LockResource(loaded);
    hex[0] = '\0';

    compared = got < 4 ? got : 4;

    if ((DWORD)compared > size) {
        compared = (UINT)size;
    }

    for (index = 0; index < compared; index++) {
        wsprintf(hex + index * 2, "%02x", read[index]);
    }

    wsprintf(probeResult, "ok,at=%ld,read=%u,%s,%s", at, got, (LPSTR)hex,
             (LPSTR)(locked && _fmemcmp(locked, read, compared) == 0 ? "same" : "differ"));
    probe("access", name, probeResult);

    if (loaded) {
        FreeResource(loaded);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HRSRC found;
    int first;
    int second;

    probeOpen(OUTPUT);
    self = instance;

    one("one", MAKEINTRESOURCE(1));
    one("seventeen", MAKEINTRESOURCE(2));
    one("three-hundred", MAKEINTRESOURCE(3));
    one("named", "WORDS");
    one("missing", MAKEINTRESOURCE(9));

    found = FindResource(self, MAKEINTRESOURCE(2), RT_RCDATA);
    first = AccessResource(self, found);
    second = AccessResource(self, found);
    probe("twice", "handles", (LPSTR)(first < 0 || second < 0 ? "failed" : first == second ? "same" : "two"));
    _lclose(first);
    _lclose(second);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
