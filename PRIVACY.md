# Privacy policy

Sourcefold is a personal, self-hosted tool. Each deployment is used by one person, the owner, whose email is set in `ALLOWED_EMAIL`. Nobody else can sign in.

## What it stores

- Your Google account email and name, to sign you in.
- A Google refresh token, so the app can save files to your Google Drive.
- The sources you save (titles, links, authors and dates), your folders and your notes.

All of this lives in the deployment owner's own Supabase database. The text of saved articles and your uploaded images are kept in Supabase only until they're copied to your Google Drive, usually a few seconds; after that they live only in Drive.

## Google Drive access

Sourcefold asks only for the `drive.file` scope. It can see and change only the files and folders it created itself, inside a `Sourcefold` folder in your Drive. It cannot read anything else in your Drive.

## Sharing

Sourcefold doesn't sell, share or send your data to anyone. It has no analytics and no ads.

## Deleting your data

Delete items and folders in the app, remove Sourcefold's access at https://myaccount.google.com/permissions, and delete the Supabase project to remove everything.

## Contact

Open an issue at https://github.com/lagoonitself/sourcefold/issues.
