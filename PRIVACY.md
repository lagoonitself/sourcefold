# Privacy policy

Sourcefold is a self-hosted tool. Whoever runs a deployment (the owner) chooses who can sign in with `ALLOWED_EMAIL`: just themselves, a list of people, or anyone with a Google account (`*`). Each person sees only their own sources; the database enforces this per account.

## What it stores

- Your Google account email and name, to sign you in.
- A Google refresh token, so the app can save files to your Google Drive.
- The sources you save (titles, links, authors and dates), your folders and your notes.

All of this lives in the deployment owner's Supabase database, which the owner can technically read. The text of saved articles and your uploaded images are kept in Supabase only until they're copied to your Google Drive, usually a few seconds; after that they live only in Drive.

## Google Drive access

Sourcefold asks only for the `drive.file` scope. It can see and change only the files and folders it created itself, inside a `Sourcefold` folder in your Drive. It cannot read anything else in your Drive.

## Sharing

Sourcefold doesn't sell, share or send your data to anyone. It has no analytics and no ads.

## Deleting your data

Delete items and folders in the app and remove Sourcefold's access at https://myaccount.google.com/permissions. To have your account and everything in it removed from a deployment, ask its owner. Owners can remove everything by deleting the Supabase project.

## Contact

Open an issue at https://github.com/lagoonitself/sourcefold/issues.
