---
paths:
  - "*.html"
  - "**/*.html"
---

# Quy tắc HTML Template

- Luôn dùng `lang="vi"` trong thẻ `<html>`
- Encoding: `<meta charset="UTF-8"/>`
- Không thêm thư viện CSS/JS ngoài từ CDN (trang phải chạy được offline)
- CSS variables phải khai báo trong `:root { }` ở đầu `<style>`
- Ảnh avatar phải có `onerror` fallback hiển thị chữ cái đầu tên
