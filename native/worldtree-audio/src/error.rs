use thiserror::Error;

#[derive(Error, Debug)]
pub enum AudioEngineError {
    #[error("Decoder initialization failed: {0}")]
    DecoderInit(String),

    #[error("Demuxer error: {0}")]
    Demux(String),

    #[error("Unsupported audio codec: {0}")]
    UnsupportedCodec(String),

    #[error("Resampler error: {0}")]
    Resampler(String),

    #[error("Opus encoder error with code: {0}")]
    OpusEncode(i32),

    #[error("Ring buffer overflow: backpressure high watermark exceeded")]
    BufferOverflow,

    #[error("Session not found: {0}")]
    SessionNotFound(u32),

    #[error("Panic intercepted across FFI boundary: {0}")]
    PanicIntercepted(String),
}

impl From<AudioEngineError> for napi::Error {
    fn from(err: AudioEngineError) -> Self {
        napi::Error::from_reason(err.to_string())
    }
}
