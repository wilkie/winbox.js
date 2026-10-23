/*
 * What the Program Manager probes (pmbare, pmraw, pmsyntax, pmfiles,
 * pmshell) share: Program Manager started and a DDEML conversation with it,
 * its execute strings and requests recorded as `progdde` records them, and
 * its files -- PROGMAN.INI as text, a group file in hexadecimal -- and its
 * windows, recorded whole.
 *
 * Include after probe.h, with PROBE_FLUSH defined and <ddeml.h> included.
 */

#ifndef PMPROBE_H
#define PMPROBE_H

static DWORD instance;
static HCONV conv;
static HSZ service;

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

static void settle(int times)
{
    MSG message;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE | PM_NOYIELD)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }

        Yield();
    }
}

static void ddeOpen(HINSTANCE module)
{
    wsprintf(probeResult, "%u",
             DdeInitialize(&instance, (PFNCALLBACK)MakeProcInstance((FARPROC)Callback, module),
                           APPCMD_CLIENTONLY, 0L));
    probe("DdeInitialize", "clientonly", probeResult);
    service = DdeCreateStringHandle(instance, "PROGMAN", CP_WINANSI);
}

/* Program Manager started, where `start` says, and a conversation with it. */
static void connect(BOOL start)
{
    int i;

    if (start) {
        wsprintf(probeResult, "%d", WinExec("PROGMAN.EXE", SW_SHOWNORMAL) > 32);
        probe("WinExec", "PROGMAN.EXE", probeResult);
    }

    for (i = 0; i < 400 && !conv; i++) {
        settle(1);

        if (FindWindow("Progman", NULL)) {
            conv = DdeConnect(instance, service, service, NULL);
        }
    }

    probe("DdeConnect", "PROGMAN,PROGMAN", conv ? "conv" : "0");
}

static void execute(LPCSTR command)
{
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;

    answer = DdeClientTransaction((LPBYTE)command, lstrlen(command) + 1, conv, 0, 0,
                                  XTYP_EXECUTE, 10000, &result);
    error = DdeGetLastError(instance);
    wsprintf(probeResult, "%d,%x,%x", answer != 0, error, LOWORD(result));
    probe("execute", command, probeResult);
}

/* An execute of bytes that are not all text: the string, its length. */
static void executeBytes(LPCSTR label, LPCSTR command, int length)
{
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;

    answer = DdeClientTransaction((LPBYTE)command, (DWORD)length, conv, 0, 0, XTYP_EXECUTE,
                                  10000, &result);
    error = DdeGetLastError(instance);
    wsprintf(probeResult, "%d,%x,%x", answer != 0, error, LOWORD(result));
    probe("execute", label, probeResult);
}

static void request(LPCSTR item)
{
    HSZ hsz = DdeCreateStringHandle(instance, item, CP_WINANSI);
    DWORD result = 0xAAAAAAAAL;
    HDDEDATA answer;
    UINT error;
    DWORD size;

    answer = DdeClientTransaction(NULL, 0, conv, hsz, CF_TEXT, XTYP_REQUEST, 10000, &result);
    error = DdeGetLastError(instance);

    if (answer) {
        size = DdeGetData(answer, NULL, 0, 0);
        lstrcpy(probeResult, "text:");
        DdeGetData(answer, (LPBYTE)probeResult + 5, sizeof(probeResult) - 16, 0);
        probeResult[sizeof(probeResult) - 16] = '\0';
        wsprintf(probeResult + lstrlen(probeResult), "/%lu", size);
        DdeFreeDataHandle(answer);
    } else {
        wsprintf(probeResult, "0,%x,%x", error, LOWORD(result));
    }

    probe("request", item, probeResult);
    DdeFreeStringHandle(instance, hsz);
}

static void disconnect(void)
{
    if (conv) {
        DdeDisconnect(conv);
        conv = 0;
    }
}

/* A file's bytes as text, or "none". */
static void text(LPCSTR label, LPCSTR path)
{
    OFSTRUCT of;
    HFILE file = OpenFile(path, &of, OF_READ);
    int got;

    if (file == HFILE_ERROR) {
        probe("text", label, "none");
        return;
    }

    got = _lread(file, probeResult, sizeof(probeResult) - 1);
    _lclose(file);
    probeResult[got < 0 ? 0 : got] = '\0';
    probe("text", label, probeResult);
}

/* A file's bytes in hexadecimal, 512 to a record, its size first. */
static void bytes(LPCSTR label, LPCSTR path)
{
    static BYTE chunk[512];
    OFSTRUCT of;
    HFILE file = OpenFile(path, &of, OF_READ);
    long size;
    long at = 0;
    int got;
    int j;

    if (file == HFILE_ERROR) {
        probe("bytes", label, "none");
        return;
    }

    size = _llseek(file, 0L, 2);
    _llseek(file, 0L, 0);
    wsprintf(probeResult, "%ld", size);
    probe("size", label, probeResult);

    while ((got = _lread(file, chunk, sizeof(chunk))) > 0) {
        probeResult[0] = '\0';

        for (j = 0; j < got; j++) {
            wsprintf(probeResult + 2 * j, "%02x", chunk[j]);
        }

        wsprintf(probeArgs, "%s@%lx", label, at);
        probe("bytes", probeArgs, probeResult);
        at += got;
    }

    _lclose(file);
}

static void removeFile(LPCSTR path)
{
    OFSTRUCT of;

    wsprintf(probeResult, "%d", OpenFile(path, &of, OF_DELETE) != HFILE_ERROR);
    probe("delete", path, probeResult);
}

static BOOL exists(LPCSTR path)
{
    OFSTRUCT of;

    return OpenFile(path, &of, OF_EXIST) != HFILE_ERROR;
}

/* Copies a file byte for byte, as an installer copies a group file. */
static void copyFile(LPCSTR from, LPCSTR to)
{
    static BYTE chunk[512];
    OFSTRUCT of;
    HFILE in = OpenFile(from, &of, OF_READ);
    HFILE out;
    long total = 0;
    int got;

    if (in == HFILE_ERROR) {
        probe("copy", to, "no source");
        return;
    }

    out = _lcreat(to, 0);

    while ((got = _lread(in, chunk, sizeof(chunk))) > 0) {
        _lwrite(out, chunk, got);
        total += got;
    }

    _lclose(in);
    _lclose(out);
    wsprintf(probeResult, "%ld", total);
    probe("copy", to, probeResult);
}

static void rectOf(LPSTR out, RECT FAR *rect)
{
    wsprintf(out + lstrlen(out), "%d,%d,%d,%d", rect->left, rect->top, rect->right, rect->bottom);
}

/* Program Manager's windows: its frame, its MDI client, and each group's
 * window with its place in the client, its state and its title. */
static void windows(LPCSTR label)
{
    HWND frame = FindWindow("Progman", NULL);
    HWND client;
    HWND child;
    RECT rect;
    POINT corner;
    char title[64];

    if (!frame) {
        probe("windows", label, "none");
        return;
    }

    GetWindowRect(frame, &rect);
    lstrcpy(probeResult, "frame:");
    rectOf(probeResult, &rect);
    wsprintf(probeResult + lstrlen(probeResult), ":%d%d%d", IsWindowVisible(frame) != 0,
             IsIconic(frame) != 0, IsZoomed(frame) != 0);
    client = GetWindow(frame, GW_CHILD);

    while (client) {
        GetClassName(client, title, sizeof(title));

        if (!lstrcmpi(title, "MDIClient")) {
            break;
        }

        client = GetWindow(client, GW_HWNDNEXT);
    }

    if (client) {
        GetClientRect(client, &rect);
        lstrcat(probeResult, ";client:");
        rectOf(probeResult, &rect);

        for (child = GetWindow(client, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
            if (GetWindow(child, GW_OWNER)) {
                continue;
            }

            GetWindowRect(child, &rect);
            corner.x = rect.left;
            corner.y = rect.top;
            ScreenToClient(client, &corner);
            rect.right += corner.x - rect.left;
            rect.bottom += corner.y - rect.top;
            rect.left = corner.x;
            rect.top = corner.y;
            GetWindowText(child, title, sizeof(title));
            wsprintf(probeResult + lstrlen(probeResult), ";%s:", (LPSTR)title);
            rectOf(probeResult, &rect);
            wsprintf(probeResult + lstrlen(probeResult), ":%d%d%d", IsWindowVisible(child) != 0,
                     IsIconic(child) != 0, IsZoomed(child) != 0);
        }
    }

    probe("windows", label, probeResult);
}

/* Waits for Program Manager's window to go. */
static void gone(void)
{
    int i;

    for (i = 0; i < 400 && FindWindow("Progman", NULL); i++) {
        settle(1);
    }

    settle(20);
    probe("FindWindow", "Progman", FindWindow("Progman", NULL) ? "running" : "gone");
}

#endif
