/*
 * The program `pmitem.c`'s group items name: the recorder puts it in
 * C:\WINDOWS as PMITEMC.EXE. Started by Program Manager, it adds a line to
 * C:\ORACLE\PMITEM.TXT with its command line, its current directory, the
 * show command it was given and its module's file, and ends.
 */

#include <windows.h>
#include <direct.h>

#define LOG "C:\\ORACLE\\PMITEM.TXT"

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char line[300];
    char directory[80];
    char path[80];
    HFILE file;

    directory[0] = '\0';
    getcwd(directory, sizeof(directory));
    GetModuleFileName(instance, path, sizeof(path));
    wsprintf(line, "args=%s|cwd=%s|show=%d|path=%s\r\n", command, (LPSTR)directory, show,
             (LPSTR)path);
    file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);

    (void)previous;
    return 0;
}
