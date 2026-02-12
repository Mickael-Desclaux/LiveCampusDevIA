const { PrismaClient } = require('@prisma/client');

// PrismaClient instance singleton
const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'], // Logging SQL queries en dev
});

// Graceful shutdown
process.on('beforeExit', async () => {
    await prisma.$disconnect();
});

module.exports = prisma;
