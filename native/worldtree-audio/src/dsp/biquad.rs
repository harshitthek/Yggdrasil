use std::f32::consts::PI;

/// Direct Form II Transposed Biquad Filter.
/// Highly optimized for SIMD f32 calculation with zero state allocation per sample.
#[derive(Clone, Debug)]
pub struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    // Filter state for stereo channels
    s1_l: f32,
    s2_l: f32,
    s1_r: f32,
    s2_r: f32,
}

impl BiquadFilter {
    pub fn new_peaking_eq(sample_rate: f32, center_freq: f32, q: f32, gain_db: f32) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let omega = 2.0 * PI * center_freq / sample_rate;
        let alpha = omega.sin() / (2.0 * q);
        let cos_omega = omega.cos();

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_omega;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            s1_l: 0.0,
            s2_l: 0.0,
            s1_r: 0.0,
            s2_r: 0.0,
        }
    }

    pub fn new_low_shelf(sample_rate: f32, cutoff_freq: f32, q: f32, gain_db: f32) -> Self {
        let a = 10.0f32.powf(gain_db / 40.0);
        let omega = 2.0 * PI * cutoff_freq / sample_rate;
        let alpha = omega.sin() / (2.0 * q);
        let cos_omega = omega.cos();
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_omega);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_omega);
        let a2 = (a + 1.0) + (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            s1_l: 0.0,
            s2_l: 0.0,
            s1_r: 0.0,
            s2_r: 0.0,
        }
    }

    #[inline(always)]
    pub fn process_sample_left(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.s1_l;
        self.s1_l = self.b1 * input - self.a1 * output + self.s2_l;
        self.s2_l = self.b2 * input - self.a2 * output;
        output
    }

    #[inline(always)]
    pub fn process_sample_right(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.s1_r;
        self.s1_r = self.b1 * input - self.a1 * output + self.s2_r;
        self.s2_r = self.b2 * input - self.a2 * output;
        output
    }
}
