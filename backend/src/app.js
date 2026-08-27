import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

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

// Order matters: 404 first, then the error handler last.
app.use(notFound);
app.use(errorHandler);

export default app;
