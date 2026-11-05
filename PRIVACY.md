# Privacy policy

Sourcefold is a self-hosted tool. Whoever runs a deployment (the owner) chooses who can sign in with `ALLOWED_EMAIL`: just themselves, a list of people, or anyone with a Google account (`*`). Each person sees only their own sources and the projects others have shared with them; the database enforces this per account.

## What it stores

- Your Google account email and name, to sign you in.
- A Google refresh token, so the app can save files to your Google Drive, if you keep the Drive backup on.
- The list of what you save (titles, links, authors and dates), your projects, groups, notes and highlights.
- The text of saved articles and your uploaded images.

The list lives in the deployment owner's Supabase database. The text and images live in the owner's Cloudflare R2 storage, reached only through the deployment's own Cloudflare Worker, which asks the database whether you may read or change each source. A source's text sits in Supabase only for the few seconds it takes to copy it to R2. The owner can technically read both. Each computer you sign in on also keeps a copy in `Documents/Sourcefold`.

A deployment set up without the Cloudflare part keeps the old behaviour: text stays in Supabase only until it is copied to your Google Drive, then lives only there.

## Google Drive backup

With **Back up to Google Drive** on (Settings, and when you first sign in on the desktop app), Sourcefold also copies every source into a `Sourcefold` folder in your Drive. Turn it off and nothing more is sent to Drive; what's already there stays until you delete it.

## TL;DRs

The desktop app can write a TL;DR of each source with an AI you choose in **Settings → TL;DR**: ChatGPT (signed in with your own ChatGPT account), OpenRouter or OpenCode (with your own key). Nothing is sent until you turn this on. Then the desktop app sends the source's text from your computer straight to that service, under that service's own privacy policy, and the TL;DR is stored with your sources. Your ChatGPT sign-in and your keys stay on your computer. TL;DRs taken from the article itself (such as Wikipedia's lead) never leave your computer.

## Google Drive access

Sourcefold asks only for the `drive.file` scope. It can see and change only the files and folders it created itself, inside a `Sourcefold` folder in your Drive. It cannot read anything else in your Drive.

## Shared projects

You can share a project by giving someone its invite link or code. Everyone who joins sees the whole project (sources, their text, groups, notes and highlights), sees each other's names and emails, and, if they joined as editors, can change it. What they add belongs to the project. Remove someone, turn the link off or leave the project, and access stops at once. Only you can share your own projects; nobody can join one without a link or code you handed out.

## Your data and third parties

Sourcefold doesn't sell or share your data, and sends it nowhere except the AI you pick for TL;DRs, if you turn them on. It has no analytics and no ads.

## Deleting your data

Delete items and folders in the app. In this version a deleted source's text stays in R2 until the deployment owner clears it; removing it automatically is planned and remove Sourcefold's access at https://myaccount.google.com/permissions. To have your account and everything in it removed from a deployment, ask its owner. Owners can remove everything by deleting the Supabase project.

## Contact

Open an issue at https://github.com/lagoonitself/sourcefold/issues.
