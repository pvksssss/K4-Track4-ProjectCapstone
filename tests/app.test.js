import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as geometry from '../src/monitor.js';

// Run the actual application with a deterministic browser/media adapter. No webcam,
// downloaded model, wall-clock sleeps or production-only test hooks are required.
const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
  .replace(/^import .*from '\.\/monitor\.js';\r?\n/, '');

function browserHarness() {
  const elements = new Map(), revoked = [];
  let now = 0, nextUrl = 0;
  const drawing = new Proxy({}, { get: () => () => {} });
  const makeElement = () => ({ hidden: true, disabled: false, checked: false, value: '',
    style: {}, dataset: {}, width: 960, height: 600,
    classList: { add() {}, remove() {}, toggle() {} },
    getContext: () => drawing, addEventListener() {}, replaceChildren() {}, append() {},
    pause() {}, load() {}, removeAttribute(key) { delete this[key]; },
  });
  const get = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  get('alert-duration').value = '1.5'; get('scenario').value = 'drowsy';
  const video = get('video');
  Object.assign(video, { readyState: 2, currentTime: 0, videoWidth: 960, videoHeight: 600,
    play: async () => {}, ended: false });
  const model = { detectForVideo: () => ({ faceLandmarks: [] }) };
  const measurement = { valid: true, ear: .3 };
  const context = vm.createContext({ ...geometry, measureFace: () => ({ ...measurement }),
    performance: { now: () => now }, fakeModel: model,
    document: { getElementById: get, createElement: makeElement, createTextNode: x => x, addEventListener() {} },
    window: { addEventListener() {} },
    URL: { createObjectURL: () => `blob:test-${++nextUrl}`, revokeObjectURL: url => revoked.push(url) },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, Date,
  });
  vm.runInContext(appSource, context, { filename: 'src/app.js' });
  const run = code => vm.runInContext(code, context);
  run('landmarker = fakeModel');
  return { get, video, model, measurement, revoked, run, setTime: time => { now = time; },
    async startFile(name = 'test.mp4') {
      context.inputFile = { name, size: 100, type: 'video/mp4' };
      return run('startVideoFile(inputFile)');
    },
    frame(time) { now = time; video.currentTime += .1; run(`cameraFrame(${time})`); },
  };
}

for (const next of ['video', 'simulation', 'camera']) {
  test(`a cancelled video's late failure cannot modify a newer ${next} session`, async () => {
    const h = browserHarness();
    let rejectOld;
    h.video.play = () => new Promise((_, reject) => { rejectOld = reject; });
    const old = h.startFile('old.mp4');
    await Promise.resolve(); // loadModel resolves; the first play() is still pending.
    assert.equal(typeof rejectOld, 'function');
    h.run('stopSession()');
    h.video.play = async () => {};
    if (next === 'video') await h.startFile('new.mp4');
    else if (next === 'simulation') h.run('startSimulation()');
    else { h.video.srcObject = { liveCamera: true }; h.run("newSession('camera'); beginCalibration()"); }
    const state = h.get('state-panel').dataset.state, message = h.get('notice').textContent;
    const newUrl = h.run('videoObjectUrl'), src = h.video.src, cameraStream = h.video.srcObject;
    rejectOld(new Error('AbortError: play() interrupted by load()'));
    await old;
    assert.equal(h.run('running'), true);
    assert.equal(h.run('mode'), next);
    assert.equal(h.get('state-panel').dataset.state, state);
    assert.equal(h.get('notice').textContent, message);
    assert.equal(h.video.src, src); assert.equal(h.video.srcObject, cameraStream);
    assert.equal(h.run('videoObjectUrl'), newUrl);
    assert.deepEqual(h.revoked, ['blob:test-1']);
    if (next === 'video') assert.equal(h.run('mediaMode'), 'file');
  });
}

test('a cancelled video that finishes loading cannot restart over a new session', async () => {
  const h = browserHarness();
  let resolveOld;
  h.video.play = () => new Promise(resolve => { resolveOld = resolve; });
  const old = h.startFile(); await Promise.resolve();
  h.run('stopSession(); startSimulation()'); resolveOld(); await old;
  assert.equal(h.run('mode'), 'simulation'); assert.equal(h.run('running'), true);
  assert.deepEqual(h.revoked, ['blob:test-1']);
});

test('an unreadable current file cleans up and allows another video to start', async () => {
  const h = browserHarness();
  h.video.play = async () => { throw new Error('Unsupported video'); };
  await h.startFile();
  assert.equal(h.run('loading'), false); assert.equal(h.run('running'), false);
  assert.equal(h.video.src, undefined); assert.equal(h.run('videoObjectUrl'), null);
  assert.equal(h.get('start-video').disabled, false);
  assert.match(h.get('notice').textContent, /Không phát được video/);
  assert.deepEqual(h.revoked, ['blob:test-1']);
  h.video.play = async () => {}; await h.startFile('good.mp4');
  assert.equal(h.run('running'), true); assert.equal(h.run('mediaMode'), 'file');
});

for (const source of ['camera', 'video']) {
  test(`a 20-second first inference does not consume ${source} calibration time`, () => {
    const h = browserHarness();
    h.run(`newSession('${source}'); beginCalibration()`);
    h.model.detectForVideo = () => { h.setTime(20100); return { faceLandmarks: [] }; };
    h.frame(100);
    assert.equal(h.run('calibration.started'), 20100);
    assert.equal(h.run('calibration.validMs'), 0);
    assert.equal(h.run('session.calibrationReady'), false);
    h.model.detectForVideo = () => ({ faceLandmarks: [] });
    for (let time = 20200; time <= 23100; time += 100) h.frame(time);
    assert.equal(h.run('session.calibrationReady'), true);
    assert.equal(h.run('calibration'), null);
    assert.equal(h.run('session.calibrations.length'), 1);
    assert.ok(Math.abs(h.run('monitor.threshold') - .204) < 1e-8);
    assert.equal(h.run('monitor.alerts'), 0);
  });
}

test('missing faces still time out 15 seconds after the first completed inference', () => {
  const h = browserHarness(); h.measurement.valid = false;
  h.run("newSession('camera'); beginCalibration()");
  h.model.detectForVideo = () => { h.setTime(20100); return { faceLandmarks: [] }; };
  h.frame(100); h.model.detectForVideo = () => ({ faceLandmarks: [] });
  h.frame(35100); assert.notEqual(h.run('calibration'), null);
  h.frame(35200); assert.equal(h.run('calibration'), null);
  assert.equal(h.run('session.calibrationReady'), false);
  assert.match(h.get('notice').textContent, /Hiệu chuẩn chưa thành công/);
  assert.equal(h.run('monitor.alerts'), 0);
});

test('a stalled stream cannot leave calibration pending forever after inference starts', () => {
  const h = browserHarness(); h.measurement.valid = false;
  h.run("newSession('camera'); beginCalibration()"); h.frame(100);
  h.video.readyState = 0; h.setTime(16000); h.run('cameraFrame(16000)');
  assert.equal(h.run('calibration'), null);
  assert.equal(h.run('session.calibrationReady'), false);
  assert.match(h.get('notice').textContent, /Hiệu chuẩn chưa thành công/);
});
