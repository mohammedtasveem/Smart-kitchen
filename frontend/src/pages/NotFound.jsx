import { Link } from 'react-router-dom';

import { EmptyState } from '../components/Feedback.jsx';
import Icon from '../components/Icon.jsx';

export default function NotFound() {
  return (
    <div className="center-screen">
      <EmptyState
        icon="compass"
        title="Page not found"
        action={
          <Link to="/" className="btn btn-primary">
            <Icon name="dashboard" size={17} />
            Go to dashboard
          </Link>
        }
      >
        The link may be broken, or the page may have been removed.
      </EmptyState>
    </div>
  );
}
