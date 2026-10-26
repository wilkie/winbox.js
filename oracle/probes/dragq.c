/*
 * SHELL's dropped-file calls on a block made as File Manager makes one for
 * WM_DROPFILES: the names' offset, the point, whether outside the client
 * area, then the names, each ended by a nought, a nought after them.
 *
 * * `count`: DragQueryFile with -1.
 * * `file`: DragQueryFile for a file and a buffer's size, the answer and
 *   what the buffer holds (`#` where nothing was written).
 * * `point`: DragQueryPoint, the answer and the point.
 * * `finish`: DragFinish, then GlobalSize of the block.
 */

#include "probe.h"
#include <shellapi.h>

#define OUTPUT "C:\\ORACLE\\DRAGQ.OUT"

static HGLOBAL make(WORD offset, int x, int y, BOOL outside, LPCSTR names, int length)
{
    HGLOBAL block = GlobalAlloc(GMEM_MOVEABLE | GMEM_SHARE | GMEM_ZEROINIT, offset + length + 2);
    BYTE FAR *bytes = (BYTE FAR *)GlobalLock(block);
    int i;

    *(WORD FAR *)bytes = offset;
    *(int FAR *)(bytes + 2) = x;
    *(int FAR *)(bytes + 4) = y;
    *(WORD FAR *)(bytes + 6) = (WORD)outside;

    for (i = 0; i < length; i++) {
        bytes[offset + i] = names[i];
    }

    GlobalUnlock(block);
    return block;
}

static void file(LPCSTR what, HDROP drop, UINT index, int size)
{
    char buffer[40];
    UINT answer;

    lstrcpy(buffer, "###################");
    answer = DragQueryFile(drop, index, size < 0 ? NULL : buffer, size < 0 ? 0 : size);
    buffer[20] = '\0';
    wsprintf(probeResult, "%u:%s", answer, (LPSTR)buffer);
    probe("file", what, probeResult);
}

static void point(LPCSTR what, HDROP drop)
{
    POINT at;
    BOOL answer;

    at.x = -7;
    at.y = -7;
    answer = DragQueryPoint(drop, &at);
    wsprintf(probeResult, "%d:%d,%d", answer, at.x, at.y);
    probe("point", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char two[] = "C:\\ONE.TXT\0C:\\DIR\\TWO.DOC\0";
    HGLOBAL drop;

    probeOpen(OUTPUT);

    drop = make(8, 12, 34, FALSE, two, sizeof(two));
    wsprintf(probeResult, "%u", DragQueryFile((HDROP)drop, (UINT)-1, NULL, 0));
    probe("count", "two", probeResult);
    file("0 in 40", (HDROP)drop, 0, 40);
    file("1 in 40", (HDROP)drop, 1, 40);
    file("1 in 5", (HDROP)drop, 1, 5);
    file("1 in 1", (HDROP)drop, 1, 1);
    file("1 in 0", (HDROP)drop, 1, 0);
    file("1 no buffer", (HDROP)drop, 1, -1);
    file("2 in 40", (HDROP)drop, 2, 40);
    file("7 in 40", (HDROP)drop, 7, 40);
    point("inside", (HDROP)drop);
    DragFinish((HDROP)drop);
    wsprintf(probeResult, "%lu", GlobalSize(drop));
    probe("finish", "size after", probeResult);

    drop = make(20, -3, 500, TRUE, two, sizeof(two));
    wsprintf(probeResult, "%u", DragQueryFile((HDROP)drop, (UINT)-1, NULL, 0));
    probe("count", "two at 20", probeResult);
    file("1 at 20", (HDROP)drop, 1, 40);
    point("outside", (HDROP)drop);
    DragFinish((HDROP)drop);

    drop = make(8, 0, 0, 5, "\0", 1);
    wsprintf(probeResult, "%u", DragQueryFile((HDROP)drop, (UINT)-1, NULL, 0));
    probe("count", "none", probeResult);
    file("0 of none", (HDROP)drop, 0, 40);
    point("flag 5", (HDROP)drop);
    DragFinish((HDROP)drop);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
