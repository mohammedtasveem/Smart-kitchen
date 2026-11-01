import basicSsl from '@vitejs/plugin-basic-ssl';
import base from './vite.config.js';

/*
 * HTTPS development config. Some browser features -- secure-context APIs and
 * camera-capable iframes, for example -- only light up on an https origin, and
 * a device coming over the LAN is a non-localhost origin, which browsers treat
 * as insecure even for plain http. This config is identical to the base one
 * but served over a self-signed certificate.
 *
 * Run with: npm run dev:https
 *
 * The certificate is self-signed, so the first visit shows a browser warning;
 * it is a development-only cert, not the production TLS story. In production
 * HTTPS comes from the hosting platform's own certificate.
 */
export default {
  ...base,
  plugins: [...base.plugins, basicSsl()],
};