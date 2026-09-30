/*
 * Metafiles on disk: made by `CreateMetaFile` with a file's name, read by
 * `GetMetaFile`, written by `CopyMetaFile`.
 *
 * Into each metafile, the same calls: SetPixel(1, 1, red), SelectObject
 * of a green solid brush, Rectangle(2, 2, 20, 14), MoveTo(2, 18),
 * LineTo(40, 18), TextOut(2, 20, "Hi"), SelectObject of the stock white
 * brush.
 *
 * * `call`: each call's answer, in hexadecimal, or whether it was other
 *   than nought where a handle is answered.
 * * `file`: a file's size and its bytes, 32 to a record, in hexadecimal,
 *   `at` the offset of each: DISK.WMF as `CreateMetaFile` and
 *   `CloseMetaFile` left it, COPY.WMF from `CopyMetaFile` of the disk
 *   metafile, MEM.WMF from `CopyMetaFile` of one in memory.
 * * `block`: what a metafile's handle's global block holds; see `block`.
 * * `play`: a metafile played with `PlayMetaFile` into a cell 48 by 32 on
 *   the screen, over white, read back a row at a time, palette digits.
 * * `exists`: whether a file can be opened, after `DeleteMetaFile`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DISKMETA.OUT"

#define DISK "C:\\ORACLE\\DISK.WMF"
#define COPY "C:\\ORACLE\\COPY.WMF"
#define MEMORY "C:\\ORACLE\\MEM.WMF"

#define W 48
#define H 32

/* Each record is closed into the file, so a call that ends the probe
 * leaves the records before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

static const char HEX[] = "0123456789abcdef";

static const COLORREF PALETTE[16] = {
    RGB(0, 0, 0),       RGB(128, 0, 0),     RGB(0, 128, 0),   RGB(128, 128, 0),
    RGB(0, 0, 128),     RGB(128, 0, 128),   RGB(0, 128, 128), RGB(192, 192, 192),
    RGB(128, 128, 128), RGB(255, 0, 0),     RGB(0, 255, 0),   RGB(255, 255, 0),
    RGB(0, 0, 255),     RGB(255, 0, 255),   RGB(0, 255, 255), RGB(255, 255, 255),
};

static HDC screen;

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

static void call(LPCSTR name, DWORD answer)
{
    wsprintf(probeResult, "%lx", answer);
    record("call", name, probeResult);
}

/* Bytes as hexadecimal, into `probeResult`. */
static void hex(BYTE FAR *bytes, int count)
{
    int n;

    for (n = 0; n < count; n++) {
        probeResult[n * 2] = HEX[bytes[n] >> 4];
        probeResult[n * 2 + 1] = HEX[bytes[n] & 15];
    }

    probeResult[count * 2] = '\0';
}

static void file(LPCSTR name, LPCSTR path)
{
    OFSTRUCT of;
    HFILE handle = OpenFile(path, &of, OF_READ);
    BYTE chunk[32];
    long size;
    long at;

    if (handle == HFILE_ERROR) {
        wsprintf(probeArgs, "%s,size", name);
        record("file", probeArgs, "cannot open");
        return;
    }

    size = _llseek(handle, 0L, 2);
    _llseek(handle, 0L, 0);
    wsprintf(probeArgs, "%s,size", name);
    wsprintf(probeResult, "%ld", size);
    record("file", probeArgs, probeResult);

    for (at = 0; at < size; at += 32) {
        int count = (int)(size - at < 32 ? size - at : 32);

        _lread(handle, chunk, count);
        hex(chunk, count);
        wsprintf(probeArgs, "%s,at=%ld", name, at);
        record("file", probeArgs, probeResult);
    }

    _lclose(handle);
}

/*
 * What a metafile's handle's block holds: its size by `GlobalSize`; its
 * header, 18 bytes; and, for one on disk, the `OFSTRUCT` after six bytes
 * more: its length byte, its fixed-disk byte, its error, and its path. The
 * six bytes, the file's date and time in the `OFSTRUCT`, and what follows
 * it are left out: they are whatever was there, or the clock.
 */
static void block(LPCSTR name, HGLOBAL handle)
{
    DWORD size = GlobalSize(handle);
    BYTE FAR *bytes;

    wsprintf(probeArgs, "%s,size", name);
    wsprintf(probeResult, "%lu", size);
    record("block", probeArgs, probeResult);

    bytes = (BYTE FAR *)GlobalLock(handle);

    if (!bytes) {
        wsprintf(probeArgs, "%s,header", name);
        record("block", probeArgs, "cannot lock");
        return;
    }

    hex(bytes, 18);
    wsprintf(probeArgs, "%s,header", name);
    record("block", probeArgs, probeResult);

    if (bytes[0] == 2) {
        wsprintf(probeResult, "%02x,%02x,%04x,%s", bytes[24], bytes[25],
                 *(WORD FAR *)(bytes + 26), (LPSTR)(bytes + 32));
        wsprintf(probeArgs, "%s,ofstruct", name);
        record("block", probeArgs, probeResult);
    }

    GlobalUnlock(handle);
}

static void play(LPCSTR name, HMETAFILE metafile)
{
    RECT cell;
    int x;
    int y;

    SetRect(&cell, 0, 0, W, H);
    FillRect(screen, &cell, GetStockObject(WHITE_BRUSH));
    wsprintf(probeArgs, "%s,PlayMetaFile", name);
    call(probeArgs, PlayMetaFile(screen, metafile));

    for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
            probeResult[x] = digit(GetPixel(screen, x, y));
        }

        probeResult[W] = '\0';
        wsprintf(probeArgs, "%s,y=%d", name, y);
        record("play", probeArgs, probeResult);
    }
}

static void exists(LPCSTR name, LPCSTR path)
{
    OFSTRUCT of;
    HFILE handle = OpenFile(path, &of, OF_READ);

    record("exists", name, handle == HFILE_ERROR ? "no" : "yes");

    if (handle != HFILE_ERROR) {
        _lclose(handle);
    }
}

static void draw(HDC meta, HBRUSH brush)
{
    SetPixel(meta, 1, 1, RGB(255, 0, 0));
    SelectObject(meta, brush);
    Rectangle(meta, 2, 2, 20, 14);
    MoveTo(meta, 2, 18);
    LineTo(meta, 40, 18);
    TextOut(meta, 2, 20, "Hi", 2);
    SelectObject(meta, GetStockObject(WHITE_BRUSH));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HDC meta;
    HBRUSH brush;
    HMETAFILE disk;
    HMETAFILE read;
    HMETAFILE copy;
    HMETAFILE memory;
    HMETAFILE copied;
    HGLOBAL bits;
    OFSTRUCT of;

    probeOpen(OUTPUT);
    ShowCursor(FALSE);
    SetCursorPos(GetSystemMetrics(SM_CXSCREEN) - 1, GetSystemMetrics(SM_CYSCREEN) - 1);

    screen = GetDC(NULL);
    brush = CreateSolidBrush(RGB(0, 255, 0));

    OpenFile(DISK, &of, OF_DELETE);
    OpenFile(COPY, &of, OF_DELETE);
    OpenFile(MEMORY, &of, OF_DELETE);

    meta = CreateMetaFile(DISK);
    call("CreateMetaFile(disk)", meta != NULL);
    draw(meta, brush);
    disk = CloseMetaFile(meta);
    call("CloseMetaFile(disk)", disk != NULL);
    file("disk", DISK);
    block("disk", disk);
    play("disk", disk);

    read = GetMetaFile(DISK);
    call("GetMetaFile(disk)", read != NULL);
    block("read", read);
    play("read", read);

    copy = CopyMetaFile(disk, COPY);
    call("CopyMetaFile(disk,file)", copy != NULL);
    file("copy", COPY);
    block("copy", copy);

    copied = CopyMetaFile(disk, NULL);
    call("CopyMetaFile(disk,NULL)", copied != NULL);
    block("copied", copied);
    play("copied", copied);

    meta = CreateMetaFile(NULL);
    draw(meta, brush);
    memory = CloseMetaFile(meta);
    block("memory", memory);
    block("memcopy", CopyMetaFile(memory, NULL));
    call("CopyMetaFile(memory,file)", (copy = CopyMetaFile(memory, MEMORY)) != NULL);
    file("memory", MEMORY);
    block("tofile", copy);
    play("tofile", copy);

    bits = GetMetaFileBits(read);
    call("GetMetaFileBits(read)", bits != NULL);
    call("GetMetaFileBits(read) same", bits == (HGLOBAL)read);
    block("bits", bits);
    play("setbits", SetMetaFileBits(bits));

    call("DeleteMetaFile(disk)", DeleteMetaFile(disk));
    exists("disk", DISK);
    call("DeleteMetaFile(copy)", DeleteMetaFile(copy));
    exists("memory", MEMORY);

    call("CreateMetaFile(no drive)", CreateMetaFile("Q:\\NONE\\X.WMF") != NULL);

    DeleteObject(brush);
    ReleaseDC(NULL, screen);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
