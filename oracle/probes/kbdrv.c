/*
 * The keyboard driver, KEYBOARD.DRV, called by its ordinals:
 *
 * * `toascii`: ToAscii for every virtual key 0-255 with its scan code
 *   (MapVirtualKey type 0), under a shift state, as the answer and the word
 *   written (sentinel AAAAh when nothing is), four and four hexadecimal
 *   digits; two records a state, keys 0-127 and 128-255.
 * * `altnum`: typing a character's number on the numeric keypad with Alt
 *   held, step by step: the answer and the word written.
 * * `keyname`: GetKeyNameText for each scan code, plain and with the
 *   extended bit, sixteen codes a record joined by `|`; and the "don't care"
 *   bit for the shift, control and alternate keys; and a short buffer.
 * * `oemscan`: OemKeyScan for every character, eight hexadecimal digits,
 *   sixty-four a record.
 * * `inquire`, `type`, `speed`, `switch`, `sysreq`, `tableseg`: Inquire,
 *   GetKeyboardType (and again after NewTable), SetSpeed,
 *   ScreenSwitchEnable, EnableKBSysReq and the bytes of the segment
 *   GetTableSeg answers. Not GetBIOSKeyProc, which answers the INT 9
 *   handler DOSX had as the driver was enabled: WinBox has no BIOS.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\KBDRV.OUT"

typedef int(FAR PASCAL *TOASCIIPROC)(UINT, UINT, LPBYTE, LPVOID, UINT);
typedef int(FAR PASCAL *NAMEPROC)(LONG, LPSTR, int);
typedef DWORD(FAR PASCAL *OEMSCANPROC)(UINT);
typedef UINT(FAR PASCAL *MAPPROC)(UINT, UINT);
typedef int(FAR PASCAL *INQUIREPROC)(LPVOID);
typedef int(FAR PASCAL *INTPROC)(int);
typedef UINT(FAR PASCAL *VOIDPROC)(void);

static HMODULE driver;
static BYTE keys[256];

static FARPROC entry(int ordinal)
{
    return GetProcAddress(driver, MAKEINTRESOURCE(ordinal));
}

static UINT map(UINT code, UINT type)
{
    return ((MAPPROC)entry(131))(code, type);
}

static void toascii(LPCSTR state)
{
    static char all[8 * 128 + 1];
    char what[40];
    WORD out;
    int answer;
    int half;
    int i;

    for (half = 0; half < 2; half++) {
        for (i = 0; i < 128; i++) {
            UINT vk = half * 128 + i;

            out = 0xaaaa;
            answer = ((TOASCIIPROC)entry(4))(vk, map(vk, 0), keys, &out, 0);
            wsprintf(all + i * 8, "%04x%04x", (WORD)answer, out);
        }

        wsprintf(what, "%s %d", state, half);
        probe("toascii", what, all);
    }
}

static WORD altWord;

/* One key of an Alt+numpad sequence: up or down, with Alt held or not. */
static void step(LPCSTR what, UINT vk, UINT scan, BOOL alt, UINT flags)
{
    int answer;

    keys[0x12] = (BYTE)(alt ? 0x80 : 0);
    answer = ((TOASCIIPROC)entry(4))(vk, scan, keys, &altWord, flags);
    wsprintf(probeResult, "%04x %04x", (WORD)answer, altWord);
    probe("altnum", what, probeResult);
}

/* A number typed on the numeric keypad with Alt held. */
static void altnum(LPCSTR digits, UINT flags)
{
    static const BYTE scans[10] = {0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49};
    char what[40];
    int i;

    altWord = 0xaaaa;
    wsprintf(what, "%s/%u alt down", digits, flags);
    step(what, 0x12, 0x38, TRUE, flags);

    for (i = 0; digits[i]; i++) {
        int digit = digits[i] - '0';

        wsprintf(what, "%s/%u %c down", digits, flags, digits[i]);
        step(what, 0x60 + digit, scans[digit], TRUE, flags);
        wsprintf(what, "%s/%u %c up", digits, flags, digits[i]);
        step(what, 0x60 + digit, 0x8000 | scans[digit], TRUE, flags);
    }

    wsprintf(what, "%s/%u alt up", digits, flags);
    step(what, 0x12, 0x8038, FALSE, flags);
}

static void keyname(BOOL extended)
{
    static char all[1200];
    char name[40];
    int group;
    int i;

    for (group = 0; group < 8; group++) {
        all[0] = '\0';

        for (i = 0; i < 16; i++) {
            int scan = group * 16 + i;
            int answer;

            name[0] = '\0';
            answer = ((NAMEPROC)entry(133))(MAKELONG(0, scan | (extended ? 0x100 : 0)), name,
                                           sizeof(name));
            wsprintf(all + lstrlen(all), "%s%d:%s", (LPSTR)(i ? "|" : ""), answer, (LPSTR)name);
        }

        wsprintf(probeArgs, "%s %02x", (LPSTR)(extended ? "ext" : "plain"), group * 16);
        probe("keyname", probeArgs, all);
    }
}

static void named(LPCSTR what, LONG lParam, int size)
{
    char name[40];
    int answer;

    lstrcpy(name, "##########");
    answer = ((NAMEPROC)entry(133))(lParam, name, size);
    name[20] = '\0';
    wsprintf(probeResult, "%d:%s", answer, (LPSTR)name);
    probe("keyname", what, probeResult);
}

static void hexOf(LPSTR out, BYTE FAR *bytes, int count)
{
    int i;

    for (i = 0; i < count; i++) {
        wsprintf(out + i * 2, "%02x", bytes[i]);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char all[8 * 64 + 1];
    BYTE info[8];
    int answer;
    int i;
    int group;
    UINT segment;

    probeOpen(OUTPUT);
    driver = GetModuleHandle("KEYBOARD");

    toascii("none");
    keys[0x10] = 0x80;
    toascii("shift");
    keys[0x10] = 0;
    keys[0x11] = 0x80;
    toascii("ctrl");
    keys[0x10] = 0x80;
    toascii("ctrl+shift");
    keys[0x10] = 0;
    keys[0x11] = 0;
    keys[0x12] = 0x80;
    toascii("alt");
    keys[0x11] = 0x80;
    toascii("ctrl+alt");
    keys[0x11] = 0;
    keys[0x12] = 0;
    keys[0x14] = 1;
    toascii("caps");
    keys[0x10] = 0x80;
    toascii("caps+shift");
    keys[0x10] = 0;
    keys[0x14] = 0;

    altnum("65", 0);
    altnum("130", 0);
    altnum("0233", 0);
    altnum("66", 2);
    altnum("67", 1);
    altnum("300", 0);

    /* A key held: its down twice. */
    altWord = 0xaaaa;
    step("repeat alt down", 0x12, 0x38, TRUE, 0);
    step("repeat 6 down", 0x66, 0x4d, TRUE, 0);
    step("repeat 6 down again", 0x66, 0x4d, TRUE, 0);
    step("repeat 6 up", 0x66, 0x804d, TRUE, 0);
    step("repeat alt up", 0x12, 0x8038, FALSE, 0);

    /* Another key's up, and a letter while Alt is held. */
    altWord = 0x1234;
    step("letter up", 0x41, 0x801e, FALSE, 0);
    step("alt letter down", 0x41, 0x1e, TRUE, 0);
    keys[0x12] = 0;

    keyname(FALSE);
    keyname(TRUE);
    named("dontcare lshift", MAKELONG(0, 0x22a), 40);
    named("dontcare rshift", MAKELONG(0, 0x236), 40);
    named("dontcare ctrl", MAKELONG(0, 0x21d), 40);
    named("dontcare rctrl", MAKELONG(0, 0x31d), 40);
    named("dontcare alt", MAKELONG(0, 0x238), 40);
    named("dontcare ralt", MAKELONG(0, 0x338), 40);
    named("dontcare a", MAKELONG(0, 0x21e), 40);
    named("backspace 0", MAKELONG(0, 0x0e), 0);
    named("backspace 1", MAKELONG(0, 0x0e), 1);
    named("backspace 2", MAKELONG(0, 0x0e), 2);
    named("backspace 9", MAKELONG(0, 0x0e), 9);
    named("backspace 10", MAKELONG(0, 0x0e), 10);
    named("backspace 11", MAKELONG(0, 0x0e), 11);
    named("a 1", MAKELONG(0, 0x1e), 1);
    named("a 2", MAKELONG(0, 0x1e), 2);
    named("high word", MAKELONG(0xffff, 0x1e), 10);
    named("bits 26 on", MAKELONG(0, 0xfc1e), 10);

    for (group = 0; group < 4; group++) {
        for (i = 0; i < 64; i++) {
            wsprintf(all + i * 8, "%08lx", ((OEMSCANPROC)entry(128))(group * 64 + i));
        }

        wsprintf(probeArgs, "%02x", group * 64);
        probe("oemscan", probeArgs, all);
    }

    for (i = 0; i < 8; i++) {
        info[i] = 0xaa;
    }

    answer = ((INQUIREPROC)entry(1))(info);
    wsprintf(probeResult, "%d ", answer);
    hexOf(probeResult + lstrlen(probeResult), info, 8);
    probe("inquire", "", probeResult);

    for (i = 0; i < 4; i++) {
        wsprintf(probeArgs, "%d", i);
        wsprintf(probeResult, "%d", ((INTPROC)entry(130))(i));
        probe("type", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%d", ((INTPROC)entry(130))(0x100));
    probe("type", "100h", probeResult);
    ((VOIDPROC)entry(127))();

    for (i = 0; i < 3; i++) {
        wsprintf(probeArgs, "after NewTable %d", i);
        wsprintf(probeResult, "%d", ((INTPROC)entry(130))(i));
        probe("type", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%04x", (WORD)((INTPROC)entry(7))(-1));
    probe("speed", "-1", probeResult);
    wsprintf(probeResult, "%04x", (WORD)((INTPROC)entry(7))(0));
    probe("speed", "0", probeResult);

    wsprintf(probeResult, "%04x", (WORD)((INTPROC)entry(100))(0x100));
    probe("switch", "100h", probeResult);
    wsprintf(probeResult, "%04x", (WORD)((INTPROC)entry(100))(0));
    probe("switch", "0", probeResult);
    wsprintf(probeResult, "%04x", (WORD)((INTPROC)entry(100))(1));
    probe("switch", "1", probeResult);

    {
        static const int flags[] = {0, 1, 4, 2, 8, 5, 0xf0, 10};

        for (i = 0; i < sizeof(flags) / sizeof(flags[0]); i++) {
            wsprintf(probeArgs, "%d", flags[i]);
            wsprintf(probeResult, "%04x", (WORD)((INTPROC)entry(136))(flags[i]));
            probe("sysreq", probeArgs, probeResult);
        }
    }

    segment = ((VOIDPROC)entry(126))();
    wsprintf(probeResult, "%s", (LPSTR)(segment ? "set" : "null"));
    probe("tableseg", "GetTableSeg", probeResult);

    if (segment) {
        hexOf(all, (BYTE FAR *)MAKELP(segment, 0), 0x44);
        probe("tableseg", "00", all);
        hexOf(all, (BYTE FAR *)MAKELP(segment, 0x44), 0x44);
        probe("tableseg", "44", all);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
