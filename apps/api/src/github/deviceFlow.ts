// ---------------------------------------------------------------------------
// GitHub OAuth device-flow client.
//
// Per-user browserless OAuth. The user visits `verification_uri` in any
// browser (typically the same device), enters `user_code`, and authorizes
// the app. The backend polls the access-token endpoint until the user
// approves (or the code expires).
//
// We use the default client ID baked into VS Code's Copilot extension,
// which is a public/non-confidential client registered by GitHub specifically
// for Copilot device-flow auth. Operators can override via
// HOME_OS_GITHUB_CLIENT_ID if they register their own OAuth app.
// ---------------------------------------------------------------------------

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenSuccess {
  kind: 'ok';
  accessToken: string;
  tokenType: string;
  scope: string;
}

export interface AccessTokenPending {
  kind: 'pending';
  /** 'authorization_pending' | 'slow_down' | other transient errors */
  reason: string;
  /** If GitHub asked us to slow down, the new interval in seconds. */
  interval?: number;
}

export interface AccessTokenFailure {
  kind: 'error';
  reason: string;
  description?: string;
}

export type AccessTokenResult = AccessTokenSuccess | AccessTokenPending | AccessTokenFailure;

export interface DeviceFlowOptions {
  clientId: string;
  fetchImpl?: typeof fetch;
  scope?: string;
}

/** Step 1: request a device + user code. */
export async function requestDeviceCode(opts: DeviceFlowOptions): Promise<DeviceCodeResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    client_id: opts.clientId,
    // Copilot API itself doesn't require any extra GitHub scope, but we ask
    // for `read:user` so we can resolve the login/id for display.
    scope: opts.scope ?? 'read:user',
  });
  const res = await fetchImpl(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`github_device_code_http_${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Partial<DeviceCodeResponse>;
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('github_device_code_malformed_response');
  }
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: data.expires_in ?? 900,
    interval: data.interval ?? 5,
  };
}

/** Step 2: exchange a device_code for an access_token. Call once per interval. */
export async function pollAccessToken(
  opts: DeviceFlowOptions & { deviceCode: string }
): Promise<AccessTokenResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    client_id: opts.clientId,
    device_code: opts.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const res = await fetchImpl(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { kind: 'error', reason: `http_${res.status}`, description: text.slice(0, 200) };
  }
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  };
  if (data.access_token) {
    return {
      kind: 'ok',
      accessToken: data.access_token,
      tokenType: data.token_type ?? 'bearer',
      scope: data.scope ?? '',
    };
  }
  const err = data.error ?? 'unknown_error';
  if (err === 'authorization_pending' || err === 'slow_down') {
    return { kind: 'pending', reason: err, interval: data.interval };
  }
  return { kind: 'error', reason: err, description: data.error_description };
}

export interface GithubUserIdentity {
  id: number;
  login: string;
}

/** Looks up /user with a freshly-obtained access token so we can store the login/id. */
export async function fetchGithubUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<GithubUserIdentity> {
  const res = await fetchImpl(USER_URL, {
    headers: {
      authorization: `token ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'home-os/1.0',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`github_user_http_${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: number; login?: string };
  if (typeof data.id !== 'number' || typeof data.login !== 'string') {
    throw new Error('github_user_malformed_response');
  }
  return { id: data.id, login: data.login };
}
