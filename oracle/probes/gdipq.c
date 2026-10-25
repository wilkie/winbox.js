/*
 * GDI's priority queue, which the spooler keeps its jobs in: `CreatePQ`,
 * `InsertPQ`, `MinPQ`, `ExtractPQ`, `SizePQ` and `DeletePQ`, by ordinal.
 * Handles are never recorded, only whether the call gave one; each record
 * carries the queue's block, its four header words and its entries as
 * they stand after the call.
 *
 * * `create`: a queue of four.
 * * `insert`: keys in order, then one smaller, one equal, and one into a
 *   full queue.
 * * `min`, `extract`: down to empty, and once more.
 * * `size`: asked, grown, and shrunk below what it holds.
 * * `delete`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIPQ.OUT"

typedef HANDLE(FAR PASCAL *CREATEPROC)(int);
typedef int(FAR PASCAL *ONEPROC)(HANDLE);
typedef int(FAR PASCAL *INSERTPROC)(HANDLE, int, int);
typedef int(FAR PASCAL *SIZEPROC)(HANDLE, int);

static CREATEPROC createPQ;
static ONEPROC minPQ, extractPQ, deletePQ;
static INSERTPROC insertPQ;
static SIZEPROC sizePQ;

static HANDLE queue;

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

/* The answer, and the block: its header's four words and the entries
 * from the first to the end its first word gives. */
static void show(LPCSTR function, LPCSTR what, int answer)
{
    int FAR *words;
    LPSTR at;
    int i, end;

    wsprintf(probeResult, "%d", answer);
    at = probeResult + lstrlen(probeResult);
    words = (int FAR *)GlobalLock(queue);

    if (words) {
        wsprintf(at, " [%d %d %d %d]", words[0], words[1], words[2], words[3]);
        at += lstrlen(at);
        end = words[0] / 2;

        for (i = 0; i < end && i < 64; i += 2) {
            wsprintf(at, " %d:%d", words[4 + i], words[5 + i]);
            at += lstrlen(at);
        }

        GlobalUnlock(queue);
    }

    probe(function, what, probeResult);
}

static void insert(int tag, int key)
{
    int answer = insertPQ(queue, tag, key);

    wsprintf(probeArgs, "tag %d key %d", tag, key);
    show("insert", probeArgs, answer == (int)queue ? 1 : answer);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show_)
{
    createPQ = (CREATEPROC)gdiProc(230);
    minPQ = (ONEPROC)gdiProc(231);
    extractPQ = (ONEPROC)gdiProc(232);
    insertPQ = (INSERTPROC)gdiProc(233);
    sizePQ = (SIZEPROC)gdiProc(234);
    deletePQ = (ONEPROC)gdiProc(235);

    probeOpen(OUTPUT);

    queue = createPQ(4);
    show("create", "4", queue ? 1 : 0);
    show("size", "asked", sizePQ(queue, 0));
    show("min", "empty", minPQ(queue));
    show("extract", "empty", extractPQ(queue));

    insert(100, 5);
    insert(101, 7);
    insert(102, 7);
    show("min", "in order", minPQ(queue));
    show("extract", "in order", extractPQ(queue));
    insert(103, 9);
    insert(104, 2);
    insert(105, 6);
    show("min", "heaped", minPQ(queue));
    show("extract", "1", extractPQ(queue));
    insert(106, 6);
    insert(107, 1);
    show("extract", "2", extractPQ(queue));
    show("extract", "3", extractPQ(queue));
    show("extract", "4", extractPQ(queue));
    show("extract", "5", extractPQ(queue));
    show("extract", "6", extractPQ(queue));
    show("extract", "7", extractPQ(queue));

    insert(108, 4);
    insert(109, 3);
    insert(110, 8);
    insert(111, 8);
    insert(112, 0);
    show("size", "grown by 2", sizePQ(queue, 2));
    insert(113, 0);
    insert(114, -5);
    show("size", "shrunk by 5", sizePQ(queue, -5));
    show("size", "shrunk by 1", sizePQ(queue, -1));
    show("size", "asked again", sizePQ(queue, 0));
    show("extract", "8", extractPQ(queue));
    show("extract", "9", extractPQ(queue));
    show("extract", "10", extractPQ(queue));

    wsprintf(probeResult, "%d", deletePQ(queue));
    probe("delete", "the queue", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show_;
    return 0;
}
