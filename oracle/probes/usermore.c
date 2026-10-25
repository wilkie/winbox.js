/*
 * More of USER's smaller exports, called by ordinal:
 *
 * * `lookup`: LookupMenuHandle on a menu bar with pop-ups, one inside
 *   another, as `bar`, `file`, `inner`, `0` or `other`: a command in the
 *   bar, in a pop-up, in the inner pop-up, one in two places, none.
 * * `iconheader`: GetInternalIconHeader of a cursor made, the twelve bytes
 *   in hexadecimal.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\USERMORE.OUT"

typedef HMENU(FAR PASCAL *LOOKUPPROC)(HMENU, UINT);
typedef void(FAR PASCAL *HEADERPROC)(LPVOID, LPVOID);

static HMODULE user;
static HMENU bar, file, inner;

static FARPROC entry(int ordinal)
{
    return GetProcAddress(user, MAKEINTRESOURCE(ordinal));
}

static LPCSTR nameOf(HMENU menu)
{
    if (!menu) {
        return "0";
    }

    if (menu == bar) {
        return "bar";
    }

    if (menu == file) {
        return "file";
    }

    if (menu == inner) {
        return "inner";
    }

    return "other";
}

static void lookup(LPCSTR what, HMENU menu, UINT command)
{
    probe("lookup", what, nameOf(((LOOKUPPROC)entry(217))(menu, command)));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static BYTE andBits[128];
    static BYTE xorBits[128];
    BYTE header[16];
    HCURSOR cursor;
    LPVOID locked;
    int i;

    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");

    bar = CreateMenu();
    file = CreatePopupMenu();
    inner = CreatePopupMenu();
    AppendMenu(inner, MF_STRING, 301, "Inner");
    AppendMenu(inner, MF_STRING, 500, "Twice inner");
    AppendMenu(file, MF_STRING, 201, "Open");
    AppendMenu(file, MF_POPUP, (UINT)inner, "More");
    AppendMenu(file, MF_STRING, 500, "Twice file");
    AppendMenu(bar, MF_POPUP, (UINT)file, "File");
    AppendMenu(bar, MF_STRING, 101, "Help");

    lookup("bar command", bar, 101);
    lookup("file command", bar, 201);
    lookup("inner command", bar, 301);
    lookup("twice", bar, 500);
    lookup("none", bar, 999);
    lookup("file asked for inner", file, 301);
    lookup("minus one", bar, 0xffff);

    for (i = 0; i < sizeof(andBits); i++) {
        andBits[i] = (BYTE)i;
        xorBits[i] = (BYTE)~i;
    }

    cursor = CreateCursor(instance, 7, 9, 32, 32, andBits, xorBits);
    locked = GlobalLock(cursor);

    for (i = 0; i < 16; i++) {
        header[i] = 0xaa;
    }

    ((HEADERPROC)entry(372))(locked, header);
    probeResult[0] = '\0';

    for (i = 0; i < 16; i++) {
        wsprintf(probeResult + i * 2, "%02x", header[i]);
    }

    probe("iconheader", "cursor 32x32 at 7,9", probeResult);
    GlobalUnlock(cursor);
    DestroyCursor(cursor);
    DestroyMenu(bar);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
