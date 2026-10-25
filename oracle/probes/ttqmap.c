/*
 * `ttquery` under `MM_LOMETRIC`: `GetFontData`, `GetKerningPairs`,
 * `GetCharABCWidths` and `GetOutlineTextMetrics` for Arial and Times New
 * Roman asked for by a height in tenths of a millimetre. GDI turns the
 * widths, the amounts and the outline metrics into the device context's
 * units.
 */

#define TTQUERY_MAPPED
#define OUTPUT "C:\\ORACLE\\TTQMAP.OUT"

#include "ttquery.c"
