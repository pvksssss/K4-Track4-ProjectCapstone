import { FaceLandmarker, FilesetResolver } from '/vendor/vision_bundle.mjs';
const output = document.getElementById('result');
let model;
try {
  const files = await FilesetResolver.forVisionTasks('/vendor/wasm');
  const options = { baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1 };
  let delegate = 'GPU';
  try { model = await FaceLandmarker.createFromOptions(files, options); }
  catch { delegate = 'CPU'; options.baseOptions.delegate = delegate; model = await FaceLandmarker.createFromOptions(files, options); }
  const canvas = document.getElementById('input');
  canvas.getContext('2d').fillRect(0, 0, 640, 480);
  const start = performance.now();
  const result = model.detectForVideo(canvas, start);
  const elapsed = performance.now() - start;
  if (!Array.isArray(result.faceLandmarks) || result.faceLandmarks.length !== 0) throw new Error('Expected zero faces on blank input');
  output.dataset.status = 'passed';
  output.textContent = `PASS\nModel initialized (${delegate}).\nVideo inference returned 0 faces on a blank 640×480 canvas.\nFirst blank-frame inference: ${elapsed.toFixed(1)} ms.\nNo camera permission requested.\nThis is a runtime smoke test, not a recognition accuracy benchmark.`;
} catch (error) {
  output.dataset.status = 'failed'; output.textContent = `FAIL\n${error.stack || error.message}`;
} finally { model?.close(); }
