import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPES_KEY = 'requiredScopes';

/**
 * Declares the OAuth scopes a connector endpoint requires. Enforced by
 * ConnectorAuthGuard. App JWTs (first-party) implicitly carry all scopes.
 */
export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);
