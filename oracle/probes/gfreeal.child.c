/*
 * The program `gfreeal.c` starts: it makes two blocks of its own, frees
 * every block its task owns with GlobalFreeAll, and writes to the probe's
 * file what was left of them, and the answer, before it ends.
 */

#include <windows.h>

typedef WORD(FAR PASCAL *FreeAll)(WORD);

static void record(LPCSTR args, LPCSTR result)
{
    char line[80];
    HFILE file = _lopen("C:\\ORACLE\\GFREEAL.OUT", OF_WRITE);
    int length;

    if (file == HFILE_ERROR) {
        return;
    }

    _llseek(file, 0L, 2);
    length = wsprintf(line, "child\t%s\t%s\r\n", args, result);
    _lwrite(file, line, length);
    _lclose(file);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HGLOBAL moveable = GlobalAlloc(GMEM_MOVEABLE, 64);
    HGLOBAL fixed = GlobalAlloc(GMEM_FIXED, 64);
    HGLOBAL shared = GlobalAlloc(GMEM_MOVEABLE | GMEM_SHARE, 64);
    FreeAll freeAll =
        (FreeAll)GetProcAddress(GetModuleHandle("KERNEL"), MAKEINTRESOURCE(26));
    char text[64];
    WORD answer;

    wsprintf(text, "%lx,%lx,%lx", GlobalSize(moveable), GlobalSize(fixed), GlobalSize(shared));
    record("before", text);

    answer = freeAll(0);

    wsprintf(text, "%lx,%lx,%lx", GlobalSize(moveable), GlobalSize(fixed), GlobalSize(shared));
    record("after", text);
    wsprintf(text, "%x", answer);
    record("answer", text);

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
