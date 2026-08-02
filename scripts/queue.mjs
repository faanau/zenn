/**
 * Shared reading of publish-queue.txt and the article files it names.
 *
 * Both the publisher and the notifier need to answer "what is pending, and in
 * what order". If they answered it separately the two could drift, and the
 * notification would name a different "next up" than the one that actually
 * ships. One implementation, used by both.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const QUEUE = join(REPO, 'publish-queue.txt');

export function articlePath(slug) {
  return join(REPO, 'articles', `${slug}.md`);
}

/** Ordered slugs, comments and blanks removed. */
export function readQueue() {
  return readFileSync(QUEUE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function isPublished(file) {
  return /^published:\s*true\s*$/m.test(readFileSync(file, 'utf8'));
}

export function titleOf(slug) {
  const file = articlePath(slug);
  if (!existsSync(file)) return slug;
  return (readFileSync(file, 'utf8').match(/^title:\s*"(.*)"\s*$/m) || [])[1] ?? slug;
}

/**
 * Queued slugs that are not yet published, in queue order.
 *
 * A queued slug with no file is skipped rather than treated as pending, so a
 * typo in the queue cannot stall the run behind an article that cannot exist.
 */
export function pendingSlugs({ warn = false } = {}) {
  return readQueue().filter((slug) => {
    if (!existsSync(articlePath(slug))) {
      if (warn) console.warn(`  WARNING: ${slug} is queued but articles/${slug}.md does not exist`);
      return false;
    }
    return !isPublished(articlePath(slug));
  });
}
