const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully');
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '🍽️ BookEat API is running (Minimal Test Version)',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Base route
app.get('/', (req, res) => {
  res.json({ message: '🍽️ Welcome to BookEat API (Minimal Test Version)' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.url} not found` });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 BookEat Minimal API running at: http://localhost:${PORT}`);
}).on('error', (err) => {
  console.error('❌ Server startup error:', err.message);
  process.exit(1);
});
