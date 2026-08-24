pub mod biquad;
pub mod effects;

use biquad::BiquadFilter;
use effects::{EightDPanner, soft_clip};

pub struct DspPipeline {
    sample_rate: f32,
    volume: f32,
    bass_boost_filter: Option<BiquadFilter>,
    eq_filters: Vec<BiquadFilter>,
    eight_d_panner: Option<EightDPanner>,
}

impl DspPipeline {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate: sample_rate as f32,
            volume: 1.0,
            bass_boost_filter: None,
            eq_filters: Vec::new(),
            eight_d_panner: None,
        }
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.max(0.0).min(2.0);
    }

    pub fn set_bass_boost(&mut self, enabled: bool, gain_db: f32) {
        if enabled {
            self.bass_boost_filter = Some(BiquadFilter::new_low_shelf(self.sample_rate, 120.0, 0.707, gain_db));
        } else {
            self.bass_boost_filter = None;
        }
    }

    pub fn set_8d(&mut self, enabled: bool) {
        if enabled {
            self.eight_d_panner = Some(EightDPanner::new(self.sample_rate, 0.15));
        } else {
            self.eight_d_panner = None;
        }
    }

    #[inline(always)]
    pub fn process_interleaved_frame(&mut self, pcm: &mut [f32]) {
        for chunk in pcm.chunks_exact_mut(2) {
            let mut left = chunk[0] * self.volume;
            let mut right = chunk[1] * self.volume;

            if let Some(ref mut bb) = self.bass_boost_filter {
                left = bb.process_sample_left(left);
                right = bb.process_sample_right(right);
            }

            for eq in &mut self.eq_filters {
                left = eq.process_sample_left(left);
                right = eq.process_sample_right(right);
            }

            if let Some(ref mut panner) = self.eight_d_panner {
                let (pan_l, pan_r) = panner.process_sample(left, right);
                left = pan_l;
                right = pan_r;
            }

            chunk[0] = soft_clip(left);
            chunk[1] = soft_clip(right);
        }
    }
}
