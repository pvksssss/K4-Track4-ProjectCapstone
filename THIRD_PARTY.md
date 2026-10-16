# Tài nguyên bên thứ ba

- **MediaPipe Tasks Vision 0.10.32** (`@mediapipe/tasks-vision`): runtime JavaScript/WASM từ npm, giấy phép Apache-2.0 theo package. Cài bằng `npm install`; phiên bản và integrity được khóa trong `package-lock.json`. Giữ các thông báo giấy phép của package khi phân phối runtime.
- **MediaPipe Face Landmarker float16, revision 1**: tải từ `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` bằng `npm run setup`. Không đưa bản nhị phân vào Git. SHA-256 bản được kiểm tra: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
- Tài liệu API: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Nguồn và thông tin model: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/index#models

Giao diện chính dùng font hệ thống và hình vector/canvas trong repo, không gọi Google Fonts/CDN. `hackathon.html` giữ nguyên nội dung đề bài ban đầu, bao gồm liên kết Google Fonts của trang gốc.
