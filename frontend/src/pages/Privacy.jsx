import { Link } from 'react-router-dom';

import { EFFECTIVE_DATE, PROJECT_LINES, DocShell } from '../components/Doc.jsx';

const SECTIONS = [
  {
    h: '1. Overview',
    p: [
      'Smart Kitchen is a tool that helps households track food expiry dates, receive alerts and discover recipes. This policy explains what information the service collects, why it is collected, who it is shared with, and the choices you have. The short version: we collect only what the feature you are using needs, and nothing else.',
      'We do not sell your data. We do not run advertising, tracking scripts or analytics beacons of any kind.',
    ],
  },
  {
    h: '2. Information we collect',
    list: [
      ['Account basics', 'Your name, email address and a hashed password. A password can never be read back — it is stored only as a bcrypt hash.'],
      ['WhatsApp number (optional)', 'A phone number entered only if you want expiry alerts delivered over WhatsApp. It is optional at sign-up and can be changed or removed from your Profile page at any time.'],
      ['Inventory data', 'The food items you add yourself: name, category, quantity and expiry date. This data is yours alone and is visible only to you.'],
      ['Camera photos', 'When you scan a food packet, the photo you capture is sent to an AI model to read the label. Photos stay attached to your account, appear only in your private review queue, and can be discarded with one tap.'],
      ['Session data', 'A login session (a random token) kept in your browser so you do not have to sign in on every page.'],
    ],
  },
  {
    h: '3. What we deliberately do not collect',
    p: 'No location data. No browsing history. No device identifiers for advertising. No contact lists. No app-level analytics or third-party trackers. If a feature does not need a data point, we do not ask for it — the WhatsApp number is the clearest example: it is optional and skipped entirely if you do not request alerts.',
  },
  {
    h: '4. How the information is used',
    list: [
      ['Expiry tracking', 'Dates you enter are processed to compute how soon an item expires.'],
      ['AI food recognition', 'Photos you scan are analysed to suggest the product name, category and any expiry date printed on the pack. An AI response is a suggestion, not a fact — you confirm or correct it before anything is saved.'],
      ['Alerts', 'If you have added a WhatsApp number, expiry summaries for your own items are delivered to that number. You can opt out by removing the number.'],
      ['Recipes', 'Expiring items are matched against a recipe library to suggest dishes.'],
    ],
  },
  {
    h: '5. Third parties we rely on',
    list: [
      ['Google Gemini (AI)', 'Camera photos are sent to the Gemini API for vision recognition. A photo is used only to interpret that one image; recognition is a paid API call, not a training program onto your images.'],
      ['TiDB Cloud (database)', 'Your account and inventory records are stored in a managed cloud database.'],
      ['WhatsApp', 'Alert messages are delivered through the WhatsApp Business platform to the number you provided for that purpose.'],
      ['Google Fonts', 'The interface loads two typefaces from Google Fonts, as most websites do.'],
    ],
  },
  {
    h: '6. Data retention and deletion',
    p: 'Your inventory items, photos and account record are kept only while your account exists. You can delete individual items and photos yourself at any time. Removing your WhatsApp number from Profile stops alert messages. If you want your account and every record tied to it fully deleted, contact us and it will be done.',
  },
  {
    h: '7. Security',
    p: [
      'Passwords are stored as bcrypt hashes and can never be recovered in plain text. Data moving between your browser and the app travels over the same origin in development, and over HTTPS when deployed. Photos are not publicly listed: each review photo lives behind a random file name and is tied to your account.',
      'No system connected to the internet can promise absolute security, but every access path is deliberately narrow: your inventory is scoped to your account, and the camera device route is protected by a key that is checked on every request.',
    ],
  },
  {
    h: '8. Children',
    p: 'The service is not directed at children under 13, and we do not knowingly collect their information.',
  },
  {
    h: '9. Changes to this policy',
    p: 'If the service starts collecting anything new, this page will be updated with a new effective date before the change takes effect.',
  },
  {
    h: '10. Contact',
    p: 'Questions about this policy or a deletion request can be raised through the Profile page or directly with the project team. ' + PROJECT_LINES,
  },
];

export default function Privacy() {
  return (
    <DocShell
      title="Privacy Policy"
      tagline="What Smart Kitchen collects, how it is used, and how to take it back."
      updated={EFFECTIVE_DATE}
      sections={SECTIONS}
    >
      <Link to="/" className="btn btn-ghost">
        Back to the app
      </Link>
    </DocShell>
  );
}
