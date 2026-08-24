use std::f32::consts::PI;

/// 8D Audio Circular Panning Effect.
#[derive(Clone, Debug)]
pub struct EightDPanner {
    angle: f32,
    speed: f32,
    sample_rate: f32,
}

impl EightDPanner {
    pub fn new(sample_rate: f32, cycles_per_sec: f32) -> Self {
        Self {
            angle: 0.0,
            speed: 2.0 * PI * cycles_per_sec / sample_rate,
            sample_rate,
        }
    }

    #[inline(always)]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32) {
        let pan = (self.angle.sin() + 1.0) * 0.5; // 0.0 to 1.0
        let left_gain = (1.0 - pan).sqrt();
        let right_gain = pan.sqrt();

        self.angle += self.speed;
        if self.angle > 2.0 * PI {
            self.angle -= 2.0 * PI;
        }

        (left * left_gain, right * right_gain)
    }
}

/// Dynamic Soft Clipper to prevent digital distortion after Bass Boost.
#[inline(always)]
pub fn soft_clip(sample: f32) -> f32 {
    if sample > 1.0 {
        1.0 - (-sample).exp() * 0.1
    } else if sample < -1.0 {
        -1.0 + (sample).exp() * 0.1
    } else {
        sample
    }
}
