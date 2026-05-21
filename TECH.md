# 🍽️ BookEat Backend — Công Nghệ Sử Dụng

## Tổng Quan

Backend của dự án **BookEat** được xây dựng theo kiến trúc RESTful API, cung cấp các dịch vụ dữ liệu cho ứng dụng đặt bàn nhà hàng.

---

## 🛠️ Ngôn Ngữ & Runtime

| Công nghệ | Phiên bản | Mô tả |
|-----------|-----------|-------|
| **JavaScript** | ES2020+ | Ngôn ngữ lập trình chính |
| **Node.js** | LTS | Môi trường runtime cho JavaScript phía server |

---

## 📦 Framework & Thư Viện Chính

| Tên | Phiên bản | Mục đích sử dụng |
|-----|-----------|-----------------|
| **Express.js** | ^5.2.1 | Web framework chính, xây dựng REST API |

---

## 🗂️ Hệ Thống Module

| Loại | Giá trị | Mô tả |
|------|---------|-------|
| **Module System** | CommonJS (`require` / `module.exports`) | Hệ thống module mặc định của Node.js |

---

## ⚙️ Cấu Trúc Dự Án

```
BookEat_BE_NodsJS/
├── index.js              # Entry point chính của ứng dụng
├── package.json          # Cấu hình dự án & dependencies
├── package-lock.json     # Lock file đảm bảo version nhất quán
└── node_modules/         # Thư viện bên thứ ba (không commit)
```

---

## 📋 Scripts

| Lệnh | Mô tả |
|------|-------|
| `npm test` | Chạy kiểm thử |

---

## 🚀 Khởi Chạy Dự Án

```bash
# Cài đặt dependencies
npm install

# Chạy server
node index.js

# Hoặc dùng nodemon (nếu đã cài)
npx nodemon index.js
```

---

## 🔮 Công Nghệ Dự Kiến Bổ Sung

> Các công nghệ có thể được tích hợp trong quá trình phát triển:

- **Database**: MongoDB (Mongoose)
- **Authentication**: JWT (jsonwebtoken), bcrypt
- **Validation**: Joi / express-validator
- **Environment**: dotenv
- **Dev Tool**: nodemon
- **API Docs**: Swagger / Postman

---

*Cập nhật lần cuối: 2026-05-21*
