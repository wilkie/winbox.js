/*
 * The standard cursors and icons as LoadCursor and LoadIcon with no
 * instance answer them, read as the memory they are:
 *
 * * `cursor`, `icon`: for each standard id, the block's size (GlobalSize),
 *   its twelve bytes of header in hexadecimal, a sum of the bytes after the
 *   header (a word, each byte added, then rotated left one), and whether a
 *   second LoadCursor or LoadIcon answers the same handle.
 * * `flags`: GlobalFlags of the arrow and of the application icon.
 * * `metrics`: SM_CXCURSOR and SM_CYCURSOR, SM_CXICON and SM_CYICON.
 *
 * A program that edits the arrow (ArrowSmith) takes GlobalSize of
 * LoadCursor(NULL, IDC_ARROW) to be 120h before it goes on.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STDCUR.OUT"

static void block(LPCSTR kind, LPCSTR what, HANDLE handle, HANDLE again)
{
    BYTE FAR *bytes;
    DWORD size;
    DWORD i;
    WORD sum = 0;

    if (!handle) {
        probe(kind, what, "0");
        return;
    }

    size = GlobalSize(handle);
    bytes = (BYTE FAR *)GlobalLock(handle);

    if (!bytes) {
        wsprintf(probeResult, "%lu not locked %s", size, (LPSTR)(again == handle ? "same" : "other"));
        probe(kind, what, probeResult);
        return;
    }

    wsprintf(probeResult, "%lu ", size);

    for (i = 0; i < 12 && i < size; i++) {
        wsprintf(probeResult + lstrlen(probeResult), "%02x", bytes[(int)i]);
    }

    for (i = 12; i < size; i++) {
        sum = (WORD)(sum + bytes[(int)i]);
        sum = (WORD)((sum << 1) | (sum >> 15));
    }

    wsprintf(probeResult + lstrlen(probeResult), " %04x %s", sum,
             (LPSTR)(again == handle ? "same" : "other"));
    GlobalUnlock(handle);
    probe(kind, what, probeResult);
}

static void cursor(LPCSTR what, LPCSTR id)
{
    HCURSOR first = LoadCursor(NULL, id);

    block("cursor", what, first, LoadCursor(NULL, id));
}

static void icon(LPCSTR what, LPCSTR id)
{
    HICON first = LoadIcon(NULL, id);

    block("icon", what, first, LoadIcon(NULL, id));
}

static void metric(LPCSTR what, int index)
{
    wsprintf(probeResult, "%d", GetSystemMetrics(index));
    probe("metrics", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    cursor("IDC_ARROW", IDC_ARROW);
    cursor("IDC_IBEAM", IDC_IBEAM);
    cursor("IDC_WAIT", IDC_WAIT);
    cursor("IDC_CROSS", IDC_CROSS);
    cursor("IDC_UPARROW", IDC_UPARROW);
    cursor("IDC_SIZE", IDC_SIZE);
    cursor("IDC_ICON", IDC_ICON);
    cursor("IDC_SIZENWSE", IDC_SIZENWSE);
    cursor("IDC_SIZENESW", IDC_SIZENESW);
    cursor("IDC_SIZEWE", IDC_SIZEWE);
    cursor("IDC_SIZENS", IDC_SIZENS);

    icon("IDI_APPLICATION", IDI_APPLICATION);
    icon("IDI_HAND", IDI_HAND);
    icon("IDI_QUESTION", IDI_QUESTION);
    icon("IDI_EXCLAMATION", IDI_EXCLAMATION);
    icon("IDI_ASTERISK", IDI_ASTERISK);

    wsprintf(probeResult, "%04x", GlobalFlags(LoadCursor(NULL, IDC_ARROW)));
    probe("flags", "IDC_ARROW", probeResult);
    wsprintf(probeResult, "%04x", GlobalFlags(LoadIcon(NULL, IDI_APPLICATION)));
    probe("flags", "IDI_APPLICATION", probeResult);

    metric("SM_CXCURSOR", SM_CXCURSOR);
    metric("SM_CYCURSOR", SM_CYCURSOR);
    metric("SM_CXICON", SM_CXICON);
    metric("SM_CYICON", SM_CYICON);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
