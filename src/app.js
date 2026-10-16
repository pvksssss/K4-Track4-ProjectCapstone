import { DrowsinessMonitor, EYES, measureFace, calibrateThreshold } from './monitor.js';

const $ = id => document.getElementById(id);
const video = $('video'), preview = $('preview'), ctx = preview.getContext('2d');
const chart = $('chart'), chartCtx = chart.getContext('2d');
let monitor = new DrowsinessMonitor();
let landmarker, stream, audio, frameId, loading = false, running = false;
let generation = 0, mode = null, session = null, calibration = null, videoObjectUrl = null, mediaMode = null;
let lastProcessed = -Infinity, lastVideoTime = -1, lastSample = -Infinity, lastRender = -Infinity;
let lastState = null, lostSince = null, lostLogged = false, nextBeep = 0;
let simulatedMs = -50;
let samples = [], events = [], history = [], latencies = [], frameTimes = [];
const states = {
  idle: ['Chờ kết nối', 'Bắt đầu một phiên để theo dõi.'],
  normal: ['Đang quan sát', 'Chưa thấy hai mắt nhắm kéo dài.'],
  warning: ['Mắt đang nhắm', 'Đang theo dõi thời gian nhắm mắt liên tục.'],
  alert: ['Cần nghỉ ngơi', 'Hai mắt nhắm vượt ngưỡng thời gian đã chọn.'],
  lost: ['Thiếu tín hiệu', 'Không đủ dữ liệu để kết luận trạng thái mắt.'],
  calibrating: ['Đang hiệu chuẩn', 'Mở mắt tự nhiên và nhìn thẳng vào camera.'],
};
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function seconds(ms) { return (ms / 1000).toFixed(1); }
function elapsed(time = performance.now()) { return session ? Math.max(0, time - session.startedMono) : 0; }
function clock(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function controls() {
  $('start-camera').disabled = running || loading;
  $('start-video').disabled = running || loading;
  $('start-simulation').disabled = running || loading;
  $('stop').disabled = !running && !loading;
  $('alert-duration').disabled = running || loading;
  $('scenario').disabled = running || loading;
  $('calibrate').disabled = !running || (mode !== 'camera' && mode !== 'video') || !!calibration;
  $('export').disabled = !session;
}
function stateView(state, description) {
  $('state-panel').dataset.state = state;
  $('state-label').textContent = states[state][0];
  $('state-description').textContent = description || states[state][1];
  $('alert-overlay').hidden = state !== 'alert';
  $('viewfinder').classList.toggle('alerting', state === 'alert');
}
function addEvent(type, title, detail = '', time = performance.now()) {
  const event = { elapsedMs: Math.round(elapsed(time)), type, title, detail };
  events.push(event);
  // Keep long-running sessions bounded; exported samples retain the most recent 30 minutes.
  if (events.length > 1000) events.shift();
  $('event-count').textContent = `${events.length} SỰ KIỆN`;
  $('events').replaceChildren(...events.slice(-40).reverse().map(item => {
    const li = document.createElement('li'); li.className = item.type;
    const t = document.createElement('time'); t.textContent = clock(item.elapsedMs);
    const content = document.createElement('div');
    const b = document.createElement('b'); b.textContent = item.title;
    const small = document.createElement('small'); small.textContent = item.detail;
    content.append(b, small); li.append(t, content); return li;
  }));
}
function initAudio() {
  if (!$('sound').checked) return;
  try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); } catch { /* Visual alert remains available. */ }
}
function beep() {
  if (!$('sound').checked || !audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  for (let i = 0; i < 2; i++) {
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.frequency.value = i ? 740 : 880;
    gain.gain.setValueAtTime(0, now + i * 0.22);
    gain.gain.linearRampToValueAtTime(0.13, now + i * 0.22 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.18);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(now + i * 0.22); oscillator.stop(now + i * 0.22 + 0.2);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
function setThreshold(value, label) {
  monitor.threshold = value;
  $('threshold-value').replaceChildren(document.createTextNode(value.toFixed(3) + ' '));
  const small = document.createElement('small'); small.textContent = label;
  $('threshold-value').append(small);
}
function newSession(source) {
  mode = source; running = true; loading = false;
  monitor = new DrowsinessMonitor({ alertAfterMs: Number($('alert-duration').value) * 1000 });
  session = { id: new Date().toISOString(), source, scenario: source === 'simulation' ? $('scenario').value : null,
    mediaFile: source === 'video' ? session?.mediaFile ?? null : null,
    startedAt: new Date().toISOString(), startedMono: performance.now(), stoppedAt: null,
    model: source === 'simulation' ? null : 'MediaPipe Face Landmarker float16/1; tasks-vision 0.10.32', calibrations: [] };
  samples = []; events = []; history = []; latencies = []; frameTimes = [];
  lastProcessed = lastSample = lastRender = -Infinity; lastVideoTime = -1; lastState = null;
  lostSince = null; lostLogged = false; nextBeep = 0;
  // Avoid reporting a stalled stream before its first scheduled frame.
  lastProcessed = performance.now();
  setThreshold(0.21, source === 'simulation' ? 'mô phỏng' : 'mặc định');
  $('preview').hidden = false; $('placeholder').hidden = true;
  $('simulation-label').hidden = source !== 'simulation';
  $('video-label').hidden = source !== 'video';
  $('source-badge').textContent = source === 'simulation' ? 'MÔ PHỎNG' : source === 'video' ? 'VIDEO DỰ PHÒNG' : 'CAMERA TRỰC TIẾP';
  $('source-badge').className = `badge ${source}`;
  $('session-dot').classList.add('running');
  $('live-indicator').textContent = source === 'simulation' ? 'SIMULATION' : source === 'video' ? 'VIDEO' : 'LIVE';
  $('chart-source').textContent = source === 'simulation' ? 'DỮ LIỆU MÔ PHỎNG' : source === 'video' ? 'VIDEO DỰ PHÒNG' : 'CAMERA THỰC';
  $('latency-description').textContent = source === 'simulation' ? 'Không chạy model trong chế độ mô phỏng.' : 'Đo riêng bước chạy model trên thiết bị.';
  $('latency-value').textContent = '—'; $('fps-label').textContent = '— FPS';
  addEvent('start', source === 'simulation' ? 'Bắt đầu mô phỏng' : source === 'video' ? 'Mở video dự phòng' : 'Kết nối camera',
    source === 'simulation' ? 'Tín hiệu EAR tổng hợp, không phải kết quả nhận diện.'
      : source === 'video' ? 'Video quay sẵn, chạy qua cùng model và bộ đếm. Không phải camera trực tiếp.'
      : 'Hình ảnh được xử lý trên thiết bị.');
  stateView('normal'); controls();
}

async function loadModel() {
  if (landmarker) return landmarker;
  notice('Đang khởi tạo model cục bộ. Lần đầu có thể mất vài giây…');
  const { FaceLandmarker, FilesetResolver } = await import('/vendor/vision_bundle.mjs');
  const files = await FilesetResolver.forVisionTasks('/vendor/wasm');
  const options = { baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6 };
  try { landmarker = await FaceLandmarker.createFromOptions(files, options); }
  catch { options.baseOptions.delegate = 'CPU'; landmarker = await FaceLandmarker.createFromOptions(files, options); }
  return landmarker;
}
async function startCamera() {
  if (running || loading) return;
  if (!navigator.mediaDevices?.getUserMedia) { notice('Camera cần Chrome/Edge trên http://localhost hoặc HTTPS. Hãy chạy npm start rồi mở địa chỉ được in ra.'); return; }
  const token = ++generation;
  loading = true; controls(); initAudio();
  let requestedStream;
  try {
    await loadModel();
    if (token !== generation) return;
    notice('Cho phép trình duyệt truy cập webcam để bắt đầu.');
    requestedStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 600 } } });
    if (token !== generation) { requestedStream.getTracks().forEach(t => t.stop()); return; }
    stream = requestedStream; video.srcObject = stream;
    await video.play();
    if (token !== generation) { requestedStream.getTracks().forEach(t => t.stop()); return; }
    preview.width = video.videoWidth; preview.height = video.videoHeight;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (running) stopSession('Camera đã ngắt kết nối'); });
    newSession('camera'); notice(); beginCalibration(); frameId = requestAnimationFrame(cameraFrame);
  } catch (error) {
    requestedStream?.getTracks().forEach(t => t.stop());
    if (token !== generation) return;
    loading = false; stream = null; video.srcObject = null; controls(); stateView('idle');
    const messages = { NotAllowedError: 'Chưa được cấp quyền camera. Cho phép camera trong thanh địa chỉ rồi thử lại.',
      NotFoundError: 'Không tìm thấy webcam. Kết nối camera hoặc thử chế độ mô phỏng.',
      NotReadableError: 'Camera đang bận hoặc không truy cập được. Đóng ứng dụng khác đang dùng webcam rồi thử lại.' };
    notice(messages[error.name] || 'Không khởi tạo được camera/model. Chạy npm install và npm run setup, sau đó tải lại trang. Chi tiết: ' + error.message);
  }
}
  // Fallback when the demo laptop has no working webcam: run a pre-recorded file
  // through the identical model, geometry, calibration and alert pipeline.
  async function startVideoFile(file) {
    if (running || loading || !file) return;
    const token = ++generation;
    loading = true; controls(); initAudio();
    let url = null;
    try {
      notice('Đang khởi tạo model cục bộ. Lần đầu có thể mất vài giây…');
      await loadModel();
      if (token !== generation) return;
      url = URL.createObjectURL(file); videoObjectUrl = url;
      video.srcObject = null; video.src = url; video.loop = false;
      video.hidden = false;
      await video.play();
      if (token !== generation) return;
      preview.width = video.videoWidth || 960; preview.height = video.videoHeight || 600;
      mediaMode = 'file';
      newSession('video');
      session.mediaFile = { name: file.name, sizeBytes: file.size, type: file.type };
      notice('Đang phát video dự phòng. Kết quả này KHÔNG phải camera trực tiếp; nhãn nguồn được ghi trong JSON xuất.');
      beginCalibration();
      frameId = requestAnimationFrame(cameraFrame);
    } catch (error) {
      // A cancelled play() may reject after a new session has taken over this video element.
      // stopSession already released the old URL; never clean up the new session's media.
      if (token !== generation) return;
      if (url) URL.revokeObjectURL(url);
      videoObjectUrl = null; mediaMode = null;
      loading = false; video.pause(); video.removeAttribute('src'); video.load();
      video.hidden = true; controls(); stateView('idle');
      notice('Không phát được video. Thử tệp mp4/webm phổ biến. Chi tiết: ' + error.message);
    }
  }
function beginCalibration() {
  if (!running || (mode !== 'camera' && mode !== 'video')) return;
  // Start the acquisition deadline only after inference actually returns a frame.
  // The first GPU inference can take seconds and must not consume this budget.
  calibration = { started: null, last: null, validMs: 0, samples: [] };
  session.calibrationReady = false;
  monitor.closedSince = null;
  $('calibration-overlay').hidden = false; $('calibration-progress').style.width = '0%';
  notice('Hiệu chuẩn: mở mắt tự nhiên, nhìn thẳng và giữ mặt trong khung. Không nhắm mắt trong bước này.');
  addEvent('calibration', 'Bắt đầu hiệu chuẩn', 'Cần 3 giây tín hiệu mắt mở hợp lệ.');
  stateView('calibrating'); controls();
}
function calibrationStep(measurement, time) {
  const current = calibration;
  current.started ??= time;
  if (time - current.started > 15000) {
    calibration = null; $('calibration-overlay').hidden = true;
    addEvent('lost', 'Hiệu chuẩn chưa thành công', 'Chưa thu được đủ tín hiệu hợp lệ.');
    notice(mode === 'video'
      ? 'Video kết thúc hoặc thiếu đủ 3 giây mắt mở ở đầu tệp để hiệu chuẩn. Dùng video mở đầu bằng khoảng 8–10 giây mắt mở, rồi mới đến đoạn nhắm mắt.'
      : 'Hiệu chuẩn chưa thành công. Tăng ánh sáng, tháo kính tối màu và nhấn “Hiệu chuẩn lại”. Cảnh báo tạm dừng đến khi hiệu chuẩn xong.');
    controls(); return;
  }
  const good = measurement.valid && measurement.ear >= 0.14 && measurement.ear <= 0.5;
  if (good) {
    if (current.last !== null && time - current.last <= 300) current.validMs += time - current.last;
    current.last = time; current.samples.push(measurement.ear);
  } else { current.last = null; }
  $('calibration-progress').style.width = `${Math.min(100, current.validMs / 30)}%`;
  $('calibration-text').textContent = good ? `Giữ mắt mở tự nhiên · ${seconds(current.validMs)} / 3.0 giây` : (measurement.reason || 'Mở mắt tự nhiên, nhìn thẳng…');
  stateView('calibrating');
  if (current.validMs >= 3000) {
    const result = calibrateThreshold(current.samples);
    if (!result) return;
    calibration = null; monitor.reset(); setThreshold(result.threshold, 'đã hiệu chuẩn');
    session.calibrationReady = true;
    session.calibrations.push({ elapsedMs: Math.round(elapsed(time)), ...result, sampleCount: current.samples.length });
    $('calibration-overlay').hidden = true; notice();
    addEvent('calibration', 'Hiệu chuẩn hoàn tất', `EAR mở ${result.baseline.toFixed(3)} → ngưỡng ${result.threshold.toFixed(3)}. Bộ đếm đo được bắt đầu lại.`, time);
    history = []; lastState = null; controls();
  }
}
function cameraFrame(time) {
  if (!running || (mode !== 'camera' && mode !== 'video')) return;
  // Limit synchronous inference to ~15 Hz so the interface remains responsive.
  if (time - lastProcessed >= 65 && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastProcessed = time; lastVideoTime = video.currentTime;
    try {
      const before = performance.now();
      const result = landmarker.detectForVideo(video, before);
      const measuredAt = performance.now();
      const inferenceMs = measuredAt - before;
      const landmarks = result.faceLandmarks?.[0];
      const measurement = measureFace(landmarks, preview.width, preview.height);
      ctx.drawImage(video, 0, 0, preview.width, preview.height);
      if (landmarks) drawLandmarks(landmarks, measurement.valid);
      if (calibration) calibrationStep(measurement, measuredAt);
      processMeasurement(measurement, measuredAt, inferenceMs, !session.calibrationReady);
    } catch (error) {
      stopSession('Lỗi xử lý khung hình'); notice('Không xử lý được khung hình: ' + error.message); return;
    }
  } else if (time - lastProcessed > 600) {
    const missing = { valid: false, reason: mediaMode === 'file' ? 'Video không cung cấp khung hình mới' : 'Camera không cung cấp khung hình mới' };
    if (calibration && calibration.started !== null) calibrationStep(missing, time);
    processMeasurement(missing, time, null, !session.calibrationReady);
    lastProcessed = time;
  }
  // A file has an end; a live camera never reaches one.
  if (mediaMode === 'file' && video.ended) { stopSession('Hết video dự phòng'); return; }
  frameId = requestAnimationFrame(cameraFrame);
}
function drawLandmarks(points, valid) {
  ctx.strokeStyle = valid ? '#a7f0b8' : '#f0c982'; ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = Math.max(1.5, preview.width / 500);
  for (const indices of Object.values(EYES)) {
    ctx.beginPath();
    indices.forEach((index, i) => { const p = points[index]; if (i) ctx.lineTo(p.x * preview.width, p.y * preview.height); else ctx.moveTo(p.x * preview.width, p.y * preview.height); });
    ctx.closePath(); ctx.stroke();
    indices.forEach(index => { const p = points[index]; ctx.beginPath(); ctx.arc(p.x * preview.width, p.y * preview.height, 2.5, 0, 2 * Math.PI); ctx.fill(); });
  }
}
const SOURCE_LABEL = { simulation: 'Mô phỏng', camera: 'Camera thực', video: 'Video dự phòng' };
function processMeasurement(measurement, time, inferenceMs, suspended = false) {
  const status = monitor.update({ time, ear: measurement.ear, valid: measurement.valid && !suspended });
  const state = suspended ? 'calibrating' : status.state;
  stateView(state, state === 'lost' ? measurement.reason : undefined);
  $('tracking-label').textContent = measurement.valid
    ? (mode === 'simulation' ? '◉ TÍN HIỆU MÔ PHỎNG' : mode === 'video' ? '◉ MỐC MẮT HỢP LỆ · VIDEO' : '◉ MỐC MẮT HỢP LỆ')
    : `○ ${measurement.reason || 'THIẾU TÍN HIỆU'}`;
  if (status.newAlert) {
    addEvent('alert', 'Cảnh báo nhắm mắt kéo dài', `${seconds(status.closedMs)} giây · EAR ${measurement.ear.toFixed(3)} · ${SOURCE_LABEL[mode]}`, time);
  }
  if (state === 'lost') {
    lostSince ??= time;
    if (!lostLogged && time - lostSince >= 700) { addEvent('lost', 'Không đủ tín hiệu', measurement.reason || 'Không thấy khuôn mặt', time); lostLogged = true; }
  } else {
    if (lostLogged) addEvent('recovery', 'Tín hiệu đã trở lại', 'Bắt đầu lại bộ đếm nhắm mắt.', time);
    lostSince = null; lostLogged = false;
  }
  if (lastState === 'alert' && state !== 'alert') addEvent('recovery', 'Kết thúc cảnh báo', state === 'lost' ? 'Mất tín hiệu; chưa thể kết luận mắt đã mở.' : 'Hai mắt không còn dưới ngưỡng.', time);
  lastState = state;
  if (state === 'alert' && time >= nextBeep) { if (performance.now() - time < 300) beep(); nextBeep = time + 1600; }
  if (inferenceMs !== null) { latencies.push(inferenceMs); if (latencies.length > 300) latencies.shift(); }
  frameTimes.push(time); frameTimes = frameTimes.filter(t => t >= time - 1000);
  if (time - lastSample >= 190) {
    const row = { elapsedMs: Math.round(elapsed(time)), ear: measurement.valid ? measurement.ear : null,
      valid: !!measurement.valid, state, closedMs: Math.round(status.closedMs), threshold: monitor.threshold,
      perclos: status.perclos, validWindowMs: Math.round(status.validMs), inferenceMs, source: mode };
    samples.push(row); if (samples.length > 9000) samples.shift();
    history.push(row); history = history.filter(s => s.elapsedMs >= row.elapsedMs - 30000);
    lastSample = time;
  }
  if (time - lastRender < 90) return;
  lastRender = time;
  $('ear-value').textContent = measurement.valid ? measurement.ear.toFixed(3) : '—';
  $('closed-time').textContent = seconds(status.closedMs);
  $('closed-progress').style.width = `${Math.min(100, status.closedMs / monitor.alertAfterMs * 100)}%`;
  $('perclos-value').textContent = status.perclos === null ? '—' : `${Math.round(status.perclos * 100)}%`;
  $('coverage-value').textContent = status.validMs ? `${seconds(status.validMs)}s hợp lệ / 60s` : 'chưa có dữ liệu';
  $('alert-count').textContent = status.alerts;
  $('blink-count').textContent = `${status.blinks} lần chớp mắt ngắn được quan sát.`;
  $('latency-value').textContent = latencies.length ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1) : '—';
  const observedFps = frameTimes.length > 1 ? Math.round((frameTimes.length - 1) * 1000 / (frameTimes.at(-1) - frameTimes[0])) : 0;
  $('fps-label').textContent = `${observedFps || '—'} ${mode === 'simulation' ? 'SAMPLE/S' : 'FPS'}`;
  $('session-label').textContent = `${SOURCE_LABEL[mode]} · ${clock(elapsed(time))}`;
  drawChart(elapsed(time));
}

// Known synthetic inputs exercise the state machine, never the recognition model.
function simulationMeasurement(ms) {
  const s = ms / 1000, scenario = session.scenario;
  let valid = true, ear = 0.31 + Math.sin(s * 2.5) * 0.007;
  if (scenario === 'drowsy') {
    if ((s >= 2 && s < 2.2) || (s >= 10 && s < 10.2)) ear = 0.08;
    if (s >= 5 && s < 9) ear = 0.075 + Math.sin(s * 5) * 0.006;
    if (s >= 12 && s < 14) valid = false;
  } else if (scenario === 'blink') {
    if (s % 2.5 >= 1.5 && s % 2.5 < 1.7) ear = 0.08;
  } else {
    if (s >= 3 && s < 3.8) ear = 0.08;
    if (s >= 3.8 && s < 7) valid = false;
    if (s >= 7 && s < 7.7) ear = 0.08;
    if (s >= 10 && s < 13) valid = false;
  }
  return { valid, ear, reason: valid ? 'Tín hiệu mô phỏng' : 'Mất khuôn mặt (mô phỏng)' };
}
function drawSimulation(measurement, time) {
  const w = preview.width, h = preview.height;
  ctx.fillStyle = '#132b24'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#45664f'; ctx.lineWidth = 2;
  if (!measurement.valid) {
    ctx.setLineDash([7, 8]); ctx.strokeRect(w * .32, h * .15, w * .36, h * .65); ctx.setLineDash([]); return;
  }
  const offset = Math.sin(time / 1800) * 5;
  ctx.strokeStyle = '#72977b'; ctx.beginPath(); ctx.ellipse(w / 2 + offset, h * .48, w * .145, h * .29, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * .26, h); ctx.quadraticCurveTo(w * .27, h * .72, w * .5, h * .79); ctx.quadraticCurveTo(w * .73, h * .72, w * .74, h); ctx.stroke();
  const closed = measurement.ear < monitor.threshold;
  ctx.strokeStyle = closed ? '#e6b476' : '#a2d5ae'; ctx.fillStyle = ctx.strokeStyle;
  for (const x of [w * .44, w * .56]) {
    const ry = closed ? 2.5 : 13;
    ctx.beginPath(); ctx.ellipse(x + offset, h * .43, 23, ry, 0, 0, Math.PI * 2); ctx.stroke();
    if (!closed) { ctx.beginPath(); ctx.arc(x + offset, h * .43, 5, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.arc(x + offset + Math.cos(a) * 23, h * .43 + Math.sin(a) * ry, 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.strokeStyle = '#72977b'; ctx.beginPath(); ctx.moveTo(w * .5 + offset, h * .46); ctx.lineTo(w * .485 + offset, h * .57); ctx.lineTo(w * .515 + offset, h * .57); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(w * .5 + offset, h * .65, w * .04, 3, 0, 0, Math.PI); ctx.stroke();
}
function simulationFrame(time) {
  if (!running || mode !== 'simulation') return;
  const ms = elapsed(time);
  // Replay known synthetic samples at 20 Hz, even if browser painting is throttled.
  // Real camera inference never fills in missing frames this way.
  let measurement;
  while (simulatedMs + 50 <= Math.min(ms, 16000)) {
    simulatedMs += 50;
    measurement = simulationMeasurement(simulatedMs);
    processMeasurement(measurement, session.startedMono + simulatedMs, null);
  }
  if (measurement) drawSimulation(measurement, time);
  if (ms >= 16000) { stopSession('Hoàn tất kịch bản mô phỏng'); return; }
  frameId = requestAnimationFrame(simulationFrame);
}
function startSimulation() {
  if (running || loading) return;
  generation++; initAudio(); newSession('simulation'); simulatedMs = -50; preview.width = 960; preview.height = 600;
  notice('Đang chạy kịch bản 16 giây với tín hiệu EAR tổng hợp. Chế độ này chỉ kiểm tra logic cảnh báo, không đánh giá độ chính xác của camera/model.');
  frameId = requestAnimationFrame(simulationFrame);
}
function stopSession(reason = 'Đã dừng phiên') {
  generation++; const wasActive = running;
  running = false; loading = false; cancelAnimationFrame(frameId);
  stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null;
  // Release the local file handle; nothing is retained after a session stops.
  if (videoObjectUrl) { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(videoObjectUrl); videoObjectUrl = null; }
  mediaMode = null; video.hidden = true;
  calibration = null; $('calibration-overlay').hidden = true;
  if (wasActive && session) { session.stoppedAt = new Date().toISOString(); session.durationMs = Math.round(elapsed()); addEvent('stop', reason, 'Dữ liệu phiên vẫn có thể xuất xuống máy.'); }
  $('session-dot').classList.remove('running'); $('session-label').textContent = reason;
  $('live-indicator').textContent = 'STOPPED'; $('tracking-label').textContent = '○ PHIÊN ĐÃ DỪNG';
  $('simulation-label').hidden = true; $('video-label').hidden = true;
  $('closed-time').textContent = '0.0'; $('closed-progress').style.width = '0%';
  stateView('idle', session ? 'Phiên đã dừng. Xem hoặc xuất dữ liệu bên dưới.' : undefined);
  controls();
}
function drawChart(now = 0) {
  const w = chart.width, h = chart.height, left = 56, right = w - 15, top = 16, bottom = h - 30;
  chartCtx.clearRect(0, 0, w, h);
  chartCtx.font = '16px Segoe UI'; chartCtx.textAlign = 'right'; chartCtx.lineWidth = 1;
  const y = value => bottom - Math.min(.5, value) / .5 * (bottom - top);
  for (const value of [0, .1, .2, .3, .4, .5]) {
    chartCtx.fillStyle = '#9aa891'; chartCtx.fillText(value.toFixed(1), left - 12, y(value) + 5);
    chartCtx.strokeStyle = '#edf1e9'; chartCtx.beginPath(); chartCtx.moveTo(left, y(value)); chartCtx.lineTo(right, y(value)); chartCtx.stroke();
  }
  chartCtx.setLineDash([8, 7]); chartCtx.strokeStyle = '#c4b78e';
  chartCtx.beginPath(); chartCtx.moveTo(left, y(monitor.threshold)); chartCtx.lineTo(right, y(monitor.threshold)); chartCtx.stroke(); chartCtx.setLineDash([]);
  const end = Math.max(30000, now), start = end - 30000;
  const x = ms => left + (ms - start) / 30000 * (right - left);
  chartCtx.strokeStyle = '#568461'; chartCtx.lineWidth = 2.8; chartCtx.beginPath();
  let connected = false, previousTime = null;
  for (const item of history) {
    if (item.elapsedMs < start || item.ear === null || item.state === 'calibrating') { connected = false; continue; }
    if (previousTime !== null && item.elapsedMs - previousTime > 600) connected = false;
    if (connected) chartCtx.lineTo(x(item.elapsedMs), y(item.ear)); else chartCtx.moveTo(x(item.elapsedMs), y(item.ear));
    connected = true; previousTime = item.elapsedMs;
  }
  chartCtx.stroke(); chartCtx.textAlign = 'center'; chartCtx.fillStyle = '#a2ad9b';
  for (let i = 0; i <= 3; i++) chartCtx.fillText(`${Math.round((start + i * 10000) / 1000)}s`, left + i / 3 * (right - left), h - 5);
}
function download(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportSession() {
  if (!session) return;
  const sorted = [...latencies].sort((a, b) => a - b);
  const report = { schemaVersion: 1, app: 'Vin Driver Watch', exportedAt: new Date().toISOString(),
    session: { ...session, startedMono: undefined, durationMs: session.durationMs ?? Math.round(elapsed()) },
    settings: { threshold: monitor.threshold, alertAfterMs: monitor.alertAfterMs, rollingWindowMs: monitor.windowMs },
    summary: { alerts: monitor.alerts, blinks: monitor.blinks, validMs: Math.round(monitor.totalValidMs),
      closedMs: Math.round(monitor.totalClosedMs), unknownMs: Math.round(monitor.totalUnknownMs),
      recentInferenceMeanMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
      recentInferenceP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null },
    retention: 'Most recent 9000 samples (~30 min), 1000 events; latency statistics: last 300 inferences. Counters reset after calibration.',
    limitations: 'Eye-closure heuristic; not a medical diagnosis or a validated driving-safety system. Simulation is synthetic, not model accuracy evidence.',
    evidenceClass: session.source === 'camera' ? 'live-camera' : session.source === 'video' ? 'pre-recorded-file' : 'synthetic-simulation',
    events, samples };
  const name = `driverwatch-${mode}-${session.id.replace(/[:.]/g, '-')}`;
  download(name + '.json', JSON.stringify(report, null, 2), 'application/json');
  notice('Đã xuất báo cáo JSON gồm cấu hình, hiệu chuẩn, thống kê, sự kiện và mẫu EAR. Không chứa ảnh hoặc video.');
}

$('start-camera').addEventListener('click', startCamera);
$('start-video').addEventListener('click', () => $('video-file').click());
$('video-file').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  startVideoFile(file);
});
$('start-simulation').addEventListener('click', startSimulation);
$('stop').addEventListener('click', () => { stopSession(); notice(); });
$('calibrate').addEventListener('click', beginCalibration);
$('export').addEventListener('click', exportSession);
$('sound').addEventListener('change', initAudio);
$('alert-duration').addEventListener('input', () => {
  const value = Number($('alert-duration').value).toFixed(1);
  $('duration-output').textContent = `${value} giây`; $('duration-scale').textContent = `Ngưỡng ${value} giây`;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (running || loading)) { stopSession('Tạm dừng khi rời tab'); notice('Phiên đã dừng vì tab bị ẩn. Bắt đầu lại khi bạn sẵn sàng để tránh bỏ sót khung hình.'); }
});
window.addEventListener('pagehide', () => { if (running || loading) stopSession('Đóng trang'); landmarker?.close(); });
controls(); drawChart();
