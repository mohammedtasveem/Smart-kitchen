import { Router } from 'express';

import { signup, login, me, updateMe, logout } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Rate limit auth endpoints to prevent brute-force attacks
router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);
router.post('/logout', requireAuth, logout);

export default router;
