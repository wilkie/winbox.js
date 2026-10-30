/*
 * USER's ordinals 470 and 216, called by ordinal.
 *
 * * `stringfunc`: ordinal 470 with CX choosing the routine (`USER.EXE`
 *   seg11 `02e7`, its table at `02df`): 1 `AnsiNext`'s body, 2 `AnsiPrev`'s,
 *   3 `AnsiUpper`'s, 4 `AnsiLower`'s. What DX:AX answers, as an offset from
 *   the string where it is the string's selector, and the bytes of
 *   arguments it took off the stack; for 3 and 4 the string after.
 * * `seeuser`: ordinal 216 (`USER.EXE` seg41 `181e`) for each request: 1
 *   `LocalAlloc` in USER's heap, 2 `LocalFree` of what 1 gave, 3
 *   `LocalCompact`, 4 and 5 two of USER's words, and requests 0 and 6. As
 *   `nought` or `non-nought`, and -1 in full.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\STRFUNC.OUT"

typedef DWORD(FAR PASCAL *SEEUSER)(WORD, WORD, DWORD);

static FARPROC stringFunc;
static LPSTR first;
static LPSTR second;
static WORD selector;
static WORD routine;
static WORD answerAx;
static WORD answerDx;
static WORD before;
static WORD after;

/* One far pointer pushed, CX the routine. */
static void callOne(void)
{
    _asm {
        mov before, sp
        push word ptr first+2
        push word ptr first
        mov cx, routine
        call dword ptr stringFunc
        mov answerAx, ax
        mov answerDx, dx
        mov after, sp
        mov sp, before
    }
}

/* Two far pointers pushed, the first first, CX the routine. */
static void callTwo(void)
{
    _asm {
        mov before, sp
        push word ptr first+2
        push word ptr first
        push word ptr second+2
        push word ptr second
        mov cx, routine
        call dword ptr stringFunc
        mov answerAx, ax
        mov answerDx, dx
        mov after, sp
        mov sp, before
    }
}

static void report(LPCSTR what, LPSTR base)
{
    if (answerDx == HIWORD(base)) {
        wsprintf(probeResult, "+%d popped %u", (int)(answerAx - LOWORD(base)),
                 (UINT)(after - before + 0));
    } else {
        wsprintf(probeResult, "%04x:%04x popped %u", answerDx, answerAx,
                 (UINT)(after - before + 0));
    }

    probe("stringfunc", what, probeResult);
}

static void seeUser(SEEUSER call, WORD request, WORD word, DWORD value, LPCSTR what, DWORD FAR *out)
{
    DWORD answer = call(request, word, value);

    if (out) {
        *out = answer;
    }

    if (answer == 0xffffffffL) {
        lstrcpy(probeResult, "-1");
    } else {
        lstrcpy(probeResult, answer ? "non-nought" : "nought");
    }

    probe("seeuser", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char text[] = "Hello, World";
    static char upper[] = "Mixed Case";
    static char lower[] = "Mixed Case";
    HMODULE user;
    SEEUSER seeuser;
    DWORD handle;

    probeOpen(OUTPUT);

    user = GetModuleHandle("USER");
    stringFunc = GetProcAddress(user, MAKEINTRESOURCE(470));
    seeuser = (SEEUSER)GetProcAddress(user, MAKEINTRESOURCE(216));

    /* The stack's popped bytes are counted from the four of the far
     * return: what is left after is less what was pushed. */
    first = text;
    routine = 1;
    callOne();
    after = after - (before - 4);
    before = 0;
    report("1 next of start", text);

    first = text + 12;
    callOne();
    after = after - (before - 4);
    before = 0;
    report("1 next of end", text);

    first = text;
    second = text + 5;
    routine = 2;
    callTwo();
    after = after - (before - 8);
    before = 0;
    report("2 prev of +5", text);

    second = text;
    callTwo();
    after = after - (before - 8);
    before = 0;
    report("2 prev of start", text);

    first = upper;
    routine = 3;
    callOne();
    after = after - (before - 4);
    before = 0;
    report("3 upper", upper);
    probe("stringfunc", "3 upper text", upper);

    first = lower;
    routine = 4;
    callOne();
    after = after - (before - 4);
    before = 0;
    report("4 lower", lower);
    probe("stringfunc", "4 lower text", lower);

    first = (LPSTR)MAKELONG('q', 0);
    routine = 3;
    callOne();
    after = after - (before - 4);
    before = 0;
    wsprintf(probeResult, "%04x:%04x popped %u", answerDx, answerAx, after);
    probe("stringfunc", "3 upper of a character", probeResult);

    seeUser(seeuser, 1, LMEM_FIXED, 16, "1 alloc", &handle);
    seeUser(seeuser, 2, LOWORD(handle), 0, "2 free", NULL);
    seeUser(seeuser, 3, 0, 0, "3 compact", NULL);
    seeUser(seeuser, 4, 0, 0, "4 word", NULL);
    seeUser(seeuser, 5, 0, 0, "5 word", NULL);
    seeUser(seeuser, 0, 0, 0, "0", NULL);
    seeUser(seeuser, 6, 0, 0, "6", NULL);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    (void)selector;
    return 0;
}
