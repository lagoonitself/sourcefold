// Drive sign-in errors, shared by the website and the apps so `instanceof` checks work everywhere.

export class DriveAuthError extends Error {
  constructor(message = "Google Drive authorization failed.") {
    super(message);
    this.name = "DriveAuthError";
  }
}

// The refresh token belongs to a different OAuth client than GOOGLE_CLIENT_ID.
// Reconnecting can't fix this; the server settings must match Supabase's Google provider.
export class DriveClientMismatchError extends Error {
  constructor() {
    super("GOOGLE_CLIENT_ID doesn't match the Google client Supabase signs in with.");
    this.name = "DriveClientMismatchError";
  }
}
