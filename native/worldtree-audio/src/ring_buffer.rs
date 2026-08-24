use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::Arc;
use parking_lot::Mutex;

/// Lock-free Single-Producer Single-Consumer (SPSC) ring buffer holding pre-encoded Opus frames.
/// Holds 20ms frames (typically 200-400 bytes each).
pub struct OpusFrameQueue {
    producer: Mutex<Producer<Vec<u8>>>,
    consumer: Mutex<Consumer<Vec<u8>>>,
    capacity: usize,
}

impl OpusFrameQueue {
    pub fn new(capacity: usize) -> Self {
        let (producer, consumer) = RingBuffer::new(capacity);
        Self {
            producer: Mutex::new(producer),
            consumer: Mutex::new(consumer),
            capacity,
        }
    }

    pub fn push(&self, frame: Vec<u8>) -> Result<(), ()> {
        let mut prod = self.producer.lock();
        prod.push(frame).map_err(|_| ())
    }

    pub fn pop(&self) -> Option<Vec<u8>> {
        let mut cons = self.consumer.lock();
        cons.pop().ok()
    }

    pub fn len(&self) -> usize {
        let cons = self.consumer.lock();
        cons.slots()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn is_empty(&self) -> bool {
        let cons = self.consumer.lock();
        cons.is_empty()
    }
}
