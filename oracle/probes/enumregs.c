/*
 * The registers GDI calls a font or object enumeration's procedure with:
 * a procedure of the probe's own making, eight bytes of code at a time in
 * a block of its own run through a code alias, with no prologue to change
 * them. It keeps what it found and answers nought, so each enumeration
 * stops at its first call.
 *
 * * `regs`: AX, DS and ES as they relate: `ss` for the stack's segment,
 *   `mine` for the probe's data segment, `tm` for the offset of the
 *   TEXTMETRIC it was given, `lf` for the LOGFONT's, `n` for another number
 *   and its value otherwise; then `sp` and each far pointer given, as
 *   `ss+offset from SP at entry` or `other`, and the font type.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ENUMREGS.OUT"

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

WORD getDs(void);
#pragma aux getDs = "mov ax, ds" value [ax];
WORD getSs(void);
#pragma aux getSs = "mov ax, ss" value [ax];

static BYTE FAR *data;
static FARPROC code;

/* The procedure, for a callback that pops `bytes` of arguments. */
static void build(WORD selector, WORD bytes)
{
    static const BYTE body[] = {
        0x1e,                   /* push ds             */
        0x50,                   /* push ax             */
        0xb8, 0, 0,             /* mov ax, <data>      */
        0x8e, 0xd8,             /* mov ds, ax          */
        0x58,                   /* pop ax              */
        0xa3, 0x00, 0x00,       /* mov [0], ax: AX     */
        0x58,                   /* pop ax              */
        0x50,                   /* push ax             */
        0xa3, 0x02, 0x00,       /* mov [2], ax: DS     */
        0x8c, 0xc0,             /* mov ax, es          */
        0xa3, 0x04, 0x00,       /* mov [4], ax: ES     */
        0x8c, 0xd0,             /* mov ax, ss          */
        0xa3, 0x06, 0x00,       /* mov [6], ax: SS     */
        0x8b, 0xc4,             /* mov ax, sp          */
        0x05, 0x02, 0x00,       /* add ax, 2           */
        0xa3, 0x08, 0x00,       /* mov [8], ax: SP     */
        0xff, 0x06, 0x0a, 0x00, /* inc word [0Ah]      */
        0x8b, 0xdc,             /* mov bx, sp          */
        0x36, 0x8b, 0x47, 0x02, /* mov ax, ss:[bx+2]   */
        0xa3, 0x10, 0x00,
        0x36, 0x8b, 0x47, 0x04, /* mov ax, ss:[bx+4]   */
        0xa3, 0x12, 0x00,
        0x36, 0x8b, 0x47, 0x06,
        0xa3, 0x14, 0x00,
        0x36, 0x8b, 0x47, 0x08,
        0xa3, 0x16, 0x00,
        0x36, 0x8b, 0x47, 0x0a,
        0xa3, 0x18, 0x00,
        0x36, 0x8b, 0x47, 0x0c,
        0xa3, 0x1a, 0x00,
        0x36, 0x8b, 0x47, 0x0e,
        0xa3, 0x1c, 0x00,
        0x36, 0x8b, 0x47, 0x10,
        0xa3, 0x1e, 0x00,
        0x36, 0x8b, 0x47, 0x12,
        0xa3, 0x20, 0x00,
        0x1f,                   /* pop ds              */
        0x33, 0xc0,             /* xor ax, ax          */
        0xca, 0, 0              /* retf <bytes>        */
    };
    int i;

    for (i = 0; i < sizeof(body); i++) {
        data[0x40 + i] = body[i];
    }

    data[0x40 + 3] = LOBYTE(selector);
    data[0x40 + 4] = HIBYTE(selector);
    data[0x40 + sizeof(body) - 2] = LOBYTE(bytes);
    data[0x40 + sizeof(body) - 1] = HIBYTE(bytes);

    for (i = 0; i < 0x40; i++) {
        data[i] = 0;
    }
}

static WORD word(int at)
{
    return *(WORD FAR *)(data + at);
}

/* A register's value as it relates to what the procedure was given. */
static void relate(LPSTR out, WORD value, WORD tm, WORD lf)
{
    if (value == getSs()) {
        lstrcpy(out, "ss");
    } else if (value == getDs()) {
        lstrcpy(out, "mine");
    } else if (tm && value == tm) {
        lstrcpy(out, "tm");
    } else if (lf && value == lf) {
        lstrcpy(out, "lf");
    } else if (value < 0x100) {
        wsprintf(out, "n%u", value);
    } else {
        lstrcpy(out, "other");
    }
}

/* A far pointer given, as it lies from the stack at entry. */
static void pointer(LPSTR out, WORD offset, WORD selector)
{
    if (selector == word(6)) {
        wsprintf(out, "ss+%d", (int)(offset - word(8)));
    } else if (selector == getDs()) {
        lstrcpy(out, "mine");
    } else {
        lstrcpy(out, "other");
    }
}

/* What a font enumeration's procedure found: lplf, lptm, type, lParam. */
static void fonts(LPCSTR what)
{
    char ax[12], ds[12], es[12], lf[16], tm[16];
    /* At entry: the return address, then lParam, the type, lptm, lplf. */
    WORD tmOffset = word(0x1a);
    WORD lfOffset = word(0x1e);

    relate(ax, word(0), tmOffset, lfOffset);
    relate(ds, word(2), tmOffset, lfOffset);
    relate(es, word(4), tmOffset, lfOffset);
    pointer(lf, lfOffset, word(0x20));
    pointer(tm, tmOffset, word(0x1c));
    wsprintf(probeResult, "calls=%u ax=%s ds=%s es=%s lf=%s tm=%s type=%u", word(0x0a),
             (LPSTR)ax, (LPSTR)ds, (LPSTR)es, (LPSTR)lf, (LPSTR)tm, word(0x18));
    probe("regs", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL block;
    WORD selector;
    WORD alias;
    HDC screen;
    char ax[12], ds[12], es[12], object[16];

    probeOpen(OUTPUT);

    block = GlobalAlloc(GMEM_FIXED | GMEM_ZEROINIT, 512);
    data = (BYTE FAR *)GlobalLock(block);
    selector = HIWORD((DWORD)data);
    alias = AllocDStoCSAlias(selector);
    code = (FARPROC)MAKELONG(0x40, alias);
    screen = GetDC(NULL);

    build(selector, 14);
    EnumFonts(screen, "System", (OLDFONTENUMPROC)code, 0L);
    fonts("EnumFonts System");

    build(selector, 14);
    EnumFonts(screen, "Arial", (OLDFONTENUMPROC)code, 0L);
    fonts("EnumFonts Arial");

    build(selector, 14);
    EnumFontFamilies(screen, "System", (FONTENUMPROC)code, 0L);
    fonts("EnumFontFamilies System");

    build(selector, 14);
    EnumFontFamilies(screen, "Arial", (FONTENUMPROC)code, 0L);
    fonts("EnumFontFamilies Arial");

    build(selector, 14);
    EnumFontFamilies(screen, NULL, (FONTENUMPROC)code, 0L);
    fonts("EnumFontFamilies all");

    build(selector, 8);
    EnumObjects(screen, OBJ_PEN, (GOBJENUMPROC)code, 0L);
    relate(ax, word(0), 0, 0);
    relate(ds, word(2), 0, 0);
    relate(es, word(4), 0, 0);
    pointer(object, word(0x18), word(0x1a));
    wsprintf(probeResult, "calls=%u ax=%s ds=%s es=%s object=%s", word(0x0a), (LPSTR)ax,
             (LPSTR)ds, (LPSTR)es, (LPSTR)object);
    probe("regs", "EnumObjects pens", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(word(0) == word(2) ? "yes" : "no"));
    probe("regs", "EnumObjects ax is ds", probeResult);

    build(selector, 8);
    EnumObjects(screen, OBJ_BRUSH, (GOBJENUMPROC)code, 0L);
    relate(ax, word(0), 0, 0);
    relate(ds, word(2), 0, 0);
    relate(es, word(4), 0, 0);
    pointer(object, word(0x18), word(0x1a));
    wsprintf(probeResult, "calls=%u ax=%s ds=%s es=%s object=%s", word(0x0a), (LPSTR)ax,
             (LPSTR)ds, (LPSTR)es, (LPSTR)object);
    probe("regs", "EnumObjects brushes", probeResult);

    ReleaseDC(NULL, screen);
    FreeSelector(alias);
    GlobalUnlock(block);
    GlobalFree(block);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
