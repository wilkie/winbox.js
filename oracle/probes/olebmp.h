/*
 * A bitmap file as Paintbrush's `Native` is one: `BITMAPFILEHEADER`, a
 * `BITMAPINFOHEADER` of 8 by 4 pixels at four bits, 3780 pixels to a metre,
 * sixteen colours, and its bits -- each pixel `seed` plus its place, so
 * two made with different seeds differ. `OLEBMP_SIZE` bytes, written to
 * `out`. For `olepbd`, whose objects are of the class `PBrush`.
 */

#ifndef OLEBMP_H
#define OLEBMP_H

#define OLEBMP_SIZE 134

static void putWord(BYTE far *at, WORD value)
{
    at[0] = (BYTE)value;
    at[1] = (BYTE)(value >> 8);
}

static void putDword(BYTE far *at, DWORD value)
{
    putWord(at, (WORD)value);
    putWord(at + 2, (WORD)(value >> 16));
}

static void oleBmp(BYTE far *out, int seed)
{
    int i;

    for (i = 0; i < OLEBMP_SIZE; i++) {
        out[i] = 0;
    }

    /* BITMAPFILEHEADER: "BM", its size, its bits' offset. */
    out[0] = 'B';
    out[1] = 'M';
    putDword(out + 2, OLEBMP_SIZE);
    putDword(out + 10, 118);

    /* BITMAPINFOHEADER. */
    putDword(out + 14, 40);
    putDword(out + 18, 8);
    putDword(out + 22, 4);
    putWord(out + 26, 1);
    putWord(out + 28, 4);
    putDword(out + 34, 16);
    putDword(out + 38, 3780);
    putDword(out + 42, 3780);

    /* Sixteen colours: grey steps. */
    for (i = 0; i < 16; i++) {
        out[54 + i * 4] = (BYTE)(i * 17);
        out[54 + i * 4 + 1] = (BYTE)(i * 17);
        out[54 + i * 4 + 2] = (BYTE)(i * 17);
    }

    for (i = 0; i < 16; i++) {
        out[118 + i] = (BYTE)(((seed + i) & 15) << 4 | ((seed + i + 1) & 15));
    }
}

#endif
