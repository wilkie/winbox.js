//! The host's speakers: what the machine's sound card plays (`audio.rs` of
//! the engine) sounded through the host's default output device, by cpal.
//!
//! The card's samples are unsigned bytes, one channel, at the card's own
//! rate -- 11,111 a second for a program's 11,025 -- and the host's device
//! has its own rate and channels: each half of the card's buffer is
//! resampled, linearly, as it comes, and played in every channel. They
//! are queued as they come and played as the device asks for them, so a
//! half arrives a little before it is heard. A halt drops what is queued.
//!
//! MIDI is not played yet: there is no synthesizer here to play it on.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use winbox_win16::audio::Sound;

/// The samples waiting for the device, as it plays them.
type Queue = Arc<Mutex<VecDeque<f32>>>;

/// The host's output, if it has one, and where the card's samples are
/// between one half and the next.
pub struct Speaker {
    stream: Option<cpal::Stream>,
    queue: Queue,
    /// The device's rate.
    rate: f64,
    /// The last sample resampled from, and how far past it the next one
    /// out is, in the card's samples.
    previous: f32,
    phase: f64,
}

impl Speaker {
    /// The host's default output opened; a speaker that sounds nothing
    /// where there is none.
    pub fn open() -> Self {
        let queue: Queue = Arc::new(Mutex::new(VecDeque::new()));
        let mut speaker = Self {
            stream: None,
            queue: Arc::clone(&queue),
            rate: 44_100.0,
            previous: 0.0,
            phase: 0.0,
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

        let stream = match format {
            cpal::SampleFormat::I16 => build::<i16>(&device, &config, queue),
            cpal::SampleFormat::U16 => build::<u16>(&device, &config, queue),
            cpal::SampleFormat::I32 => build::<i32>(&device, &config, queue),
            _ => build::<f32>(&device, &config, queue),
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
            Sound::Samples { rate, samples, .. } => self.queue_samples(*rate, samples),
            Sound::Halt { .. } => {
                if let Ok(mut queue) = self.queue.lock() {
                    queue.clear();
                }

                self.phase = 0.0;
            }
            Sound::Midi { .. } | Sound::Silence { .. } => {}
        }
    }

    /// The card's bytes at its rate made the device's samples at its own,
    /// each between the two around it.
    #[allow(clippy::cast_precision_loss)]
    fn queue_samples(&mut self, rate: f64, samples: &[u8]) {
        let step = rate / self.rate;
        let source: Vec<f32> = std::iter::once(self.previous)
            .chain(
                samples
                    .iter()
                    .map(|&byte| (f32::from(byte) - 128.0) / 128.0),
            )
            .collect();
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

        if let Ok(mut queue) = self.queue.lock() {
            queue.extend(out);
        }
    }
}

/// The device's stream, playing what is queued in every channel, and
/// silence when nothing is.
fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Queue,
) -> Option<cpal::Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels).max(1);
    let stream = device
        .build_output_stream(
            *config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let mut queue = queue.lock().ok();

                for frame in data.chunks_mut(channels) {
                    let value = queue
                        .as_mut()
                        .and_then(|queue| queue.pop_front())
                        .unwrap_or(0.0);

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
