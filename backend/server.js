import app from './src/app.js';
import { env, checkEnv } from './src/config/env.js';
import { pingDatabase, closePool, explainDbError } from './src/config/db.js';
import { startScheduler, stopScheduler } from './src/jobs/scheduler.js';

checkEnv();

const server = app.listen(env.port, async () => {
  console.log(`[server] listening on http://localhost:${env.port}  (${env.nodeEnv})`);

  // Report DB status at boot, but do NOT crash on failure -- during setup the
  // server should still start so /api/health works and explains what is wrong.
  const ping = await pingDatabase();
  if (ping.ok) {
    console.log(`[db]     connected to "${env.db.database}" @ ${env.db.host}:${env.db.port}`);
    // Only after a confirmed connection: a sweep against a dead database would
    // just log a failure every night for no reason.
    startScheduler();
  } else {
    console.warn(`[db]     NOT connected -- ${ping.error}`);
    const hint = explainDbError(ping.code);
    if (hint) console.warn(`[db]     hint: ${hint}`);
    console.warn('[sweep]  not scheduled -- no database connection');
  }
});

async function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down...`);
  server.close(async () => {
    // Stop the cron task before the pool closes, so an in-flight sweep is not
    // cut off mid-query.
    await stopScheduler();
    await closePool();
    console.log('[server] closed cleanly');
    process.exit(0);
  });
  // Don't hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled promise rejection:', reason);
});
