/**
 * One labelled form control.
 *
 * `error` is the string the backend put in `details[name]`, so a validation
 * response maps straight onto the form with no client-side rule duplication.
 * `aria-invalid` + `aria-describedby` wire the message to the input for screen
 * readers instead of relying on the red border alone.
 */
export default function Field({
  label,
  name,
  error,
  hint,
  required = false,
  as = 'input',
  children,
  ...rest
}) {
  const id = `f-${name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  const shared = {
    id,
    name,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy || undefined,
    ...rest,
  };

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label} {!required && <span className="opt">(optional)</span>}
      </label>

      {as === 'textarea' && <textarea className={`textarea${error ? ' invalid' : ''}`} {...shared} />}
      {as === 'select' && (
        <select className={`select${error ? ' invalid' : ''}`} {...shared}>
          {children}
        </select>
      )}
      {as === 'input' && <input className={`input${error ? ' invalid' : ''}`} {...shared} />}

      {hint && !error && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
