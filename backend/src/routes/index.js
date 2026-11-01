import { Router } from 'express';

import healthRoutes from './health.routes.js';
import authRoutes from './auth.routes.js';
import foodItemRoutes from './foodItem.routes.js';
import notificationRoutes from './notification.routes.js';
import recipeRoutes from './recipe.routes.js';
import deviceRoutes from './device.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/food-items', foodItemRoutes);
router.use('/notifications', notificationRoutes);
router.use('/recipes', recipeRoutes);
router.use('/device', deviceRoutes); // Phase 10

export default router;
