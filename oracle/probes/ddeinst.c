/*
 * An installer's last step, as SETUP programs make it: a DDEML client that
 * starts Program Manager where it is not running, connects to "PROGMAN",
 * and sends it one execute string -- [CreateGroup], two [AddItem]s and
 * [ShowGroup] -- then asks for the group's text, disconnects and ends.
 *
 * As a probe it runs as Windows' shell, and starts PROGMAN.EXE; as a
 * program in a session it finds the Program Manager already running. Its
 * records are the connection, the execute's answer, `DdeGetLastError`'s
 * and the status in `pdwResult`'s low word, and the group's text.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\DDEINST.OUT"

static DWORD instance;
static HCONV conv;

HDDEDATA CALLBACK __export Callback(UINT type, UINT format, HCONV which, HSZ one, HSZ two,
                                    HDDEDATA data, DWORD first, DWORD second)
{
    (void)type;
    (void)format;
    (void)which;
    (void)one;
    (void)two;
    (void)data;
    (void)first;
    (void)second;
    return 0;
}

static void settle(void)
{
    MSG message;

    while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE | PM_NOYIELD)) {
        TranslateMessage(&message);
        DispatchMessage(&message);
    }

    Yield();
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    static const char script[] = "[CreateGroup(WinBox Games)]"
                                 "[AddItem(C:\\WINDOWS\\SOL.EXE,Solitaire)]"
                                 "[AddItem(C:\\WINDOWS\\WINMINE.EXE,Minesweeper)]"
                                 "[ShowGroup(WinBox Games,1)]";
    HSZ service;
    HSZ group;
    HDDEDATA answer;
    DWORD result = 0xAAAAAAAAL;
    UINT error;
    int i;

    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);

    wsprintf(probeResult, "%u",
             DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           APPCMD_CLIENTONLY, 0L));
    probe("DdeInitialize", "clientonly", probeResult);

    if (!FindWindow("Progman", NULL)) {
        WinExec("PROGMAN.EXE", SW_SHOWNORMAL);
    }

    service = DdeCreateStringHandle(instance, "PROGMAN", CP_WINANSI);

    for (i = 0; i < 400 && !conv; i++) {
        settle();

        if (FindWindow("Progman", NULL)) {
            conv = DdeConnect(instance, service, service, NULL);
        }
    }

    probe("DdeConnect", "PROGMAN,PROGMAN", conv ? "conv" : "0");

    if (conv) {
        answer = DdeClientTransaction((LPBYTE)script, sizeof(script), conv, 0, 0, XTYP_EXECUTE,
                                      10000, &result);
        error = DdeGetLastError(instance);
        wsprintf(probeResult, "%d,%x,%x", answer != 0, error, LOWORD(result));
        probe("execute", "CreateGroup,AddItem,AddItem,ShowGroup", probeResult);

        group = DdeCreateStringHandle(instance, "WinBox Games", CP_WINANSI);
        answer = DdeClientTransaction(NULL, 0, conv, group, CF_TEXT, XTYP_REQUEST, 10000, &result);

        if (answer) {
            lstrcpy(probeResult, "text:");
            DdeGetData(answer, (LPBYTE)probeResult + 5, sizeof(probeResult) - 6, 0);
            probeResult[sizeof(probeResult) - 1] = '\0';
            DdeFreeDataHandle(answer);
        } else {
            wsprintf(probeResult, "0,%x", DdeGetLastError(instance));
        }

        probe("request", "WinBox Games", probeResult);
        DdeFreeStringHandle(instance, group);
        wsprintf(probeResult, "%d", DdeDisconnect(conv));
        probe("DdeDisconnect", "PROGMAN", probeResult);
    }

    DdeFreeStringHandle(instance, service);
    wsprintf(probeResult, "%d", DdeUninitialize(instance));
    probe("DdeUninitialize", "", probeResult);
    probeFinish();
    return 0;
}
