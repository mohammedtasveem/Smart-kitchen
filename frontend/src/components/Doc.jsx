import { Link } from 'react-router-dom';

import Icon from './Icon.jsx';

/** Effective date shown at the bottom of every public document. */
export const EFFECTIVE_DATE = '1 November 2026';

export const PROJECT_LINES =
  'AI-Powered Smart Kitchen Management, Expiry Monitoring and Recipe ' +
    'Recommendation System — SECAB Institute of Engineering and Technology, ' +
    'B.E. Electronics and Communication Engineering.';

/** One definition-List-style row: a lead-in label (as a <dt>) and its body
 *  (as a <dd>), which reads correctly for screen-reader users.
 */
function Term({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Section({ h, p, list }) {
  return (
    <section className="doc-section">
      <h2>{h}</h2>
      {(Array.isArray(p) ? p : p ? [p] : []).map((line) => (
        <p key={line.slice(0, 24)}>{line}</p>
      ))}

      {list && (
        <dl className="doc-list">
          {list.map(([label, text]) => (
            <Term key={label} label={label}>
              {text}
            </Term>
          ))}
        </dl>
      )}
    </section>
  );
}

/** The page chrome every public document needs, and nothing it does not.
 *  Inlined so pages cannot accidentally eat half a heading file for it.
 */
export function DocShell({ title, tagline, updated, sections, children }) {
  return (
    <div className="doc-shell" role="document">
      <a className="skip-link" href="#doc-main">
        Skip to main content
      </a>

      <header className="doc-head">
        <Link to="/" className="doc-brand">
          <img src="/favicon.svg" alt="Smart Kitchen logo" />
          <span>Smart Kitchen</span>
        </Link>
        <nav className="doc-nav" aria-label="Documents">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </nav>
      </header>

      <main id="doc-main" className="doc-main" tabindex="-1">
        <article className="doc">
          <h1>{title}</h1>
          <p className="doc-tagline">{tagline}</p>
          <p className="doc-updated">Effective date: {updated}</p>

          <div className="doc-body">
            {sections.map((section) => (
              <Section key={section.h} {...section} />
            ))}
          </div>

          <footer className="doc-foot">
            <p className="doc-project">
              <Icon name="flask" size={16} />
              {PROJECT_LINES}
            </p>
            {children && <div className="doc-actions">{children}</div>}
          </footer>
        </article>
      </main>
    </div>
  );
}