import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { trialRouter } from './routes/trial.js';
import { initMailer } from './config/mailer.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Allow CORS for Chrome Extensions and Localhost
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or extension service workers)
      if (!origin) return callback(null, true);
      if (
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1')
      ) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive in dev for easy integration
    },
    credentials: true,
  })
);

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'FormPilot Backend Server',
    time: new Date().toISOString(),
  });
});

// Trial & Auth Routes
app.use('/api/trial', trialRouter);

// Start server if run directly
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function startServer(port = PORT) {
  return initMailer().then(() => {
    return app.listen(port, () => {
      console.log(`\n======================================================`);
      console.log(`🚀 FormPilot Trial Server running at: http://localhost:${port}`);
      console.log(`📡 Health Check: http://localhost:${port}/api/health`);
      console.log(`======================================================\n`);
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer();
}

export default app;
