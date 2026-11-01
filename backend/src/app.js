import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.set('trust proxy', 1);

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.isProduction ? 'combined' : 'dev'));

app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'Smart Food Inventory API',
    docs: '/api/health',
  });
});

app.use('/api', routes);

// ESP32-CAM photos (Phase 10), served from the same origin as the API so the
// review screen can use a relative /uploads/... URL in every environment.
// readFileSync is not involved; express.static streams from disk and sets
// its own content type. The directory need not exist yet -- static simply
// answers 404 until the first upload creates it.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.use('/uploads', express.static(path.join(backendRoot, 'uploads')));

// Order matters: 404 first, then the error handler last.
app.use(notFound);
app.use(errorHandler);

export default app;
