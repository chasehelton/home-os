import * as client from 'openid-client';
import type { Env } from '../env.js';

export interface OidcStartResult {
  url: URL;
  codeVerifier: string;
  state: string;
  nonce: string;
}

export interface OidcVerifiedClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  pictureUrl: string | null;
}

export class OidcDisabledError extends Error {
  constructor() {
    super('Google OAuth is not configured (set HOME_OS_GOOGLE_CLIENT_ID/SECRET).');
  }
}

/**
 * OIDC client for Google sign-in. Uses authorization code + PKCE + nonce.
 *
 * Important: this is *login only*. Calendar offline access (refresh tokens)
 * is requested separately in Phase 5 with its own consent flow.
 */
export class GoogleOidc {
  private configPromise: Promise<client.Configuration> | null = null;

  constructor(private readonly env: Env) {}

  isConfigured(): boolean {
    return Boolean(this.env.HOME_OS_GOOGLE_CLIENT_ID && this.env.HOME_OS_GOOGLE_CLIENT_SECRET);
  }

  private async config(): Promise<client.Configuration> {
    if (!this.isConfigured()) throw new OidcDisabledError();
    if (!this.configPromise) {
      this.configPromise = client.discovery(
        new URL('https://accounts.google.com'),
        this.env.HOME_OS_GOOGLE_CLIENT_ID!,
        this.env.HOME_OS_GOOGLE_CLIENT_SECRET!,
      );
    }
    return this.configPromise;
  }

  async start(): Promise<OidcStartResult> {
    const cfg = await this.config();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    const url = client.buildAuthorizationUrl(cfg, {
      redirect_uri: this.env.HOME_OS_GOOGLE_REDIRECT_URI,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    });

    return { url, codeVerifier, state, nonce };
  }

  async finish(params: {
    callbackUrl: URL;
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
  }): Promise<OidcVerifiedClaims> {
    const cfg = await this.config();
    const tokens = await client.authorizationCodeGrant(cfg, params.callbackUrl, {
      pkceCodeVerifier: params.codeVerifier,
      expectedState: params.expectedState,
      expectedNonce: params.expectedNonce,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('Missing ID token claims.');

    const sub = String(claims.sub);
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    const emailVerified = claims.email_verified === true;
    const name = typeof claims.name === 'string' ? claims.name : email;
    const pictureUrl = typeof claims.picture === 'string' ? claims.picture : null;

    if (!email) throw new Error('Google did not return an email address.');
    return { sub, email, emailVerified, name, pictureUrl };
  }
}
