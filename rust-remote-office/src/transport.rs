use crate::protocol::{ClientMessage, InputEvent};
use anyhow::{Result, ensure};
use iroh::endpoint::QuicTransportConfig;
use std::{
    sync::{
        Arc,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Semaphore, mpsc, watch};

pub const CONTROL_PRIORITY: i32 = 10;
pub const SCREEN_PRIORITY: i32 = -10;

pub fn quic_config() -> QuicTransportConfig {
    // iroh already supplies keepalives. Make the office profile explicit and bounded.
    QuicTransportConfig::builder()
        .keep_alive_interval(Duration::from_secs(5))
        .max_idle_timeout(Some(
            Duration::from_secs(20).try_into().expect("valid timeout"),
        ))
        .send_window(2 * 1024 * 1024)
        .stream_receive_window((2u32 * 1024 * 1024).into())
        .receive_window((4u32 * 1024 * 1024).into())
        .max_concurrent_bidi_streams(8u32.into())
        .max_concurrent_uni_streams(2u32.into())
        .build()
}

pub struct FramePacer {
    pub credit: Arc<Semaphore>,
    minimum_ms: AtomicU64,
    interval_ms: AtomicU64,
    rate: AtomicU32,
}

impl FramePacer {
    pub fn new(minimum: Duration) -> Self {
        let minimum_ms = minimum.as_millis().clamp(16, 2000) as u64;
        Self {
            credit: Arc::new(Semaphore::new(1)),
            minimum_ms: AtomicU64::new(minimum_ms),
            interval_ms: AtomicU64::new(minimum_ms),
            rate: AtomicU32::new((1000 / minimum_ms) as u32),
        }
    }

    pub fn interval(&self) -> Duration {
        Duration::from_millis(self.interval_ms.load(Ordering::Relaxed))
    }

    pub fn set_rate(&self, frames_per_second: u32) {
        let interval = 1000u64.div_ceil(u64::from(frames_per_second));
        self.minimum_ms.store(interval, Ordering::Relaxed);
        self.interval_ms.store(interval, Ordering::Relaxed);
        self.rate.store(frames_per_second, Ordering::Relaxed);
    }

    pub fn rate(&self) -> u32 {
        self.rate.load(Ordering::Relaxed)
    }

    pub fn delivered(&self, elapsed: Duration) {
        let minimum_ms = self.minimum_ms.load(Ordering::Relaxed);
        let target = (elapsed.as_millis().min(2000) as u64).max(minimum_ms);
        let current = self.interval_ms.load(Ordering::Relaxed);
        // Back off immediately; recover gradually without exceeding the requested update rate.
        let next = if target > current {
            target
        } else {
            (current * 7 + target) / 8
        };
        self.interval_ms
            .store(next.max(minimum_ms), Ordering::Relaxed);
    }
}

pub struct FrameAcks {
    sent: AtomicU64,
    acknowledged: watch::Sender<u64>,
}

impl FrameAcks {
    pub fn new() -> (Self, watch::Receiver<u64>) {
        let (acknowledged, receiver) = watch::channel(0);
        (
            Self {
                sent: AtomicU64::new(0),
                acknowledged,
            },
            receiver,
        )
    }

    pub fn sending(&self, sequence: u64) -> Result<()> {
        ensure!(
            sequence == self.sent.load(Ordering::Acquire) + 1,
            "Nonsequential outgoing frame"
        );
        self.sent.store(sequence, Ordering::Release);
        Ok(())
    }

    pub fn acknowledge(&self, sequence: u64) -> Result<()> {
        ensure!(
            sequence > 0 && sequence <= self.sent.load(Ordering::Acquire),
            "Unexpected frame acknowledgement"
        );
        self.acknowledged.send_if_modified(|previous| {
            if sequence > *previous {
                *previous = sequence;
                true
            } else {
                false
            }
        });
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct NetworkSnapshot {
    pub rtt_ms: Option<f64>,
    pub screen_kib_per_second: f64,
    pub updates_per_second: f64,
    pub received_frames: u64,
    pub received_screen_bytes: u64,
    pub processing_ms: f64,
}

#[derive(Default)]
pub struct ReceiveMetrics {
    frames: AtomicU64,
    bytes: AtomicU64,
    processing_us: AtomicU64,
}

impl ReceiveMetrics {
    pub fn received(&self, bytes: usize, processing: Duration) {
        self.bytes.fetch_add(bytes as u64, Ordering::Relaxed);
        self.processing_us.store(
            processing.as_micros().min(u128::from(u64::MAX)) as u64,
            Ordering::Relaxed,
        );
        self.frames.fetch_add(1, Ordering::Release);
    }
}

#[derive(Default)]
pub struct StatsSampler {
    frames: u64,
    bytes: u64,
}

impl StatsSampler {
    pub fn sample(
        &mut self,
        metrics: &ReceiveMetrics,
        elapsed: Duration,
        rtt: Option<Duration>,
    ) -> NetworkSnapshot {
        let frames = metrics.frames.load(Ordering::Acquire);
        let bytes = metrics.bytes.load(Ordering::Relaxed);
        let seconds = elapsed.as_secs_f64().max(0.001);
        let sample = NetworkSnapshot {
            rtt_ms: rtt.map(|rtt| rtt.as_secs_f64() * 1000.0),
            screen_kib_per_second: bytes.saturating_sub(self.bytes) as f64 / 1024.0 / seconds,
            updates_per_second: frames.saturating_sub(self.frames) as f64 / seconds,
            received_frames: frames,
            received_screen_bytes: bytes,
            processing_ms: metrics.processing_us.load(Ordering::Relaxed) as f64 / 1000.0,
        };
        self.frames = frames;
        self.bytes = bytes;
        sample
    }
}

// Only adjacent pointer moves can be replaced. A button, key or clipboard operation is a barrier.
pub fn coalesce_pointer(
    message: ClientMessage,
    receiver: &mut mpsc::Receiver<ClientMessage>,
    pending: &mut Option<ClientMessage>,
) -> ClientMessage {
    let mut message = message;
    if matches!(message, ClientMessage::Input(InputEvent::Move { .. })) {
        for _ in 0..128 {
            let Ok(next) = receiver.try_recv() else {
                break;
            };
            if matches!(next, ClientMessage::Input(InputEvent::Move { .. })) {
                message = next;
            } else {
                *pending = Some(next);
                break;
            }
        }
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::PointerButton;

    #[test]
    fn pacing_backs_off_and_recovers_without_exceeding_the_requested_rate() {
        let pacing = FramePacer::new(Duration::from_millis(125));
        pacing.delivered(Duration::from_millis(600));
        assert_eq!(pacing.interval(), Duration::from_millis(600));
        for _ in 0..100 {
            pacing.delivered(Duration::from_millis(10));
        }
        assert_eq!(pacing.interval(), Duration::from_millis(125));
        pacing.delivered(Duration::from_secs(120));
        assert_eq!(pacing.interval(), Duration::from_secs(2));
    }

    #[test]
    fn acks_reject_future_frames_and_do_not_move_backwards() {
        let (acks, receiver) = FrameAcks::new();
        assert!(acks.acknowledge(1).is_err());
        acks.sending(1).unwrap();
        acks.acknowledge(1).unwrap();
        acks.sending(2).unwrap();
        acks.acknowledge(2).unwrap();
        acks.acknowledge(1).unwrap();
        assert_eq!(*receiver.borrow(), 2);
        assert!(acks.acknowledge(3).is_err());
    }

    #[test]
    fn pointer_coalescing_preserves_the_position_before_a_click() {
        let (sender, mut receiver) = mpsc::channel(8);
        sender
            .try_send(ClientMessage::Input(InputEvent::Move { x: 2, y: 2 }))
            .unwrap();
        sender
            .try_send(ClientMessage::Input(InputEvent::Move { x: 3, y: 3 }))
            .unwrap();
        sender
            .try_send(ClientMessage::Input(InputEvent::Button {
                button: PointerButton::Left,
                down: true,
            }))
            .unwrap();
        sender
            .try_send(ClientMessage::Input(InputEvent::Move { x: 4, y: 4 }))
            .unwrap();
        let mut pending = None;
        let message = coalesce_pointer(
            ClientMessage::Input(InputEvent::Move { x: 1, y: 1 }),
            &mut receiver,
            &mut pending,
        );
        assert!(matches!(
            message,
            ClientMessage::Input(InputEvent::Move { x: 3, y: 3 })
        ));
        assert!(matches!(
            pending,
            Some(ClientMessage::Input(InputEvent::Button { down: true, .. }))
        ));
        assert!(matches!(
            receiver.try_recv().unwrap(),
            ClientMessage::Input(InputEvent::Move { x: 4, y: 4 })
        ));
    }

    #[test]
    fn statistics_use_the_actual_sampling_interval_and_have_no_idle_frame_rate() {
        let metrics = ReceiveMetrics::default();
        metrics.received(2048, Duration::from_millis(3));
        let mut sampler = StatsSampler::default();
        let sample = sampler.sample(
            &metrics,
            Duration::from_secs(2),
            Some(Duration::from_millis(25)),
        );
        assert_eq!(sample.screen_kib_per_second, 1.0);
        assert_eq!(sample.updates_per_second, 0.5);
        assert_eq!(sample.rtt_ms, Some(25.0));
        assert_eq!(sample.processing_ms, 3.0);
        let idle = sampler.sample(&metrics, Duration::from_secs(1), None);
        assert_eq!(idle.updates_per_second, 0.0);
        assert_eq!(idle.screen_kib_per_second, 0.0);
    }
}
