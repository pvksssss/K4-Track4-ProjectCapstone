export const EYES = {
  left: [33, 160, 158, 133, 153, 144],
  right: [362, 385, 387, 263, 373, 380],
};

export function eyeAspectRatio(landmarks, indices, width, height) {
  const points = indices.map(i => landmarks[i]);
  if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const distance = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  const horizontal = distance(points[0], points[3]);
  if (horizontal < 1) return null;
  return (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * horizontal);
}

// This is a geometry gate, not a model confidence estimate.
export function measureFace(landmarks, width, height) {
  if (!landmarks?.length) return { valid: false, reason: 'Không thấy khuôn mặt' };
  const left = eyeAspectRatio(landmarks, EYES.left, width, height);
  const right = eyeAspectRatio(landmarks, EYES.right, width, height);
  const a = landmarks[33], b = landmarks[263], nose = landmarks[1];
  if (left === null || right === null || !a || !b || !nose || !Number.isFinite(nose.x)) {
    return { valid: false, reason: 'Không đủ mốc mắt' };
  }
  const eyeWidth = Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  const yaw = Math.abs(nose.x - (a.x + b.x) / 2) / Math.max(Math.abs(b.x - a.x), 0.001);
  const roll = Math.abs(Math.atan2((b.y - a.y) * height, Math.abs(b.x - a.x) * width));
  if (eyeWidth < width * 0.12) return { valid: false, reason: 'Đưa mặt gần camera hơn' };
  if (yaw > 0.32 || roll > 0.5) return { valid: false, reason: 'Nhìn thẳng, giữ đầu cân bằng' };
  if (landmarks.some(p => p.x < 0.01 || p.x > 0.99 || p.y < 0.01 || p.y > 0.99)) {
    return { valid: false, reason: 'Giữ toàn bộ mặt trong khung' };
  }
  // Both eyes must be below threshold; a wink should not trigger a drowsiness alert.
  return { valid: true, ear: Math.max(left, right), left, right, reason: 'Theo dõi tốt' };
}

export function calibrateThreshold(samples) {
  const sorted = samples.filter(x => Number.isFinite(x) && x >= 0.14 && x <= 0.5).sort((a, b) => a - b);
  if (sorted.length < 30) return null;
  const baseline = sorted[Math.floor((sorted.length - 1) * 0.7)];
  return { baseline, threshold: Math.max(0.10, Math.min(0.32, baseline * 0.68)) };
}

export class DrowsinessMonitor {
  constructor({ threshold = 0.21, alertAfterMs = 1500, windowMs = 60000, maxGapMs = 600 } = {}) {
    Object.assign(this, { threshold, alertAfterMs, windowMs, maxGapMs });
    this.reset();
  }

  reset() {
    this.lastTime = null;
    this.previous = null;
    this.closedSince = null;
    this.segments = [];
    this.alerts = 0;
    this.blinks = 0;
    this.wasAlert = false;
    this.totalValidMs = 0;
    this.totalClosedMs = 0;
    this.totalUnknownMs = 0;
    this.snapshot = { state: 'idle', closedMs: 0, perclos: null, validMs: 0, alerts: 0, blinks: 0 };
  }

  update({ time, ear = null, valid = false }) {
    if (!Number.isFinite(time)) throw new TypeError('time must be finite');
    if (this.lastTime !== null && time <= this.lastTime) return { ...this.snapshot, newAlert: false };
    const dt = this.lastTime === null ? 0 : time - this.lastTime;
    const gap = dt > this.maxGapMs;
    const usable = valid && Number.isFinite(ear) && ear >= 0 && ear < 1;
    if (dt && !gap && this.previous?.valid && usable) {
      const closed = this.previous.closed;
      this.segments.push({ start: this.lastTime, end: time, closed });
      this.totalValidMs += dt;
      if (closed) this.totalClosedMs += dt;
    } else {
      this.totalUnknownMs += dt;
    }
    const cutoff = time - this.windowMs;
    this.segments = this.segments.filter(s => s.end > cutoff);
    let validMs = 0, closedWindowMs = 0;
    for (const segment of this.segments) {
      const duration = segment.end - Math.max(segment.start, cutoff);
      validMs += duration;
      if (segment.closed) closedWindowMs += duration;
    }
    if (gap || !usable) this.closedSince = null;
    const closed = usable && ear < this.threshold;
    if (closed && this.closedSince === null) this.closedSince = time;
    if (usable && !closed && this.closedSince !== null) {
      const duration = time - this.closedSince;
      if (duration >= 80 && duration <= 500) this.blinks++;
      this.closedSince = null;
    }
    const closedMs = this.closedSince === null ? 0 : time - this.closedSince;
    const state = !usable ? 'lost' : closedMs >= this.alertAfterMs ? 'alert' : closedMs >= 500 ? 'warning' : 'normal';
    const newAlert = state === 'alert' && !this.wasAlert;
    if (newAlert) this.alerts++;
    this.wasAlert = state === 'alert';
    this.previous = { valid: usable, closed };
    this.lastTime = time;
    this.snapshot = { state, closedMs, perclos: validMs ? closedWindowMs / validMs : null,
      validMs, alerts: this.alerts, blinks: this.blinks, newAlert, ear: usable ? ear : null };
    return this.snapshot;
  }
}
