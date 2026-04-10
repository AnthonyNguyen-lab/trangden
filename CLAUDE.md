# Trangden Portfolio Builder

## Tổng quan dự án
Script Node.js tự động tạo portfolio HTML và nộp bài lên trangden.vn qua Puppeteer.

## Lệnh thường dùng
- Chạy: `node run.js`
- Cài thư viện: `npm install`
- Xem log server: `python3 -m http.server 8080`

## Cấu trúc file
- `run.js` — Script chính: lấy dữ liệu → tạo HTML → chụp ảnh → nộp bài
- `index.html` — Portfolio HTML được sinh ra tự động (không sửa tay)
- `html2canvas.min.js` — Thư viện chụp ảnh phía browser

## Quy tắc code

### Tổng quát
- Dùng tiếng Việt cho log/comment giải thích
- Giữ nguyên hàm `buildHTML` ở cuối file `run.js`
- Không thêm dependency mới nếu không thực sự cần thiết

### Puppeteer
- Luôn dùng `headless: 'new'` (không dùng `true`/`false`)
- Đóng browser bằng `browser.close()` trong mọi trường hợp (kể cả lỗi)
- Timeout mặc định: 20000ms cho `goto`, 10000ms cho fallback

### API / Fetch
- Thử browser fetch trước, fallback sang Node.js nếu lỗi
- Không log token hoặc thông tin nhạy cảm ra console
- Dùng `FAKE_VALUES` set để lọc dữ liệu giả từ API

### HTML template
- CSS variables dùng prefix `--` (ví dụ: `--bg`, `--p1`, `--acc`)
- Responsive: grid 2 cột trên desktop, 1 cột trên mobile (`max-width: 580px`)
- Không dùng framework CSS ngoài (chỉ dùng CSS thuần)

## Thông tin quan trọng
- `MY_ID` và `MY_TOKEN` là thông tin xác thực — không commit lên git công khai
- `F_ID` và `F_QUEST` là ID của người bạn cần tìm thông tin
- File `preview.png` được tạo tự động sau khi chạy script
