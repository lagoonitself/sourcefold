/**
 * Validation logic for Sourcefold Desktop loopback sign-in parameters.
 */

export interface ValidationSuccess {
  valid: true;
  callbackUrl: string;
  state: string;
}

export interface ValidationFailure {
  valid: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const STATE_REGEX = /^[A-Za-z0-9\-_]{8,128}$/;
const INVALID_LINK_MESSAGE = "This sign-in link isn't valid. Start again from the desktop app.";

/**
 * Validates loopback callback URL and state for desktop authentication.
 */
export function validateConnectParams(
  callback: string | null | undefined,
  state: string | null | undefined,
): ValidationResult {
  if (!state || typeof state !== "string" || !STATE_REGEX.test(state)) {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  if (!callback || typeof callback !== "string") {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  let url: URL;
  try {
    url = new URL(callback);
  } catch {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  if (url.protocol !== "http:") {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  if (!url.port || url.port.trim() === "") {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  const portNum = Number(url.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  if (url.pathname !== "/auth/callback") {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  if (url.username || url.password) {
    return {
      valid: false,
      error: INVALID_LINK_MESSAGE,
    };
  }

  // Construct normalized URL without search/hash
  const normalizedCallback = `http://${hostname}:${portNum}/auth/callback`;

  return {
    valid: true,
    callbackUrl: normalizedCallback,
    state,
  };
}
