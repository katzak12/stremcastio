// Letting every user run their own free relay: a "Deploy to Cloudflare" link, and spotting the
// resulting address (https://<name>.<account>.workers.dev) when the user copies it and comes back.

export const DEPLOY_RELAY_URL =
  'https://deploy.workers.cloudflare.com/?url=https://github.com/katzak12/stremcastio/tree/main/worker'

/** The first workers.dev address in some text (e.g. the clipboard), without a trailing slash or path. */
export function findWorkerUrl(text: string | null | undefined): string | null {
  if (!text) return null
  const m = /https:\/\/(?:[a-z0-9-]+\.)+workers\.dev\b/i.exec(text)
  return m ? m[0].toLowerCase() : null
}
