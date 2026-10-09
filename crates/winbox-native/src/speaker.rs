//! The host's speakers: what the machine's sound card plays (`audio.rs` of
//! the engine) sounded through the host's default output device, by cpal.
//!
//! The card's waveform samples are eight-bit unsigned or sixteen-bit
//! signed, one channel or two, at the card's own rate -- 11,111 a second
//! for a program's 11,025 on the Sound Blaster's card, the program's own
//! on WinBox's -- and its FM chip's are signed 16-bit, one channel, at
//! 44,100 (`fm.rs` of the engine); the host's device has its own rate and
//! channels. Each is made pairs of left and right, one channel heard in
//! both; resampled, linearly, as it comes; queued; and the two queues
//! mixed -- added, as DOSBox's mixer adds its channels -- and played as
//! the device asks for them, the left in its first channel, the right in
//! its second and the two together in any other, or in its only one; so
//! the host sounds the card half a buffer or more late.
//!
//! The FM chip's sound comes a few milliseconds at a time, as the machine
//! makes it: its queue is let fill to `PRIMED` before it is played after
//! running dry, so that the device does not catch it up and break it into
//! pieces; and it is kept under `MOST`, the oldest let go, where the
//! machine runs ahead of the device's clock.
//!
//! MIDI to the card's port is not played: there is nothing here to play it
//! on. What the synthesizer is sent is heard through the FM chip.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use winbox_win16::audio::Sound;

/// How much of the FM chip's sound is queued before it is played after
/// running dry, and the most kept, in seconds.
const PRIMED: f64 = 0.05;
const MOST: f64 = 0.5;

/// A sample of each side, left and right, from -1 to just under 1.
type Frame = [f32; 2];

/// The samples waiting for the device, as it plays them: the waveform's
/// and the FM chip's, and whether the FM chip's is playing.
#[derive(Debug, Default)]
struct Queues {
    wave: VecDeque<Frame>,
    fm: VecDeque<Frame>,
    fm_playing: bool,
}

type Shared = Arc<Mutex<Queues>>;

/// Samples at one rate made samples at another, each between the two
/// around it, from one piece to the next.
#[derive(Debug, Default)]
struct Resampler {
    /// The last sample resampled from, and how far past it the next one
    /// out is, in the samples coming in.
    previous: Frame,
    phase: f64,
}

impl Resampler {
    #[allow(clippy::cast_precision_loss)]
    fn run(&mut self, step: f64, samples: impl Iterator<Item = Frame>) -> Vec<Frame> {
        let source: Vec<Frame> = std::iter::once(self.previous).chain(samples).collect();
        let last = (source.len() - 1) as f64;
        let mut at = self.phase;
        let mut out = Vec::with_capacity((last / step) as usize + 1);

        while at < last {
            let whole = at.floor();
            let part = (at - whole) as f32;
            let index = whole as usize;
            let (from, to) = (source[index], source[index + 1]);

            out.push([
                from[0] * (1.0 - part) + to[0] * part,
                from[1] * (1.0 - part) + to[1] * part,
            ]);
            at += step;
        }

        self.phase = at - last;
        self.previous = source[source.len() - 1];
        out
    }
}

/// The card's waveform bytes as pairs of left and right: eight-bit samples
/// unsigned, sixteen-bit signed and least significant byte first, a
/// sample of each channel in turn; one channel heard in both.
fn frames(bytes: &[u8], channels: u16, bits: u16) -> Vec<Frame> {
    let size = if bits == 16 { 2 } else { 1 };
    let channels = usize::from(channels.clamp(1, 2));
    let sample = |at: &[u8]| {
        if size == 2 {
            f32::from(i16::from_le_bytes([at[0], at[1]])) / 32768.0
        } else {
            (f32::from(at[0]) - 128.0) / 128.0
        }
    };

    bytes
        .chunks_exact(size * channels)
        .map(|frame| {
            let left = sample(frame);

            if channels == 2 {
                [left, sample(&frame[size..])]
            } else {
                [left, left]
            }
        })
        .collect()
}

/// The host's output, if it has one, and where the card's samples are
/// between one piece and the next.
pub struct Speaker {
    stream: Option<cpal::Stream>,
    queues: Shared,
    /// The device's rate.
    rate: f64,
    wave: Resampler,
    fm: Resampler,
}

impl Speaker {
    /// The host's default output opened; a speaker that sounds nothing
    /// where there is none.
    pub fn open() -> Self {
        let queues: Shared = Arc::default();
        let mut speaker = Self {
            stream: None,
            queues: Arc::clone(&queues),
            rate: 44_100.0,
            wave: Resampler::default(),
            fm: Resampler::default(),
        };
        let Some(device) = cpal::default_host().default_output_device() else {
            eprintln!("no sound: the host has no output device");
            return speaker;
        };
        let Ok(config) = device.default_output_config() else {
            eprintln!("no sound: the host's output device has no configuration");
            return speaker;
        };
        let format = config.sample_format();
        let config: cpal::StreamConfig = config.into();

        speaker.rate = f64::from(config.sample_rate);

        let primed = (PRIMED * speaker.rate) as usize;
        let stream = match format {
            cpal::SampleFormat::I16 => build::<i16>(&device, &config, queues, primed),
            cpal::SampleFormat::U16 => build::<u16>(&device, &config, queues, primed),
            cpal::SampleFormat::I32 => build::<i32>(&device, &config, queues, primed),
            _ => build::<f32>(&device, &config, queues, primed),
        };

        match stream {
            Some(stream) => speaker.stream = Some(stream),
            None => eprintln!("no sound: the host's output device did not open"),
        }

        speaker
    }

    /// What the card did, sounded.
    pub fn play(&mut self, sound: &Sound) {
        if self.stream.is_none() {
            return;
        }

        match sound {
            Sound::Samples {
                rate,
                channels,
                bits,
                samples,
                ..
            } => {
                let out = self.wave.run(
                    rate / self.rate,
                    frames(samples, *channels, *bits).into_iter(),
                );

                if let Ok(mut queues) = self.queues.lock() {
                    queues.wave.extend(out);
                }
            }
            Sound::Fm { rate, samples, .. } => {
                let out = self.fm.run(
                    rate / self.rate,
                    samples.iter().map(|&sample| {
                        let value = f32::from(sample) / 32768.0;

                        [value, value]
                    }),
                );
                let most = (MOST * self.rate) as usize;

                if let Ok(mut queues) = self.queues.lock() {
                    queues.fm.extend(out);

                    let over = queues.fm.len().saturating_sub(most);

                    queues.fm.drain(..over);
                }
            }
            Sound::Midi { .. } | Sound::Silence { .. } => {}
        }
    }
}

/// The device's stream, playing what is queued, mixed -- the left in its
/// first channel, the right in its second, the two together in any other
/// or in its only one -- and silence when nothing is.
fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queues: Shared,
    primed: usize,
) -> Option<cpal::Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels).max(1);
    let stream = device
        .build_output_stream(
            *config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let Ok(mut queues) = queues.lock() else {
                    return;
                };

                if !queues.fm_playing && queues.fm.len() >= primed {
                    queues.fm_playing = true;
                }

                for frame in data.chunks_mut(channels) {
                    let wave = queues.wave.pop_front().unwrap_or_default();
                    let fm = if queues.fm_playing {
                        queues.fm.pop_front().unwrap_or_default()
                    } else {
                        [0.0; 2]
                    };

                    if queues.fm.is_empty() {
                        queues.fm_playing = false;
                    }

                    let left = (wave[0] + fm[0]).clamp(-1.0, 1.0);
                    let right = (wave[1] + fm[1]).clamp(-1.0, 1.0);
                    let both = f32::midpoint(left, right);

                    if channels == 1 {
                        frame[0] = T::from_sample(both);
                        continue;
                    }

                    for (index, sample) in frame.iter_mut().enumerate() {
                        *sample = T::from_sample(match index {
                            0 => left,
                            1 => right,
                            _ => both,
                        });
                    }
                }
            },
            |error| eprintln!("sound: {error}"),
            None,
        )
        .ok()?;

    stream.play().ok()?;
    Some(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixteen_bit_stereo_is_left_then_right() {
        let bytes = [0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x00, 0x80];

        assert_eq!(
            frames(&bytes, 2, 16),
            [[0.5, -0.5], [32767.0 / 32768.0, -1.0]]
        );
    }

    #[test]
    fn eight_bit_mono_is_heard_on_both_sides() {
        assert_eq!(
            frames(&[0x80, 0xc0, 0x40], 1, 8),
            [[0.0; 2], [0.5; 2], [-0.5; 2]]
        );
        // Eight-bit stereo, and a sample of only one channel left over.
        assert_eq!(frames(&[0xc0, 0x40, 0x80], 2, 8), [[0.5, -0.5]]);
    }

    #[test]
    fn a_rate_is_resampled_to_the_devices_from_piece_to_piece() {
        let mut resampler = Resampler::default();
        let piece = || std::iter::repeat_n([0.25, -0.25], 441);
        let mut out = Vec::new();

        for _ in 0..100 {
            out.extend(resampler.run(44_100.0 / 48_000.0, piece()));
        }

        // A second's 44,100 made 48,000, give or take one: the first
        // piece begins from the silence before it.
        assert!((47_999..=48_001).contains(&out.len()), "{}", out.len());
        assert!(
            out[10..]
                .iter()
                .all(|frame| (frame[0] - 0.25).abs() < 1e-6 && (frame[1] + 0.25).abs() < 1e-6)
        );
    }
}
