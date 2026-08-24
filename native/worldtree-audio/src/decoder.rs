use symphonia::core::audio::{AudioBuffer, Signal};
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use std::io::Cursor;
use crate::error::AudioEngineError;

/// High-throughput in-memory audio decoder utilizing Symphonia.
pub struct ChunkDecoder {
    sample_rate: u32,
    channels: u32,
}

impl ChunkDecoder {
    pub fn new() -> Self {
        Self {
            sample_rate: 48000,
            channels: 2,
        }
    }

    /// Decodes an in-memory encoded chunk (MP3, AAC, FLAC, Vorbis) to planar f32 PCM channels.
    pub fn decode_chunk(&mut self, data: &[u8]) -> Result<Vec<f32>, AudioEngineError> {
        let cursor = Cursor::new(data.to_vec());
        let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

        let hint = Hint::new();
        let meta_opts: MetadataOptions = Default::default();
        let fmt_opts: FormatOptions = Default::default();

        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &fmt_opts, &meta_opts)
            .map_err(|e| AudioEngineError::Demux(e.to_string()))?;

        let mut format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| AudioEngineError::UnsupportedCodec("No audio track found".into()))?;

        let track_id = track.id;
        let dec_opts: DecoderOptions = Default::default();
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &dec_opts)
            .map_err(|e| AudioEngineError::DecoderInit(e.to_string()))?;

        let mut interleaved_pcm = Vec::new();

        while let Ok(packet) = format.next_packet() {
            if packet.track_id() != track_id {
                continue;
            }

            match decoder.decode(&packet) {
                Ok(decoded) => {
                    let mut sample_buf = AudioBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                    decoded.convert(&mut sample_buf);

                    let planes = sample_buf.planes();
                    let left = planes.planes()[0];
                    let right = if planes.planes().len() > 1 {
                        planes.planes()[1]
                    } else {
                        left
                    };

                    for i in 0..left.len() {
                        interleaved_pcm.push(left[i]);
                        interleaved_pcm.push(right[i]);
                    }
                }
                Err(SymphoniaError::IoError(_)) => break,
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(err) => return Err(AudioEngineError::DecoderInit(err.to_string())),
            }
        }

        Ok(interleaved_pcm)
    }
}
