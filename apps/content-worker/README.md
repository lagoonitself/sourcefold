# Sourcefold content Worker

A small Cloudflare Worker that stores each source's Markdown text and uploaded images in R2. It is the only thing that touches the bucket. It asks Supabase (`content_access`) with the caller's own sign-in token who may read or write an item.

## Routes

| Request                   | Answer                                                  |
| ------------------------- | ------------------------------------------------------- |
| `GET /health`             | `200 {"data":{"status":"ok"}}`                          |
| `GET /v1/items/{id}/text` | Markdown, `ETag: "<sha256>"`, or `404`                  |
| `PUT /v1/items/{id}/text` | UTF-8 Markdown, up to 10 MiB, answers `{sha256, bytes}` |
| `GET /v1/items/{id}/file` | Stored image bytes with their content type              |
| `PUT /v1/items/{id}/file` | Image bytes (`Content-Type: image/*`), up to 25 MiB     |

Auth is `Authorization: Bearer <Supabase access token>`, or `Authorization: Service <SERVICE_SECRET>` for the website's server. Errors are `{"error":{"message","code"}}`. Writes are refused with `507 storage_full` near the R2 free-plan limit.

## Deploy your own

1. `npx wrangler r2 bucket create sourcefold-content`
2. Put your Supabase URL and publishable key in `wrangler.jsonc` (`vars`).
3. `npx wrangler secret put SERVICE_SECRET` (or set the plain variable `SERVICE_SECRET_SHA256` to the secret's SHA-256 in hex, so the secret itself isn't stored in Cloudflare)
4. `npx wrangler deploy`

## Develop

`npm test`, `npm run typecheck`, `npm run build` (bundles to `dist/worker.js`).
