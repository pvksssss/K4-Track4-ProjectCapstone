# Kết quả kiểm tra ngày 16/10/2026

## Tự động

- `npm test`: **10/10 pass**, gồm hình học EAR, chớp mắt ngắn, thời điểm cảnh báo 1500 ms, mất tín hiệu, khoảng trống khung hình, tỉ lệ theo thời lượng, timestamp lặp và hiệu chuẩn.
- `npm run check`: không có lỗi cú pháp. `tests/model-smoke.js` cũng qua `node --check`.
- `git diff --check`: không có lỗi whitespace.
- Model đã tải 3,758,596 bytes, SHA-256 khớp giá trị khóa trong script thiết lập. Chạy lại `npm run setup` xác nhận model đã có và hợp lệ.
- Nội dung `hackathon.html` tương đương trang đề bài ở HEAD, bỏ qua khác biệt LF/CRLF do checkout Windows.

## Trong Chrome

| Phép thử | Kết quả quan sát |
|---|---|
| Khởi tạo MediaPipe và suy luận VIDEO trên canvas trống 640×480 | PASS; delegate GPU; trả về 0 khuôn mặt, không hỏi quyền webcam |
| Mô phỏng nhắm mắt kéo dài | 1 cảnh báo, sự kiện ghi thời lượng 1.5 giây |
| Mô phỏng chớp mắt tự nhiên, 16 giây | 6 lần chớp, 0 cảnh báo |
| Mô phỏng mất khuôn mặt, 16 giây | 0 cảnh báo; có sự kiện mất tín hiệu và phục hồi |
| Rời tab trong phiên | Phiên tự dừng, dữ liệu còn để xuất |
| Xuất JSON từ phiên mô phỏng chớp mắt | File tải được và parse được; source=simulation, scenario=blink, alerts=0, blinks=6, 81 mẫu, 2 sự kiện |
| Bố cục cửa sổ hẹp | Cột giám sát và dữ liệu chuyển bố cục; DOM tại bề rộng thực tế 562 px không tràn ngang |

Các đường dẫn tài nguyên ứng dụng, JS, CSS, WASM, model và trang đề bài trả HTTP 200 với MIME tương ứng. Các đường dẫn `/.git/config`, `/package.json` và `/src/../package.json` trả 404.

## Chưa kiểm chứng

Chưa thử trực tiếp với người qua webcam, chưa đo độ chính xác nhận diện, độ trễ trên khuôn mặt người, âm lượng loa thực tế hoặc tác động khi triển khai trên xe. Các bước cần thực hiện trước buổi demo được mô tả trong `EVALUATION.md`. Số đo và mô phỏng ở trên không thay thế thử nghiệm thực tế.
