const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Passport — cần khởi tạo trước khi dùng routes
const { passport } = require('./src/config/passport.config');
app.use(passport.initialize());

// CORS — cho phép FE (Vite :5173) gọi API
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─────────────────────────────────────────────
// Kết nối MongoDB
// ─────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
// Health check — FE dùng để kiểm tra BE đang chạy
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '🍽️ BookEat API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Base route
app.get('/', (req, res) => {
  res.json({ message: '🍽️ Welcome to BookEat API', version: '1.0.0' });
});

// API routes (sẽ thêm dần)
const apiRouter = express.Router();
app.use('/api/v1', apiRouter);

// TODO: Thêm routes ở đây
apiRouter.use('/auth', require('./src/routes/auth.routes'));
// apiRouter.use('/restaurants', require('./src/routes/restaurant.routes'));
// apiRouter.use('/bookings', require('./src/routes/booking.routes'));

// Test route
apiRouter.get('/ping', (req, res) => {
  res.json({ message: 'pong 🏓', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.url} not found` });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 BookEat API running at: http://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 API base: http://localhost:${PORT}/api/v1`);
});
