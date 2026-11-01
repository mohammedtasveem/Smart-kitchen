import { Link } from 'react-router-dom';

import { EFFECTIVE_DATE, PROJECT_LINES, DocShell } from '../components/Doc.jsx';

const SECTIONS = [
  {
    h: '1. Acceptance of these terms',
    p: [
      'By creating an account or using Smart Kitchen, you agree to these Terms and to the Privacy Policy. If you do not agree, please stop using the service. The operational details of how your data is handled live in the Privacy Policy; these Terms cover the rules of using the service itself.',
    ],
  },
  {
    h: '2. What this service does',
    p: [
      'Smart Kitchen lets you record food items, tracks expiry dates automatically, sends optional WhatsApp alert reminders, suggests recipes built around your own inventory, and offers an AI camera assist that reads food packaging.',
      'The service is a student engineering project built and maintained as part of a Bachelor of Engineering programme. It is provided as-is: useful, but not a commercial product and not a substitute for your own judgement.',
    ],
  },
  {
    h: '3. Eligibility and your account',
    p: 'You must be at least 13 years old to create an account. Keep your login credentials private; you are responsible for activity that happens through your account. The app is single-user scoped: the inventory you see is your own inventory.',
  },
  {
    h: '4. Acceptable use',
    list: [
      ['Your data', 'Add only your real household inventory. Do not use the service for spam, denial-of-service or scraping.'],
      ['Device endpoints', 'The camera capture route is meant for your own webcam scan or your own ESP32-CAM device. Do not flood the AI endpoints with unrelated images through the device key.'],
      ['No tampering', 'Do not probe, scan or attack the service infrastructure, and do not attempt to access another user\u2019s data.'],
    ],
  },
  {
    h: '5. AI suggestions \u2014 always verify before relying on them',
    p: [
      'The AI camera assist (product name, category, expiry date) and recipe recommendations are probability-based estimates from an automated vision model. They are offered as a convenience, not as accurate product labeling.',
      'Never rely on an AI-suggested expiry date over the date actually printed on the packaging, and never consume food only because software told you it was safe. The service tracks the dates you enter with your own eyes on the packet; it cannot see your kitchen.',
    ],
  },
  {
    h: '6. No warranty',
    p: 'The service is provided without warranty of any kind, express or implied. It may be slow, interrupted, or unavailable at times, and AI features may misidentify items, cite a wrong date, or suggest a recipe that does not suit your taste, dietary needs or allergies. We make no guarantee that alerts, WhatsApp delivery or recipe matching will be perfectly accurate or perfectly on time.',
  },
  {
    h: '7. Limitation of liability',
    p: 'To the extent permitted by law, neither the project team nor the institute is liable to you for any loss connected to use of the service, including spoiled food, health effects, a missed alert or data loss, whether those losses are direct or indirect. Use the service as an assistant, with your own judgement.',
  },
  {
    h: '8. Intellectual property',
    p: 'The application code, design and documentation are part of the student\u2019s academic project and are protected by that copyright. The food items, photos and inventory records you create remain yours; you are giving the service no ownership over them.',
  },
  {
    h: '9. Termination and changes',
    p: 'You can stop using the service at any time. The team may suspend or discontinue all or part of the service at any time, including as the academic project ends. If these terms change materially, the effective date at the bottom of this page will be updated.',
  },
  {
    h: '10. Governing law',
    p: 'These terms are governed by the laws of India (Karnataka). Contact the project team through the Profile page if you have a question or a dispute.',
  },
];

export default function Terms() {
  return (
    <DocShell
      title="Terms of Service"
      tagline="The rules, disclaimers and expectations that come with using Smart Kitchen."
      updated={EFFECTIVE_DATE}
      sections={SECTIONS}
    >
      <Link to="/" className="btn btn-ghost">
        Back to the app
      </Link>
    </DocShell>
  );
}
