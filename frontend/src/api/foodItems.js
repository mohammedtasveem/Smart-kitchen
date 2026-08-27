import { api, toQuery } from './client.js';

/**
 * Food inventory endpoints (Phase 5 backend).
 *
 * Keeping the URLs here means a route rename touches one file, not six pages.
 */

export function listFoodItems(filters = {}) {
  return api.get(`/food-items${toQuery(filters)}`);
}

export function getSummary() {
  return api.get('/food-items/summary');
}

export function createFoodItem(payload) {
  return api.post('/food-items', payload);
}

export function updateFoodItem(id, patch) {
  return api.patch(`/food-items/${id}`, patch);
}

export function setConsumed(id, consumed) {
  return api.post(`/food-items/${id}/consume`, { consumed });
}

export function deleteFoodItem(id) {
  return api.del(`/food-items/${id}`);
}
