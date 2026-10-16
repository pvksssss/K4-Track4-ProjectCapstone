# Đánh giá, số đo và ca lỗi

## Những gì đã có thể chứng minh

`npm test` kiểm tra 10 tình huống logic/hình học: chớp mắt 200 ms, cảnh báo sau 1500 ms, một cảnh báo mỗi đợt nhắm, mất tín hiệu, khung hình bị gián đoạn, tỉ lệ theo thời lượng, timestamp lặp, EAR không hợp lệ, hiệu chuẩn và nháy một mắt.

Đây là phép thử trên đầu vào tổng hợp với kết quả kỳ vọng đã biết, không phải đánh giá độ chính xác của MediaPipe hay kết luận về buồn ngủ thực tế. Tương tự, trang `tests/model-smoke.html` chỉ xác nhận runtime/model tải được và thực hiện suy luận trên khung hình trống.

## Quy trình thu bằng chứng trên webcam

Dùng thành viên đội tự đóng vai, cùng một laptop, camera, độ phân giải và ngưỡng thời gian. Chỉ thực hiện khi ngồi yên. Thống nhất một người thao tác và một người ghi mốc thời gian/lần thử; dùng video màn hình để kiểm chứng độ trễ nếu cần. Không dùng dữ liệu thật của bệnh nhân hoặc sinh viên ngoài đội.

Đề xuất tập thử nhỏ để bắt đầu: 3 người × 3 điều kiện (sáng đủ, thiếu sáng, đeo kính nếu có) × 3 động tác (mắt mở/chớp tự nhiên, nhắm 2–3 giây, rời khung). Mỗi lần thử 20–30 giây và hiệu chuẩn lại khi đổi người/điều kiện. Đây là đề xuất thu dữ liệu, chưa phải tập dữ liệu đã được thu hay có nhãn thật.

1. Bật webcam, hiệu chuẩn đúng hướng dẫn. Nếu không hiệu chuẩn được, ghi nhận thất bại thay vì bỏ khỏi mẫu thử.
2. Ghi người tham gia bằng mã P01/P02/P03, điều kiện ánh sáng và kính; không cần danh tính.
3. Ghi mốc bắt đầu và kết thúc hành động theo video/người quan sát độc lập. Nhãn phải đến từ thao tác thật, không lấy trạng thái dự đoán làm nhãn.
4. Thực hiện động tác; đợi phản hồi. Ghi nhắm mắt có cảnh báo không, chớp mắt có báo nhầm không, mất mặt có bị kết luận nhắm không.
5. Dừng phiên và xuất JSON trước khi bắt đầu phiên tiếp theo. Ghi cấu hình và tên file tương ứng.
6. Quay video dự phòng riêng; chỉ giữ/chia sẻ trong phạm vi người tham gia đã đồng ý.

## Bảng kết quả cần điền từ thử nghiệm

| Chỉ số | Cách đo | Kết quả thật |
|---|---|---|
| Số lần nhắm dài phát hiện đúng / tổng lần nhắm dài | Một cảnh báo khớp một đợt nhắm đã được người quan sát ghi nhận | Chưa đo |
| Số cảnh báo nhầm / giờ mắt mở | Đếm cảnh báo khi nhãn thật không có nhắm dài, chia cho giờ quan sát hợp lệ | Chưa đo |
| Độ trễ từ nhắm thật đến cảnh báo | Timestamp video thật → sự kiện cảnh báo; báo median/P95 theo các lần thử | Chưa đo |
| Độ trễ model mean/P95 | JSON `summary.recentInferenceMeanMs` / `recentInferenceP95Ms`; tối đa 300 khung gần nhất | Chưa đo trên người |
| Độ phủ tín hiệu | `validMs / (validMs + unknownMs)` sau hiệu chuẩn; kèm độ dài phiên | Chưa đo |
| Tỉ lệ hiệu chuẩn thành công | Số lần thu đủ 3 giây hợp lệ / tổng lần bắt đầu hiệu chuẩn | Chưa đo |

## Kết quả đã đo trên tệp video dự phòng (không phải người thật)

Bảng trên vẫn để trống vì chưa có ai ngồi trước webcam. Để chứng minh đường chạy đầu-cuối hoạt động, nhóm đã chạy một tệp video 20 giây ghép từ ba đoạn (mắt mở → mắt nhắm → nền xám → mắt mở lại) qua nút **Video dự phòng**. Đây là **bằng chứng đường chạy**, không phải số liệt độ chính xác:

| Đoạn | Kết quả quan sát |
|---|---|
| 0–9s mắt mở | Hiệu chuẩn hoàn tất lúc 7.7s; EAR mở 0.263 → ngưỡng cá nhân 0.179 |
| 9–15s mắt nhắm | EAR rơi xuống 0.022–0.026; cảnh báo đúng một lần lúc 11.0s với `closedMs = 1.5s` |
| 15–18s nền xám | Trạng thái “Thiếu tín hiệu”, bộ đếm nhắm mắt bị ngắt |
| 18–20s mắt mở lại | Tín hiệu trở lại, bộ đếm chạy lại từ đầu |

JSON xuất cho phiên đó: `source: video`, `evidenceClass: pre-recorded-file`, 1 cảnh báo, 76 mẫu, `validMs` 9555, `unknownMs` 3076, suy luận mean 43.1 ms / P95 35.5 ms (laptop đang chạy mô phỏng Chrome). Không suy ra từ đây bất kỳ kết luận nào về độ chính xác trên người.

Lưu ý vận hành: lần suy luận đầu tiên của một phiên mất khoảng 4–5 giây để khởi động GPU. Nếu tệp video không mở đầu bằng đủ thời gian mắt mở, hiệu chuẩn 3 giây sẽ không kịp và cảnh báo bị tạm dừng. Chuẩn bị tệp mở đầu bằng khoảng 8–10 giây mắt mở.

Không gọi thời gian suy luận là độ trễ toàn hệ thống. Ứng dụng giới hạn khoảng 15 lần suy luận/giây; tốc độ thực phụ thuộc laptop. Mốc 1.5 giây là ngưỡng logic sau mẫu đầu tiên được nhận là nhắm, có sai số lấy mẫu và nhận diện so với thời điểm người thật bắt đầu nhắm.

Mẫu JSON xuất mỗi ~200 ms phục vụ xem lại, không chứa toàn bộ khung suy luận. Dùng sự kiện cảnh báo và video có timestamp nếu cần độ trễ chính xác hơn; không dùng khoảng cách hai hàng JSON để khẳng định thời gian phản hồi từng khung.

## Một ca lỗi nên trình bày

**Kính râm/tối màu**: camera không quan sát được mí mắt, nhưng model có thể vẫn dự đoán mốc trên vùng kính. Hình học có vẻ hợp lệ không đồng nghĩa mắt đã được nhìn thấy đúng. EAR có thể không thay đổi khi người đóng vai nhắm mắt, làm hệ thống bỏ sót hoặc báo nhầm. Thử trực tiếp và ghi đúng kết quả quan sát; nếu không tái hiện được, chọn ca khác có bằng chứng thay vì khẳng định đã quan sát lỗi này.

Một ca dễ lặp lại khác là quay đầu/rời khung: hệ thống chuyển sang thiếu tín hiệu và ngắt đếm. Đây là hành vi xử lý giới hạn, không phải bằng chứng rằng model nhận biết đúng mọi trạng thái quay đầu.

**Hướng cải thiện**: bộ kiểm tra khả năng nhìn thấy mắt, cảm biến hồng ngoại cho cabin, đánh giá nhiều góc camera và dữ liệu kính/ánh sáng; kiểm chứng độc lập trước khi dùng thực tế. Việc sàng lọc hiện tại chỉ kiểm tra kích thước mặt, độ lệch mũi, góc đường mắt và biên ảnh; không có mô hình độ sáng/che khuất đã được kiểm chứng.

## Ý nghĩa các trường trong log

- `session.source`: `camera` hoặc `simulation`; không gộp hai nguồn để tính độ chính xác.
- `session.calibrations`: EAR mở, ngưỡng, số mẫu và thời điểm hiệu chuẩn thành công.
- `samples[].valid`: hình học mốc hợp lệ; không phải nhãn đúng/sai của model. Trong hiệu chuẩn, trạng thái `calibrating` bị loại khỏi phép tính mắt.
- `samples[].perclos`: tỉ lệ thời gian EAR dưới ngưỡng trên thời gian hợp lệ trong cửa sổ 60 giây, có tính chớp mắt; không phải phép đo PERCLOS lâm sàng.
- `events`: thời điểm theo mili giây từ đầu phiên. `alert` có thời lượng nhắm đã quan sát; một đợt nhắm chỉ tăng một lần.
- `summary`: bộ đếm từ lần hiệu chuẩn thành công gần nhất, khác với toàn bộ sự kiện trong phiên khi hiệu chuẩn lại. Thống kê suy luận lấy tối đa 300 lần suy luận gần nhất, có thể gồm bước hiệu chuẩn.
- Thiếu tín hiệu hoặc khoảng cách khung hình >600 ms được tính vào `unknownMs`, không tính là mắt mở hay mắt nhắm.
- Bắt đầu phiên mới sẽ thay thế dữ liệu trong RAM. Bộ đệm giữ tối đa 9000 mẫu và 1000 sự kiện, nên xuất sớm với phiên dài.
