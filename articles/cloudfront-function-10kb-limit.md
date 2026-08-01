---
title: "CloudFront Function の 10KB 制限にコメントで引っかかったので、コメントを消さずにデプロイする"
emoji: "✂️"
type: "tech"
topics: ["aws", "cloudfront", "javascript", "cicd"]
published: false
---

CloudFront Function にリダイレクトを1つ足したら、デプロイが落ちた。

```
An error occurred (FunctionSizeLimitExceeded) when calling the
UpdateFunction operation
```

CloudFront Function のソースコードは **10KB が上限**（正確には 10,240 バイト）。Lambda@Edge と違い、これは緩和申請できないハード制限だ。

ファイルを測ってみた。

```
ソース全体   10,951 バイト   ← 上限超過
コメント除去  6,274 バイト   ← ロジックだけなら余裕
```

**超過分は全部コメントだった。**

## 消すべきか

素直な解決策は「コメントを削る」だ。実際そうしている例は多いと思う。

だが、このファイルの性質を考えると筋が悪い。

CloudFront Function は**エッジで動き、ログも出せず、デバッグもできない**。そして中身は自明ではなかった。

- ホスト名からパスプレフィックスへのマッピング
- 2世代のレガシーURL変換テーブル（セクション名の改称と、スラッグの改称）
- それらを**1パスで合成して301を1回に抑える**という要件
- ネストしたサブドメイン1件だけスラッグが違う例外

「なぜこう書いてあるか」が消えると、半年後の自分が確実に壊す。実際、コメントにはこう書いてあった。

```js
// 301 redirect: legacy section names AND legacy seed-N slugs are both
// resolved before the redirect is emitted, so
// `host.example.com/quotes/seed-1/` goes straight to
// `example.com/c/char/wisdom/fulfill-my-duty/` — one hop, not two.
```

これは仕様であって装飾ではない。消したら、次に触る人は2ホップのチェーンを再導入する。

## デプロイ時に剥がす

なので、**ソースは読める形で保ち、デプロイ用の成果物からだけコメントを落とす**ことにした。

```js
const stripped = source
  .replace(/\/\*[\s\S]*?\*\//g, '')   // ブロックコメント
  .replace(/^[ \t]*\/\/.*$/gm, '')    // 行頭の行コメント
  .replace(/\n{2,}/g, '\n')
  .trim();
```

意図的に**コメント除去だけ**にしている。識別子のリネームも式の書き換えもしない。理由は2つある。

1. **成果物がソースと行単位でほぼ一致する。** エッジで問題が起きたとき、スタックトレースの行番号がまだ意味を持つ
2. **ユニットテストがソースに対して走る。** 変換が軽微なら、ソースを検証することが成果物の検証として通用する

## 素朴な置換の危険を潰す

正規表現でコメントを消すのは、一般には正しくない。文字列リテラルの中に `/*` があれば、そこからコードを食い始める。

なので、変換前後に検証を入れた。

**① 文字列リテラルに `/*` が無いか**

```js
const literals = [...source.matchAll(/'[^'\n]*'|"[^"\n]*"/g)].map(m => m[0]);
const bad = literals.find(s => s.includes('/*'));
if (bad) { /* abort */ }
```

最初これを `//` も含めて検査したら、**`https://` に反応して即座に落ちた**。行コメントの除去は行頭アンカー付き（`^[ \t]*\/\/`）なので、行中の `//` は無関係だ。検査を厳しくしすぎると、正しいコードが通らなくなる。

**② テンプレートリテラルが無いか**

テンプレートリテラルの中に `//` で始まる行があると、行コメントとして消される可能性がある。ただしこの検査は**ストリップ後の出力に対して**行う必要がある。ソースにはバッククォートがコメント内の説明として大量に出てくるからだ（これも最初やって落ちた）。

```js
if (stripped.includes('`')) { /* abort */ }
```

**③ 成果物がパースでき、`handler` が取れるか**

これが決定的な検査になる。

```js
try {
  const fn = new Function(`${stripped}\nreturn handler;`)();
  if (typeof fn !== 'function') throw new Error('handler is not a function');
} catch (e) {
  console.error(`stripped artifact does not parse — ${e.message}`);
  process.exit(1);
}
```

置換が何かを壊していれば、ほぼ確実にここで落ちる。

**④ サイズが上限内か**

```js
if (bytes > LIMIT) {
  console.error(`FAIL: ${bytes} bytes exceeds the ${LIMIT}-byte limit.`);
  console.error('Shorten the logic — stripping comments is no longer enough.');
  process.exit(1);
}
```

AWS に弾かれてから気づくのではなく、**S3 にファイルを上げる前に**落とす。デプロイ手順の途中で失敗すると、中途半端な状態が残って厄介だ。

## 成果物に対してもテストを流す

ユニットテストはソースに対して書いてある。だが実際にデプロイされるのは成果物なので、**成果物に対しても同じテストを流した**。

```bash
sed 's#cloudfront-function.js#cloudfront-function.min.js#' \
  scripts/deploy/cloudfront-function.test.mjs > /tmp/min-test.mjs
node /tmp/min-test.mjs
# → 42 assertions, all passing
```

テスト側はファイルを読んで `new Function` で `handler` を取り出す形にしてあるので、対象ファイルを差し替えるだけで済む。

```js
const source = readFileSync(join(here, 'cloudfront-function.js'), 'utf8');
const handler = new Function(`${source}\nreturn handler;`)();
```

CloudFront Function は `handler(event)` という決まった形なので、イベントオブジェクトを自前で作れば**AWSに一切触らずに全経路をテストできる**。これは地味だが効く。

```js
function makeEvent(url) {
  const u = new URL(url);
  return {
    request: {
      uri: u.pathname,
      querystring: {},
      headers: { host: { value: u.hostname } },
    },
  };
}
```

さらに、**リダイレクト先を自分自身に食わせ直して、ホップ数を数える**ようにした。

```js
function resolve(url, max = 5) {
  let current = url, hops = 0;
  for (;;) {
    const out = handler(makeEvent(current));
    if (out.statusCode === 301) {
      hops += 1;
      if (hops > max) throw new Error(`redirect loop from ${url}`);
      current = out.headers.location.value;
      continue;
    }
    return { hops, final: current, uri: out.uri };
  }
}
```

「1ホップで着く」という要件が**テストで表現できる**ようになる。チェーンを再導入したら落ちる。

## デプロイ

```bash
npm run build:cf   # strip + 検証。上限超過でここで落ちる

aws cloudfront update-function \
  --name myRouter --if-match "$ETAG" \
  --function-config Comment="router",Runtime=cloudfront-js-2.0 \
  --function-code fileb://cloudfront-function.min.js

# publish 前に AWS 側のランタイムで実際に叩ける
aws cloudfront test-function --name myRouter --if-match "$NEW_ETAG" \
  --stage DEVELOPMENT --event-object fileb://event.json

aws cloudfront publish-function --name myRouter --if-match "$NEW_ETAG"
```

`test-function` は見落とされがちだが有用で、**DEVELOPMENT ステージの関数を AWS の本物のランタイムで実行して結果を返す**。手元の Node で通っていても、CloudFront JS ランタイム（ES5.1相当の制約がある）で動くとは限らない。publish 前にここを通しておくと安心できる。

## まとめ

- CloudFront Function の 10KB はソースコードのサイズで、**コメントも含む**
- コメントを削る前に、**デプロイ時に剥がす**選択肢を検討する価値がある。エッジで動くコードほど、なぜそう書いてあるかの記録が要る
- 素朴な正規表現でのストリップは、**変換後にパースして検証する**なら実用に足りる
- 検査を書いたら、**落ちるべき入力で必ず試す**。私は2回、自分の検査に誤検知で止められた（`https://` と、コメント内のバッククォート）
- `aws cloudfront test-function` で、publish 前に本物のランタイムで確認できる

ちなみに、この仕組みを入れた翌週にリダイレクトを4つ追加したら、ソースは 10,951 バイトになった。**strip が無ければそのデプロイは失敗していた。**
