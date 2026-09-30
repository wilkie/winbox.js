/*
 * What `GetObject` tells of a brush: FIBS/W reads a solid brush's colour
 * back out of its `LOGBRUSH` to set the background of its dialogs' text.
 *
 * * `object`: for each brush, `GetObject`'s answer with room for 8 bytes and
 *   for 4, and the bytes written, in hexadecimal, the buffer filled with
 *   EEh first. The brushes: solid of C0C0C0h, of 123456h (a colour the
 *   display dithers), of 808080h; a hatched one, `HS_CROSS` of 0000FFh; and
 *   the stock white, light grey and null brushes.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\BRUSHOBJ.OUT"

static const char HEX[] = "0123456789abcdef";

static void object(LPCSTR name, HBRUSH brush)
{
    BYTE bytes[16];
    int room;

    for (room = 8; room >= 4; room -= 4) {
        int count;
        int at;
        LPSTR out = probeResult;

        for (at = 0; at < 16; at++) {
            bytes[at] = 0xee;
        }

        count = GetObject(brush, room, bytes);
        out += wsprintf(out, "%d;", count);

        for (at = 0; at < 10; at++) {
            *out++ = HEX[bytes[at] >> 4];
            *out++ = HEX[bytes[at] & 15];
        }

        *out = '\0';
        wsprintf(probeArgs, "%s,%d", name, room);
        probe("object", probeArgs, probeResult);
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HBRUSH made[4];
    int i;

    probeOpen(OUTPUT);

    made[0] = CreateSolidBrush(RGB(0xc0, 0xc0, 0xc0));
    made[1] = CreateSolidBrush(RGB(0x56, 0x34, 0x12));
    made[2] = CreateSolidBrush(RGB(0x80, 0x80, 0x80));
    made[3] = CreateHatchBrush(HS_CROSS, RGB(0xff, 0, 0));

    object("solid c0c0c0", made[0]);
    object("solid 123456", made[1]);
    object("solid 808080", made[2]);
    object("hatch cross ff", made[3]);
    object("stock white", GetStockObject(WHITE_BRUSH));
    object("stock ltgray", GetStockObject(LTGRAY_BRUSH));
    object("stock null", GetStockObject(NULL_BRUSH));

    for (i = 0; i < 4; i++) {
        DeleteObject(made[i]);
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
