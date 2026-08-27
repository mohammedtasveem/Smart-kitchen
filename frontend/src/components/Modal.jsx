import { useEffect, useRef } from 'react';

import Icon from './Icon.jsx';

/**
 * Centred dialog (bottom sheet on phones -- see the .overlay rules).
 *
 * Handles the three things a hand-rolled modal usually forgets: Escape closes
 * it, the page behind it does not scroll, and focus moves inside on open so
 * keyboard users are not left tabbing through the page underneath.
 */
export default function Modal({ title, onClose, children }) {
  const boxRef = useRef(null);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    boxRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="overlay"
      // Only a click that starts AND ends on the backdrop closes it, so a drag
      // that begins inside the dialog does not dismiss the user's typing.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={boxRef}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
