// Prints the floating-point-derived tables of dbopl.cpp's InitTables
// (WAVE_TABLEMUL), with dbopl's own expressions, as Rust constants.
#include <math.h>
#include <stdio.h>
#include <stdint.h>
#define PI 3.14159265358979323846
#define MUL_SH 16
int main() {
	printf("pub(crate) const SINE: [i16; 512] = [");
	for (int i = 0; i < 512; i++)
		printf("%s%d,", i % 16 ? " " : "\n    ", (int16_t)(sin((i + 0.5) * (PI / 512.0)) * 4084));
	printf("\n];\n\n");
	printf("pub(crate) const EXPONENTIAL: [i16; 256] = [");
	for (int i = 0; i < 256; i++)
		printf("%s%d,", i % 16 ? " " : "\n    ", (int16_t)(0.5 + (pow(2.0, -1.0 + (255 - i * 8) * (1.0 / 256))) * 4085));
	printf("\n];\n\n");
	printf("pub(crate) const MUL: [u16; 384] = [");
	for (int i = 0; i < 384; i++) {
		int s = i * 8;
		double val = (0.5 + (pow(2.0, -1.0 + (255 - s) * (1.0 / 256))) * (1 << MUL_SH));
		printf("%s%d,", i % 16 ? " " : "\n    ", (uint16_t)(val));
	}
	printf("\n];\n");
	return 0;
}
