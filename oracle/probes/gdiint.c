/*
 * GDI's internal exports for USER and the drivers that a program can reach
 * by number: `FixupBogusPublisherMetafile`, `DeviceColorMatch`, `ScanLR`,
 * `ShrinkGDIHeap` and `GDITaskTermination`. Recorded on the VGA.
 *
 * * `fixup`: `FixupBogusPublisherMetafile` of a memory metafile's bits,
 *   with its size in the header right, wrong, and asked to be put right or
 *   not, and of one whose type is not 1: the answer and the size in the
 *   header after.
 * * `colormatch`: `DeviceColorMatch` of a colour against a table of the
 *   probe's: the answer.
 * * `scanlr`: `ScanLR` on a memory context, from a point, each way, for
 *   the colour and for anything else: the answer.
 * * `call`: `ShrinkGDIHeap` and `GDITaskTermination`, which answer
 *   nothing a caller reads: only that they came back.
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\GDIINT.OUT"

typedef int(FAR PASCAL *FIXUPPROC)(LPSTR, BOOL);
typedef WORD(FAR PASCAL *MATCHPROC)(DWORD, LPSTR);
typedef int(FAR PASCAL *SCANPROC)(HDC, int, int, DWORD, int);
typedef void(FAR PASCAL *VOIDPROC)(void);
typedef void(FAR PASCAL *TASKPROC)(HANDLE);

static FIXUPPROC fixup;
static MATCHPROC colorMatch;
static SCANPROC scanLR;

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

static void fixed(LPCSTR name, HGLOBAL bits, int type, DWORD size, BOOL fix)
{
    WORD FAR *header = (WORD FAR *)GlobalLock(bits);
    WORD typeWas = header[0];
    DWORD sizeWas = *(DWORD FAR *)(header + 3);
    int answer;

    header[0] = (WORD)type;

    if (size) {
        *(DWORD FAR *)(header + 3) = size;
    }

    answer = fixup((LPSTR)header, fix);
    wsprintf(probeArgs, "%s fix %d", name, fix);
    wsprintf(probeResult, "%d size %ld", answer, *(DWORD FAR *)(header + 3));
    probe("fixup", probeArgs, probeResult);
    header[0] = typeWas;
    *(DWORD FAR *)(header + 3) = sizeWas;
    GlobalUnlock(bits);
}

static void matched(LPCSTR name, LPSTR table, DWORD colour)
{
    wsprintf(probeArgs, "%s %08lx", name, colour);
    wsprintf(probeResult, "%u", colorMatch(colour, table));
    probe("colormatch", probeArgs, probeResult);
}

static void scanned(LPCSTR name, HDC dc, int x, int y, DWORD colour, int style)
{
    wsprintf(probeArgs, "%s %d,%d %08lx style %d", name, x, y, colour, style);
    wsprintf(probeResult, "%d", scanLR(dc, x, y, colour, style));
    probe("scanlr", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    /* A device's table as `DeviceColorMatch` takes it: the offset of the
     * word to answer in each entry, then a far pointer to the entries'
     * block -- a count, a word, then ten bytes each, blue, green and red
     * at 6 to 8. */
    static BYTE entries[4 + 10 * 5];
    static struct {
        WORD field;
        LPSTR table;
    } device;
    static BYTE colours[5][3] = {
        {0, 0, 0}, {0xff, 0, 0}, {0, 0x80, 0}, {0x40, 0x40, 0xff}, {0xff, 0xff, 0xff}};
    HDC screen, memory;
    HBITMAP bitmap, before;
    HMETAFILE file;
    HGLOBAL bits;
    HGLOBAL table;
    LPSTR at;
    int i;

    probeOpen(OUTPUT);
    fixup = (FIXUPPROC)gdiProc(464);
    colorMatch = (MATCHPROC)gdiProc(449);
    scanLR = (SCANPROC)gdiProc(135);

    /* FixupBogusPublisherMetafile. */
    memory = CreateMetaFile(NULL);
    MoveTo(memory, 1, 2);
    LineTo(memory, 30, 40);
    Rectangle(memory, 5, 6, 70, 80);
    TextOut(memory, 3, 4, "Hello", 5);
    file = CloseMetaFile(memory);
    bits = GetMetaFileBits(file);
    wsprintf(probeResult, "%ld", *(DWORD FAR *)((WORD FAR *)GlobalLock(bits) + 3));
    GlobalUnlock(bits);
    probe("fixup", "size", probeResult);

    fixed("right", bits, 1, 0, FALSE);
    fixed("right", bits, 1, 0, TRUE);
    fixed("short", bits, 1, 5, FALSE);
    fixed("short", bits, 1, 5, TRUE);
    fixed("long", bits, 1, 0x12345L, TRUE);
    fixed("type 2", bits, 2, 5, TRUE);
    fixed("type 0", bits, 0, 5, TRUE);
    GlobalFree(bits);

    /* DeviceColorMatch. */
    table = GlobalAlloc(GMEM_FIXED | GMEM_ZEROINIT, sizeof(entries));
    at = (LPSTR)GlobalLock(table);
    *(WORD FAR *)at = 5;

    for (i = 0; i < 5; i++) {
        LPSTR entry = at + 4 + i * 10;

        *(WORD FAR *)entry = (WORD)(0x100 + i);
        *(WORD FAR *)(entry + 2) = (WORD)(0x200 + i * 3);
        *(WORD FAR *)(entry + 4) = (WORD)(0x300 + i * 5);
        entry[6] = colours[i][2];
        entry[7] = colours[i][1];
        entry[8] = colours[i][0];
    }

    device.table = at;

    for (i = 0; i <= 4; i += 2) {
        static char name[16];

        device.field = (WORD)i;
        wsprintf(name, "field %d", i);
        matched(name, (LPSTR)&device, 0x000000L);
        matched(name, (LPSTR)&device, 0x0000ffL);
        matched(name, (LPSTR)&device, 0xff4040L);
        matched(name, (LPSTR)&device, 0x007000L);
        matched(name, (LPSTR)&device, 0xc0c0c0L);
        matched(name, (LPSTR)&device, 0x02ffffffL);
        matched(name, (LPSTR)&device, 0x00202020L);
        matched(name, (LPSTR)&device, 0x00a04020L);
    }

    GlobalUnlock(table);
    GlobalFree(table);

    /* ScanLR, on a bitmap of the display's and on a monochrome one. */
    screen = GetDC(NULL);
    memory = CreateCompatibleDC(screen);
    bitmap = CreateCompatibleBitmap(screen, 32, 8);
    before = SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 32, 8, WHITENESS);

    for (i = 5; i <= 9; i++) {
        SetPixel(memory, i, 3, RGB(255, 0, 0));
    }

    SetPixel(memory, 20, 3, RGB(0, 0, 255));

    for (i = 0; i < 4; i++) {
        scanned("colour", memory, 0, 3, RGB(255, 0, 0), i);
        scanned("colour", memory, 7, 3, RGB(255, 0, 0), i);
        scanned("colour", memory, 12, 3, RGB(250, 10, 0), i);
        scanned("colour", memory, 31, 3, RGB(255, 255, 255), i);
        scanned("colour", memory, 0, 3, RGB(0, 0, 255), i);
        scanned("colour", memory, 31, 5, RGB(255, 255, 255), i);
    }

    scanned("colour", memory, 32, 3, RGB(255, 0, 0), 0);
    scanned("colour", memory, 0, 8, RGB(255, 0, 0), 0);
    scanned("colour", memory, -1, 3, RGB(255, 0, 0), 0);
    SetViewportOrg(memory, 4, 1);
    scanned("moved", memory, 3, 2, RGB(255, 0, 0), 0);
    scanned("moved", memory, 3, 2, RGB(255, 0, 0), 1);
    SetViewportOrg(memory, 0, 0);
    scanned("none", NULL, 0, 3, RGB(255, 0, 0), 0);

    SelectObject(memory, before);
    DeleteObject(bitmap);
    bitmap = CreateBitmap(24, 4, 1, 1, NULL);
    SelectObject(memory, bitmap);
    PatBlt(memory, 0, 0, 24, 4, BLACKNESS);
    PatBlt(memory, 10, 1, 4, 1, WHITENESS);

    for (i = 0; i < 4; i++) {
        scanned("mono", memory, 0, 1, RGB(255, 255, 255), i);
        scanned("mono", memory, 11, 1, RGB(255, 255, 0), i);
        scanned("mono", memory, 23, 1, RGB(128, 0, 0), i);
        scanned("mono", memory, 23, 2, RGB(0, 0, 0), i);
    }

    SelectObject(memory, before);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(NULL, screen);

    /* ShrinkGDIHeap and GDITaskTermination. */
    ((VOIDPROC)gdiProc(354))();
    probe("call", "ShrinkGDIHeap", "back");
    ((TASKPROC)gdiProc(460))(GetCurrentTask());
    probe("call", "GDITaskTermination", "back");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
