'use strict';

/**
 * Email Service — BookEat
 * Sử dụng nodemailer + Gmail SMTP (App Password)
 * Đọc cấu hình từ .env, KHÔNG hardcode credential
 */

const nodemailer = require('nodemailer');

// ─── Khởi tạo transporter một lần (singleton) ───
let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;

  const host     = process.env.MAIL_HOST;
  const port     = Number(process.env.MAIL_PORT) || 587;
  const user     = process.env.MAIL_USERNAME;
  const pass     = process.env.MAIL_PASSWORD;

  // Thiếu cấu hình → trả null, email sẽ được log ra console
  if (!host || !user || !pass) {
    console.warn('⚠️  [EmailService] Thiếu MAIL_HOST/MAIL_USERNAME/MAIL_PASSWORD — email sẽ được log ra console.');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,   // true chỉ khi dùng port 465 (SSL)
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  console.log('✅ [EmailService] SMTP transporter đã khởi tạo.');
  return _transporter;
};

// ─── Kiểm tra kết nối SMTP ───
const verifySmtp = async () => {
  const transporter = getTransporter();
  if (!transporter) return { ok: false, message: 'Chưa cấu hình SMTP' };

  try {
    await transporter.verify();
    return { ok: true, message: 'SMTP kết nối thành công' };
  } catch (err) {
    // KHÔNG log password, chỉ log message lỗi
    console.error('❌ [EmailService] SMTP verify thất bại:', err.message);
    return { ok: false, message: err.message };
  }
};

// ─── Hàm gửi mail cốt lõi ───
const sendMail = async ({ to, subject, html, text }) => {
  const transporter = getTransporter();
  const from        = process.env.MAIL_FROM || 'Book Eat <noreply@bookeat.com>';
  const replyTo     = process.env.MAIL_REPLY_TO;

  const mailOptions = { from, to, subject, html, text, ...(replyTo && { replyTo }) };

  if (!transporter) {
    // Fallback: log ra console khi không có SMTP
    console.log('📧 [EmailService][MOCK] ─────────────────────────');
    console.log(`   To      : ${to}`);
    console.log(`   Subject : ${subject}`);
    console.log(`   Body    :\n${text || '(html only)'}`);
    console.log('─────────────────────────────────────────────────');
    return { mock: true };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📤 [EmailService] Gửi thành công → ${to} (messageId: ${info.messageId})`);
    return info;
  } catch (err) {
    console.error(`❌ [EmailService] Gửi thất bại → ${to}: ${err.message}`);
    throw err; // để caller xử lý
  }
};

// ─── A. Verify account email ───
const sendVerificationEmail = async (user, token) => {
  const frontendUrl    = process.env.FRONTEND_URL || 'http://localhost:5173';
  const verifyUrl      = `${frontendUrl}/auth/verify-email?token=${token}`;
  const subject        = '📧 Xác minh tài khoản — BookEat';

  const html = buildVerifyEmailTemplate({
    fullName: user.fullName,
    verifyUrl,
    expiresHours: 24,
  });

  const text = `Xin chào ${user.fullName},\n\nVui lòng xác minh tài khoản BookEat của bạn:\n${verifyUrl}\n\nLink hết hạn sau 24 giờ.\n\nBookEat Team`;

  await sendMail({ to: user.email, subject, html, text });
};

// ─── B. Resend verify email ───
const sendResendVerificationEmail = async (user, token) => {
  // Dùng lại template verify nhưng thay subject
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const verifyUrl   = `${frontendUrl}/auth/verify-email?token=${token}`;
  const subject     = '🔁 Gửi lại xác minh tài khoản — BookEat';

  const html = buildVerifyEmailTemplate({
    fullName: user.fullName,
    verifyUrl,
    expiresHours: 24,
    isResend: true,
  });

  const text = `Xin chào ${user.fullName},\n\nĐây là email xác minh mới:\n${verifyUrl}\n\nLink hết hạn sau 24 giờ.\n\nBookEat Team`;

  await sendMail({ to: user.email, subject, html, text });
};

// ─── C. Forgot password email ───
const sendForgotPasswordEmail = async (user, token) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetUrl    = `${frontendUrl}/auth/reset-password?token=${token}`;
  const subject     = '🔑 Đặt lại mật khẩu — BookEat';

  const html = buildResetPasswordTemplate({ fullName: user.fullName, resetUrl, expiresMinutes: 60 });
  const text = `Xin chào ${user.fullName},\n\nĐặt lại mật khẩu tại:\n${resetUrl}\n\nLink hết hạn sau 60 phút.\n\nBookEat Team`;

  await sendMail({ to: user.email, subject, html, text });
};

// ─── D. Admin notification khi có user mới ───
const sendAdminNewUserNotification = async (user) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return; // Không bắt buộc

  const subject = `👤 Người dùng mới đăng ký — ${user.username}`;
  const text = [
    `Có người dùng mới đăng ký trên BookEat:`,
    ``,
    `Tên       : ${user.fullName}`,
    `Username  : ${user.username}`,
    `Email     : ${user.email}`,
    `Vai trò   : ${user.role}`,
    `Thời gian : ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
  ].join('\n');

  const html = buildAdminNotificationTemplate({ user });

  // Không throw — admin notification thất bại không được làm hỏng flow đăng ký
  try {
    await sendMail({ to: adminEmail, subject, html, text });
  } catch (err) {
    console.warn('⚠️  [EmailService] Admin notification thất bại (bỏ qua):', err.message);
  }
};

// ═══════════════════════════════════════════════
//   EMAIL TEMPLATES — HTML
// ═══════════════════════════════════════════════

const baseLayout = (bodyContent) => `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BookEat</title>
</head>
<body style="margin:0;padding:0;background:#f4f0eb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0eb;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e8e0d4;">
          <!-- Header -->
          <tr>
            <td style="background:#2c2c2c;padding:28px 36px;text-align:center;">
              <div style="font-family:Georgia,serif;font-size:28px;font-weight:300;color:#d8cbb8;letter-spacing:-0.5px;">
                🍽️ BookEat
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f6f2;border-top:1px solid #e8e0d4;padding:20px 36px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.6;">
                Email này được gửi tự động từ <strong>BookEat</strong>.<br/>
                Vui lòng không trả lời email này.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// Template A/B: Xác minh tài khoản
const buildVerifyEmailTemplate = ({ fullName, verifyUrl, expiresHours, isResend = false }) =>
  baseLayout(`
    <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:26px;font-weight:300;color:#2c2c2c;letter-spacing:-0.5px;">
      ${isResend ? 'Gửi lại xác minh tài khoản' : 'Xác minh tài khoản'}
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#b6ab9c;">BookEat</p>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.6;">
      Xin chào <strong>${fullName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.7;">
      ${isResend
        ? 'Bạn vừa yêu cầu gửi lại email xác minh.'
        : 'Cảm ơn bạn đã đăng ký tài khoản tại BookEat!'
      }
      Vui lòng nhấn nút bên dưới để xác minh địa chỉ email và kích hoạt tài khoản của bạn.
    </p>
    <!-- CTA Button -->
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#d8cbb8;">
          <a href="${verifyUrl}"
             style="display:inline-block;padding:14px 32px;color:#2c2c2c;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
            ✅ Xác minh tài khoản
          </a>
        </td>
      </tr>
    </table>
    <!-- Fallback link -->
    <p style="margin:0 0 8px;font-size:13px;color:#888;line-height:1.6;">
      Nếu nút trên không hoạt động, hãy sao chép link sau vào trình duyệt:
    </p>
    <p style="margin:0 0 24px;word-break:break-all;">
      <a href="${verifyUrl}" style="font-size:12px;color:#d49653;text-decoration:none;">${verifyUrl}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#aaa;border-top:1px solid #f0ece6;padding-top:16px;">
      ⏱️ Link này có hiệu lực trong <strong>${expiresHours} giờ</strong>.<br/>
      Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email này.
    </p>
  `);

// Template C: Quên mật khẩu
const buildResetPasswordTemplate = ({ fullName, resetUrl, expiresMinutes }) =>
  baseLayout(`
    <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:26px;font-weight:300;color:#2c2c2c;letter-spacing:-0.5px;">
      Đặt lại mật khẩu
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#b6ab9c;">BookEat</p>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.6;">
      Xin chào <strong>${fullName}</strong>,
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.7;">
      Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.
      Nhấn nút bên dưới để tiến hành đặt lại mật khẩu mới.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:#d8cbb8;">
          <a href="${resetUrl}"
             style="display:inline-block;padding:14px 32px;color:#2c2c2c;font-size:15px;font-weight:600;text-decoration:none;">
            🔑 Đặt lại mật khẩu
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#888;">
      Nếu nút trên không hoạt động, hãy sao chép link sau:
    </p>
    <p style="margin:0 0 24px;word-break:break-all;">
      <a href="${resetUrl}" style="font-size:12px;color:#d49653;text-decoration:none;">${resetUrl}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#aaa;border-top:1px solid #f0ece6;padding-top:16px;">
      ⏱️ Link này có hiệu lực trong <strong>${expiresMinutes} phút</strong>.<br/>
      Nếu bạn không yêu cầu, hãy bỏ qua email này. Mật khẩu của bạn sẽ không thay đổi.
    </p>
  `);

// Template D: Admin notification
const buildAdminNotificationTemplate = ({ user }) =>
  baseLayout(`
    <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:24px;font-weight:300;color:#2c2c2c;">
      👤 Người dùng mới đăng ký
    </h1>
    <p style="margin:0 0 24px;font-size:14px;color:#b6ab9c;">Thông báo hệ thống — BookEat</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e0d4;">
      ${[
        ['Họ và tên',  user.fullName],
        ['Username',   user.username],
        ['Email',      user.email],
        ['Vai trò',    user.role === 'restaurant_owner' ? 'Chủ nhà hàng' : 'Khách hàng'],
        ['Thời gian',  new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })],
      ].map(([label, value], i) => `
        <tr style="background:${i % 2 === 0 ? '#faf8f5' : '#ffffff'}">
          <td style="padding:10px 16px;font-size:13px;color:#888;width:40%;border-bottom:1px solid #f0ece6;">${label}</td>
          <td style="padding:10px 16px;font-size:13px;color:#2c2c2c;border-bottom:1px solid #f0ece6;"><strong>${value}</strong></td>
        </tr>
      `).join('')}
    </table>
  `);

module.exports = {
  verifySmtp,
  sendVerificationEmail,
  sendResendVerificationEmail,
  sendForgotPasswordEmail,
  sendAdminNewUserNotification,
};
