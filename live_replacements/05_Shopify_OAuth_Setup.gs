/************************************************************
 * FILE START: 05_Shopify_OAuth_Setup.gs
 ************************************************************/

/************************************************************
 * APPS SCRIPT: 05_Shopify_OAuth_Setup.gs
 * PROJECT: Shopify → Striven Bridge
 *
 * Purpose:
 * Shopify OAuth setup and Shopify Admin token management.
 *
 * Handles:
 * - Authorization URL generation
 * - OAuth callback validation
 * - Admin API access token storage
 * - Expiring offline token storage
 * - Refresh-token based renewal before expiry
 *
 * Depends on:
 * - 00_Config.gs
 * - 01_Sheet_Setup_And_Utilities.gs
 *
 * Rules:
 * - No diagnostics in this file.
 * - No menu functions in this file.
 * - Do not use online tokens for background automation.
 ************************************************************/


/************************************************************
 * SHOPIFY OAUTH CONFIG
 ************************************************************/

const SHOPIFY_OAUTH = {
  SCOPES: [
    'read_orders',
    'read_customers',
    'read_products',
    'write_products'
  ],

  // Refresh before actual expiry to avoid failures during automation runs.
  REFRESH_BUFFER_MS: 5 * 60 * 1000,

  TOKEN_TYPE: {
    NON_EXPIRING_OFFLINE: 'NON_EXPIRING_OFFLINE',
    EXPIRING_OFFLINE: 'EXPIRING_OFFLINE',
    ONLINE: 'ONLINE',
    UNKNOWN: 'UNKNOWN'
  }
};


/************************************************************
 * STEP 1:
 * Run this after deploying this Apps Script as a Web App.
 ************************************************************/

function getShopifyOAuthRedirectUrl() {
  const url = ScriptApp.getService().getUrl();

  Logger.log(url);

  return url;
}


/************************************************************
 * STEP 2:
 * Run this to create the Shopify authorization link.
 ************************************************************/

function buildShopifyAuthorizationUrl() {
  const props = PropertiesService.getScriptProperties();

  const shop = shopifyOAuthCleanShopDomain_(
    props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_STORE_DOMAIN)
  );

  const clientId = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_ID);
  const redirectUri = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_OAUTH_REDIRECT_URI);

  if (!shop) {
    throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_STORE_DOMAIN}`);
  }

  if (!clientId) {
    throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_ID}`);
  }

  if (!redirectUri) {
    throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_OAUTH_REDIRECT_URI}`);
  }

  const state = Utilities.getUuid();

  props.setProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_OAUTH_STATE, state);

  const params = {
    client_id: clientId,
    scope: SHOPIFY_OAUTH.SCOPES.join(','),
    redirect_uri: redirectUri,
    state: state
  };

  const authUrl =
    `https://${shop}/admin/oauth/authorize?${shopifyOAuthBuildQueryString_(params)}`;

  Logger.log('Open this URL in your browser:');
  Logger.log(authUrl);

  return authUrl;
}


/************************************************************
 * STEP 3:
 * Shopify redirects here after approval.
 *
 * This is called automatically by the deployed Web App URL.
 ************************************************************/

function doGet(e) {
  try {
    const result = handleShopifyOAuthCallback_(e);

    return HtmlService.createHtmlOutput(`
      <h2>Shopify authorization complete</h2>
      <p>The Shopify Admin API token was saved.</p>
      <p>Token type: ${shopifyOAuthEscapeHtml_(result.tokenType || '')}</p>
      <p>You can close this tab and return to your Google Sheet.</p>
      <pre>${shopifyOAuthEscapeHtml_(JSON.stringify(result, null, 2))}</pre>
    `);

  } catch (err) {
    return HtmlService.createHtmlOutput(`
      <h2>Shopify authorization failed</h2>
      <p>${shopifyOAuthEscapeHtml_(err.message)}</p>
      <p>Check Apps Script logs for details.</p>
    `);
  }
}


/************************************************************
 * CALLBACK HANDLER
 ************************************************************/

function handleShopifyOAuthCallback_(e) {
  if (!e || !e.parameter) {
    throw new Error('Missing OAuth callback parameters.');
  }

  const params = e.parameter;

  const shop = shopifyOAuthCleanShopDomain_(params.shop);
  const code = params.code;
  const state = params.state;
  const hmac = params.hmac;

  if (!shop) {
    throw new Error('Missing shop in OAuth callback.');
  }

  if (!code) {
    throw new Error('Missing authorization code in OAuth callback.');
  }

  if (!hmac) {
    throw new Error('Missing hmac in OAuth callback.');
  }

  validateShopifyOAuthState_(state);
  validateShopifyOAuthHmac_(params);

  const tokenResult = exchangeShopifyCodeForAccessToken_(shop, code);
  const saved = saveShopifyAdminTokenResult_(shop, tokenResult, 'OAUTH_CALLBACK');

  shopifyStrivenLog_({
    level: 'INFO',
    action: 'SHOPIFY_OAUTH',
    message: 'Shopify Admin API token saved.',
    details: saved
  });

  return saved;
}


/************************************************************
 * TOKEN GETTER USED BY AUTOMATION
 *
 * Any Shopify Admin API request should call this instead of
 * reading SHOPIFY_ADMIN_ACCESS_TOKEN directly.
 ************************************************************/

function getValidShopifyAdminAccessToken_() {
  const props = PropertiesService.getScriptProperties();

  const token = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_ADMIN_ACCESS_TOKEN);
  const expiresAtMs = Number(
    props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_ACCESS_TOKEN_EXPIRES_AT) || 0
  );

  if (!token) {
    throw new Error(
      `Missing Shopify token. Run buildShopifyAuthorizationUrl(), approve the app, and complete OAuth.`
    );
  }

  // Non-expiring offline token. No expiry metadata means no refresh is needed.
  if (!expiresAtMs) {
    return token;
  }

  const nowMs = Date.now();
  const shouldRefresh = expiresAtMs <= nowMs + SHOPIFY_OAUTH.REFRESH_BUFFER_MS;

  if (!shouldRefresh) {
    return token;
  }

  return refreshShopifyAdminAccessToken_();
}


/************************************************************
 * TOKEN REFRESH
 *
 * Uses a script lock because Shopify refresh tokens are rotated.
 * Concurrent refresh attempts are a real way to break automation.
 ************************************************************/

function refreshShopifyAdminAccessToken_() {
  const lock = LockService.getScriptLock();

  lock.waitLock(30000);

  try {
    const props = PropertiesService.getScriptProperties();

    // Re-check after lock in case another execution already refreshed it.
    const currentToken = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_ADMIN_ACCESS_TOKEN);
    const expiresAtMs = Number(
      props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_ACCESS_TOKEN_EXPIRES_AT) || 0
    );

    if (
      currentToken &&
      expiresAtMs &&
      expiresAtMs > Date.now() + SHOPIFY_OAUTH.REFRESH_BUFFER_MS
    ) {
      return currentToken;
    }

    const shop = shopifyOAuthCleanShopDomain_(
      props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_STORE_DOMAIN)
    );

    const clientId = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_ID);
    const clientSecret = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_SECRET);
    const refreshToken = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_REFRESH_TOKEN);

    if (!shop) {
      throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_STORE_DOMAIN}`);
    }

    if (!clientId) {
      throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_ID}`);
    }

    if (!clientSecret) {
      throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_SECRET}`);
    }

    if (!refreshToken) {
      throw new Error(
        'Shopify token is expiring, but no refresh token is stored. Reauthorize Shopify OAuth.'
      );
    }

    const tokenResult = exchangeShopifyRefreshTokenForAccessToken_({
      shop,
      clientId,
      clientSecret,
      refreshToken
    });

    const saved = saveShopifyAdminTokenResult_(shop, tokenResult, 'TOKEN_REFRESH');

    shopifyStrivenLog_({
      level: 'INFO',
      action: 'SHOPIFY_TOKEN_REFRESH',
      message: 'Shopify Admin API token refreshed.',
      details: saved
    });

    return saved.accessToken;

  } finally {
    lock.releaseLock();
  }
}


/************************************************************
 * STATE VALIDATION
 ************************************************************/

function validateShopifyOAuthState_(incomingState) {
  const props = PropertiesService.getScriptProperties();
  const savedState = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_OAUTH_STATE);

  if (!savedState) {
    throw new Error('Missing saved OAuth state. Rebuild the authorization URL and try again.');
  }

  if (!incomingState || incomingState !== savedState) {
    throw new Error('OAuth state mismatch. Authorization rejected.');
  }
}


/************************************************************
 * HMAC VALIDATION
 ************************************************************/

function validateShopifyOAuthHmac_(params) {
  const props = PropertiesService.getScriptProperties();
  const clientSecret = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_SECRET);

  if (!clientSecret) {
    throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_SECRET}`);
  }

  const incomingHmac = String(params.hmac || '').toLowerCase();

  const message = Object.keys(params)
    .filter(key => key !== 'hmac' && key !== 'signature')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  const calculatedBytes = Utilities.computeHmacSha256Signature(
    message,
    clientSecret
  );

  const calculatedHmac = calculatedBytes
    .map(byte => {
      const value = byte < 0 ? byte + 256 : byte;
      return ('0' + value.toString(16)).slice(-2);
    })
    .join('')
    .toLowerCase();

  if (!shopifyOAuthSafeCompare_(incomingHmac, calculatedHmac)) {
    throw new Error('OAuth HMAC validation failed. Authorization rejected.');
  }
}


function shopifyOAuthSafeCompare_(a, b) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}


/************************************************************
 * TOKEN EXCHANGE - AUTHORIZATION CODE
 ************************************************************/

function exchangeShopifyCodeForAccessToken_(shop, code) {
  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_ID);
  const clientSecret = props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_SECRET);

  if (!clientId) {
    throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_ID}`);
  }

  if (!clientSecret) {
    throw new Error(`Missing Script Property: ${SHOPIFY_STRIVEN_PROPS.SHOPIFY_CLIENT_SECRET}`);
  }

  const requestExpiring = shopifyOAuthShouldRequestExpiringOfflineToken_();

  const payload = {
    client_id: clientId,
    client_secret: clientSecret,
    code: code
  };

  if (requestExpiring) {
    payload.expiring = '1';
  }

  return shopifyOAuthTokenPost_(shop, payload, 'Shopify authorization-code token exchange');
}


/************************************************************
 * TOKEN EXCHANGE - REFRESH TOKEN
 ************************************************************/

function exchangeShopifyRefreshTokenForAccessToken_(input) {
  const payload = {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken
  };

  return shopifyOAuthTokenPost_(
    input.shop,
    payload,
    'Shopify refresh-token exchange'
  );
}


function shopifyOAuthTokenPost_(shop, payload, label) {
  const cleanShop = shopifyOAuthCleanShopDomain_(shop);
  const url = `https://${cleanShop}/admin/oauth/access_token`;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: shopifyOAuthBuildQueryString_(payload),
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  let parsed;

  try {
    parsed = JSON.parse(responseText);
  } catch (err) {
    throw new Error(`${label} returned non-JSON. HTTP ${responseCode}: ${responseText}`);
  }

  if (responseCode < 200 || responseCode >= 300) {
    throw new Error(`${label} failed. HTTP ${responseCode}: ${responseText}`);
  }

  return parsed;
}


/************************************************************
 * TOKEN STORAGE
 ************************************************************/

function saveShopifyAdminTokenResult_(shop, tokenResult, source) {
  const accessToken = tokenResult && tokenResult.access_token
    ? String(tokenResult.access_token).trim()
    : '';

  if (!accessToken) {
    throw new Error(`Shopify token response did not include access_token: ${JSON.stringify(tokenResult)}`);
  }

  const props = PropertiesService.getScriptProperties();

  const nowMs = Date.now();

  const expiresInSeconds = Number(tokenResult.expires_in || 0);
  const refreshTokenExpiresInSeconds = Number(tokenResult.refresh_token_expires_in || 0);

  const accessTokenExpiresAtMs = expiresInSeconds
    ? nowMs + expiresInSeconds * 1000
    : 0;

  const refreshTokenExpiresAtMs = refreshTokenExpiresInSeconds
    ? nowMs + refreshTokenExpiresInSeconds * 1000
    : 0;

  const tokenType = resolveShopifyTokenType_(tokenResult);

  if (tokenType === SHOPIFY_OAUTH.TOKEN_TYPE.ONLINE) {
    throw new Error(
      'Shopify returned an ONLINE token. This is not safe for background automation. Reauthorize for offline access.'
    );
  }

  props.setProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_STORE_DOMAIN, shopifyOAuthCleanShopDomain_(shop));
  props.setProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_ADMIN_ACCESS_TOKEN, accessToken);
  props.setProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_TOKEN_TYPE, tokenType);

  if (tokenResult.scope) {
    props.setProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_TOKEN_SCOPE, String(tokenResult.scope || ''));
  }

  if (accessTokenExpiresAtMs) {
    props.setProperty(
      SHOPIFY_STRIVEN_PROPS.SHOPIFY_ACCESS_TOKEN_EXPIRES_AT,
      String(accessTokenExpiresAtMs)
    );
  } else {
    props.deleteProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_ACCESS_TOKEN_EXPIRES_AT);
  }

  if (tokenResult.refresh_token) {
    props.setProperty(
      SHOPIFY_STRIVEN_PROPS.SHOPIFY_REFRESH_TOKEN,
      String(tokenResult.refresh_token || '')
    );
  } else if (tokenType === SHOPIFY_OAUTH.TOKEN_TYPE.NON_EXPIRING_OFFLINE) {
    props.deleteProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_REFRESH_TOKEN);
  }

  if (refreshTokenExpiresAtMs) {
    props.setProperty(
      SHOPIFY_STRIVEN_PROPS.SHOPIFY_REFRESH_TOKEN_EXPIRES_AT,
      String(refreshTokenExpiresAtMs)
    );
  } else if (tokenType === SHOPIFY_OAUTH.TOKEN_TYPE.NON_EXPIRING_OFFLINE) {
    props.deleteProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_REFRESH_TOKEN_EXPIRES_AT);
  }

  return {
    status: 'SUCCESS',
    source: source || '',
    shop: shopifyOAuthCleanShopDomain_(shop),
    tokenType,
    accessToken: accessToken,
    accessTokenStoredAs: SHOPIFY_STRIVEN_PROPS.SHOPIFY_ADMIN_ACCESS_TOKEN,
    scope: tokenResult.scope || '',
    accessTokenExpiresAt: accessTokenExpiresAtMs
      ? new Date(accessTokenExpiresAtMs).toISOString()
      : '',
    refreshTokenStored: !!tokenResult.refresh_token,
    refreshTokenExpiresAt: refreshTokenExpiresAtMs
      ? new Date(refreshTokenExpiresAtMs).toISOString()
      : ''
  };
}


function resolveShopifyTokenType_(tokenResult) {
  if (tokenResult && tokenResult.associated_user) {
    return SHOPIFY_OAUTH.TOKEN_TYPE.ONLINE;
  }

  if (tokenResult && tokenResult.refresh_token) {
    return SHOPIFY_OAUTH.TOKEN_TYPE.EXPIRING_OFFLINE;
  }

  if (tokenResult && tokenResult.access_token && !tokenResult.expires_in) {
    return SHOPIFY_OAUTH.TOKEN_TYPE.NON_EXPIRING_OFFLINE;
  }

  return SHOPIFY_OAUTH.TOKEN_TYPE.UNKNOWN;
}


function shopifyOAuthShouldRequestExpiringOfflineToken_() {
  const props = PropertiesService.getScriptProperties();

  const raw = String(
    props.getProperty(SHOPIFY_STRIVEN_PROPS.SHOPIFY_REQUEST_EXPIRING_OFFLINE_TOKEN) || 'YES'
  ).trim().toUpperCase();

  return raw !== 'NO';
}


/************************************************************
 * SMALL HELPERS
 ************************************************************/

function shopifyOAuthCleanShopDomain_(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');
}


function shopifyOAuthBuildQueryString_(params) {
  return Object.keys(params || {})
    .map(key => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`;
    })
    .join('&');
}


function shopifyOAuthEscapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/************************************************************
 * FILE END: 05_Shopify_OAuth_Setup.gs
 ************************************************************/
