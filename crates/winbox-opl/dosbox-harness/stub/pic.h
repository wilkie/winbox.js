#ifndef STUB_PIC_H
#define STUB_PIC_H
#include "dosbox.h"
extern double stub_pic_full_index;
extern Bit32u PIC_Ticks;
static inline double PIC_FullIndex(void) { return stub_pic_full_index; }
#endif
