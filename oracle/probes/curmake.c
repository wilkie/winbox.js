/*
 * Cursors made, copied and destroyed, called by ordinal:
 *
 * * `create`: CreateCursor and CreateCursorIconIndirect -- the block's size
 *   (GlobalSize) and its twelve bytes of header in hexadecimal, then
 *   whether its mask and picture are the bits given.
 * * `copy`: CopyCursor -- a new handle, the size, and whether its bytes
 *   are the cursor's.
 * * `current`: SetCursor with a cursor made, GetCursor, then GetCursor
 *   after DestroyCursor of the current cursor, as `made`, `arrow`, `0` or
 *   `other`.
 * * `destroy`: DestroyCursor's answers, once and twice, for a cursor made
 *   and for nought, and GlobalSize after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CURMAKE.OUT"

typedef HCURSOR(FAR PASCAL *CREATECURSORPROC)(HINSTANCE, int, int, int, int, const void FAR *,
                                               const void FAR *);
typedef HANDLE(FAR PASCAL *INDIRECTPROC)(HINSTANCE, LPVOID, const void FAR *, const void FAR *);
typedef HCURSOR(FAR PASCAL *COPYCURSORPROC)(HINSTANCE, HCURSOR);
typedef BOOL(FAR PASCAL *DESTROYCURSORPROC)(HCURSOR);

static HMODULE user;
static HINSTANCE self;
static BYTE andBits[4 * 32 * 4];
static BYTE xorBits[4 * 32 * 4];
static HCURSOR arrow;
static HCURSOR made;

static FARPROC entry(int ordinal)
{
    return GetProcAddress(user, MAKEINTRESOURCE(ordinal));
}

static LPCSTR nameOf(HCURSOR cursor)
{
    if (!cursor) {
        return "0";
    }

    if (cursor == made) {
        return "made";
    }

    if (cursor == arrow) {
        return "arrow";
    }

    return "other";
}

/* The block's size, header and whether the bits follow it as given. */
static void block(LPCSTR kind, LPCSTR what, HANDLE handle, int andSize, int xorSize)
{
    BYTE FAR *bytes;
    int i;
    BOOL same = TRUE;

    if (!handle) {
        probe(kind, what, "0");
        return;
    }

    bytes = (BYTE FAR *)GlobalLock(handle);
    wsprintf(probeResult, "%lu ", GlobalSize(handle));

    for (i = 0; i < 12; i++) {
        wsprintf(probeResult + lstrlen(probeResult), "%02x", bytes[i]);
    }

    for (i = 0; i < andSize; i++) {
        same = same && bytes[12 + i] == andBits[i];
    }

    for (i = 0; i < xorSize; i++) {
        same = same && bytes[12 + andSize + i] == xorBits[i];
    }

    lstrcat(probeResult, same ? " bits" : " other");
    GlobalUnlock(handle);
    probe(kind, what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    BYTE info[12];
    HCURSOR copy;
    HANDLE other;
    BYTE FAR *one;
    BYTE FAR *two;
    BOOL same;
    int i;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");
    self = instance;
    arrow = LoadCursor(NULL, IDC_ARROW);

    for (i = 0; i < sizeof(andBits); i++) {
        andBits[i] = (BYTE)(i * 7 + 1);
        xorBits[i] = (BYTE)(i * 13 + 5);
    }

    made = ((CREATECURSORPROC)entry(406))(instance, 3, 5, 32, 32, andBits, xorBits);
    block("create", "CreateCursor 32x32", made, 128, 128);

    other = ((CREATECURSORPROC)entry(406))(instance, 1, 1, 17, 2, andBits, xorBits);
    block("create", "CreateCursor 17x2", other, 8, 8);
    ((DESTROYCURSORPROC)entry(458))(other);

    info[0] = 1;
    info[1] = 0;
    info[2] = 2;
    info[3] = 0;
    info[4] = 16;
    info[5] = 0;
    info[6] = 16;
    info[7] = 0;
    info[8] = 2;
    info[9] = 0;
    info[10] = 1;
    info[11] = 1;
    other = ((INDIRECTPROC)entry(408))(instance, info, andBits, xorBits);
    block("create", "CreateCursorIconIndirect 16x16 1x1", other, 32, 32);
    ((DESTROYCURSORPROC)entry(458))(other);

    info[10] = 4;
    other = ((INDIRECTPROC)entry(408))(instance, info, andBits, xorBits);
    block("create", "CreateCursorIconIndirect 16x16 4x1", other, 32, 128);
    ((DESTROYCURSORPROC)entry(458))(other);

    info[10] = 1;
    info[11] = 8;
    info[4] = 10;
    other = ((INDIRECTPROC)entry(408))(instance, info, andBits, xorBits);
    block("create", "CreateCursorIconIndirect 10x16 1x8", other, 32, 160);
    ((DESTROYCURSORPROC)entry(458))(other);

    copy = ((COPYCURSORPROC)entry(369))(instance, made);
    one = (BYTE FAR *)GlobalLock(made);
    two = (BYTE FAR *)GlobalLock(copy);
    same = copy != made;

    for (i = 0; i < 12 + 128 + 128; i++) {
        same = same && one[i] == two[i];
    }

    GlobalUnlock(copy);
    GlobalUnlock(made);
    wsprintf(probeResult, "%s %lu", (LPSTR)(same ? "same" : "other"), GlobalSize(copy));
    probe("copy", "CopyCursor", probeResult);

    probe("current", "SetCursor made, before", nameOf(SetCursor(made)));
    probe("current", "GetCursor", nameOf(GetCursor()));
    wsprintf(probeResult, "%d", ((DESTROYCURSORPROC)entry(458))(made));
    probe("destroy", "made, current", probeResult);
    probe("current", "GetCursor after", nameOf(GetCursor()));
    wsprintf(probeResult, "%lu", GlobalSize(made));
    probe("destroy", "made, size after", probeResult);

    wsprintf(probeResult, "%d", ((DESTROYCURSORPROC)entry(458))(copy));
    probe("destroy", "copy", probeResult);
    wsprintf(probeResult, "%d", ((DESTROYCURSORPROC)entry(458))(copy));
    probe("destroy", "copy again", probeResult);
    wsprintf(probeResult, "%d", ((DESTROYCURSORPROC)entry(458))(NULL));
    probe("destroy", "0", probeResult);
    SetCursor(arrow);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
