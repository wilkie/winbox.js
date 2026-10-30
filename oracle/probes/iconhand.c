/*
 * USER's resource handlers for icons and cursors, which `SignalProc` sets
 * for a module as KERNEL loads it, and what they make of the resource.
 * The probe's resources (`iconhand.rc`): icon groups 10 to 14, each of one
 * icon -- 32, 16, 48 and 64 square in sixteen colours, and 32 square in
 * black and white -- and cursor groups 20 to 22, each of one cursor -- 32
 * square in black and white, hotspot 5, 9; 32 square in sixteen colours,
 * hotspot 20, 3; 16 square in black and white, hotspot 7, 7; and icon
 * groups 15 and 16, 32 and 16 square again, for `chain`. Their pictures
 * are patterns of WinBox's own: a colour pixel `(3x + 5y + (xy >> 3)) & 15`,
 * a black and white one set where `((x >> 1) + y) % 3` is nought, the mask
 * set where `(x + 2y) % 7` is nought or `x < 2`.
 *
 * * `handler`: what `SetResourceHandler` answers for the probe's module for
 *   `RT_ICON`, `RT_CURSOR`, `RT_GROUP_ICON` and `RT_GROUP_CURSOR`, as the
 *   USER ordinal whose address it is (336, 356, 357, 456), `kernel` for
 *   KERNEL's code's selector, `none`, or `other`; put back after each.
 * * `signal`: `SignalProc` (USER 314) called with the probe's instance and
 *   40h, a module loaded, after the probe's handler was set for `RT_ICON`:
 *   its answer, and the handler then.
 * * `load`, `lock`, `bytes`: each `RT_ICON` resource of groups 10 to 14
 *   (numbers 1 to 8) and each `RT_CURSOR` resource by its number:
 *   `LoadResource`'s block's `GlobalSize` and `GlobalFlags`; locked, its
 *   first twelve bytes as words and its `GlobalSize` again; then the block,
 *   32 bytes a record in hexadecimal, as far as its header says it holds:
 *   twelve bytes, the mask's rows and the picture's, each a whole number of
 *   words -- what lies after that is the memory the block was given, which
 *   for a block made larger is whatever was there before.
 * * `loadicon`, `loadcursor`: each group by `LoadIcon` or `LoadCursor`:
 *   whether asking again gives the same handle; whether it is the block
 *   `LoadResource` gives for the group's member; its `GlobalSize`; and
 *   `DestroyIcon`'s or `DestroyCursor`'s answer for it.
 * * `chain`: the probe's own handler for `RT_ICON`, which counts its calls
 *   and calls the one it replaced: its calls after `LoadIcon` of group 15
 *   (a second 32 square icon of sixteen colours), after `DrawIcon` of it,
 *   and after `LoadResource` and `LockResource` of the member of group 16
 *   (a second 16 square one): icons loaded by nothing before, as a block
 *   freed with `FreeResource` stays, and `LoadResource` gives it again with
 *   no handler called.
 * * `screen`: groups 14 (black and white), 10 and 11 drawn with `DrawIcon`
 *   on a grey patch of the screen, a row each, and read back a pixel at a
 *   time as the index of the sixteen colours each is, `?` for none.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ICONHAND.OUT"

typedef FARPROC(FAR PASCAL *SETHANDLER)(HINSTANCE, LPCSTR, FARPROC);
typedef HGLOBAL(FAR PASCAL *HANDLER)(HGLOBAL, HINSTANCE, HRSRC);
typedef DWORD(FAR PASCAL *SIGNALPROC)(HANDLE, WORD, WORD, DWORD);
typedef UINT(FAR PASCAL *IDPROC)(HANDLE, LPCSTR);

static HMODULE user;
static WORD kernelCode;
static SETHANDLER setResourceHandler;
static HANDLER before;
static int calls;

static LPCSTR which(FARPROC proc)
{
    static char text[16];
    static const int ordinals[] = { 336, 356, 357, 456 };
    int at;

    for (at = 0; at < 4; at++) {
        if (proc == GetProcAddress(user, MAKEINTRESOURCE(ordinals[at]))) {
            wsprintf(text, "%d", ordinals[at]);
            return text;
        }
    }

    if (!proc) {
        return "none";
    }

    return HIWORD(proc) == kernelCode ? "kernel" : "other";
}

HGLOBAL FAR PASCAL __export Dummy(HGLOBAL block, HINSTANCE instance, HRSRC resource)
{
    (void)instance;
    (void)resource;
    return block;
}

HGLOBAL FAR PASCAL __export Counter(HGLOBAL block, HINSTANCE instance, HRSRC resource)
{
    calls++;
    return before(block, instance, resource);
}

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static char digit(COLORREF colour)
{
    int index;

    for (index = 0; index < 16; index++) {
        if (PALETTE[index] == (colour & 0xffffffL)) {
            return HEX[index];
        }
    }

    return '?';
}

/* Each group drawn on grey, and read back a row at a time. */
static void drawn(HINSTANCE instance)
{
    static const UINT GROUPS[] = { 14, 10, 11 };
    HDC screen = GetDC(NULL);
    int at;
    int x;
    int y;

    SelectObject(screen, GetStockObject(GRAY_BRUSH));
    PatBlt(screen, 0, 0, 40 * 3, 40, PATCOPY);

    for (at = 0; at < 3; at++) {
        DrawIcon(screen, 4 + at * 40, 4, LoadIcon(instance, MAKEINTRESOURCE(GROUPS[at])));
    }

    for (y = 0; y < 40; y++) {
        for (x = 0; x < 40 * 3; x++) {
            probeResult[x] = digit(GetPixel(screen, x, y));
        }

        probeResult[x] = '\0';
        wsprintf(probeArgs, "y=%d", y);
        probe("screen", probeArgs, probeResult);
    }

    ReleaseDC(NULL, screen);
}

static void handler(HINSTANCE instance, LPCSTR type, LPCSTR what)
{
    FARPROC old = setResourceHandler(instance, type, (FARPROC)Dummy);

    probe("handler", what, which(old));
    setResourceHandler(instance, type, old);
}

static void resource(HINSTANCE instance, LPCSTR type, LPCSTR kind, UINT last)
{
    UINT id;

    for (id = 1; id <= last; id++) {
        HRSRC found = FindResource(instance, MAKEINTRESOURCE(id), type);
        HGLOBAL loaded;
        BYTE FAR *bytes;
        WORD FAR *words;
        DWORD size;
        DWORD held;
        DWORD at;

        if (!found) {
            continue;
        }

        wsprintf(probeArgs, "%s %u", kind, id);
        loaded = LoadResource(instance, found);
        wsprintf(probeResult, "size=%lu flags=%04x", GlobalSize(loaded), GlobalFlags(loaded));
        probe("load", probeArgs, probeResult);

        bytes = (BYTE FAR *)LockResource(loaded);

        if (!bytes) {
            probe("lock", probeArgs, "none");
            FreeResource(loaded);
            continue;
        }

        words = (WORD FAR *)bytes;
        size = GlobalSize(loaded);
        wsprintf(probeResult, "%04x %04x %04x %04x %04x %04x size=%lu", words[0], words[1],
                 words[2], words[3], words[4], words[5], size);
        probe("lock", probeArgs, probeResult);

        held = 12 + (DWORD)words[3] * words[4] +
               (DWORD)((((words[2] * HIBYTE(words[5])) + 15) >> 4) << 1) * LOBYTE(words[5]) *
                   words[3];

        if (held > size) {
            held = size;
        }

        for (at = 0; at < held; at += 32) {
            LPSTR out = probeResult;
            DWORD each;

            for (each = at; each < at + 32 && each < held; each++) {
                wsprintf(out, "%02x", bytes[(UINT)each]);
                out += 2;
            }

            wsprintf(probeArgs, "%s %u +%lu", kind, id, at);
            probe("bytes", probeArgs, probeResult);
        }

        UnlockResource(loaded);
        FreeResource(loaded);
    }
}

/* The member of a group: the block `LoadResource` gives for it. */
static HGLOBAL member(HINSTANCE instance, UINT group, LPCSTR groupType, LPCSTR type)
{
    HRSRC found = FindResource(instance, MAKEINTRESOURCE(group), groupType);
    HGLOBAL loaded;
    UINT id;

    if (!found) {
        return NULL;
    }

    loaded = LoadResource(instance, found);
    id = ((IDPROC)GetProcAddress(user, MAKEINTRESOURCE(455)))(loaded, type);
    FreeResource(loaded);

    found = FindResource(instance, MAKEINTRESOURCE(id), type);

    return found ? LoadResource(instance, found) : NULL;
}

static void icons(HINSTANCE instance, BOOL cursors)
{
    UINT group;

    for (group = cursors ? 20 : 10; group <= (UINT)(cursors ? 22 : 14); group++) {
        HANDLE first = cursors ? LoadCursor(instance, MAKEINTRESOURCE(group))
                               : LoadIcon(instance, MAKEINTRESOURCE(group));
        HANDLE again = cursors ? LoadCursor(instance, MAKEINTRESOURCE(group))
                               : LoadIcon(instance, MAKEINTRESOURCE(group));
        HGLOBAL resource =
            member(instance, group, cursors ? RT_GROUP_CURSOR : RT_GROUP_ICON,
                   cursors ? RT_CURSOR : RT_ICON);
        BOOL destroyed;

        if (resource) {
            FreeResource(resource);
        }

        wsprintf(probeArgs, "%u", group);
        wsprintf(probeResult, "%s again=%s resource=%s size=%lu", first ? "1" : "0",
                 again == first ? "same" : "other", resource == first ? "same" : "other",
                 first ? GlobalSize(first) : 0L);
        destroyed = cursors ? DestroyCursor(first) : DestroyIcon(first);
        wsprintf(probeResult + lstrlen(probeResult), " destroy=%d", destroyed);
        probe(cursors ? "loadcursor" : "loadicon", probeArgs, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    SIGNALPROC signalProc;
    FARPROC old;
    HICON icon;
    HGLOBAL loaded;
    HDC screen;
    DWORD answer;

    probeOpen(OUTPUT);

    user = GetModuleHandle("USER");
    setResourceHandler =
        (SETHANDLER)GetProcAddress(GetModuleHandle("KERNEL"), "SetResourceHandler");
    kernelCode = HIWORD(GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(1)));
    signalProc = (SIGNALPROC)GetProcAddress(user, MAKEINTRESOURCE(314));

    handler(instance, RT_ICON, "icon");
    handler(instance, RT_CURSOR, "cursor");
    handler(instance, RT_GROUP_ICON, "group icon");
    handler(instance, RT_GROUP_CURSOR, "group cursor");

    old = setResourceHandler(instance, RT_ICON, (FARPROC)Dummy);
    answer = signalProc(instance, 0x40, 0, 0L);
    wsprintf(probeResult, "answer=%u handler=%s", LOWORD(answer),
             which(setResourceHandler(instance, RT_ICON, old)));
    probe("signal", "40h", probeResult);

    resource(instance, RT_ICON, "icon", 8);
    resource(instance, RT_CURSOR, "cursor", 29);

    icons(instance, FALSE);
    icons(instance, TRUE);

    before = (HANDLER)setResourceHandler(instance, RT_ICON, (FARPROC)Counter);
    icon = LoadIcon(instance, MAKEINTRESOURCE(15));
    wsprintf(probeResult, "%d", calls);
    probe("chain", "LoadIcon", probeResult);

    screen = GetDC(NULL);
    DrawIcon(screen, 0, 0, icon);
    ReleaseDC(NULL, screen);
    wsprintf(probeResult, "%d", calls);
    probe("chain", "DrawIcon", probeResult);

    loaded = member(instance, 16, RT_GROUP_ICON, RT_ICON);
    wsprintf(probeResult, "%d", calls);
    probe("chain", "LoadResource", probeResult);
    LockResource(loaded);
    wsprintf(probeResult, "%d", calls);
    probe("chain", "LockResource", probeResult);
    UnlockResource(loaded);
    FreeResource(loaded);
    DestroyIcon(icon);
    setResourceHandler(instance, RT_ICON, (FARPROC)before);

    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);
    drawn(instance);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
