import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import {
  createItem,
  listItems,
  summary,
  getItem,
  updateItem,
  consumeItem,
  deleteItem,
} from '../controllers/foodItem.controller.js';

const router = Router();

// Applied to the whole router, not per route. A new endpoint added below is
// protected by default -- forgetting requireAuth on one line cannot expose
// another user's inventory.
router.use(requireAuth);

router.route('/').get(listItems).post(createItem);

// MUST stay above '/:id'. Express matches in order, so with the routes swapped
// a request for /summary would arrive as id="summary".
router.get('/summary', summary);

router.route('/:id').get(getItem).patch(updateItem).delete(deleteItem);

router.post('/:id/consume', consumeItem);

export default router;
