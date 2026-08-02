#!/usr/bin/env node
/**
 * Email the outcome of a scheduled publish run, via SES.
 *
 *   NOTIFY_KIND=published node scripts/notify.mjs
 *   NOTIFY_KIND=failed    node scripts/notify.mjs
 *   ... --dry-run   # print the message, send nothing
 *
 * Only two outcomes are worth an email: an article went out, or the run
 * broke. A run that correctly does nothing (still inside the waiting period)
 * is silent — it happens most weeks, and a weekly "nothing happened" message
 * is exactly the kind of mail people stop reading, including the ones that
 * matter.
 *
 * Sending uses SES through a GitHub OIDC role, so there are no long-lived AWS
 * credentials in this repository. See .github/workflows/publish-next.yml.
 *
 * If sending itself fails this exits non-zero on purpose. That turns the run
 * red, and GitHub's own "workflow failed" mail to the repository owner becomes
 * the fallback — a notifier that can fail silently is worse than none.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pendingSlugs, titleOf } from './queue.mjs';

const DRY_RUN = process.argv.slice(2).includes('--dry-run');

const KIND = process.env.NOTIFY_KIND ?? 'published';
const TO = process.env.NOTIFY_TO;
const FROM = process.env.NOTIFY_FROM ?? 'noreply@faanau.co.jp';
const REGION = process.env.NOTIFY_REGION ?? 'ap-northeast-1';
const MIN_DAYS = Number(process.env.PUBLISH_MIN_DAYS ?? 10);

const SLUG = process.env.NOTIFY_SLUG ?? '';
const TITLE = process.env.NOTIFY_TITLE ?? SLUG;

const RUN_URL =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '(ローカル実行)';

/** The workflow's cron: Tuesday 00:00 UTC = Tuesday 09:00 JST. */
const CRON_WEEKDAY_UTC = 2;

/**
 * The first scheduled run that will clear the waiting period.
 *
 * Worth stating in the mail because the effective cadence is not the 10 days
 * the gate names: ten days after a Tuesday is a Friday, and the next run is
 * the Tuesday after that. The real spacing is a fortnight.
 */
function firstEligibleRun(from, minDays) {
  const d = new Date(from.getTime() + minDays * 86_400_000);
  d.setUTCHours(0, 0, 0, 0);
  if (d.getTime() < from.getTime() + minDays * 86_400_000 || d.getUTCDay() !== CRON_WEEKDAY_UTC) {
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (d.getUTCDay() !== CRON_WEEKDAY_UTC);
  }
  return d;
}

function jstDate(d) {
  return d.toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function publishedMessage() {
  const remaining = pendingSlugs();
  const lines = [
    '記事を公開しました。',
    '',
    `  ${TITLE}`,
    `  https://zenn.dev/faanau/articles/${SLUG}`,
    '',
    'Zenn は GitHub 連携で取り込むので、反映まで数分かかります。',
    'その間はこの URL が 404 になります。',
    '',
  ];

  if (remaining.length === 0) {
    lines.push(
      'これでキューは空になりました。',
      'publish-queue.txt に次の slug を足すまで、自動公開は止まります。',
    );
  } else {
    lines.push(
      `キューの残り: ${remaining.length} 本`,
      '',
      `  次回: ${titleOf(remaining[0])}`,
      `        ${remaining[0]}`,
      `        最短 ${jstDate(firstEligibleRun(new Date(), MIN_DAYS))} 09:00`,
      '',
      `待機期間は ${MIN_DAYS} 日ですが、実行は火曜だけなので実際の間隔は概ね2週間です。`,
    );
  }

  lines.push('', `実行ログ: ${RUN_URL}`);
  return { subject: `[zenn] 公開: ${TITLE}`, body: lines.join('\n') };
}

function failedMessage() {
  const published = SLUG !== '';
  const lines = [
    '自動公開ワークフローが失敗しました。',
    '',
    `  実行ログ: ${RUN_URL}`,
    '',
  ];

  if (published) {
    // The publish step succeeded and something after it broke. The article may
    // or may not have reached the default branch, so state that plainly rather
    // than guessing.
    lines.push(
      `公開処理そのものは ${SLUG} まで進んでいます。`,
      'commit / push のどちらで落ちたかによって、公開済みか未公開かが変わります。',
      '',
      '確認すること:',
      '  - git log --grep="^publish: " で該当のコミットが積まれているか',
      '  - 積まれていれば公開済み。Zenn 側にも出ているか見る',
      '  - 積まれていなければ未公開。articles/ はそのまま、次回に持ち越し',
    );
  } else {
    lines.push(
      '記事は公開されていません。',
      '',
      '確認すること:',
      '  - publish-queue.txt の slug と articles/ のファイル名が一致しているか',
      '  - ワークフローの権限（contents: write / id-token: write）',
      '  - SES 送信ロールの信頼ポリシー',
    );
  }

  lines.push(
    '',
    'このまま放置しても記事が二重に出ることはありません。',
    '次の火曜に再試行されます。',
  );
  return { subject: '[zenn] 失敗: 自動公開ワークフロー', body: lines.join('\n') };
}

/**
 * Sent by the notify-test dispatch input.
 *
 * Local dry-runs prove the message reads correctly and a local send proves SES
 * accepts the sender, but neither exercises the OIDC role — that only happens
 * inside a real run. This is how that gets tested without publishing anything.
 */
function testMessage() {
  const remaining = pendingSlugs();
  return {
    subject: '[zenn] テスト送信',
    body: [
      'これはテスト送信です。記事は公開していません。',
      '',
      'この一通が届いたということは、以下が通っています。',
      '',
      '  - GitHub Actions から OIDC で AWS ロールを引き受けられる',
      '  - SES が noreply@faanau.co.jp からの送信を受け付ける',
      '  - 宛先が正しく設定されている',
      '',
      `キューの残り: ${remaining.length} 本`,
      remaining.length ? `  次回: ${titleOf(remaining[0])}` : '  （キューは空）',
      '',
      `実行ログ: ${RUN_URL}`,
    ].join('\n'),
  };
}

const MESSAGE = { failed: failedMessage, test: testMessage, published: publishedMessage };
const { subject, body } = (MESSAGE[KIND] ?? publishedMessage)();

if (DRY_RUN) {
  console.log(`To:      ${TO ?? '(NOTIFY_TO unset)'}`);
  console.log(`From:    ${FROM}`);
  console.log(`Subject: ${subject}`);
  console.log('');
  console.log(body);
  process.exit(0);
}

if (!TO) {
  console.error('FAIL: NOTIFY_TO is not set — no destination to send to.');
  process.exit(1);
}

// Written to a file and passed with file:// rather than assembled as CLI
// arguments: the subject and body are Japanese prose containing quotes and
// newlines, and SES's shorthand argument syntax has no good way to carry them.
const payload = join(tmpdir(), `ses-${process.pid}.json`);
writeFileSync(
  payload,
  JSON.stringify({
    Source: FROM,
    Destination: { ToAddresses: [TO] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Text: { Data: body, Charset: 'UTF-8' } },
    },
  }),
);

execFileSync('aws', ['ses', 'send-email', '--region', REGION, '--cli-input-json', `file://${payload}`], {
  stdio: 'inherit',
});
console.log(`notified (${KIND})`);
