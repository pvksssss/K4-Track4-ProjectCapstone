# Vin Driver Watch — Vin Perception Hackathon

Demo cảnh báo **hai mắt nhắm kéo dài** cho bối cảnh tài xế VinBus / VinFast. Webcam → MediaPipe Face Landmarker → hình học mắt (EAR) → bộ đếm theo thời gian → cảnh báo hình ảnh và âm thanh. Đây là một tín hiệu có thể liên quan đến buồn ngủ, không phải phép chẩn đoán buồn ngủ.

## Chạy ứng dụng

Cần **Node.js 20 trở lên**, Chrome hoặc Edge và webcam. Trong thư mục dự án:

```powershell
npm install
npm run setup
npm start
```

Mở **http://127.0.0.1:8080**. Không mở `index.html` bằng `file://`. Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` thay cho `npm`.

- Internet chỉ cần ở bước cài thư viện và tải model (~3.8 MB). Sau đó ứng dụng chạy cục bộ, không dùng API key, CDN hay dịch vụ AI bên ngoài.
- Bấm **Bắt đầu camera**, tự cấp quyền webcam, mở mắt tự nhiên và nhìn thẳng để hiệu chuẩn 3 giây. Thời gian chờ hiệu chuẩn tối đa 15 giây; không phát cảnh báo cho đến khi hiệu chuẩn thành công.
- Nhắm cả hai mắt trên ngưỡng thời gian đã chọn (mặc định 1.5 giây) để thử cảnh báo; mở mắt để kết thúc. Chớp mắt ngắn không báo động.
- Bấm **Chạy mô phỏng** để thử logic bằng tín hiệu tổng hợp trong 16 giây; chọn kịch bản trước khi chạy. Mô phỏng được ghi nhãn trên giao diện và trong file xuất.
- Bấm **Xuất dữ liệu phiên** để tải JSON chứa số đo, cấu hình, hiệu chuẩn và sự kiện; không chứa ảnh/video. Phiên mới thay thế dữ liệu của phiên trước, nên xuất trước khi bắt đầu phiên mới.
- Bấm **Dừng phiên** để tắt camera. Rời tab cũng dừng phiên. `Ctrl+C` tại terminal để dừng máy chủ.

Nếu cổng 8080 đã được dùng:

```powershell
$env:PORT=8081
npm start
```

## Chức năng

- Vẽ 6 mốc cho mỗi mắt lên video; tính EAR trong không gian pixel để tránh sai do tỉ lệ khung hình.
- Hiệu chuẩn cá nhân: phân vị 70% của EAR mắt mở × 0.68, giới hạn ngưỡng trong [0.10, 0.32].
- Dùng `max(EAR trái, EAR phải)` để yêu cầu cả hai mắt cùng nhắm; hạn chế báo nhầm khi nháy một mắt.
- Các trạng thái: chờ, hiệu chuẩn, đang quan sát, mắt đang nhắm, cảnh báo, thiếu tín hiệu.
- Mất mặt, mặt quá nhỏ, góc quay đầu lớn hoặc khoảng cách khung hình >600 ms ngắt bộ đếm nhắm mắt. Bộ lọc hình học không phải điểm confidence của model và không đảm bảo phát hiện mọi ảnh kém chất lượng.
- Biểu đồ EAR 30 giây; tỉ lệ nhắm mắt trên thời gian hợp lệ trong cửa sổ 60 giây; số lần cảnh báo/chớp mắt; thời gian suy luận thực tế. Tỉ lệ nhắm mắt này có tính chớp mắt ngắn, không phải PERCLOS lâm sàng đã được chuẩn hóa.
- Không ghi hay tải video lên server. Log tồn tại trong RAM, chỉ được lưu thành file khi bạn xuất. Mỗi phiên giữ tối đa 9000 mẫu (~30 phút), 1000 sự kiện; thống kê suy luận lấy 300 khung gần nhất. Hiệu chuẩn lại sẽ bắt đầu lại các bộ đếm và cửa sổ thống kê mắt.

## Kiểm tra

```powershell
npm test
npm run check
```

10 kiểm thử về hình học, chớp mắt, cảnh báo theo thời gian, mất tín hiệu, khung hình bị trễ, tỉ lệ cửa sổ trượt và hiệu chuẩn. Không cần webcam để chạy kiểm thử logic.

Khi server đang chạy, mở http://127.0.0.1:8080/tests/model-smoke.html để kiểm tra model thực sự khởi tạo và xử lý một canvas trống; không bật camera. Phép thử này không đo độ chính xác trên khuôn mặt người.

## Cấu trúc

```text
index.html                 Giao diện ứng dụng
hackathon.html             Trang đề bài gốc, được giữ nguyên
src/app.js                 Webcam, MediaPipe, hiệu chuẩn, giao diện, mô phỏng, xuất JSON
src/monitor.js             Hình học và bộ máy quyết định độc lập với giao diện
src/styles.css             Giao diện responsive
scripts/server.mjs         Server localhost, chỉ phục vụ tài nguyên được cho phép
scripts/download-model.mjs Tải model chính thức về models/
tests/                     Kiểm thử logic và kiểm tra model trong trình duyệt
docs/DEMO.md               Kịch bản trình bày 10 phút, giải thích kiến trúc và impact
docs/EVALUATION.md         Quy trình thu số đo thật, phân tích ca lỗi và giới hạn
```

## Giới hạn

Đây là prototype hackathon, chưa được kiểm chứng để dùng khi lái xe. Kính tối màu, ánh sáng yếu, mắt nhỏ, góc camera, cúi/quay đầu và mốc mắt sai có thể gây bỏ sót hoặc báo nhầm. Chỉ demo khi xe đang dừng; thành viên đội tự đóng vai. Chưa có dữ liệu thực nghiệm để tuyên bố độ chính xác hoặc giảm tai nạn. Xem [kịch bản demo](docs/DEMO.md) và [hướng dẫn đánh giá](docs/EVALUATION.md).

Model và runtime: [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js), `@mediapipe/tasks-vision` 0.10.32. Xem [nguồn tài nguyên](THIRD_PARTY.md).
