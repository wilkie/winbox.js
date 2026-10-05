// Drives DOSBox 0.74-3's dbopl.cpp, and the Adlib module's port and timer
// code from adlib.cpp (cut out into glue.inc by regenerate.sh), from a text
// command stream, writing every value produced as little-endian 32-bit
// integers to stdout. Built against DOSBox's GPL-2.0-or-later source, it is
// under the same terms. Nothing of DOSBox is kept in this directory.
//
// Commands, one per line (REG, VAL and PORT in hex):
//   r RATE            a new DBOPL::Handler, Init(RATE)
//   w REG VAL         Handler::WriteReg(REG, VAL)
//   a PORT VAL        Handler::WriteAddr(PORT, VAL); emits the result
//   g N               Handler::Generate(chan, N); emits the samples
//   t                 emits the chip's rate tables
//   m MODE RATE       a new Adlib::Module, MODE 0 opl2, 1 dualopl2, 2 opl3
//   p PORT VAL T      Module::PortWrite at PIC_FullIndex() T (milliseconds)
//   q PORT T          Module::PortRead at T; emits the value
//   mg N              the module's Handler::Generate(chan, N); emits the samples
#include <math.h>
#include <string>
#include <iostream>
#include <sstream>
#include "dbopl.h"

double stub_pic_full_index = 0;
Bit32u PIC_Ticks = 0;

namespace Adlib {
class Capture { public: bool DoWrite(Bit32u, Bit8u) { return true; } };
#include "glue.inc"
OPL_Mode Module::oplmode = OPL_none;
Module::Module(Section* s) : Module_base(s) {
	reg.dual[0] = 0; reg.dual[1] = 0; reg.normal = 0;
	handler = 0; capture = 0;
}
Module::~Module() {}
}

static std::vector<Bit32s> out;

int main() {
	DBOPL::Handler* h = 0;
	MixerChannel chan;
	Adlib::Module* mod = 0;
	std::string line;
	while (std::getline(std::cin, line)) {
		std::istringstream is(line);
		std::string c;
		if (!(is >> c) || c[0] == '#') continue;
		if (c == "r") {
			unsigned rate; is >> rate;
			delete h; h = new DBOPL::Handler(); h->Init(rate);
		} else if (c == "w") {
			unsigned reg, val; is >> std::hex >> reg >> val;
			h->WriteReg(reg, val);
		} else if (c == "a") {
			unsigned port, val; is >> std::hex >> port >> val;
			out.push_back(h->WriteAddr(port, val));
		} else if (c == "g") {
			unsigned n; is >> n;
			chan.out.clear();
			h->Generate(&chan, n);
			out.insert(out.end(), chan.out.begin(), chan.out.end());
		} else if (c == "t") {
			DBOPL::Chip& k = h->chip;
			out.push_back(k.lfoAdd); out.push_back(k.noiseAdd);
			for (int i = 0; i < 16; i++) out.push_back(k.freqMul[i]);
			for (int i = 0; i < 76; i++) out.push_back(k.linearRates[i]);
			for (int i = 0; i < 76; i++) out.push_back(k.attackRates[i]);
		} else if (c == "m") {
			unsigned m, rate; is >> m >> rate;
			Section sec;
			mod = new Adlib::Module(&sec);
			memset(mod->cache, 0, sizeof(mod->cache));
			mod->mixerChan = new MixerChannel();
			DBOPL::Handler* dh = new DBOPL::Handler();
			mod->handler = dh;
			if (rate < 8000) rate = 8000;
			dh->Init(rate);
			mod->Init(m == 0 ? Adlib::MODE_OPL2 : m == 1 ? Adlib::MODE_DUALOPL2 : Adlib::MODE_OPL3);
		} else if (c == "p") {
			unsigned port, val; double t; is >> std::hex >> port >> val >> std::dec >> t;
			stub_pic_full_index = t; PIC_Ticks = (Bit32u)floor(t);
			mod->PortWrite(port, val, 1);
		} else if (c == "q") {
			unsigned port; double t; is >> std::hex >> port >> std::dec >> t;
			stub_pic_full_index = t; PIC_Ticks = (Bit32u)floor(t);
			out.push_back(mod->PortRead(port, 1));
		} else if (c == "mg") {
			unsigned n; is >> n;
			mod->mixerChan->out.clear();
			mod->handler->Generate(mod->mixerChan, n);
			out.insert(out.end(), mod->mixerChan->out.begin(), mod->mixerChan->out.end());
		} else {
			fprintf(stderr, "bad command %s\n", line.c_str());
			return 1;
		}
	}
	fwrite(out.data(), sizeof(Bit32s), out.size(), stdout);
	return 0;
}
