import cron from 'node-cron';

import { env } from '../config/env.js';
import { runExpirySweep, describeSweep } from '../services/expirySweep.js';
import { runWhatsAppDispatch, describeDispatch } from '../services/whatsappDispatch.js';
import { isDryRun, isConfigured } from '../services/whatsapp.js';

/**
 * Scheduler for the two background jobs.
 *
 *   Phase 7  expiry sweep     -- decide who needs alerting, write the rows
 *   Phase 8  WhatsApp dispatch -- send the rows the sweep queued
 *
 * Deliberately thin: it owns *when* the jobs run and nothing about *what* they
 * do. That keeps both callable from a test, from the API, and from a plain
 * `npm run sweep` / `npm run dispatch` without dragging a scheduler along.
 *
 * The two are separate cron entries rather than one job calling the other,
 * because they fail for unrelated reasons: the sweep needs only the database,
 *dispatch needs the database *and* Meta's Cloud API. Chaining them would mean a WhatsApp
   * outage shows up in the logs as a sweep failure.
 *
 * On a real deployment (Phase 11) the OS scheduler is the better host -- see
 * `src/jobs/runSweep.js` and `src/jobs/runDispatch.js`. These in-process jobs
 * exist so the feature works with nothing but `npm run dev`, which is how it gets
 * demonstrated.
 */

const tasks = [];

/** Run once, swallowing failures -- a crashed job must not take the API down. */
async function safeRun(label, run, describe, trigger) {
  try {
    const result = await run();
    console.log(`[${label}] (${trigger}) ${describe(result)}`);
    return result;
  } catch (err) {
    console.error(`[${label}] (${trigger}) FAILED: ${err.message}`);
    return null;
  }
}

/**
 * Register one cron entry.
 *
 * Returns null instead of throwing on a bad expression, but logs it as an error:
 * a typo in `.env` should be loud at boot, not a job that silently never fires.
 */
function schedule({ label, name, cron: expr, timezone, run, describe }) {
  if (!cron.validate(expr)) {
    console.error(`[${label}] invalid cron "${expr}" -- this job will NOT run`);
    return null;
  }

  const task = cron.schedule(expr, () => safeRun(label, run, describe, 'scheduled'), {
    name,
    timezone,
    // A run that outlives its own interval must not be started on top of itself.
    // Cheaper and less error-prone than a hand-rolled lock.
    noOverlap: true,
  });

  const next = task.getNextRun();
  console.log(
    `[${label}] scheduled "${expr}" (${timezone})  next: ${next ? next.toISOString() : 'unknown'}`
  );

  tasks.push(task);
  return task;
}

export function startScheduler() {
  if (env.sweep.enabled) {
    schedule({
      label: 'sweep',
      name: 'expiry-sweep',
      cron: env.sweep.cron,
      timezone: env.sweep.timezone,
      run: () => runExpirySweep(),
      describe: describeSweep,
    });
  } else {
    console.log('[sweep] disabled (EXPIRY_SWEEP_ENABLED=false)');
  }

  if (env.dispatch.enabled) {
    // Say up front which mode sending is in. Otherwise "12 alerts sent" in the
    // log looks identical whether or not a phone ever received anything.
    if (!isConfigured()) {
      console.log(
        '[whatsapp] no WhatsApp credentials -- messages will be logged, not sent. ' +
          'Set WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN in backend/.env'
      );
    } else if (isDryRun()) {
      console.log('[whatsapp] WHATSAPP_DRY_RUN=true -- messages will be logged, not sent');
    } else {
      console.log(
        `[whatsapp] sending via Meta Cloud API ${env.whatsapp.apiVersion}, ` +
          `phone number id ${env.whatsapp.phoneNumberId}`
      );
    }

    schedule({
      label: 'dispatch',
      name: 'whatsapp-dispatch',
      cron: env.dispatch.cron,
      timezone: env.dispatch.timezone,
      run: () => runWhatsAppDispatch(),
      describe: describeDispatch,
    });
  } else {
    console.log('[dispatch] disabled (WHATSAPP_DISPATCH_ENABLED=false)');
  }

  if (env.sweep.enabled && env.sweep.runOnBoot) {
    // Deferred so the pool is warm and this never delays listen(). unref() so a
    // process that exits immediately (a test, a CLI) is not held open by it.
    //
    // Sweep then dispatch, in that order and in one timer: on a machine that was
    // switched off at 08:00 the alerts should still go out, and dispatching before
    // the sweep has run would find an empty queue.
    setTimeout(() => {
      void (async () => {
        await safeRun('sweep', () => runExpirySweep(), describeSweep, 'boot');
        if (env.dispatch.enabled) {
          await safeRun('dispatch', () => runWhatsAppDispatch(), describeDispatch, 'boot');
        }
      })();
    }, 2000).unref();
  }

  return tasks;
}

export async function stopScheduler() {
  if (tasks.length === 0) return;
  await cron.shutdown();
  tasks.length = 0;
}
