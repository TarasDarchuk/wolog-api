import { AuthorizeParams } from './oauth.service.js';
import { SCOPE_DESCRIPTIONS } from './scopes.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JSON for embedding inside a <script> block without breaking out of it. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #f4f4f5; color: #18181b; display: flex; min-height: 100vh;
         align-items: center; justify-content: center; }
  @media (prefers-color-scheme: dark) { body { background: #18181b; color: #fafafa; } .card { background: #27272a !important; } }
  .card { background: #fff; border-radius: 16px; padding: 32px; max-width: 400px; width: 100%;
          margin: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #71717a; font-size: 14px; margin: 0 0 20px; }
  ul.scopes { list-style: none; padding: 0; margin: 0 0 24px; }
  ul.scopes li { padding: 8px 0 8px 28px; position: relative; font-size: 15px; border-bottom: 1px solid rgba(127,127,127,0.15); }
  ul.scopes li::before { content: '✓'; position: absolute; left: 4px; color: #16a34a; font-weight: 700; }
  .btn { display: block; width: 100%; padding: 12px; border-radius: 10px; border: none;
         font-size: 16px; font-weight: 600; cursor: pointer; margin-bottom: 10px; }
  .btn-primary { background: #18181b; color: #fff; }
  .btn-secondary { background: transparent; color: inherit; border: 1px solid rgba(127,127,127,0.4); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .signin { margin-bottom: 16px; }
  .status { font-size: 14px; color: #71717a; min-height: 20px; margin-bottom: 12px; }
  .error { color: #dc2626; }
  input[type=email] { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,0.4);
         font-size: 15px; margin-bottom: 8px; background: transparent; color: inherit; }
  .hidden { display: none; }
`;

export function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wolog — Authorization Error</title><style>${PAGE_STYLE}</style></head>
<body><div class="card"><h1>Authorization error</h1>
<p class="sub">${escapeHtml(message)}</p>
<p class="sub">Close this window and try connecting again.</p></div></body></html>`;
}

export function renderConsentPage(options: {
  clientName: string;
  scopes: string[];
  params: AuthorizeParams;
  appleWebClientId?: string;
  googleClientId?: string;
  devLoginEnabled: boolean;
  baseUrl: string;
}): string {
  const {
    clientName,
    scopes,
    params,
    appleWebClientId,
    googleClientId,
    devLoginEnabled,
    baseUrl,
  } = options;

  const scopeItems = scopes
    .map((s) => `<li>${escapeHtml(SCOPE_DESCRIPTIONS[s] ?? s)}</li>`)
    .join('\n');

  const appleScript = appleWebClientId
    ? `<script src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"></script>`
    : '';
  const googleScript = googleClientId
    ? `<script src="https://accounts.google.com/gsi/client" async></script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Wolog</title>
<style>${PAGE_STYLE}</style>
${appleScript}
${googleScript}
</head>
<body>
<div class="card">
  <h1>Connect to Wolog</h1>
  <p class="sub"><strong>${escapeHtml(clientName)}</strong> wants permission to:</p>
  <ul class="scopes">${scopeItems}</ul>

  <div id="signin" class="signin">
    <p class="sub">Sign in with your Wolog account to continue.</p>
    ${appleWebClientId ? '<button class="btn btn-primary" id="apple-btn"> Sign in with Apple</button>' : ''}
    ${googleClientId ? '<div id="google-btn"></div>' : ''}
    ${
      devLoginEnabled
        ? `<div id="dev-login"><input type="email" id="dev-email" placeholder="dev@example.com">
           <button class="btn btn-secondary" id="dev-btn">Dev sign in (email)</button></div>`
        : ''
    }
    ${!appleWebClientId && !googleClientId && !devLoginEnabled ? '<p class="error">No sign-in method is configured on this server.</p>' : ''}
  </div>

  <div id="consent" class="hidden">
    <p class="status" id="signed-in-as"></p>
    <button class="btn btn-primary" id="allow-btn">Allow</button>
    <button class="btn btn-secondary" id="deny-btn">Cancel</button>
  </div>

  <p class="status" id="status"></p>
</div>

<script>
(function () {
  var AUTHORIZE_PARAMS = ${jsonForScript(params)};
  var APPLE_CLIENT_ID = ${jsonForScript(appleWebClientId || null)};
  var GOOGLE_CLIENT_ID = ${jsonForScript(googleClientId || null)};
  var BASE_URL = ${jsonForScript(baseUrl)};

  var credential = null;
  var provider = null;

  var statusEl = document.getElementById('status');
  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isError ? ' error' : '');
  }

  function showConsent(label) {
    document.getElementById('signin').classList.add('hidden');
    document.getElementById('consent').classList.remove('hidden');
    document.getElementById('signed-in-as').textContent = label;
    setStatus('');
  }

  function signedIn(p, cred, label) {
    provider = p;
    credential = cred;
    showConsent(label);
  }

  async function submitDecision(decision) {
    setStatus('Working…');
    try {
      var res = await fetch(BASE_URL + '/oauth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: decision,
          provider: provider,
          credential: credential,
          authorize: AUTHORIZE_PARAMS,
        }),
      });
      var data = await res.json();
      if (!res.ok) {
        setStatus(data.message || data.error_description || 'Authorization failed', true);
        return;
      }
      window.location.assign(data.redirect);
    } catch (e) {
      setStatus('Network error — please try again', true);
    }
  }

  document.getElementById('allow-btn').addEventListener('click', function () { submitDecision('allow'); });
  document.getElementById('deny-btn').addEventListener('click', function () { submitDecision('deny'); });

  if (APPLE_CLIENT_ID && window.AppleID) {
    AppleID.auth.init({
      clientId: APPLE_CLIENT_ID,
      scope: 'name email',
      redirectURI: BASE_URL + '/oauth/authorize',
      usePopup: true,
    });
    document.getElementById('apple-btn').addEventListener('click', async function () {
      try {
        var result = await AppleID.auth.signIn();
        signedIn('apple', result.authorization.id_token, 'Signed in with Apple');
      } catch (e) {
        setStatus('Apple sign-in was cancelled or failed', true);
      }
    });
  } else if (APPLE_CLIENT_ID) {
    document.getElementById('apple-btn').addEventListener('click', function () {
      setStatus('Apple sign-in script failed to load', true);
    });
  }

  if (GOOGLE_CLIENT_ID) {
    var initGoogle = function () {
      if (!window.google || !google.accounts) { setTimeout(initGoogle, 200); return; }
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: function (resp) { signedIn('google', resp.credential, 'Signed in with Google'); },
      });
      google.accounts.id.renderButton(document.getElementById('google-btn'), {
        theme: 'outline', size: 'large', width: 336,
      });
    };
    initGoogle();
  }

  var devBtn = document.getElementById('dev-btn');
  if (devBtn) {
    devBtn.addEventListener('click', function () {
      var email = document.getElementById('dev-email').value.trim();
      if (!email) { setStatus('Enter an email', true); return; }
      signedIn('dev', email, 'Dev sign-in as ' + email);
    });
  }
})();
</script>
</body>
</html>`;
}

/** CSP for the consent page: page-inline script + Apple/Google sign-in SDKs. */
export const CONSENT_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://appleid.cdn-apple.com https://accounts.google.com https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  'frame-src https://appleid.apple.com https://accounts.google.com',
  "connect-src 'self' https://appleid.apple.com https://accounts.google.com",
  "img-src 'self' data: https:",
].join('; ');
