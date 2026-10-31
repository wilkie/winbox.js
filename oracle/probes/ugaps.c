/*
 * The last of USER's, GDI's and SHELL's internal exports a program can
 * reach, each found by its ordinal through GetProcAddress and called with
 * known registers: what it answers and what it changed. `left` is the bytes
 * of arguments the call left on the stack (nought where it pops what was
 * pushed). Values the probe can name are named: `ours` (its DS),
 * `gdi-data` (GDI's data segment, as GDISeeGDIDo's 103h answers it),
 * `given`.
 *
 * * `gp`: GetProcAddress of each module's `__GP` (USER 484, GDI 46, KERNEL
 *   342): an address or none.
 * * `farframe`: USER's _FFFE_FARFRAME (341) of a word, with a far pointer
 *   to a procedure of the probe's at 18Ch of the probe's own data: what
 *   the procedure was called with, and what the call answered.
 * * `bozo`: USER's BozosLiveHere (301) with AX the probe's DS, on an edit
 *   control of the probe's: WM_GETTEXTLENGTH, WM_SETTEXT, WM_GETTEXT.
 * * `ftrap`: GDI's FTrapping0 (355): its address and the word there.
 * * `seegdi`: GDI's GDISeeGDIDo (452) of 103h, 7, nought and 102h;
 *   `seegdiheap`, of 1, 2 and 3 -- a block of GDI's heap allocated, freed
 *   and the heap compacted.
 * * `gdiinit2`: GDI's GDIInit2 (403) on a bitmap of the display's: the
 *   word read, set, read, cleared with FFFFh, read, and put back.
 * * `finalgdi`: GDI's FinalGDIInit (405) of nought.
 * * `brute`: GDI's Brute (213) with CX as DMColorInfo's jump sets it
 *   (040Ah), beside DMColorInfo (202) itself, for a bitmap of four planes
 *   and for a device that is not a bitmap.
 * * `dde`: SHELL's HERETHARBETYGARS (100), the procedure of SHELL's DDE
 *   windows, on windows of the probe's: a message it does not take, an
 *   acknowledgement with no partner and with its partner (a block in
 *   lParam's high word), the property of 1, a termination from another and
 *   from its partner, and
 *   WM_DESTROY with no partner and with one that answers its termination.
 * * `wci`: SHELL's WCI (32), the procedure SHELL subclasses its About box's
 *   icon with, called before any About box: WM_USER, WM_PAINT and
 *   WM_NCDESTROY.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <dde.h>

#define OUTPUT "C:\\ORACLE\\UGAPS.OUT"

static HINSTANCE instance;
static HINSTANCE shell;
static WORD dseg;
static WORD gdiData;

static UINT ourDS(void)
{
    UINT value;

    _asm mov value, ds
    return value;
}

static FARPROC proc(LPCSTR module, UINT ordinal)
{
    return GetProcAddress(GetModuleHandle(module), MAKEINTRESOURCE(ordinal));
}

/* A call with its argument words pushed in order and every register set:
 * what each register holds after, and SP. */
static FARPROC target;
static WORD argv[10];
static WORD argc;
static WORD iax, ibx, icx, idx, isi, idi;
static WORD oax, obx, ocx, odx, osi, odi, spBefore, spAfter;

static void callRegs(void)
{
    _asm {
        push si
        push di
        push es
        push bx
        push cx
        push dx
        push bp
        push ds
        mov spBefore, sp
        mov cx, argc
        lea si, argv
    next:
        jcxz ready
        push word ptr [si]
        add si, 2
        dec cx
        jmp next
    ready:
        mov ax, ds
        mov es, ax
        mov ax, iax
        mov bx, ibx
        mov cx, icx
        mov dx, idx
        mov si, isi
        mov di, idi
        call dword ptr ss:target
        mov ss:oax, ax
        mov ss:obx, bx
        mov ss:ocx, cx
        mov ss:odx, dx
        mov ss:osi, si
        mov ss:odi, di
        mov ss:spAfter, sp
        push ss
        pop ds
        mov sp, spBefore
        pop ds
        pop bp
        pop dx
        pop cx
        pop bx
        pop es
        pop di
        pop si
    }
}

static void setup(LPCSTR module, UINT ordinal, WORD count)
{
    target = proc(module, ordinal);
    argc = count;
    iax = 0x1234;
    ibx = 0x2345;
    icx = 0x3456;
    idx = 0x5678;
    isi = 0x6789;
    idi = 0x789a;
}

static WORD left(void)
{
    return spBefore - spAfter;
}

/* A window procedure's five words: the window, the message, wParam, lParam. */
static void message(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    argv[0] = (WORD)hwnd;
    argv[1] = msg;
    argv[2] = wParam;
    argv[3] = HIWORD(lParam);
    argv[4] = LOWORD(lParam);
}

/* ------------------------------------------------------------------ */

static void gp(void)
{
    wsprintf(probeResult, "%s", (LPSTR)(proc("USER", 484) ? "address" : "none"));
    probe("gp", "USER", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(proc("GDI", 46) ? "address" : "none"));
    probe("gp", "GDI", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(proc("KERNEL", 342) ? "address" : "none"));
    probe("gp", "KERNEL", probeResult);
}

/* ------------------------------------------------------------------ */

static WORD seenAX, seenDX, seenCalls;

static void __declspec(naked) __far Far18C(void)
{
    _asm {
        inc word ptr ss:seenCalls
        mov ss:seenAX, ax
        mov ss:seenDX, dx
        inc ax
        mov dx, 7777h
        retf
    }
}

static void farframe(void)
{
    DWORD FAR *slot = (DWORD FAR *)MAKELP(dseg, 0x18c);
    DWORD kept = *slot;

    seenCalls = 0;
    seenAX = seenDX = 0xeeee;
    setup("USER", 341, 1);
    argv[0] = 0x4321;
    *slot = (DWORD)Far18C;
    callRegs();
    *slot = kept;

    wsprintf(probeResult, "calls=%u,ax=%x,dx=%x", seenCalls, seenAX, seenDX);
    probe("farframe", "procedure saw", probeResult);
    wsprintf(probeResult, "ax=%x,dx=%x,left=%u", oax, odx, left());
    probe("farframe", "answer", probeResult);
}

/* ------------------------------------------------------------------ */

static HWND frame;

long FAR PASCAL _export FrameProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

static void bozo(void)
{
    HWND edit = CreateWindow("EDIT", "hello", WS_CHILD | WS_VISIBLE, 0, 0, 100, 20, frame, (HMENU)1,
                             instance, NULL);
    static char text[32];

    setup("USER", 301, 5);
    iax = dseg;
    message(edit, WM_GETTEXTLENGTH, 0, 0);
    callRegs();
    wsprintf(probeResult, "ax=%x,dx=%x,left=%u,sent=%lx", oax, odx, left(),
             SendMessage(edit, WM_GETTEXTLENGTH, 0, 0));
    probe("bozo", "WM_GETTEXTLENGTH", probeResult);

    setup("USER", 301, 5);
    iax = dseg;
    message(edit, WM_SETTEXT, 0, (LPARAM)(LPSTR) "abcdef");
    callRegs();
    GetWindowText(edit, text, sizeof(text));
    wsprintf(probeResult, "ax=%x,dx=%x,left=%u,text=%s", oax, odx, left(), (LPSTR)text);
    probe("bozo", "WM_SETTEXT", probeResult);

    lstrcpy(text, "xxxxxxxxxx");
    setup("USER", 301, 5);
    iax = dseg;
    message(edit, WM_GETTEXT, 4, (LPARAM)(LPSTR)text);
    callRegs();
    wsprintf(probeResult, "ax=%x,dx=%x,left=%u,text=%s", oax, odx, left(), (LPSTR)text);
    probe("bozo", "WM_GETTEXT 4", probeResult);

    DestroyWindow(edit);
}

/* ------------------------------------------------------------------ */

typedef DWORD(FAR PASCAL *SEEPROC)(WORD, WORD, WORD, WORD);

static void ftrap(void)
{
    DWORD address = (DWORD)proc("GDI", 355);

    wsprintf(probeResult, "selector=%s,offset=%x,word=%x",
             (LPSTR)(HIWORD(address) == gdiData ? "gdi-data" : "other"), LOWORD(address),
             HIWORD(address) == gdiData ? *(WORD FAR *)address : 0xeeee);
    probe("ftrap", "FTrapping0", probeResult);
}

static void seegdi(void)
{
    SEEPROC see = (SEEPROC)proc("GDI", 452);
    DWORD answer;
    WORD block;

    answer = see(0x103, 0, 0, 0);
    wsprintf(probeResult, "ax=%s,dx=%x", (LPSTR)(LOWORD(answer) == gdiData ? "gdi-data" : "other"),
             HIWORD(answer));
    probe("seegdi", "103", probeResult);

    answer = see(7, 1, 2, 3);
    wsprintf(probeResult, "%lx", answer);
    probe("seegdi", "7", probeResult);
    answer = see(0, 1, 2, 3);
    wsprintf(probeResult, "%lx", answer);
    probe("seegdi", "0", probeResult);
    answer = see(0x102, 1, 2, 3);
    wsprintf(probeResult, "%lx", answer);
    probe("seegdi", "102", probeResult);

    answer = see(1, LMEM_FIXED, 0, 0x10);
    block = LOWORD(answer);
    wsprintf(probeResult, "ax=%s,dx=%x", (LPSTR)(block ? "block" : "0"), HIWORD(answer));
    probe("seegdiheap", "1 fixed 10", probeResult);

    answer = see(2, block, 0, 0);
    wsprintf(probeResult, "%lx", answer);
    probe("seegdiheap", "2 the block", probeResult);

    answer = see(3, 0, 0, 0);
    wsprintf(probeResult, "ax=%s,dx=%x", (LPSTR)(LOWORD(answer) ? "some" : "0"), HIWORD(answer));
    probe("seegdiheap", "3 nought", probeResult);
}

static WORD objectWord(HBITMAP bitmap)
{
    WORD FAR *entry = (WORD FAR *)MAKELP(gdiData, (WORD)bitmap);
    WORD FAR *object = (WORD FAR *)MAKELP(gdiData, *entry);

    return object[5];
}

static void initTwo(LPCSTR name, HBITMAP bitmap, WORD value, WORD original)
{
    setup("GDI", 403, 2);
    argv[0] = (WORD)bitmap;
    argv[1] = value;
    callRegs();
    wsprintf(probeResult, "ax=%s,dx=%x,left=%u",
             (LPSTR)(oax == original && original ? "original" : oax == gdiData ? "gdi-data" : oax == 0x1234 && value == 0x1234 ? "given" : oax == 0x1234 ? "1234" : oax == 0 ? "0" : "other"),
             odx, left());
    probe("gdiinit2", name, probeResult);
}

static void gdiinit2(void)
{
    HDC screen = GetDC(NULL);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 16, 8);
    WORD original;

    ReleaseDC(NULL, screen);
    original = objectWord(bitmap);
    wsprintf(probeResult, "%s", (LPSTR)(original ? "handle" : "0"));
    probe("gdiinit2", "object word", probeResult);

    initTwo("read", bitmap, 0, original);
    initTwo("set 1234", bitmap, 0x1234, original);
    initTwo("read after set", bitmap, 0, original);
    wsprintf(probeResult, "%x", objectWord(bitmap));
    probe("gdiinit2", "object word after set", probeResult);
    initTwo("ffff", bitmap, 0xffff, original);
    initTwo("read after ffff", bitmap, 0, original);
    initTwo("put back", bitmap, original, original);
    initTwo("read last", bitmap, 0, original);

    DeleteObject(bitmap);
}

static void finalgdi(void)
{
    setup("GDI", 405, 1);
    argv[0] = 0;
    callRegs();
    wsprintf(probeResult, "ax=%x,left=%u", oax, left());
    probe("finalgdi", "0", probeResult);
}

/* ------------------------------------------------------------------ */

typedef DWORD(FAR PASCAL *COLORINFOPROC)(LPSTR, DWORD, LPSTR);

typedef struct {
    short bmType;
    short bmWidth;
    short bmHeight;
    short bmWidthBytes;
    BYTE bmPlanes;
    BYTE bmBitsPixel;
    LPSTR bmBits;
    DWORD bmWidthPlanes;
    LPSTR bmlpPDevice;
    short bmSegmentIndex;
    short bmScanSegment;
    short bmFillBytes;
    short reserved[2];
} DRVBITMAP;

static DRVBITMAP colour;
static BYTE colourBits[2 * 4 * 8];
static WORD notBitmap[16];

static void bruteOne(LPCSTR name, LPSTR device, DWORD rgb)
{
    COLORINFOPROC colorInfo = (COLORINFOPROC)proc("GDI", 202);
    DWORD physical = 0xeeeeeeeeL;
    DWORD byBrute = 0xeeeeeeeeL;
    DWORD direct = colorInfo(device, rgb, (LPSTR)&physical);

    setup("GDI", 213, 6);
    icx = 0x040a;
    argv[0] = HIWORD((DWORD)device);
    argv[1] = LOWORD((DWORD)device);
    argv[2] = HIWORD(rgb);
    argv[3] = LOWORD(rgb);
    argv[4] = dseg;
    argv[5] = (WORD)(DWORD)(LPVOID)&byBrute;
    callRegs();

    wsprintf(probeResult, "same=%s,physical-same=%s,ax=%x,left=%u",
             (LPSTR)(MAKELONG(oax, odx) == direct ? "yes" : "no"),
             (LPSTR)(byBrute == physical ? "yes" : "no"), oax, left());
    probe("brute", name, probeResult);
}

static void brute(void)
{
    colour.bmType = 0;
    colour.bmWidth = 16;
    colour.bmHeight = 8;
    colour.bmWidthBytes = 2;
    colour.bmPlanes = 4;
    colour.bmBitsPixel = 1;
    colour.bmBits = (LPSTR)colourBits;
    colour.bmWidthPlanes = 16;
    colour.bmlpPDevice = NULL;
    colour.bmSegmentIndex = 0;
    colour.bmScanSegment = 8;
    colour.bmFillBytes = 0;
    notBitmap[0] = 0x1234;

    bruteOne("colour red", (LPSTR)&colour, RGB(255, 0, 0));
    bruteOne("colour grey", (LPSTR)&colour, RGB(128, 128, 128));
    bruteOne("not a bitmap", (LPSTR)notBitmap, RGB(255, 0, 0));
}

/* ------------------------------------------------------------------ */

static HWND partner;
static WORD terminations, terminatedBy, partnerAnswers;

long FAR PASCAL _export PartnerProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    if (msg == WM_DDE_TERMINATE) {
        terminations++;
        terminatedBy = wParam;

        if (partnerAnswers) {
            PostMessage((HWND)wParam, WM_DDE_TERMINATE, (WPARAM)hwnd, 0);
        }

        return 0;
    }

    return DefWindowProc(hwnd, msg, wParam, lParam);
}

static HWND window(void)
{
    return CreateWindow("UGapsFrame", "dde", WS_OVERLAPPED, 0, 0, 50, 50, NULL, NULL, instance, NULL);
}

static LPSTR who(HWND hwnd, HWND conversation, LPSTR buffer)
{
    if (hwnd == partner) {
        return "partner";
    }

    if (hwnd && hwnd == conversation) {
        return "window";
    }

    wsprintf(buffer, "%x", (WORD)hwnd);
    return buffer;
}

static void pump(void)
{
    MSG msg;

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }
}

static void ddeCall(LPCSTR name, HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    char a[16];

    terminations = 0;
    terminatedBy = 0;
    setup("SHELL", 100, 5);
    message(hwnd, msg, wParam, lParam);
    callRegs();
    pump();
    wsprintf(probeResult, "ax=%x,dx=%x,left=%u,alive=%s,prop=%s,terminations=%u,by=%s", oax, odx,
             left(), (LPSTR)(IsWindow(hwnd) ? "yes" : "no"),
             (LPSTR)(IsWindow(hwnd) ? who((HWND)GetProp(hwnd, "ddeconv"), hwnd, a) : "-"),
             terminations, (LPSTR)(terminatedBy ? who((HWND)terminatedBy, hwnd, a) : "0"));
    probe("dde", name, probeResult);
}

static void dde(void)
{
    WNDCLASS wc;
    HWND hwnd;
    HGLOBAL block;

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = PartnerProc;
    wc.hInstance = instance;
    wc.lpszClassName = "UGapsPartner";
    RegisterClass(&wc);
    partner = CreateWindow("UGapsPartner", "partner", WS_OVERLAPPED, 0, 0, 50, 50, NULL, NULL,
                           instance, NULL);

    hwnd = window();
    ddeCall("WM_USER", hwnd, WM_USER, 1, 2);

    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 0x20);
    ddeCall("ack first", hwnd, WM_DDE_ACK, (WPARAM)partner, MAKELONG(0, block));
    wsprintf(probeResult, "%s", (LPSTR)(GlobalSize(block) ? "kept" : "freed"));
    probe("dde", "block after first ack", probeResult);
    ddeCall("ack from partner", hwnd, WM_DDE_ACK, (WPARAM)partner, MAKELONG(0, block));
    wsprintf(probeResult, "%s", (LPSTR)(GlobalSize(block) ? "kept" : "freed"));
    probe("dde", "block after partner's ack", probeResult);

    hwnd = window();
    SetProp(hwnd, "ddeconv", (HANDLE)1);
    block = GlobalAlloc(GMEM_MOVEABLE | GMEM_DDESHARE, 0x20);
    ddeCall("ack with 1", hwnd, WM_DDE_ACK, (WPARAM)partner, MAKELONG(0, block));
    wsprintf(probeResult, "%s", (LPSTR)(GlobalSize(block) ? "kept" : "freed"));
    probe("dde", "block after ack with 1", probeResult);
    RemoveProp(hwnd, "ddeconv");
    DestroyWindow(hwnd);

    hwnd = window();
    SetProp(hwnd, "ddeconv", (HANDLE)partner);
    ddeCall("terminate from another", hwnd, WM_DDE_TERMINATE, (WPARAM)frame, 0);
    ddeCall("terminate from partner", hwnd, WM_DDE_TERMINATE, (WPARAM)partner, 0);

    hwnd = window();
    ddeCall("destroy alone", hwnd, WM_DESTROY, 0, 0);
    DestroyWindow(hwnd);

    hwnd = window();
    SetProp(hwnd, "ddeconv", (HANDLE)partner);
    partnerAnswers = 1;
    ddeCall("destroy with partner", hwnd, WM_DESTROY, 0, 0);
    partnerAnswers = 0;
    RemoveProp(hwnd, "ddeconv");
    DestroyWindow(hwnd);

    DestroyWindow(partner);
}

/* ------------------------------------------------------------------ */

static void wciCall(LPCSTR name, UINT msg)
{
    setup("SHELL", 32, 5);
    message(frame, msg, 0, 0);
    callRegs();
    wsprintf(probeResult, "ax=%x,dx=%x,left=%u", oax, odx, left());
    probe("wci", name, probeResult);
}

static void wci(void)
{
    wciCall("WM_USER", WM_USER);
    wciCall("WM_PAINT", WM_PAINT);
    wciCall("WM_NCDESTROY", WM_NCDESTROY);
    ValidateRect(frame, NULL);
}

/* ------------------------------------------------------------------ */

int PASCAL WinMain(HINSTANCE hInstance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    DWORD answer;

    instance = hInstance;
    probeOpen(OUTPUT);
    /* The probe runs as the shell, so nothing has loaded SHELL yet. */
    shell = LoadLibrary("SHELL.DLL");
    dseg = ourDS();
    answer = ((SEEPROC)proc("GDI", 452))(0x103, 0, 0, 0);
    gdiData = LOWORD(answer);

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = FrameProc;
    wc.hInstance = instance;
    wc.lpszClassName = "UGapsFrame";
    RegisterClass(&wc);
    frame = CreateWindow("UGapsFrame", "ugaps", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 200, 100,
                         NULL, NULL, instance, NULL);

    gp();
    farframe();
    bozo();
    ftrap();
    seegdi();
    gdiinit2();
    finalgdi();
    brute();
    dde();
    wci();

    DestroyWindow(frame);
    FreeLibrary(shell);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
