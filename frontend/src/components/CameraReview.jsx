import { useCallback, useEffect, useState } from 'react';

import { confirmDetection, discardDetection, listDetections } from '../api/detections.js';
import FoodItemForm from './FoodItemForm.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { Spinner } from './Feedback.jsx';
import { useToast } from '../context/ToastContext.jsx';

/**
 * The human half of Phase 10, methodology step 3 ("validation").
 *
 * The ESP32-CAM uploads a photo and Gemini proposes what it sees -- but the
 * proposal never becomes an inventory row on its own. This queue sits between
 * the two: the photo, the guess, and a FoodItemForm pre-filled with that guess
 * so a reviewer corrects rather than retypes.
 *
 * Reusing FoodItemForm (rather than a special "confirm detection" form) is
 * deliberate: the confirm endpoint runs the exact validateFoodItem rules a
 * manual add does, so one form, one set of field errors, one code path.
 *
 * A failed load must not eat the rest of the Inventory page -- this component
 * renders nothing at all when the queue is empty or unreachable, so a camera
 * problem never shows up as an error on a screen that has nothing to do with
 * the camera.
 */
export default function CameraReview({ knownCategories = [], onConfirmed, refreshKey = 0 }) {
  const toast = useToast();

  const [detections, setDetections] = useState(null); // null = loading
  const [reviewing, setReviewing] = useState(null); // the detection being edited
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await listDetections();
      setDetections(res.detections);
    } catch {
      // Camera feature unavailable (no device configured, network hiccup) --
      // hide the section instead of alarming the user. Manual entry still works.
      setDetections([]);
    }
  }, []);

  // refreshKey lets a photo taken in this tab (the webcam button) pull the
  // queue open again. Without it the section would stay hidden after an
  // upload, since CameraReview renders nothing at all when empty -- the user
  // would send a photo and see no sign anything happened.
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleConfirm(payload) {
    await confirmDetection(reviewing.id, payload);
    toast.success(`${payload.name} added from camera`);
    setReviewing(null);
    await load();
    onConfirmed?.();
  }

  async function handleDiscard(detection) {
    setBusyId(detection.id);
    try {
      await discardDetection(detection.id);
      toast.success('Photo discarded');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  // Still loading, nothing pending, or the endpoint unreachable: no UI at all.
  if (!detections || detections.length === 0) return null;

  const confidenceOf = (d) => (d.confidence == null ? null : Math.round(d.confidence * 100));

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <Icon name="camera" size={18} />
          Camera detections
          <span className="pill-count"> {detections.length}</span>
        </h2>
        <p className="muted">
          Photos from the camera waiting for your confirmation. Nothing enters your
          inventory until you approve it.
        </p>
      </div>

      <div className="stack">
        {detections.map((d) => {
          const pct = confidenceOf(d);
          const lowConfidence = pct != null && pct < 50;

          return (
            <div key={d.id} className="spread" style={{ gap: 16, alignItems: 'flex-start' }}>
              <img
                src={d.imageUrl}
                alt="Food photo captured by the camera"
                style={{
                  width: 72,
                  height: 72,
                  objectFit: 'cover',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-surface-2)',
                  flexShrink: 0,
                }}
              />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="spread" style={{ gap: 8 }}>
                  <strong>{d.detectedName ?? 'Unrecognised photo'}</strong>
                  {pct != null && (
                    <span className={`pill${lowConfidence ? ' warn' : ''}`}>
                      {pct}% sure
                    </span>
                  )}
                </div>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {[d.category, d.expiryDate ? `expiry ${d.expiryDate}` : 'no expiry date read']
                    .filter(Boolean)
                    .join(' · ') || 'The model could not identify this photo — type it in yourself.'}
                </p>
                {d.rawOcrText && (
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.85em' }}>
                    Read from pack: “{d.rawOcrText}”
                  </p>
                )}
              </div>

              <div className="spread" style={{ gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setReviewing(d)}
                  disabled={busyId === d.id}
                >
                  Review
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleDiscard(d)}
                  disabled={busyId === d.id}
                >
                  {busyId === d.id ? <Spinner label="Discarding" /> : 'Discard'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {reviewing && (
        <Modal
          title="Confirm camera detection"
          onClose={() => setReviewing(null)}
        >
          <div className="stack">
            <img
              src={reviewing.imageUrl}
              alt="The photo being reviewed"
              style={{
                width: '100%',
                maxHeight: 220,
                objectFit: 'contain',
                background: 'var(--c-surface-2)',
                borderRadius: 'var(--r-sm)',
              }}
            />
            <p className="muted">
              Check every field before adding — the camera’s guess can be wrong.
              Expiry date in particular is worth verifying against the pack.
            </p>
            {/* Prefilled with the AI's proposal (name/category/expiry), so the
                reviewer edits rather than starts over. Quantity stays at the
                form's default: a photo cannot tell you how much is left. */}
            <FoodItemForm
              item={{
                name: reviewing.detectedName ?? '',
                category: reviewing.category ?? '',
                expiryDate: reviewing.expiryDate ?? '',
                quantity: 1,
                unit: 'pcs',
                notes: '',
              }}
              knownCategories={knownCategories}
              onSubmit={handleConfirm}
              onCancel={() => setReviewing(null)}
              submitLabel="Add to inventory"
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
