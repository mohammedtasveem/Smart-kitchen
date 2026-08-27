/**
 * Quick WhatsApp E2E test: start server, add expiring item, sweep, dispatch.
 * Run with: node tests/whatsapp-test.mjs
 */
import { createServer } from 'http';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { pingDatabase, closePool } from '../src/config/db.js';
import { startScheduler, stopScheduler } from '../src/jobs/scheduler.js';

const BASE = `http://localhost:${env.port}/api`;

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  return res.json();
}

try {
  // Start server
  const server = app.listen(env.port, async () => {
    console.log(`[test] server on :${env.port}`);

    const ping = await pingDatabase();
    if (!ping.ok) {
      console.error('[test] DB not connected:', ping.error);
      process.exit(1);
    }
    console.log('[test] DB connected');

    try {
      // 1. Signup
      const ts = Date.now();
      const email = `watest${ts}@test.com`;
      const phone = '+918748933206';
      console.log(`\n[1] Signing up ${email} with phone ${phone}...`);

      const signup = await api('POST', '/auth/signup', {
        body: { name: 'WhatsApp Test', email, password: 'test12345', phone },
      });
      if (!signup.ok) throw new Error('Signup failed: ' + JSON.stringify(signup));
      const token = signup.token;
      console.log('    ✓ Signup OK, user id:', signup.user.id);

      // 2. Add expiring item (tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const expDate = tomorrow.toISOString().split('T')[0];
      console.log(`\n[2] Adding "Amul Milk" expiring ${expDate}...`);

      const item = await api('POST', '/food-items', {
        token,
        body: { name: 'Amul Milk', quantity: 2, unit: 'litre', expiryDate: expDate },
      });
      if (!item.ok) throw new Error('Add item failed: ' + JSON.stringify(item));
      console.log('    ✓ Item added, id:', item.item.id, 'status:', item.item.expiryStatus);

      // 3. Run sweep
      console.log('\n[3] Running expiry sweep...');
      const sweep = await api('POST', '/notifications/check', { token });
      if (!sweep.ok) throw new Error('Sweep failed: ' + JSON.stringify(sweep));
      console.log('    ✓ Sweep result:', JSON.stringify(sweep.result));

      // 4. Check notifications
      console.log('\n[4] Checking notifications...');
      const notifs = await api('GET', '/notifications', { token });
      console.log('    ✓ Notifications:', notifs.count, 'total');
      if (notifs.notifications?.length > 0) {
        for (const n of notifs.notifications) {
          console.log(`      - [${n.status}] ${n.type}: ${n.message} (channel: ${n.channel})`);
        }
      }

      // 5. Dispatch (send WhatsApp)
      console.log('\n[5] Running WhatsApp dispatch...');
      const dispatch = await api('POST', '/notifications/send', { token });
      if (!dispatch.ok) throw new Error('Dispatch failed: ' + JSON.stringify(dispatch));
      console.log('    ✓ Dispatch result:');
      console.log('      dryRun:', dispatch.result.dryRun);
      console.log('      messagesSent:', dispatch.result.messagesSent);
      console.log('      alertsSent:', dispatch.result.alertsSent);
      console.log('      alertsFailed:', dispatch.result.alertsFailed);
      if (dispatch.result.errors?.length > 0) {
        for (const e of dispatch.result.errors) {
          console.log(`      ERROR: ${e.error} (permanent: ${e.permanent})`);
        }
      }

      // 6. Final notification status
      console.log('\n[6] Final notification status...');
      const final = await api('GET', '/notifications', { token });
      if (final.notifications?.length > 0) {
        for (const n of final.notifications) {
          console.log(`      - [${n.status}] ${n.type}: ${n.message} (sentAt: ${n.sentAt})`);
        }
      }

      console.log('\n✅ WhatsApp E2E test complete!');
      if (dispatch.result.dryRun) {
        console.log('   ⚠️  Messages were DRY RUN — check server logs for the message text');
        console.log('   ⚠️  Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env');
      } else if (dispatch.result.alertsSent > 0) {
        console.log('   📱 Check your WhatsApp — message should arrive!');
      }

    } catch (err) {
      console.error('\n❌ Test failed:', err.message);
    } finally {
      await stopScheduler();
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 5000).unref();
    }
  });
} catch (err) {
  console.error('[fatal]', err);
  process.exit(1);
}
