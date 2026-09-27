/*
 * The serial and parallel ports through USER's comm functions, as Terminal
 * uses them. Under DOSBox COM1 and COM2 are ports with nothing connected.
 * COM3 and COM4 are not opened: DOSBox has no port there, and opening one
 * never returns.
 *
 * * `open`: OpenComm's answer for a name and queue sizes; a port opened is
 *   closed again at once, and CloseComm's answer follows after a `/`.
 * * `state`: a port's DCB just opened, and after SetCommState, in hex.
 * * `build`: BuildCommDCB's answer and the DCB after it, in hex; the DCB is
 *   filled with AAh first, so the bytes it leaves alone show.
 * * `set`: SetCommState's answer for a changed field.
 * * `io`: WriteComm, ReadComm, TransmitCommChar and UngetCommChar answers.
 * * `error`: GetCommError's answer and the COMSTAT after it, in hex.
 * * `event`: SetCommEventMask and GetCommEventMask.
 * * `escape`: EscapeCommFunction's answer for each code.
 * * `flush`, `break`, `notify`, `close`: those calls' answers.
 * * `lines`: on COM2, output with nothing holding it; then, with one handshake timeout or flow flag set at a time,
 *   what WriteComm answers and GetCommError finds: which modem lines a port
 *   with nothing connected shows.
 * * `closed`: each call on an id not open.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\COMMS.OUT"

/* Each record is closed into the file, so a port that hangs Windows leaves
 * the records before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static char hex[256];

static LPSTR bytes(const void FAR *what, int count)
{
    const BYTE FAR *at = (const BYTE FAR *)what;
    int i;

    for (i = 0; i < count; i++) {
        wsprintf(hex + i * 2, "%02x", at[i]);
    }

    hex[count * 2] = '\0';

    return hex;
}

/* Lets a second go by, for the ports' interrupts to do their work. */
static void wait(DWORD ms)
{
    DWORD start = GetTickCount();
    MSG msg;

    while (GetTickCount() - start < ms) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        }
    }
}

static void openOne(LPCSTR name, UINT in, UINT out)
{
    int id = OpenComm((LPSTR)name, in, out);

    wsprintf(probeArgs, "%s,%u,%u", name, in, out);

    if (id >= 0) {
        wsprintf(probeResult, "%d/%d", id, CloseComm(id));
    } else {
        wsprintf(probeResult, "%d", id);
    }

    probe("open", probeArgs, probeResult);
}

static void build(LPCSTR text)
{
    DCB dcb;
    int answer;

    _fmemset(&dcb, 0xaa, sizeof(dcb));
    answer = BuildCommDCB(text, &dcb);
    wsprintf(probeResult, "%d:", answer);
    lstrcat(probeResult, bytes(&dcb, sizeof(dcb)));
    probe("build", text, probeResult);
}

static void error(int id, LPCSTR what)
{
    COMSTAT stat;
    int answer;

    _fmemset(&stat, 0xaa, sizeof(stat));
    answer = GetCommError(id, &stat);
    wsprintf(probeResult, "%d:", answer);
    lstrcat(probeResult, bytes(&stat, sizeof(stat)));
    probe("error", what, probeResult);
}

static void set(int id, DCB FAR *base, LPCSTR what, int offset, int size, UINT value)
{
    DCB dcb;
    DCB after;
    int answer;

    dcb = *base;

    if (size == 1) {
        ((BYTE FAR *)&dcb)[offset] = (BYTE)value;
    } else {
        *(UINT FAR *)((BYTE FAR *)&dcb + offset) = value;
    }

    answer = SetCommState(&dcb);
    GetCommState(id, &after);
    wsprintf(probeResult, "%d:", answer);
    lstrcat(probeResult, bytes(&after, sizeof(after)));
    probe("set", what, probeResult);
    SetCommState(base);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static const char FAR *names[] = {
        "COM1", "com1", "COM1:", "COM1 ", "COM1:9600", "COM2", "COM5", "COM9",
        "COM10", "COM0", "COM", "AUX", "LPT1", "lpt1:", "LPT2", "LPT3", "LPT4", "PRN", "XYZ", ""
    };
    static const char FAR *texts[] = {
        "COM1:9600,n,8,1", "COM1:9600,N,8,1,x", "COM1:9600,n,8,1,p", "COM2:1200,e,7,2",
        "COM1:96,n,8,1", "COM1:19200,o,7,1.5", "COM1:110,m,5,1", "COM1:300,s,6,2",
        "COM1: 9600, n, 8, 1", "COM1:9600", "COM1:9600,n", "COM1:9600,n,8", "COM1",
        "COM1:", "COM3:2400,n,8,1", "LPT1:9600,n,8,1", "COM1:12345,n,8,1",
        "COM1:9600,q,8,1", "COM1:9600,n,9,1", "COM1:9600,n,8,3", "9600,n,8,1",
        "com1:9600,n,8,1", "COM1=9600,n,8,1", "COM1:14400,n,8,1", "COM1:57600,n,8,1"
    };
    DCB dcb;
    DCB state;
    UINT FAR *event;
    WNDCLASS kind;
    HWND window;
    int id;
    int lpt;
    int answer;
    int i;
    char buffer[32];

    probeOpen(OUTPUT);

    for (i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        openOne(names[i], 1024, 128);
    }

    openOne("COM1", 0, 0);
    openOne("COM1", 1, 1);
    openOne("COM1", 65535u, 65535u);
    openOne("COM1", 32768u, 32768u);

    id = OpenComm("COM1", 1024, 128);
    wsprintf(probeResult, "%d", id);
    probe("open", "first", probeResult);
    wsprintf(probeResult, "%d", OpenComm("COM1", 1024, 128));
    probe("open", "again", probeResult);

    _fmemset(&state, 0xaa, sizeof(state));
    wsprintf(probeResult, "%d:", GetCommState(id, &state));
    lstrcat(probeResult, bytes(&state, sizeof(state)));
    probe("state", "COM1 opened", probeResult);

    for (i = 0; i < sizeof(texts) / sizeof(texts[0]); i++) {
        build(texts[i]);
    }

    /* Each field changed on its own, from the state just opened. */
    set(id, &state, "baud 1200", 1, 2, 1200);
    set(id, &state, "baud 110", 1, 2, 110);
    set(id, &state, "baud 0", 1, 2, 0);
    set(id, &state, "baud 1", 1, 2, 1);
    set(id, &state, "baud 12345", 1, 2, 12345);
    set(id, &state, "baud 57600", 1, 2, 57600u);
    set(id, &state, "baud CBR_9600", 1, 2, 0xff12);
    set(id, &state, "baud CBR_256000", 1, 2, 0xff27);
    set(id, &state, "baud ff00", 1, 2, 0xff00);
    set(id, &state, "bytes 4", 3, 1, 4);
    set(id, &state, "bytes 5", 3, 1, 5);
    set(id, &state, "bytes 7", 3, 1, 7);
    set(id, &state, "bytes 9", 3, 1, 9);
    set(id, &state, "parity 2", 4, 1, 2);
    set(id, &state, "parity 4", 4, 1, 4);
    set(id, &state, "parity 5", 4, 1, 5);
    set(id, &state, "stop 1", 5, 1, 1);
    set(id, &state, "stop 2", 5, 1, 2);
    set(id, &state, "stop 3", 5, 1, 3);
    set(id, &state, "id 9", 0, 1, 9);
    set(id, &state, "id 1", 0, 1, 1);
    set(id, &state, "flags ffff", 12, 2, 0xffff);
    set(id, &state, "xon 0", 14, 1, 0);

    error(id, "opened");
    answer = WriteComm(id, "hello", 5);
    wsprintf(probeResult, "%d", answer);
    probe("io", "write 5", probeResult);
    error(id, "written");
    wait(1000);
    error(id, "written, a second on");
    answer = ReadComm(id, buffer, sizeof(buffer));
    wsprintf(probeResult, "%d", answer);
    probe("io", "read", probeResult);
    error(id, "read");

    wsprintf(probeResult, "%d", TransmitCommChar(id, 'x'));
    probe("io", "transmit", probeResult);
    wsprintf(probeResult, "%d", TransmitCommChar(id, 'y'));
    probe("io", "transmit again", probeResult);
    error(id, "transmitted");
    wait(500);
    error(id, "transmitted, half a second on");

    wsprintf(probeResult, "%d", UngetCommChar(id, 'u'));
    probe("io", "unget", probeResult);
    wsprintf(probeResult, "%d", UngetCommChar(id, 'v'));
    probe("io", "unget again", probeResult);
    error(id, "ungot");
    buffer[0] = buffer[1] = 0;
    answer = ReadComm(id, buffer, sizeof(buffer));
    wsprintf(probeResult, "%d:%02x%02x", answer, (BYTE)buffer[0], (BYTE)buffer[1]);
    probe("io", "read ungot", probeResult);
    wsprintf(probeResult, "%d", ReadComm(id, buffer, 0));
    probe("io", "read 0", probeResult);
    wsprintf(probeResult, "%d", WriteComm(id, buffer, 0));
    probe("io", "write 0", probeResult);

    /* More than the queue of 128 holds, with nothing taking it. */
    {
        static char big[400];

        _fmemset(big, 'z', sizeof(big));
        wsprintf(probeResult, "%d", WriteComm(id, big, sizeof(big)));
        probe("io", "write 400", probeResult);
        error(id, "written 400");
        wsprintf(probeResult, "%d", WriteComm(id, big, sizeof(big)));
        probe("io", "write 400 again", probeResult);
        error(id, "written 400 again");
    }

    event = SetCommEventMask(id, EV_RXCHAR | EV_TXEMPTY | EV_CTS | EV_DSR);
    wsprintf(probeResult, "%s,%04x", (LPSTR)(event ? "pointer" : "null"), event ? *event : 0);
    probe("event", "set", probeResult);
    wsprintf(probeResult, "%04x", GetCommEventMask(id, 0xffff));
    probe("event", "get all", probeResult);
    wsprintf(probeResult, "%04x", GetCommEventMask(id, 0xffff));
    probe("event", "get again", probeResult);
    wsprintf(probeResult, "%04x", event ? *event : 0);
    probe("event", "word after", probeResult);

    for (i = 0; i <= 11; i++) {
        wsprintf(probeArgs, "%d", i);
        wsprintf(probeResult, "%ld", EscapeCommFunction(id, i));
        probe("escape", probeArgs, probeResult);
    }

    wsprintf(probeResult, "%ld", EscapeCommFunction(id, 0x7f));
    probe("escape", "127", probeResult);
    error(id, "escaped");

    wsprintf(probeResult, "%d", SetCommBreak(id));
    probe("break", "set", probeResult);
    error(id, "break set");
    wsprintf(probeResult, "%d", ClearCommBreak(id));
    probe("break", "clear", probeResult);

    for (i = 0; i <= 2; i++) {
        wsprintf(probeArgs, "%d", i);
        wsprintf(probeResult, "%d", FlushComm(id, i));
        probe("flush", probeArgs, probeResult);
    }

    error(id, "flushed");

    kind.style = 0;
    kind.lpfnWndProc = DefWindowProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = NULL;
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "Comm";
    RegisterClass(&kind);
    window = CreateWindow("Comm", "A", WS_OVERLAPPEDWINDOW, 0, 0, 100, 60, NULL, NULL, instance,
                          NULL);
    wsprintf(probeResult, "%d", EnableCommNotification(id, window, 10, 10));
    probe("notify", "window", probeResult);
    wsprintf(probeResult, "%d", EnableCommNotification(id, window, -1, -1));
    probe("notify", "window, no thresholds", probeResult);
    wsprintf(probeResult, "%d", EnableCommNotification(id, NULL, 10, 10));
    probe("notify", "none", probeResult);
    wsprintf(probeResult, "%d", EnableCommNotification(9, window, 10, 10));
    probe("notify", "id 9", probeResult);
    DestroyWindow(window);

    wsprintf(probeResult, "%d", CloseComm(id));
    probe("close", "open", probeResult);
    wsprintf(probeResult, "%d", CloseComm(id));
    probe("close", "again", probeResult);
    wsprintf(probeResult, "%d", CloseComm(99));
    probe("close", "99", probeResult);
    wsprintf(probeResult, "%d", CloseComm(-1));
    probe("close", "-1", probeResult);

    /* Every call on the id just closed, and on COM2's, never opened. */
    for (i = 0; i < 2; i++) {
        int none = i ? 1 : id;

        wsprintf(probeArgs, "%s ", (LPSTR)(i ? "never" : "closed"));
        lstrcat(probeArgs, "write");
        wsprintf(probeResult, "%d", WriteComm(none, "a", 1));
        probe("closed", probeArgs, probeResult);
        wsprintf(probeArgs, "%s read", (LPSTR)(i ? "never" : "closed"));
        wsprintf(probeResult, "%d", ReadComm(none, buffer, 1));
        probe("closed", probeArgs, probeResult);
        wsprintf(probeArgs, "%s error", (LPSTR)(i ? "never" : "closed"));
        wsprintf(probeResult, "%d", GetCommError(none, NULL));
        probe("closed", probeArgs, probeResult);
        wsprintf(probeArgs, "%s state", (LPSTR)(i ? "never" : "closed"));
        wsprintf(probeResult, "%d", GetCommState(none, &dcb));
        probe("closed", probeArgs, probeResult);
        wsprintf(probeArgs, "%s escape", (LPSTR)(i ? "never" : "closed"));
        wsprintf(probeResult, "%ld", EscapeCommFunction(none, SETDTR));
        probe("closed", probeArgs, probeResult);
        wsprintf(probeArgs, "%s flush", (LPSTR)(i ? "never" : "closed"));
        wsprintf(probeResult, "%d", FlushComm(none, 0));
        probe("closed", probeArgs, probeResult);
        wsprintf(probeArgs, "%s transmit", (LPSTR)(i ? "never" : "closed"));
        wsprintf(probeResult, "%d", TransmitCommChar(none, 'a'));
        probe("closed", probeArgs, probeResult);
        wsprintf(probeArgs, "%s event", (LPSTR)(i ? "never" : "closed"));
        wsprintf(probeResult, "%s", (LPSTR)(SetCommEventMask(none, 1) ? "pointer" : "null"));
        probe("closed", probeArgs, probeResult);
    }

    /* Which lines a port with nothing connected shows: a write waits on a
     * line with a timeout while it is low, and a flow flag holds output. */
    {
        static const struct {
            LPCSTR what;
            int offset;
            UINT value;
        } lines[] = {
            { "rls timeout", 6, 50 },
            { "cts timeout", 8, 50 },
            { "dsr timeout", 10, 50 },
            { "cts flow", 12, 0x09 },
            { "dsr flow", 12, 0x11 },
            { "both flow", 12, 0x19 },
        };
        int two = OpenComm("COM2", 256, 256);

        wsprintf(probeResult, "%d", two);
        probe("lines", "open", probeResult);
        GetCommState(two, &state);

        /* Output with nothing holding it: whether it leaves. At 110 baud, a
         * character a tenth of a second or so, what is left just after the
         * write does not hang on how soon it is asked. */
        dcb = state;
        dcb.BaudRate = 110;
        wsprintf(probeResult, "%d", SetCommState(&dcb));
        probe("lines", "drain at 110", probeResult);
        event = SetCommEventMask(two, EV_TXEMPTY);
        wsprintf(probeResult, "%d", WriteComm(two, "hello", 5));
        probe("lines", "drain write", probeResult);
        error(two, "drain written");
        wait(1000);
        error(two, "drain, a second on");
        wsprintf(probeResult, "%04x", GetCommEventMask(two, 0xffff));
        probe("lines", "drain events", probeResult);
        wsprintf(probeResult, "%d", TransmitCommChar(two, 'x'));
        probe("lines", "drain transmit", probeResult);
        wait(500);
        error(two, "drain transmitted, half a second on");
        SetCommState(&state);

        for (i = 0; i < sizeof(lines) / sizeof(lines[0]); i++) {
            dcb = state;

            if (lines[i].offset == 12) {
                ((BYTE FAR *)&dcb)[12] = (BYTE)lines[i].value;
            } else {
                *(UINT FAR *)((BYTE FAR *)&dcb + lines[i].offset) = lines[i].value;
            }

            answer = SetCommState(&dcb);
            wsprintf(probeResult, "%d", answer);
            wsprintf(probeArgs, "%s set", lines[i].what);
            probe("lines", probeArgs, probeResult);
            wsprintf(probeArgs, "%s write", lines[i].what);
            wsprintf(probeResult, "%d", WriteComm(two, "a", 1));
            probe("lines", probeArgs, probeResult);
            wsprintf(probeArgs, "%s", lines[i].what);
            error(two, probeArgs);
            FlushComm(two, 0);
            SetCommState(&state);
        }

        wsprintf(probeResult, "%d", CloseComm(two));
        probe("lines", "close", probeResult);
    }

    /* A parallel port last, as a write may wait on a printer that is not there. */
    lpt = OpenComm("LPT1", 0, 0);
    wsprintf(probeResult, "%d", lpt);
    probe("lpt", "open", probeResult);

    if (lpt >= 0) {
        /* Only the Id: the rest of a parallel port's DCB is what was left on
         * USER's stack when it was opened. */
        _fmemset(&state, 0xaa, sizeof(state));
        wsprintf(probeResult, "%d:", GetCommState(lpt, &state));
        lstrcat(probeResult, bytes(&state, 1));
        probe("lpt", "state", probeResult);
        error(lpt, "LPT1 opened");
        wsprintf(probeResult, "%ld", EscapeCommFunction(lpt, GETMAXLPT));
        probe("lpt", "escape GETMAXLPT", probeResult);
        wsprintf(probeResult, "%d", WriteComm(lpt, "hello", 5));
        probe("lpt", "write 5", probeResult);
        error(lpt, "LPT1 written");
        wsprintf(probeResult, "%d", CloseComm(lpt));
        probe("lpt", "close", probeResult);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
