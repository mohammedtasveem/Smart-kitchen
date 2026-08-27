import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import {
  listNotifications,
  summary,
  checkNow,
  sendNow,
  retryNotification,
} from '../controllers/notification.controller.js';

const router = Router();

// Whole-router guard, same as foodItem.routes.js: an endpoint added below is
// protected by default rather than by remembering to say so.
router.use(requireAuth);

router.get('/', listNotifications);
router.get('/summary', summary);

// Both run for the caller only -- see the controller for why that is enough to
// make a manual trigger safe to expose without an admin role.
//
// `check` classifies and queues (Phase 7); `send` delivers (Phase 8). Two
// endpoints, because the sweep is deliberately network-free.
router.post('/check', checkNow);
router.post('/send', sendNow);

// Declared after the two literal paths above so 'check' and 'send' are never
// captured as an `:id`.
router.post('/:id/retry', retryNotification);

export default router;
