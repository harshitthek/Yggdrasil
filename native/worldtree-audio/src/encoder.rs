use crate::error::AudioEngineError;

/// High-performance Opus audio encoder wrapper.
/// Targets 48,000 Hz, stereo, 20ms frames (960 samples per channel).
pub struct OpusEncoder {
    encoder: *mut audiopus_sys::OpusEncoder,
    frame_size: usize,
    output_buffer: Vec<u8>,
}

unsafe impl Send for OpusEncoder {}
unsafe impl Sync for OpusEncoder {}

impl OpusEncoder {
    pub fn new(bitrate_bps: i32) -> Result<Self, AudioEngineError> {
        let mut error = 0;
        let encoder = unsafe {
            audiopus_sys::opus_encoder_create(
                48000,
                2,
                audiopus_sys::OPUS_APPLICATION_AUDIO as i32,
                &mut error,
            )
        };

        if error != audiopus_sys::OPUS_OK as i32 || encoder.is_null() {
            return Err(AudioEngineError::OpusEncode(error));
        }

        unsafe {
            audiopus_sys::opus_encoder_ctl(
                encoder,
                audiopus_sys::OPUS_SET_BITRATE_REQUEST as i32,
                bitrate_bps,
            );
            audiopus_sys::opus_encoder_ctl(
                encoder,
                audiopus_sys::OPUS_SET_SIGNAL_REQUEST as i32,
                audiopus_sys::OPUS_SIGNAL_MUSIC as i32,
            );
        }

        Ok(Self {
            encoder,
            frame_size: 960, // 20ms at 48kHz
            output_buffer: vec![0u8; 4000],
        })
    }

    pub fn encode_frame(&mut self, pcm_f32: &[f32]) -> Result<Vec<u8>, AudioEngineError> {
        if pcm_f32.len() < self.frame_size * 2 {
            return Err(AudioEngineError::OpusEncode(-1));
        }

        let encoded_len = unsafe {
            audiopus_sys::opus_encode_float(
                self.encoder,
                pcm_f32.as_ptr(),
                self.frame_size as i32,
                self.output_buffer.as_mut_ptr(),
                self.output_buffer.len() as i32,
            )
        };

        if encoded_len < 0 {
            return Err(AudioEngineError::OpusEncode(encoded_len));
        }

        Ok(self.output_buffer[..encoded_len as usize].to_vec())
    }
}

impl Drop for OpusEncoder {
    fn drop(&mut self) {
        if !self.encoder.is_null() {
            unsafe {
                audiopus_sys::opus_encoder_destroy(self.encoder);
            }
        }
    }
}
