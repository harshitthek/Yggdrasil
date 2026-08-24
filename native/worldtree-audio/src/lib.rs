#![deny(clippy::all)]

pub mod decoder;
pub mod dsp;
pub mod encoder;
pub mod error;
pub mod resampler;
pub mod ring_buffer;
pub mod session;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use session::AudioSession;

static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);
lazy_static::lazy_static! {
    static ref SESSIONS: RwLock<HashMap<u32, Arc<AudioSession>>> = RwLock::new(HashMap::new());
}

#[napi]
pub fn is_native_available() -> bool {
    true
}

#[napi(object)]
pub struct BackpressureStatus {
    pub session_id: u32,
    pub queued_frames: u32,
    pub should_pause: bool,
    pub should_resume: bool,
}

#[napi]
pub fn create_session(bitrate_bps: Option<i32>) -> Result<u32> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
        let session = AudioSession::new(id, bitrate_bps.unwrap_or(96000))
            .map_err(|e| Error::from_reason(e.to_string()))?;
        SESSIONS.write().insert(id, Arc::new(session));
        Ok(id)
    }));

    match result {
        Ok(res) => res,
        Err(_) => Err(Error::from_reason("Panic caught during session creation")),
    }
}

#[napi]
pub fn push_chunk(session_id: u32, chunk: Uint8Array) -> Result<BackpressureStatus> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let session = {
            let sessions = SESSIONS.read();
            sessions.get(&session_id).cloned()
        };

        let session = match session {
            Some(s) => s,
            None => return Err(Error::from_reason(format!("Session {} not found", session_id))),
        };

        let queued = session.push_chunk(chunk.as_ref())
            .map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(BackpressureStatus {
            session_id,
            queued_frames: queued as u32,
            should_pause: session.is_high_watermark(),
            should_resume: session.is_low_watermark(),
        })
    }));

    match result {
        Ok(res) => res,
        Err(_) => Err(Error::from_reason("Panic caught during push_chunk")),
    }
}

#[napi]
pub fn pop_opus_frame(session_id: u32) -> Result<Option<Buffer>> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let session = {
            let sessions = SESSIONS.read();
            sessions.get(&session_id).cloned()
        };

        match session {
            Some(s) => Ok(s.pop_opus_frame().map(Buffer::from)),
            None => Ok(None),
        }
    }));

    match result {
        Ok(res) => res,
        Err(_) => Err(Error::from_reason("Panic caught during pop_opus_frame")),
    }
}

#[napi]
pub fn set_volume(session_id: u32, volume: f64) -> Result<()> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if let Some(session) = SESSIONS.read().get(&session_id) {
            session.set_volume(volume as f32);
        }
        Ok(())
    }));

    match result {
        Ok(res) => res,
        Err(_) => Err(Error::from_reason("Panic caught during set_volume")),
    }
}

#[napi]
pub fn set_filter(session_id: u32, filter_name: String, enabled: bool, value: Option<f64>) -> Result<()> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if let Some(session) = SESSIONS.read().get(&session_id) {
            match filter_name.as_str() {
                "bassboost" => session.set_bass_boost(enabled, value.unwrap_or(5.0) as f32),
                "8d" => session.set_8d(enabled),
                _ => {}
            }
        }
        Ok(())
    }));

    match result {
        Ok(res) => res,
        Err(_) => Err(Error::from_reason("Panic caught during set_filter")),
    }
}

#[napi]
pub fn destroy_session(session_id: u32) -> Result<()> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        SESSIONS.write().remove(&session_id);
        Ok(())
    }));

    match result {
        Ok(res) => res,
        Err(_) => Err(Error::from_reason("Panic caught during destroy_session")),
    }
}
