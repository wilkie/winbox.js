/*
 * Program Manager's execute strings at their edges: names with bytes of
 * 80h and above (which its parser counts as whitespace), names longer than
 * thirty characters, names with few or no letters and digits to make a
 * file's name of, and names whose first eight letters are another group's;
 * AddItem with six to nine arguments, empty, negative, a hot key and
 * minimized, and Caribbean Treasure's `,,,,,`; an empty quoted argument and
 * a quote inside an unquoted one; tabs and line ends between commands; a
 * missing `]` and text after the last; and what each group's text and
 * PROGMAN.INI say after.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <ddeml.h>
#include "pmprobe.h"

#pragma library("ddeml")

#define OUTPUT "C:\\ORACLE\\PMSYNTAX.OUT"

/* A file's size, or -1. */
static void size(LPCSTR path)
{
    OFSTRUCT of;
    HFILE file = OpenFile(path, &of, OF_READ);

    if (file == HFILE_ERROR) {
        probe("size", path, "-1");
        return;
    }

    wsprintf(probeResult, "%ld", _llseek(file, 0L, 2));
    _lclose(file);
    probe("size", path, probeResult);
}

int PASCAL WinMain(HINSTANCE module, HINSTANCE previous, LPSTR command, int show)
{
    (void)previous;
    (void)command;
    (void)show;
    probeOpen(OUTPUT);
    ddeOpen(module);
    connect(TRUE);

    if (!conv) {
        probeFinish();
        return 0;
    }

    /* Names: bytes of 80h and above, inside, at the end and at the start --
     * past the eighth letter, so that the file's name has none: DOSBox's DOS
     * refuses such a byte in a file's name (dos_files.cpp, DOS_MakeName),
     * where MS-DOS takes it. */
    execute("[CreateGroup(Spielesammlung f\xfcr)]");
    execute("[CreateGroup(Caf\xe9)]");
    execute("[CreateGroup(\xe9tGamesAbc \xe9t\xe9)]");
    execute("[CreateGroup(\"Quotedabc f\xfcr \xe9\")]");
    /* Longer than thirty, and the same thirty again. */
    execute("[CreateGroup(A Very Long Group Name That Goes On And On)]");
    execute("[CreateGroup(A Very Long Group Name That Goes Somewhere Else)]");
    /* Few letters and digits, and none. */
    execute("[CreateGroup(My-Group #2)]");
    execute("[CreateGroup(!!!)]");
    execute("[CreateGroup(\"...\")]");
    /* Eight letters the same. */
    execute("[CreateGroup(Collision One)]");
    execute("[CreateGroup(Collision Two)]");
    execute("[CreateGroup(Collision Three)]");
    execute("[CreateGroup(Collisio)]");
    text("names", "C:\\WINDOWS\\PROGMAN.INI");
    request("Groups");
    size("C:\\WINDOWS\\SPIELESA.GRP");
    size("C:\\WINDOWS\\CAF.GRP");
    size("C:\\WINDOWS\\TGAMESAB.GRP");
    size("C:\\WINDOWS\\QUOTEDAB.GRP");
    size("C:\\WINDOWS\\AVERYLON.GRP");
    size("C:\\WINDOWS\\AVERYLO0.GRP");
    size("C:\\WINDOWS\\MYGROUP2.GRP");
    size("C:\\WINDOWS\\.GRP");
    size("C:\\WINDOWS\\COLLISIO.GRP");
    size("C:\\WINDOWS\\COLLISI0.GRP");
    size("C:\\WINDOWS\\COLLISI1.GRP");
    size("C:\\WINDOWS\\COLLISI2.GRP");

    /* AddItem's arguments. */
    execute("[CreateGroup(Arguments)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Six,,,10,20)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Seven,,,30,40,C:\\TEMP)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Eight,,,50,60,C:\\TEMP,1603)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Nine,,,70,80,C:\\TEMP,1604,1)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Ten,,,70,80,C:\\TEMP,1604,1,x)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Empty xy,,,,,)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Caribb,,,,,,,)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Negative,,,-10,-20)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Big,,,32000,32000)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Index,,3)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Index neg,,-1)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Hot,,,,,,65)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Min,,,,,,,1)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Min two,,,,,,,2)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,\"\")]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Ca\"lc)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,\"Ca\"\"lc\")]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Item for the name of more than thirty letters long)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Ab\xe9)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE C:\\X.TXT)]");
    execute("[AddItem(calc)]");
    execute("[AddItem(C:\\NOWHERE\\PROG.EXE)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Dir,,,,,C:\\NOWHERE)]");
    request("Arguments");
    bytes("ARGUMENT.GRP", "C:\\WINDOWS\\ARGUMENT.GRP");

    /* Between and after commands. */
    execute("[CreateGroup(Spacing)]\t\r\n[AddItem(C:\\WINDOWS\\CALC.EXE,Tabbed)]\r\n");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Unclosed)");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Junk)]junk");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Junk2)]]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Bracket[)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Paren\\(x)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,\"Paren(x)\")]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,\"Quoted\" , \"Icon\")]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,\"Two\"\"Quotes\")]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE,Comma,)]");
    execute("[AddItem(C:\\WINDOWS\\CALC.EXE\xa0,Nbsp\xa0)]");
    execute("[ AddItem (C:\\WINDOWS\\CALC.EXE , Spaced ) ]");
    execute("[AddItem()]");
    execute("[AddItem]");
    execute("[]");
    execute("[(x)]");
    request("Spacing");
    text("end", "C:\\WINDOWS\\PROGMAN.INI");

    DdeDisconnect(conv);
    DdeFreeStringHandle(instance, service);
    DdeUninitialize(instance);
    probeFinish();
    return 0;
}
