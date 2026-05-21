const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const User = require('../models/User');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/v1/auth/google/callback';

/**
 * Khởi tạo Google OAuth Strategy.
 * Chỉ gọi hàm này nếu GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET đã được cấu hình.
 */
const initPassport = () => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('⚠️  GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET chưa được cấu hình. Google OAuth sẽ bị vô hiệu hoá.');
    return false;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const googleId = profile.id;
          const fullName = profile.displayName || 'Google User';
          const avatarUrl = profile.photos?.[0]?.value || null;

          if (!email) {
            return done(new Error('Không lấy được email từ tài khoản Google'), null);
          }

          // Tìm user đã tồn tại theo googleId hoặc email
          let user = await User.findOne({
            $or: [{ googleId }, { email }],
          });

          if (user) {
            // Cập nhật googleId nếu đăng nhập lần đầu bằng Google
            if (!user.googleId) {
              user.googleId = googleId;
            }
            if (!user.avatarUrl && avatarUrl) {
              user.avatarUrl = avatarUrl;
            }
            user.lastLogin = new Date();
            await user.save({ validateBeforeSave: false });
          } else {
            // Tạo user mới từ Google
            const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
            let username = baseUsername;
            let counter = 1;

            // Đảm bảo username không bị trùng
            while (await User.exists({ username })) {
              username = `${baseUsername}_${counter++}`;
            }

            user = await User.create({
              googleId,
              email,
              username,
              fullName,
              avatarUrl,
              emailVerified: true, // Google đã xác minh email
              active: true,
              role: 'customer',
              lastLogin: new Date(),
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );

  console.log('✅ Google OAuth Strategy đã được khởi tạo');
  return true;
};

module.exports = { initPassport, passport };
