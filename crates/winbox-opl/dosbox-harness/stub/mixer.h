#ifndef STUB_MIXER_H
#define STUB_MIXER_H
#include "dosbox.h"
#include <vector>
// Records what dbopl hands the mixer.
class MixerChannel {
public:
	bool enabled = false;
	std::vector<Bit32s> out;
	void Enable(bool y) { enabled = y; }
	void SetScale(float) {}
	void AddSamples_m32(Bitu len, const Bit32s* d) { out.insert(out.end(), d, d + len); }
	void AddSamples_s32(Bitu len, const Bit32s* d) { out.insert(out.end(), d, d + len * 2); }
	void AddSamples_m16(Bitu len, const Bit16s* d) { for (Bitu i = 0; i < len; i++) out.push_back(d[i]); }
	void AddSamples_s16(Bitu len, const Bit16s* d) { for (Bitu i = 0; i < len * 2; i++) out.push_back(d[i]); }
};
class MixerObject { public: MixerChannel* Install(void*, Bitu, const char*) { return new MixerChannel(); } };
#endif
