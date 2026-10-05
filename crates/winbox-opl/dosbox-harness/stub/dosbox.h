// Stub of DOSBox's dosbox.h/config.h for building dbopl.cpp and adlib glue
// outside DOSBox (64-bit Linux build: Bitu is 64 bits, as Ubuntu's dosbox).
#ifndef STUB_DOSBOX_H
#define STUB_DOSBOX_H
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef uint8_t Bit8u; typedef int8_t Bit8s;
typedef uint16_t Bit16u; typedef int16_t Bit16s;
typedef uint32_t Bit32u; typedef int32_t Bit32s;
typedef uint64_t Bit64u; typedef int64_t Bit64s;
typedef Bit64u Bitu; typedef Bit64s Bits;
#define INLINE inline __attribute__((always_inline))
#define DB_FASTCALL
#define GCC_ATTRIBUTE(x) __attribute__ ((x))
#define GCC_UNLIKELY(x) __builtin_expect((x),0)
#define LOG_MSG(...) do {} while (0)
#endif
