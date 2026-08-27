import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { listRecipes, getRecipe, cookRecipe } from '../controllers/recipe.controller.js';

const router = Router();

// Whole-router guard, same as the other feature routers. The catalogue itself is
// public data, but every response is ranked against the caller's inventory, so
// there is no anonymous version of these endpoints to expose.
router.use(requireAuth);

router.get('/', listRecipes);
router.get('/:id', getRecipe);

// Marks the matched ingredients consumed -- methodology step 11.
router.post('/:id/cook', cookRecipe);

export default router;
