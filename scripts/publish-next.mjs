#!/usr/bin/env node
/**
 * Publish the next queued article by flipping `published: false` to true.
 *
 *   node scripts/publish-next.mjs           # publish if the interval has elapsed
 *   node scripts/publish-next.mjs --dry-run # say what would happen, change nothing
 *   node scripts/publish-next.mjs --force   # ignore the interval
 *
 * Only slugs listed in publish-queue.txt are eligible, in the order they
 * appear there. An article that is not in the queue is never published by
 * this script, whatever its state — the queue is the approval record, and
 * it is the only thing standing between a draft and the public.
 *
 * Spacing is enforced here rather than by the cron expression. GitHub's
 * schedule syntax cannot express "every other week", and a workflow that
 * fires weekly but publishes only when enough time has passed is also
 * robust to a missed or delayed run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { REPO, articlePath, readQueue, pendingSlugs, titleOf } from './queue.mjs';

const MIN_DAYS = Number(process.env.PUBLISH_MIN_DAYS ?? 10);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

/**
 * Days since this script last published something.
 *
 * Read from git rather than a state file: the commits are the record, so
 * there is nothing to fall out of sync, and a manual publish counts too.
 */
function daysSinceLastPublish() {
  const out = execFileSync(
    'git',
    ['log', '-1', '--format=%cI', '--grep=^publish: '],
    { cwd: REPO, encoding: 'utf8' },
  ).trim();
  if (!out) return Infinity; // nothing published yet
  return (Date.now() - new Date(out).getTime()) / 86_400_000;
}

const queue = readQueue();
if (queue.length === 0) {
  console.log('queue is empty — nothing to publish.');
  process.exit(0);
}

const pending = pendingSlugs({ warn: true });

if (pending.length === 0) {
  console.log(`every queued article is already published (${queue.length} in queue).`);
  process.exit(0);
}

const elapsed = daysSinceLastPublish();
if (!FORCE && elapsed < MIN_DAYS) {
  console.log(
    `last publish was ${elapsed.toFixed(1)} days ago; waiting for ${MIN_DAYS}. ` +
      `Next up: ${pending[0]}`,
  );
  process.exit(0);
}

const slug = pending[0];
const file = articlePath(slug);
const before = readFileSync(file, 'utf8');
const after = before.replace(/^published:\s*false\s*$/m, 'published: true');

if (after === before) {
  console.error(`FAIL: could not find "published: false" in articles/${slug}.md`);
  process.exit(1);
}

const title = titleOf(slug);

if (DRY_RUN) {
  console.log(`would publish: ${slug}`);
  console.log(`  ${title}`);
  console.log(`  (last publish ${elapsed === Infinity ? 'never' : elapsed.toFixed(1) + 'd ago'})`);
  console.log(`  ${pending.length - 1} left in the queue after this`);
  process.exit(0);
}

writeFileSync(file, after);
console.log(`published: ${slug}`);
console.log(`  ${title}`);
console.log(`  ${pending.length - 1} left in the queue`);

// Consumed by the workflow to build the commit message and the notification.
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    `slug=${slug}\ntitle=${title}\nremaining=${pending.length - 1}\n`,
    { flag: 'a' },
  );
}
