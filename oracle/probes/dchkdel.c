/*
 * DeleteDC and a device context's hook: GDI calls the hook with
 * `DCHC_DELETEDC` before it deletes the context, whether or not the hook's
 * flag is set, and keeps the context where the hook answers nought
 * (`GDI.EXE` seg1 `0844`-`0866`).
 *
 * A memory context is given a hook of the probe's that answers what
 * `refuse` says. For each case, `delete`: what `DeleteDC` answered, and
 * `hookcall`: how many times the hook was called, the last code, data and
 * parameter, and whether it was given the context deleted; `alive`: whether
 * the context still answers (`GetClipBox`) after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DCHKDEL.OUT"

typedef DWORD(FAR PASCAL *SETHOOKPROC)(HDC, FARPROC, DWORD);
typedef DWORD(FAR PASCAL *SETFLAGSPROC)(HDC, WORD);

static int hookCalls;
static WORD hookCode;
static DWORD hookData;
static DWORD hookParam;
static BOOL hookSameDC;
static HDC hookExpected;
static BOOL refuse;

BOOL FAR PASCAL _export HookProc(HDC hdc, WORD code, DWORD data, DWORD param)
{
    hookCalls++;
    hookCode = code;
    hookData = data;
    hookParam = param;
    hookSameDC = hdc == hookExpected;
    return refuse ? FALSE : TRUE;
}

static FARPROC gdiProc(int ordinal)
{
    return GetProcAddress(GetModuleHandle("GDI"), MAKEINTRESOURCE(ordinal));
}

static void report(LPCSTR what, HDC dc, BOOL answer)
{
    RECT box;

    wsprintf(probeResult, "%d", answer);
    probe("delete", what, probeResult);
    wsprintf(probeResult, "calls=%d code=%u data=%08lx param=%08lx samedc=%d", hookCalls,
             hookCode, hookData, hookParam, hookSameDC);
    probe("hookcall", what, probeResult);
    wsprintf(probeResult, "%d", GetClipBox(dc, &box));
    probe("alive", what, probeResult);
    hookCalls = 0;
    hookCode = 0;
    hookData = 0;
    hookParam = 0;
    hookSameDC = FALSE;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    SETHOOKPROC setDCHook;
    SETFLAGSPROC setHookFlags;
    FARPROC hook;
    HDC dc;

    probeOpen(OUTPUT);
    setDCHook = (SETHOOKPROC)gdiProc(190);
    setHookFlags = (SETFLAGSPROC)gdiProc(192);
    hook = MakeProcInstance((FARPROC)HookProc, instance);

    /* Refused: the context stays. */
    dc = CreateCompatibleDC(NULL);
    hookExpected = dc;
    setDCHook(dc, hook, 0xcafe1234L);
    refuse = TRUE;
    report("refused", dc, DeleteDC(dc));

    /* Then allowed. */
    refuse = FALSE;
    report("allowed", dc, DeleteDC(dc));

    /* The flag set first. */
    dc = CreateCompatibleDC(NULL);
    hookExpected = dc;
    setDCHook(dc, hook, 0x5678L);
    setHookFlags(dc, 1);
    report("flag set", dc, DeleteDC(dc));

    /* No hook. */
    dc = CreateCompatibleDC(NULL);
    report("no hook", dc, DeleteDC(dc));

    FreeProcInstance(hook);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
