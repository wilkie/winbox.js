/*
 * GetIconID, called by ordinal, on directories of icons and cursors made in
 * global memory, as a group resource's are: the identifier it answers, in
 * decimal.
 *
 * * `icon`: with RT_ICON as its type, an integer resource name, of entries `width x height x colours` each, its
 *   identifier after it.
 * * `cursor`: with RT_CURSOR, of entries `width x height`, the height as
 *   the directory has it, twice the cursor's.
 * * `header`: a directory whose reserved word or type is not as a group's.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ICONID.OUT"

typedef UINT(FAR PASCAL *IDPROC)(HANDLE, LPCSTR);

static HMODULE user;
static HGLOBAL memory;
static BYTE FAR *bytes;
static int at;
static int count;

static void word(WORD value)
{
    bytes[at++] = LOBYTE(value);
    bytes[at++] = HIBYTE(value);
}

static void begin(WORD reserved, WORD type)
{
    memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    bytes = (BYTE FAR *)GlobalLock(memory);
    at = 6;
    count = 0;
    bytes[0] = LOBYTE(reserved);
    bytes[1] = HIBYTE(reserved);
    bytes[2] = LOBYTE(type);
    bytes[3] = HIBYTE(type);
}

static void icon(BYTE width, BYTE height, BYTE colours, WORD id)
{
    bytes[at++] = width;
    bytes[at++] = height;
    bytes[at++] = colours;
    bytes[at++] = 0;
    word(1);
    word(4);
    word(0x2e8);
    word(0);
    word(id);
    count++;
}

static void cursor(WORD width, WORD height, WORD id)
{
    word(width);
    word(height);
    word(1);
    word(1);
    word(0x134);
    word(0);
    word(id);
    count++;
}

static void ask(LPCSTR function, LPCSTR what, UINT type)
{
    UINT id;

    bytes[4] = (BYTE)count;
    bytes[5] = 0;
    GlobalUnlock(memory);
    id = ((IDPROC)GetProcAddress(user, MAKEINTRESOURCE(455)))(memory, MAKEINTRESOURCE(type));
    wsprintf(probeResult, "%u", id);
    probe(function, what, probeResult);
    GlobalFree(memory);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    user = GetModuleHandle("USER");

    begin(0, 1);
    icon(32, 32, 2, 10);
    icon(32, 32, 16, 11);
    icon(32, 32, 8, 12);
    ask("icon", "32x32x2 10, 32x32x16 11, 32x32x8 12", 3);

    begin(0, 1);
    icon(32, 32, 2, 10);
    icon(32, 32, 8, 12);
    ask("icon", "32x32x2 10, 32x32x8 12", 3);

    begin(0, 1);
    icon(32, 32, 8, 12);
    icon(32, 32, 2, 10);
    ask("icon", "32x32x8 12, 32x32x2 10", 3);

    begin(0, 1);
    icon(16, 16, 16, 20);
    icon(64, 64, 2, 21);
    ask("icon", "16x16x16 20, 64x64x2 21", 3);

    begin(0, 1);
    icon(32, 32, 0, 30);
    icon(48, 48, 0, 31);
    ask("icon", "32x32x0 30, 48x48x0 31", 3);

    begin(0, 1);
    icon(32, 32, 200, 40);
    icon(16, 16, 2, 41);
    ask("icon", "32x32x200 40, 16x16x2 41", 3);

    begin(0, 1);
    icon(48, 48, 200, 42);
    icon(32, 32, 200, 43);
    ask("icon", "48x48x200 42, 32x32x200 43", 3);

    begin(0, 1);
    icon(64, 64, 16, 50);
    icon(32, 32, 200, 51);
    ask("icon", "64x64x16 50, 32x32x200 51", 3);

    begin(0, 1);
    icon(0, 0, 16, 52);
    icon(32, 32, 4, 53);
    ask("icon", "0x0x16 52, 32x32x4 53", 3);

    begin(0, 2);
    icon(32, 32, 2, 54);
    icon(32, 32, 16, 55);
    ask("icon", "type 2: 32x32x2 54, 32x32x16 55", 3);

    begin(0, 2);
    cursor(32, 64, 60);
    ask("cursor", "32x64 60", 1);

    begin(0, 2);
    cursor(16, 32, 70);
    cursor(32, 64, 71);
    ask("cursor", "16x32 70, 32x64 71", 1);

    begin(0, 2);
    cursor(16, 32, 80);
    cursor(32, 32, 81);
    ask("cursor", "16x32 80, 32x32 81", 1);

    begin(1, 1);
    icon(32, 32, 16, 90);
    ask("header", "reserved 1", 3);

    begin(0, 0);
    icon(32, 32, 16, 91);
    ask("header", "type 0", 3);

    begin(0, 3);
    icon(32, 32, 16, 92);
    ask("header", "type 3", 3);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
