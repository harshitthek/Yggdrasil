use rubato::{FftFixedIn, Resampler};
use crate::error::AudioEngineError;

/// SIMD-accelerated FFT sinc resampler.
pub struct AudioResampler {
    resampler: Option<FftFixedIn<f32>>,
    source_rate: u32,
    target_rate: u32,
}

impl AudioResampler {
    pub fn new(source_rate: u32, target_rate: u32) -> Result<Self, AudioEngineError> {
        if source_rate == target_rate {
            return Ok(Self {
                resampler: None,
                source_rate,
                target_rate,
            });
        }

        let resampler = FftFixedIn::<f32>::new(
            source_rate as usize,
            target_rate as usize,
            1024,
            2,
            2,
        )
        .map_err(|e| AudioEngineError::Resampler(e.to_string()))?;

        Ok(Self {
            resampler: Some(resampler),
            source_rate,
            target_rate,
        })
    }

    pub fn resample_channels(&mut self, channels: &[Vec<f32>]) -> Result<Vec<Vec<f32>>, AudioEngineError> {
        if let Some(ref mut res) = self.resampler {
            res.process(channels, None)
                .map_err(|e| AudioEngineError::Resampler(e.to_string()))
        } else {
            Ok(channels.to_vec())
        }
    }
}
