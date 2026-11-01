import { useCallback, useEffect, useRef, useState } from 'react';

import { captureFromCamera } from '../api/detections.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner } from './Feedback.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

/**
 * "Scan with camera" -- the webcam half of Phase 10, for the days the
 * ESP32-CAM is not on the desk.
 *
 * It changes nothing about the pipeline: the frame becomes a JPEG, POSTs to
 * `/api/device/capture`, and lands in the same review queue the device feeds.
 * What differs is the credential. The device carries DEVICE_API_KEY; this
 * carries the login session, because a key shipped inside JavaScript is a key
 * anybody with devtools can read. Both routes converge on the same
 * `fileCapture`, so a photo cannot be told apart afterwards by where it
 * came from.
 *
 * Two things this component is careful about:
 *
 *  - **The camera is always released.** Closing the dialog, pressing Escape,
 *    clicking the backdrop and unmounting all run the same stop(). A missed
 *    path here is the OS camera light staying on with no way to turn it off.
 *  - **A failure is a message, not a dead dialog.** Permission denied, no
 *    camera, camera busy, insecure origin -- each gets its own sentence and a
 *    "Try again", because a silent black rectangle is what makes people think
 *    the website is broken.
 */

/** Mid quality: a photo of a packet does not need more than this to be read. */
const JPEG_QUALITY = 0.85;

function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow it from the address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is already being used by another app.';
    case 'UnsupportedError':
      return 'This page cannot open a camera — it needs https or localhost.';
    default:
      return `Could not open the camera${err?.message ? ` (${err.message})` : ''}.`;
  }
}

export default function CameraCapture({ onUploaded }) {
  const toast = useToast();

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [open, setOpen] = useState(false);
  // Bumped by "Try again" so a retry re-runs the effect that opens the camera.
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    // Clear the last frame too, otherwise reopening shows a stale picture
    // from the previous session before the new stream arrives.
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // One effect owns the camera for its whole lifetime: it opens when the
  // dialog does and its cleanup closes it. That covers close, Escape,
  // backdrop click and unmount without four separate teardown paths.
  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    setError('');
    setStarting(true);

    (async () => {
      try {
        // getUserMedia only exists on a secure context. Plain http away from
        // localhost has no navigator.mediaDevices at all, and reading it as
        // undefined would look like "no camera" rather than the real cause.
        if (!navigator.mediaDevices?.getUserMedia) {
          const err = new Error('unavailable');
          err.name = 'UnsupportedError';
          throw err;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          // Rear camera on phones; harmless on a laptop that only has one.
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        });

        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) setError(cameraErrorMessage(err));
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, attempt, stop]);

  function openDialog() {
    setError('');
    setAttempt(0);
    setOpen(true);
  }

  function closeDialog() {
    stop();
    setOpen(false);
    setError('');
  }

  async function send(blob) {
    setSending(true);
    setError('');
    try {
      await captureFromCamera(blob);
      toast.success('Photo sent for review');
      closeDialog();
      onUploaded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleCapture() {
    const video = videoRef.current;
    // The first frames land a moment after the stream attaches. Capturing
    // before that would quietly upload a black rectangle.
    if (!video || !video.videoWidth) {
      setError('The camera is still starting — try again in a moment.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    // image/jpeg on purpose: the server checks for the JPEG marker, so a
    // browser that answered with PNG would be rejected before it hit the disk.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) {
      setError('This browser could not encode the frame as a JPEG.');
      return;
    }

    await send(blob);
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={openDialog}>
        <Icon name="camera" size={17} />
        Scan with camera
      </button>

      {open && (
        <Modal title="Scan an item" onClose={closeDialog}>
          <div className="stack">
            {/* Hidden rather than unmounted on error, so the element the
                effect assigns a stream to is always there when a retry
                succeeds. */}
            <div
              style={{
                ...(error ? { display: 'none' } : {}),
                position: 'relative',
                background: '#000',
                borderRadius: 'var(--r-sm)',
                overflow: 'hidden',
                aspectRatio: '4 / 3',
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {starting && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                  }}
                >
                  <Spinner label="Starting camera" />
                </div>
              )}
            </div>

            {error && (
              <div className="notice notice-error" role="alert">
                <Icon name="warning" size={17} />
                <span>{error}</span>
              </div>
            )}

            <p className="muted">
              Hold the packet so the expiry date is readable, then capture. Nothing is added to
              your inventory until you approve it on the next screen.
            </p>

            <div className="form-actions">
              {error ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setAttempt((n) => n + 1)}
                  disabled={starting}
                >
                  Try again
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCapture}
                  disabled={starting || sending}
                >
                  {sending ? <Spinner label="Sending" /> : 'Capture'}
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeDialog}
                disabled={sending}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
