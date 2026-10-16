import test from 'node:test';
import assert from 'node:assert/strict';
import { DrowsinessMonitor, eyeAspectRatio, EYES, measureFace, calibrateThreshold } from '../src/monitor.js';

const feed = (monitor, start, end, ear = 0.3, valid = true, step = 50) => {
  let result;
  for (let time = start; time <= end; time += step) result = monitor.update({ time, ear, valid });
  return result;
};

test('a normal 200 ms blink is counted, without an alert', () => {
  const m = new DrowsinessMonitor();
  feed(m, 0, 950); feed(m, 1000, 1150, 0.08);
  const result = feed(m, 1200, 2000);
  assert.equal(result.alerts, 0); assert.equal(result.blinks, 1); assert.equal(result.state, 'normal');
});
test('continuous closure alerts at 1500 ms exactly, once per episode', () => {
  const m = new DrowsinessMonitor();
  feed(m, 0, 1000); feed(m, 1050, 2500, 0.08);
  assert.equal(m.snapshot.state, 'warning');
  let result = m.update({ time: 2550, ear: 0.08, valid: true });
  assert.equal(result.state, 'alert'); assert.equal(result.newAlert, true);
  assert.equal(feed(m, 2600, 4000, 0.08).alerts, 1);
  feed(m, 4050, 4500); assert.equal(feed(m, 4550, 6100, 0.08).alerts, 2);
});
test('missing face breaks closure; two short segments cannot combine into an alert', () => {
  const m = new DrowsinessMonitor();
  feed(m, 0, 700, 0.08);
  assert.equal(feed(m, 750, 2000, null, false).state, 'lost');
  const result = feed(m, 2050, 2750, 0.08);
  assert.equal(result.alerts, 0); assert.equal(result.closedMs, 700);
  assert.equal(result.validMs, 1400); assert.equal(m.totalUnknownMs, 1350);
});
test('a stalled stream cannot count unknown seconds as eyes closed', () => {
  const m = new DrowsinessMonitor();
  feed(m, 0, 500, 0.08);
  const result = m.update({ time: 5000, ear: 0.08, valid: true });
  assert.equal(result.closedMs, 0); assert.equal(result.alerts, 0);
  assert.equal(m.totalValidMs, 500); assert.equal(m.totalUnknownMs, 4500);
});
test('rolling closure ratio weights duration, excludes invalid time, and expires stale data', () => {
  const m = new DrowsinessMonitor({ windowMs: 1000 });
  feed(m, 0, 450); feed(m, 500, 950, 0.08);
  const result = m.update({ time: 1000, ear: 0.3, valid: true });
  assert.equal(result.validMs, 1000); assert.equal(result.perclos, 0.5);
  const lost = feed(m, 1050, 2200, null, false);
  assert.equal(lost.perclos, null); assert.equal(lost.validMs, 0);
});
test('duplicate and backward timestamps do not repeat alert events', () => {
  const m = new DrowsinessMonitor();
  feed(m, 0, 1500, 0.08);
  assert.equal(m.snapshot.newAlert, true);
  assert.equal(m.update({ time: 1500, ear: 0.08, valid: true }).newAlert, false);
  assert.equal(m.update({ time: 1400, ear: 0.08, valid: true }).alerts, 1);
});
test('invalid EAR values never represent a confirmed closed eye', () => {
  for (const ear of [NaN, null, Infinity, -1, 2]) {
    const m = new DrowsinessMonitor();
    const result = feed(m, 0, 2000, ear);
    assert.equal(result.state, 'lost'); assert.equal(result.alerts, 0);
  }
});
test('calibration uses a robust open-eye percentile; inadequate/closed samples are rejected', () => {
  const result = calibrateThreshold([...Array(40).fill(0.3), ...Array(8).fill(0.15)]);
  assert.equal(result.baseline, 0.3); assert.ok(Math.abs(result.threshold - 0.204) < 1e-8);
  assert.equal(calibrateThreshold(Array(60).fill(0.07)), null);
  assert.equal(calibrateThreshold(Array(20).fill(0.3)), null);
});
test('EAR is calculated in pixel space, independent of image aspect ratio', () => {
  const pixels = [[10, 20], [12, 18], [18, 18], [20, 20], [18, 22], [12, 22]];
  for (const [width, height] of [[100, 100], [200, 100], [1920, 1080]]) {
    const landmarks = pixels.map(([x, y]) => ({ x: x / width, y: y / height }));
    assert.ok(Math.abs(eyeAspectRatio(landmarks, [0, 1, 2, 3, 4, 5], width, height) - .4) < 1e-8);
  }
});
test('a wink does not classify both eyes as closed; absent/small faces are rejected', () => {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  for (const [name, center] of [['left', .35], ['right', .65]]) {
    const ry = name === 'left' ? .004 : .03;
    const shape = [[-.05, 0], [-.03, -ry], [.03, -ry], [.05, 0], [.03, ry], [-.03, ry]];
    EYES[name].forEach((index, i) => { points[index] = { x: center + shape[i][0], y: .4 + shape[i][1] }; });
  }
  points[1] = { x: .5, y: .55 };
  const measured = measureFace(points, 1000, 1000);
  assert.equal(measured.valid, true); assert.ok(measured.ear > .21);
  assert.equal(measureFace([], 1000, 1000).valid, false);
  const tiny = points.map(p => ({ x: .5 + (p.x - .5) * .1, y: .5 + (p.y - .5) * .1 }));
  assert.equal(measureFace(tiny, 1000, 1000).valid, false);
});
