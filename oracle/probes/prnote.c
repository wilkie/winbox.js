/*
 * Notepad prints a short text through the PostScript driver: `notepad /p`,
 * which prints the file to the default printer and ends. The default
 * printer is the Apple LaserWriter Plus with `pscript`, its port a file,
 * Print Manager's spooler off. Two lines have tabs, one of them at its
 * end, which Notepad draws with `TabbedTextOut`. Recorded on the installation with a
 * printer, `vgaprint`; the run puts the driver and Notepad on the drive.
 *
 * * `started`: whether `WinExec` started Notepad.
 * * `ended`: whether Notepad had ended within the probe's wait.
 * * `size`: the file's size once Notepad is done.
 * * `line`: each line the driver wrote, as it wrote it.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PRNOTE.OUT"
#define TEXT "C:\\ORACLE\\NOTE.TXT"
#define PRINTED "C:\\ORACLE\\PRNOTE.PRN"

static char chunk[2048];
static char line[512];

/* Each line of the file, a carriage return before its line feed left off,
 * and no more than 300 of its bytes. */
static void lines(void)
{
    OFSTRUCT info;
    HFILE file = OpenFile(PRINTED, &info, OF_READ);
    long size;
    int read;
    int at;
    int length = 0;
    int count = 0;

    if (file == HFILE_ERROR) {
        probe("size", "document", "none");
        return;
    }

    size = _llseek(file, 0, 2);
    _llseek(file, 0, 0);
    wsprintf(probeResult, "%ld", size);
    probe("size", "document", probeResult);

    while ((read = _lread(file, chunk, sizeof(chunk))) > 0) {
        for (at = 0; at < read; at++) {
            if (chunk[at] == '\n') {
                if (length > 0 && line[length - 1] == '\r') {
                    length--;
                }

                line[length] = '\0';
                wsprintf(probeArgs, "%d", count++);
                probe("line", probeArgs, line);
                length = 0;
            } else if (length < 300) {
                line[length++] = chunk[at];
            }
        }
    }

    if (length > 0) {
        line[length] = '\0';
        wsprintf(probeArgs, "%d", count++);
        probe("line", probeArgs, line);
    }

    _lclose(file);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char text[] =
        "A short note,\r\nprinted by Notepad.\r\n\r\nThe third line.\r\n"
        "\tTabbed\tacross\t\tthe page.\r\nA tab at the end\t\r\n";
    OFSTRUCT info;
    HFILE file;
    MSG message;
    long rounds;
    UINT started;

    probeOpen(OUTPUT);
    WriteProfileString("windows", "spooler", "no");
    WriteProfileString("windows", "device", "Apple LaserWriter Plus,pscript," PRINTED);
    WriteProfileString("devices", "Apple LaserWriter Plus", "pscript," PRINTED);
    OpenFile(PRINTED, &info, OF_DELETE);

    file = _lcreat(TEXT, 0);
    _lwrite(file, text, sizeof(text) - 1);
    _lclose(file);

    started = WinExec("NOTEPAD.EXE /p " TEXT, SW_SHOWNORMAL);
    probe("started", "notepad", started >= 32 ? "1" : "0");

    for (rounds = 0; rounds < 20000 && GetModuleHandle("NOTEPAD"); rounds++) {
        while (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message);
            DispatchMessage(&message);
        }

        Yield();
    }

    probe("ended", "notepad", GetModuleHandle("NOTEPAD") ? "0" : "1");
    lines();

    WriteProfileString("windows", "device", "Apple LaserWriter Plus,pscript,LPT1:");
    WriteProfileString("devices", "Apple LaserWriter Plus", "pscript,LPT1:");
    WriteProfileString("windows", "spooler", "yes");
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
