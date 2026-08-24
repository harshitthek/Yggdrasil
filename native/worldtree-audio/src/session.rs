use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;

use crate::decoder::ChunkDecoder;
use crate::dsp::DspPipeline;
use crate::encoder::OpusEncoder;
use crate::error::AudioEngineError;
use crate::ring_buffer::OpusFrameQueue;

pub struct AudioSession {
    pub id: u32,
    decoder: Mutex<ChunkDecoder>,
    dsp: Mutex<DspPipeline>,
    encoder: Mutex<OpusEncoder>,
    frame_queue: Arc<OpusFrameQueue>,
    pcm_accumulator: Mutex<Vec<f32>>,
    frames_encoded: AtomicU64,
    paused: AtomicBool,
}

impl AudioSession {
    pub fn new(id: u32, bitrate_bps: i32) -> Result<Self, AudioEngineError> {
        let encoder = OpusEncoder::new(bitrate_bps)?;
        let frame_queue = Arc::new(OpusFrameQueue::new(500)); // 500 frames * 20ms = 10s max capacity

        Ok(Self {
            id,
            decoder: Mutex::new(ChunkDecoder::new()),
            dsp: Mutex::new(DspPipeline::new(48000)),
            encoder: Mutex::new(encoder),
            frame_queue,
            pcm_accumulator: Mutex::new(Vec::with_capacity(960 * 2 * 10)),
            frames_encoded: AtomicU64::new(0),
            paused: AtomicBool::new(false),
        })
    }

    pub fn push_chunk(&self, chunk: &[u8]) -> Result<usize, AudioEngineError> {
        let mut decoder = self.decoder.lock();
        let decoded_pcm = decoder.decode_chunk(chunk)?;

        let mut dsp = self.dsp.lock();
        let mut mutable_pcm = decoded_pcm;
        dsp.process_interleaved_frame(&mut mutable_pcm);

        let mut accum = self.pcm_accumulator.lock();
        accum.extend_from_slice(&mutable_pcm);

        let mut encoder = self.encoder.lock();
        let frame_samples = 960 * 2; // 20ms stereo

        while accum.len() >= frame_samples {
            let frame: Vec<f32> = accum.drain(..frame_samples).collect();
            if let Ok(opus_packet) = encoder.encode_frame(&frame) {
                let _ = self.frame_queue.push(opus_packet);
                self.frames_encoded.fetch_add(1, Ordering::Relaxed);
            }
        }

        Ok(self.frame_queue.len())
    }

    pub fn pop_opus_frame(&self) -> Option<Vec<u8>> {
        self.frame_queue.pop()
    }

    pub fn set_volume(&self, volume: f32) {
        let mut dsp = self.dsp.lock();
        dsp.set_volume(volume);
    }

    pub fn set_bass_boost(&self, enabled: bool, gain_db: f32) {
        let mut dsp = self.dsp.lock();
        dsp.set_bass_boost(enabled, gain_db);
    }

    pub fn set_8d(&self, enabled: bool) {
        let mut dsp = self.dsp.lock();
        dsp.set_8d(enabled);
    }

    pub fn queue_len(&self) -> usize {
        self.frame_queue.len()
    }

    pub fn is_high_watermark(&self) -> bool {
        self.frame_queue.len() >= 250 // 5 seconds buffered
    }

    pub fn is_low_watermark(&self) -> bool {
        self.frame_queue.len() <= 100 // 2 seconds buffered
    }
}
