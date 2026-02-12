require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// ============================================
// ROUTES - À implémenter feature par feature
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// Routes seront ajoutées progressivement :
// - /api/cart (F1)
// - /api/payment (F5)
// - /api/cart/recover/:token (F6)

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
    console.error(err.stack);

    // Prisma errors
    if (err.code && err.code.startsWith('P')) {
        return res.status(400).json({
            error: 'DATABASE_ERROR',
            code: err.code
        });
    }

    res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: err.message
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
