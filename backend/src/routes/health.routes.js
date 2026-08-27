import { Router } from 'express';
import { pingDatabase, query } from '../config/db.js';
import { explainDbError } from '../config/db.js';

const router = Router();

/** GET /api/health -- is the server up? (does not touch MySQL) */
router.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'smart-food-inventory-api',
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** GET /api/health/db -- is MySQL reachable, and which tables exist? */
router.get('/db', async (req, res) => {
  const ping = await pingDatabase();

  if (!ping.ok) {
    return res.status(503).json({
      ok: false,
      error: ping.error,
      code: ping.code,
      hint: explainDbError(ping.code),
    });
  }

  const [info] = await query('SELECT DATABASE() AS `database`, VERSION() AS version');
  const tables = await query(
    `SELECT TABLE_NAME AS name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`
  );

  res.json({
    ok: true,
    database: info.database,
    version: info.version,
    tables: tables.map((t) => t.name),
  });
});

export default router;
