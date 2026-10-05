//! The host's speakers: what the machine's sound card plays (`audio.rs` of
//! the engine) sounded through the host's default output device, by cpal.
//!
//! The card's waveform samples are unsigned bytes, one channel, at the
//! card's own rate -- 11,111 a second for a program's 11,025 -- and its FM
//! chip's are signed 16-bit, one channel, at 44,100 (`fm.rs` of the
//! engine); the host's device has its own rate and channels. Each is
//! resampled, linearly, as it comes, queued, and the two queues mixed --
//! added, as DOSBox's mixer adds its channels -- and played in every
//! channel as the device asks for them, so the host sounds the card half a
//! buffer or more late.
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

/// The samples waiting for the device, as it plays them: the waveform's
/// and the FM chip's, and whether the FM chip's is playing.
#[derive(Debug, Default)]
struct Queues {
    wave: VecDeque<f32>,
    fm: VecDeque<f32>,
    fm_playing: bool,
}

type Shared = Arc<Mutex<Queues>>;

/// Samples at one rate made samples at another, each between the two
/// around it, from one piece to the next.
#[derive(Debug, Default)]
struct Resampler {
    /// The last sample resampled from, and how far past it the next one
    /// out is, in the samples coming in.
    previous: f32,
    phase: f64,
}

impl Resampler {
    #[allow(clippy::cast_precision_loss)]
    fn run(&mut self, step: f64, samples: impl Iterator<Item = f32>) -> Vec<f32> {
        let source: Vec<f32> = std::iter::once(self.previous).chain(samples).collect();
        let last = (source.len() - 1) as f64;
        let mut at = self.phase;
        let mut out = Vec::with_capacity((last / step) as usize + 1);

        while at < last {
            let whole = at.floor();
            let part = (at - whole) as f32;
            let index = whole as usize;

            out.push(source[index] * (1.0 - part) + source[index + 1] * part);
            at += step;
        }

        self.phase = at - last;
        self.previous = source[source.len() - 1];
        out
    }
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
            Sound::Samples { rate, samples, .. } => {
                let out = self.wave.run(
                    rate / self.rate,
                    samples
                        .iter()
                        .map(|&byte| (f32::from(byte) - 128.0) / 128.0),
                );

                if let Ok(mut queues) = self.queues.lock() {
                    queues.wave.extend(out);
                }
            }
            Sound::Fm { rate, samples, .. } => {
                let out = self.fm.run(
                    rate / self.rate,
                    samples.iter().map(|&sample| f32::from(sample) / 32768.0),
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

/// The device's stream, playing what is queued, mixed, in every channel,
/// and silence when nothing is.
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
                    let wave = queues.wave.pop_front().unwrap_or(0.0);
                    let fm = if queues.fm_playing {
                        queues.fm.pop_front().unwrap_or(0.0)
                    } else {
                        0.0
                    };

                    if queues.fm.is_empty() {
                        queues.fm_playing = false;
                    }

                    let value = (wave + fm).clamp(-1.0, 1.0);

                    for sample in frame {
                        *sample = T::from_sample(value);
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
