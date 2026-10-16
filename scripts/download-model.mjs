import { mkdir, stat, rename, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'models/face_landmarker.task');
const url = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const expectedHash = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';
const sha256 = data => createHash('sha256').update(data).digest('hex');
try {
  const exists = (await stat(target).catch(() => null))?.isFile();
  if (exists && sha256(await readFile(target)) === expectedHash) {
    console.log('Model đã có sẵn: models/face_landmarker.task');
  } else {
    await mkdir(dirname(target), { recursive: true });
    console.log('Đang tải MediaPipe Face Landmarker (~3.8 MB)…');
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    // MediaPipe task bundles can have a short prefix before their ZIP signature.
    const zipOffset = buffer.subarray(0, 64).indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (buffer.length < 1000000 || zipOffset < 0) throw new Error('Model tải về không hợp lệ');
    if (sha256(buffer) !== expectedHash) throw new Error('SHA-256 của model không khớp phiên bản được khóa');
    await writeFile(target + '.partial', buffer);
    await rename(target + '.partial', target);
    console.log(`Đã tải ${buffer.length} bytes. SHA-256: ${sha256(buffer)}`);
  }
} catch (error) {
  await rm(target + '.partial', { force: true });
  console.error(`Không tải được model: ${error.message}. Kiểm tra Internet rồi chạy lại npm run setup.`);
  process.exitCode = 1;
}
