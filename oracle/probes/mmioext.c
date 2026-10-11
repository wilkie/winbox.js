/*
 * MMSYSTEM's buffered file I/O beyond what `mmio.c` asks: a rename and what
 * KERNEL tells `FileCdr`'s procedure of it; files and buffers larger than
 * 64 KiB, through huge pointers; and the files and I/O procedures a task
 * leaves when it ends.
 *
 * * `told`: what the probe's `FileCdr` procedure was told since the last
 *   record -- the function in AH, the path, and for a rename the new name
 *   after a `>` -- or `none`.
 * * `rename`, `open`, `read`, `write`, `seek`, `close`, `advance`,
 *   `getinfo`: the answer, in hex.
 * * `info`: the structure after a call: cchBuffer, how far pchNext,
 *   pchEndRead and pchEndWrite are from pchBuffer (as huge pointers),
 *   lBufOffset and lDiskOffset.
 * * `same`: how many of a range of bytes are not what the file was written
 *   with; `bytes`: a few bytes, in hex.
 * * `size`: a file's size on the disk.
 * * `child`: what the probe sees of the files MMIOEXTC.EXE leaves open
 *   (`mmioext.child.c`), while it runs and after it has ended.
 * * `found`: what mmioInstallIOProc finds for a code, `0` or `proc`.
 *
 * Every byte written is `v(i)`, a function of its place in the source
 * block, so a byte taken from the wrong 64 KiB is seen; `same` compares
 * with the source block, which holds them.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMIOEXT.OUT"
#define BIG "C:\\ORACLE\\BIG.DAT"
#define BIG2 "C:\\ORACLE\\BIG2.DAT"
#define SIZE 100000L

typedef LONG(FAR PASCAL *CDRPROC)(FARPROC);

static char told[600];
static BYTE __huge *source;
static BYTE __huge *target;
static HWND window;
static int childSeen;

static BYTE v(long i)
{
    return (BYTE)(i + (i >> 8) * 3 + (i >> 16) * 0x51);
}

/* The source block filled with v(i), a 64 KiB tile at a time through a far
 * pointer, which is quicker than through a huge one. */
static void fill(void)
{
    WORD tile;
    WORD j;

    for (tile = 0; tile < 2; tile++) {
        BYTE FAR *at = (BYTE FAR *)(source + (long)tile * 0x10000L);
        BYTE high = (BYTE)(tile * 0x51);

        j = 0;

        do {
            at[j] = (BYTE)(j + (j >> 8) * 3 + high);
            j++;
        } while (j != 0);
    }
}

BOOL FAR PASCAL _export Notify(WORD function, LPSTR path)
{
    char one[200];

    if ((function >> 8) == 0x56) {
        wsprintf(one, "%s%x:%s>%s", (LPSTR)(told[0] ? "," : ""), function >> 8, path,
                 path + lstrlen(path) + 1);
    } else {
        wsprintf(one, "%s%x:%s", (LPSTR)(told[0] ? "," : ""), function >> 8, path);
    }

    if (lstrlen(told) + lstrlen(one) < sizeof(told) - 1) {
        lstrcat(told, one);
    }

    return TRUE;
}

static void step(LPCSTR name)
{
    probe("told", name, told[0] ? told : "none");
    told[0] = '\0';
}

static void answer(LPCSTR function, LPCSTR name, DWORD value)
{
    wsprintf(probeResult, "%lx", value);
    probe(function, name, probeResult);
}

static void hex(LPSTR out, const BYTE FAR *bytes, int count)
{
    int i;

    for (i = 0; i < count; i++) {
        wsprintf(out + i * 2, "%02x", bytes[i]);
    }

    out[count * 2] = '\0';
}

static void info(LPCSTR name, HMMIO h)
{
    MMIOINFO i;
    UINT got;

    _fmemset(&i, 0, sizeof(i));
    got = mmioGetInfo(h, &i, 0);

    if (got) {
        answer("info", name, got);
        return;
    }

    wsprintf(probeResult, "cch=%lx next=%lx endread=%lx endwrite=%lx bufoff=%lx disk=%lx",
             i.cchBuffer, (long)(i.pchNext - i.pchBuffer), (long)(i.pchEndRead - i.pchBuffer),
             (long)(i.pchEndWrite - i.pchBuffer), i.lBufOffset, i.lDiskOffset);
    probe("info", name, probeResult);
}

/* How many of `count` bytes at `at` are not v(from), v(from + 1), ... */
static void same(LPCSTR name, BYTE __huge *at, long from, long count)
{
    long wrong = 0;
    long i = 0;

    /* In runs that cross no 64 KiB boundary of either block, through far
     * pointers; the source holds v(i) at i. */
    while (i < count) {
        WORD a = OFFSETOF(at + i);
        WORD b = OFFSETOF(source + from + i);
        long run = count - i;
        BYTE FAR *x = (BYTE FAR *)(at + i);
        BYTE FAR *y = (BYTE FAR *)(source + from + i);
        WORD k;

        if (run > 0x10000L - a) {
            run = 0x10000L - a;
        }

        if (run > 0x10000L - b) {
            run = 0x10000L - b;
        }

        for (k = 0; k < (WORD)(run - 1); k++) {
            if (x[k] != y[k]) {
                wrong++;
            }
        }

        if (x[k] != y[k]) {
            wrong++;
        }

        i += run;
    }

    wsprintf(probeResult, "%lx", wrong);
    probe("same", name, probeResult);
}

/* A file on the disk: its size, and how many of its bytes are not
 * v(from), v(from + 1), ... */
static void onDisk(LPCSTR name, LPCSTR path, long from)
{
    HFILE file = _lopen(path, OF_READ);
    long size;

    if (file == HFILE_ERROR) {
        probe("size", name, "none");
        return;
    }

    size = _llseek(file, 0L, 2);
    _llseek(file, 0L, 0);
    answer("size", name, size);
    _fmemset((LPSTR)target, 0, 16);
    _hread(file, (void __huge *)target, size);
    _lclose(file);
    same(name, target, from, size);
}

static void readSome(LPCSTR name, HMMIO h, int count)
{
    BYTE data[16];
    long got;

    _fmemset(data, 0xee, sizeof(data));
    got = mmioRead(h, (HPSTR)data, count);
    wsprintf(probeResult, "%lx ", got);
    hex(probeResult + lstrlen(probeResult), data, count);
    probe("read", name, probeResult);
}

static void renames(HINSTANCE instance)
{
    CDRPROC cdr = (CDRPROC)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(130));
    FARPROC mine = MakeProcInstance((FARPROC)Notify, instance);
    HFILE file;
    HMMIO h;
    MMIOINFO i;

    file = _lcreat("C:\\ORACLE\\R1.DAT", 0);
    _lwrite(file, "rename", 6);
    _lclose(file);

    cdr(mine);
    told[0] = '\0';

    probeNote("mmioRename, and what FileCdr's procedure is told");
    answer("rename", "R1>R2", mmioRename("C:\\ORACLE\\R1.DAT", "C:\\ORACLE\\R2.DAT", NULL, 0));
    step("R1>R2");
    answer("rename", "relative", mmioRename("ORACLE\\R2.DAT", "ORACLE\\R3.DAT", NULL, 0));
    step("relative");
    answer("rename", "missing", mmioRename("C:\\ORACLE\\NONE.DAT", "C:\\ORACLE\\R4.DAT", NULL, 0));
    step("missing");
    answer("rename", "onto", mmioRename("C:\\ORACLE\\R3.DAT", "C:\\ORACLE\\R3.DAT", NULL, 0));
    step("onto");
    _fmemset(&i, 0, sizeof(i));
    i.fccIOProc = FOURCC_DOS;
    answer("rename", "dos", mmioRename("C:\\ORACLE\\R3.DAT", "C:\\ORACLE\\R5.DAT", &i, 0));
    step("dos");

    probeNote("mmioOpen creating and deleting, as FileCdr's procedure is told");
    h = mmioOpen("C:\\ORACLE\\MADE.DAT", NULL, MMIO_CREATE | MMIO_WRITE);
    step("create");
    mmioClose(h, 0);
    step("close");
    mmioOpen("C:\\ORACLE\\MADE.DAT", NULL, MMIO_DELETE);
    step("delete");
    mmioOpen("C:\\ORACLE\\R5.DAT", NULL, MMIO_DELETE);
    step("delete-r5");

    cdr(NULL);
}

static void large(void)
{
    MMIOINFO i;
    HMMIO h;
    HGLOBAL block;
    BYTE __huge *own;
    long k;
    long got;
    BYTE four[4];

    fill();

    probeNote("unbuffered: 100000 bytes written from offset 3 of a 128 KiB block");
    h = mmioOpen(BIG, NULL, MMIO_CREATE | MMIO_WRITE);
    answer("write", "unbuffered", mmioWrite(h, (HPSTR)(source + 3), SIZE));
    info("unbuffered", h);
    answer("seek", "unbuffered-end", mmioSeek(h, 0L, SEEK_END));
    answer("close", "unbuffered", mmioClose(h, 0));
    onDisk("unbuffered", BIG, 3);

    probeNote("read back through MMSYSTEM's own buffer of 8 KiB, to offset 5");
    h = mmioOpen(BIG, NULL, MMIO_READ | MMIO_ALLOCBUF);
    _fmemset((LPSTR)target, 0, 16);
    got = mmioRead(h, (HPSTR)(target + 5), SIZE - 10);
    answer("read", "allocbuf", got);
    same("allocbuf", target + 5, 3, SIZE - 10);
    info("allocbuf", h);
    answer("seek", "allocbuf-65530", mmioSeek(h, 65530L, SEEK_SET));
    readSome("allocbuf-65530", h, 12);
    info("allocbuf-65530", h);
    answer("seek", "allocbuf-end", mmioSeek(h, -10L, SEEK_END));
    readSome("allocbuf-end", h, 12);
    answer("close", "allocbuf", mmioClose(h, 0));

    probeNote("a buffer of MMSYSTEM's of 70000 bytes");
    _fmemset(&i, 0, sizeof(i));
    i.cchBuffer = 70000L;
    h = mmioOpen(BIG, &i, MMIO_READ | MMIO_ALLOCBUF);
    wsprintf(probeResult, "%s,%x", (LPSTR)(h ? "h" : "0"), i.wErrorRet);
    probe("open", "big-allocbuf", probeResult);

    if (h) {
        info("big-allocbuf", h);
        readSome("big-allocbuf", h, 12);
        info("big-allocbuf-read", h);
        answer("seek", "big-allocbuf-66000", mmioSeek(h, 66000L, SEEK_SET));
        readSome("big-allocbuf-66000", h, 12);
        info("big-allocbuf-66000", h);
        answer("seek", "big-allocbuf-80000", mmioSeek(h, 80000L, SEEK_SET));
        readSome("big-allocbuf-80000", h, 12);
        info("big-allocbuf-80000", h);
        answer("close", "big-allocbuf", mmioClose(h, 0));
    }

    probeNote("written through a buffer of 70000 bytes, in pieces of 33333");
    _fmemset(&i, 0, sizeof(i));
    i.cchBuffer = 70000L;
    h = mmioOpen(BIG2, &i, MMIO_CREATE | MMIO_WRITE | MMIO_ALLOCBUF);
    answer("write", "big-buffer-1", mmioWrite(h, (HPSTR)(source + 7), 33333L));
    info("big-buffer-1", h);
    answer("write", "big-buffer-2", mmioWrite(h, (HPSTR)(source + 7 + 33333L), 33333L));
    info("big-buffer-2", h);
    answer("write", "big-buffer-3", mmioWrite(h, (HPSTR)(source + 7 + 66666L), 33334L));
    info("big-buffer-3", h);
    answer("close", "big-buffer", mmioClose(h, 0));
    onDisk("big-buffer", BIG2, 7);

    probeNote("the program's own buffer of 80000 bytes, used through mmioAdvance");
    block = GlobalAlloc(GMEM_MOVEABLE, 80000L);
    own = (BYTE __huge *)GlobalLock(block);
    _fmemset(&i, 0, sizeof(i));
    i.pchBuffer = (HPSTR)own;
    i.cchBuffer = 80000L;
    h = mmioOpen(BIG, &i, MMIO_READ);
    wsprintf(probeResult, "%s,%x", (LPSTR)(h ? "h" : "0"), i.wErrorRet);
    probe("open", "own-buffer", probeResult);

    if (h) {
        info("own-buffer", h);
        mmioGetInfo(h, &i, 0);
        answer("advance", "own-1", mmioAdvance(h, &i, MMIO_READ));
        wsprintf(probeResult, "endread=%lx bufoff=%lx byte=%02x,%02x", (long)(i.pchEndRead - i.pchBuffer),
                 i.lBufOffset, (BYTE)i.pchBuffer[70000L], (BYTE)i.pchBuffer[65536L]);
        probe("advanced", "own-1", probeResult);
        i.pchNext = i.pchEndRead;
        answer("advance", "own-2", mmioAdvance(h, &i, MMIO_READ));
        wsprintf(probeResult, "endread=%lx bufoff=%lx byte=%02x", (long)(i.pchEndRead - i.pchBuffer),
                 i.lBufOffset, (BYTE)i.pchBuffer[1]);
        probe("advanced", "own-2", probeResult);
        mmioSetInfo(h, &i, 0);
        answer("close", "own-buffer", mmioClose(h, 0));
    }

    GlobalUnlock(block);
    GlobalFree(block);

    probeNote("a memory file of 100000 bytes, the 128 KiB block");
    _fmemset(&i, 0, sizeof(i));
    i.fccIOProc = FOURCC_MEM;
    i.pchBuffer = (HPSTR)source;
    i.cchBuffer = SIZE;
    h = mmioOpen(NULL, &i, MMIO_READWRITE);
    wsprintf(probeResult, "%s,%x", (LPSTR)(h ? "h" : "0"), i.wErrorRet);
    probe("open", "memory", probeResult);

    if (h) {
        info("memory", h);
        answer("seek", "memory-65530", mmioSeek(h, 65530L, SEEK_SET));
        readSome("memory-65530", h, 12);
        answer("seek", "memory-end", mmioSeek(h, 0L, SEEK_END));
        answer("seek", "memory-65534", mmioSeek(h, 65534L, SEEK_SET));
        answer("write", "memory-65534", mmioWrite(h, "WXYZ", 4L));
        four[0] = source[65534L];
        four[1] = source[65535L];
        four[2] = source[65536L];
        four[3] = source[65537L];
        hex(probeResult, four, 4);
        probe("bytes", "memory-65534", probeResult);
        info("memory-written", h);
        answer("close", "memory", mmioClose(h, 0));
    }

    for (k = 65534L; k < 65538L; k++) {
        source[k] = v(k);
    }

    probeNote("a memory file of 60000 bytes grown by 20000 at a time");
    block = GlobalAlloc(GMEM_MOVEABLE, 60000L);
    own = (BYTE __huge *)GlobalLock(block);
    _fmemset(&i, 0, sizeof(i));
    i.fccIOProc = FOURCC_MEM;
    i.pchBuffer = (HPSTR)own;
    i.cchBuffer = 60000L;
    i.adwInfo[0] = 20000L;
    h = mmioOpen(NULL, &i, MMIO_CREATE | MMIO_READWRITE);
    wsprintf(probeResult, "%s,%x", (LPSTR)(h ? "h" : "0"), i.wErrorRet);
    probe("open", "grown", probeResult);

    if (h) {
        answer("write", "grown-1", mmioWrite(h, (HPSTR)source, 50000L));
        info("grown-1", h);
        answer("write", "grown-2", mmioWrite(h, (HPSTR)(source + 50000L), 50000L));
        info("grown-2", h);
        answer("seek", "grown-65530", mmioSeek(h, 65530L, SEEK_SET));
        readSome("grown-65530", h, 12);
        answer("seek", "grown-end", mmioSeek(h, 0L, SEEK_END));
        mmioGetInfo(h, &i, 0);
        same("grown", (BYTE __huge *)i.pchBuffer, 0, SIZE);
        wsprintf(probeResult, "%lx", GlobalSize(block));
        probe("size", "grown-block", probeResult);
        answer("close", "grown", mmioClose(h, 0));
    }

    GlobalUnlock(block);
    GlobalFree(block);
}

static HMMIO childFirst;
static HMMIO childSecond;

static void childInfo(LPCSTR when)
{
    MMIOINFO i;
    UINT first, second;

    first = mmioGetInfo(childFirst, &i, 0);
    second = mmioGetInfo(childSecond, &i, 0);
    wsprintf(probeResult, "%x,%x", first, second);
    probe("child", when, probeResult);
}

static void childLog(LPCSTR when)
{
    char text[200];
    HFILE file = _lopen("C:\\ORACLE\\CHILDLOG.TXT", OF_READ);
    int count;
    int k;

    if (file == HFILE_ERROR) {
        probe("childlog", when, "none");
        return;
    }

    count = _lread(file, text, sizeof(text) - 1);
    _lclose(file);
    text[count < 0 ? 0 : count] = '\0';

    for (k = 0; text[k]; k++) {
        if (text[k] == '\r') {
            text[k] = ' ';
        } else if (text[k] == '\n') {
            text[k] = '|';
        }
    }

    probe("childlog", when, text);
}

static void found(LPCSTR name, FOURCC code)
{
    LPMMIOPROC proc = mmioInstallIOProc(code, NULL, MMIO_FINDPROC);

    probe("found", name, proc ? "proc" : "0");
}

LRESULT FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        childFirst = (HMMIO)wParam;
        childSecond = (HMMIO)LOWORD(lParam);
        childSeen = 1;
        childInfo("running");
        childLog("running");
        found("CHD-running", mmioFOURCC('C', 'H', 'D', ' '));
        found("GLB-running", mmioFOURCC('G', 'L', 'B', ' '));
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void tasks(void)
{
    MSG msg;
    long turns;
    HMMIO h;
    MMIOINFO i;

    probeNote("a program that ends with files of MMSYSTEM's open");
    OpenFile("C:\\ORACLE\\CHILDLOG.TXT", (OFSTRUCT *)probeResult, OF_DELETE);
    OpenFile("C:\\ORACLE\\CHILD1.DAT", (OFSTRUCT *)probeResult, OF_DELETE);
    WinExec("MMIOEXTC.EXE", SW_SHOWNORMAL);

    for (turns = 0; turns < 20000L && (!childSeen || GetModuleHandle("MMIOEXTC")); turns++) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        }

        Yield();
    }

    wsprintf(probeResult, "%s,%s", (LPSTR)(childSeen ? "seen" : "unseen"),
             (LPSTR)(GetModuleHandle("MMIOEXTC") ? "running" : "ended"));
    probe("child", "waited", probeResult);
    childInfo("ended");
    childLog("ended");
    onDisk("child1", "C:\\ORACLE\\CHILD1.DAT", 0);
    found("CHD-ended", mmioFOURCC('C', 'H', 'D', ' '));
    found("GLB-ended", mmioFOURCC('G', 'L', 'B', ' '));

    _fmemset(&i, 0, sizeof(i));
    h = mmioOpen("X.CHD+Y", &i, MMIO_READ);
    wsprintf(probeResult, "%s,%x", (LPSTR)(h ? "h" : "0"), i.wErrorRet);
    probe("open", "CHD-ended", probeResult);

    if (h) {
        mmioClose(h, 0);
    }

    probe("found", "GLB-removed",
          mmioInstallIOProc(mmioFOURCC('G', 'L', 'B', ' '), NULL, MMIO_REMOVEPROC) ? "proc" : "0");
    found("GLB-after", mmioFOURCC('G', 'L', 'B', ' '));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    HGLOBAL sourceBlock, targetBlock;

    probeOpen(OUTPUT);

    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = instance;
    wc.lpszClassName = "MmioExt";
    RegisterClass(&wc);
    window = CreateWindow("MmioExt", "MmioExt", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL,
                          instance, NULL);

    sourceBlock = GlobalAlloc(GMEM_MOVEABLE, 0x20000L);
    targetBlock = GlobalAlloc(GMEM_MOVEABLE, 0x20000L);
    source = (BYTE __huge *)GlobalLock(sourceBlock);
    target = (BYTE __huge *)GlobalLock(targetBlock);

    renames(instance);
    large();
    tasks();

    GlobalUnlock(sourceBlock);
    GlobalUnlock(targetBlock);
    GlobalFree(sourceBlock);
    GlobalFree(targetBlock);
    DestroyWindow(window);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
