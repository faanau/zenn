---
title: "URLを変えるなら「Googleがまだ知らないうち」— サブドメイン4つを1ホストに統合した記録"
emoji: "🧭"
type: "tech"
topics: ["seo", "cloudfront", "アーキテクチャ", "運用"]
published: false
---

SEO の記事はたいてい「URLは変えるな」で終わる。正しいのだが、そこで思考が止まると、**本当に変えるべき状況で動けなくなる**。

先日、キャラクター別に切っていたサブドメイン4つを、1ホストのパス配下に統合した。

```
kyojuro-rengoku.example.com/wisdom/foo/
luffy.example.com/pitfalls/bar/          →  example.com/c/{character}/...
giyu-tomioka.example.com/gems/baz/
uzumaki.naruto.example.com/idioms/qux/
```

145URL の移行だ。普通なら「やめとけ」案件で、実際その判断は正しい場面が多い。ではなぜやったのか、そしてなぜ**その時点でやるのが最も安かった**のか。

## 判断の材料は全数調査から出た

Search Console の画面は「未登録78件」までしか教えてくれない。URL Inspection API で全URLを調べたら、こうだった。

```
URL is unknown to Google        133
Crawled - currently not indexed  17
Submitted and indexed             1
```

ホスト別。

| ホスト | Google が知らないURL |
|---|---|
| A | 37 / 37 |
| B | 35 / 35 |
| C | 35 / 35 |
| D | 23 / 38 |

**4サイトのうち3つは、1ページもクロールされたことがなかった。** sitemap は送信済みで、Google はそれを取得もしていた。URLは渡っているのに、読みに来ていない。

理由ははっきりしている。**クロールバジェットと信頼はホスト単位で配分される。** 権威ゼロの新規ホストが4つあって、それぞれが独立に発見を勝ち取る必要があり、どれも閾値に届いていなかった。親ドメインもインデックス済みが1ページだけで、配れる信頼が無い。

キャラを増やすほど**薄まる**構造になっていた。

## 移行コストが最も安いのは「知られていないとき」

ここが本題だ。

URL移行のコストは、**Googleが現在そのURLについて持っている資産**に比例する。インデックス、被リンク、順位、履歴。移行はそれらを301で引き継ぐ作業で、引き継ぎは必ず目減りする。

このとき、145URL中133本は**Googleが存在すら知らなかった**。

```
移行コスト ≒ 捨てるものの量 ≒ ほぼゼロ
```

そして、この窓は**閉じる一方**だ。インデックスが増えれば増えるほど移行は高くつく。「いつかやる」と先送りすると、やる価値が下がるのではなく、**やるコストが上がる**。

だから「URLを変えるな」という原則には、こう但し書きが要る。

> **変えるなら、いま知られていないうちに変えろ。**
> 迷っているうちに知られると、選択肢が消える。

逆に言えば、既にインデックスされ被リンクもあるURLなら、原則どおり触らない方がいい。**同じ「URL変更」でも、状態によって判断が正反対になる。**

## 実装：1ホップを保証する

このサイトは過去に2回リネームしていた。

1. セクション名の改称（`/quotes/` → `/wisdom/` など）
2. スラッグの改称（`seed-1` → `fulfill-my-duty` など）

CloudFront Function にリダイレクトが2ブロック並んでいて、素直に書くと**連鎖する**。

```
/quotes/seed-1/  →301→  /wisdom/seed-1/  →301→  /wisdom/fulfill-my-duty/
```

実際そうなっていた。ローンチ当時の外部リンクは全部 `/quotes/seed-N/` 側なので、**最古のURLが最も遠い**という最悪の配置だ。

ここに3つ目の変換（ホスト→パス）を足すと3ホップになる。なので、**全部の変換を1パスで合成してから301を1回だけ返す**ようにした。

```js
function normalizeLegacy(p) {
  let out = p;
  for (const oldPath in LEGACY_PATHS) {          // 世代1: セクション改称
    if (out === oldPath || out.startsWith(oldPath + '/')) {
      out = LEGACY_PATHS[oldPath] + out.slice(oldPath.length);
      break;
    }
  }
  const key = out.replace(/\/$/, '');
  if (SLUG_REDIRECTS[key]) out = SLUG_REDIRECTS[key] + '/';   // 世代2: スラッグ改称
  return out;
}

// 世代3（ホスト→パス）と合成して、301は1回だけ
return redirect(APEX + target + normalizeLegacy(path));
```

### ホップ数をテストで表現する

「1ホップで着く」は仕様なので、テストで書けるようにした。**リダイレクト先を自分自身に食わせ直して、止まるまでの回数を数える。**

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

// 「1ホップで、この場所に着く」
redirects(
  'https://kyojuro-rengoku.example.com/quotes/seed-1/',
  'https://example.com/c/kyojuro-rengoku/wisdom/fulfill-my-duty/',
);
```

CloudFront Function は `handler(event)` という決まった形なので、イベントを自前で組み立てれば**AWSに触らずに全経路を検証できる**。最終的に42アサーションになった。

チェーンを再導入したら落ちる。これが無いと、半年後に誰か（自分を含む）が必ず戻す。

## 引っかかったところ

### 共有アセットは apex ルートへ返す

サブドメインへのリクエストを全部 `/c/{slug}/` 配下に飛ばすと、共有アセットが壊れる。

```
luffy.example.com/manga-panels/x.jpg
  → example.com/c/luffy/manga-panels/x.jpg   ← 存在しない
```

`/images/` `/_assets/` `/manga-panels/` などバケットルートにあるものは、**apex のルートへ**返す必要がある。ホットリンクされている画像や、キャッシュに残った古いHTMLが参照するCSSが死ぬ。

### robots.txt はリダイレクトしない

クローラがサブドメインに robots.txt を求めてきたとき、**リダイレクトではなくファイルを返す**方がいい。IndexNow の検証キーも同様で、これらはホストごとのプロトコルファイルだ。

### ネストしたホストのスラッグが違った

`uzumaki.naruto.example.com` だけ、S3上のプレフィックスが `/c/uzumaki/naruto/` になっていた。ホスト名の構造をそのまま反映していたためだ。

そのまま統合すると公開URLが `example.com/c/uzumaki/naruto/…` になる。**これが最後の移行である以上、恒久的に残る。** 該当35URLは全部Googleが知らなかったので、ここで `/c/naruto/` に移した。ホスト名から機械的にスラッグを導出できないので、逆引きマップに明示的に書いた。

### ビルド時のガードが逆になる

「`/c/{slug}/` は dev 専用のリンク形式で、本番に漏れたらデプロイを止める」というガードがあった。統合で `/c/{slug}/` が**本番の正しい形**になったので、このガードは正しいビルドを全部拒否するようになる。

**外さずに反転させた。** 今は逆に、退役したサブドメインURLが残っていないかを見ている。

## 結果

移行後、145URL全数を検証した。

```
301 が1回 → 200 → 自己参照canonical
145 / 145 合格
```

ローンチ当時の2ホップチェーンも解消した。

```
kyojuro-rengoku.example.com/quotes/seed-1/
  → 1ホップ → example.com/c/kyojuro-rengoku/wisdom/fulfill-my-duty/
```

## 統合そのものは効果を保証しない

正直に書いておくと、**これだけではインデックスは動かない**と予想している。

律速は依然として外部シグナル（被リンク、指名検索）で、統合はそれを**4分割せず1点に集める**ための前工程にすぎない。実際、統合前に2,700語まで厚くした記事は、クロールされた上で未登録のままだった。「厚くすれば拾われる」段階ですらなかった。

だから統合の意義はこう表現するのが正確だと思う。

> リンクを取ったときに、その効果が分散しない状態を作った。

そして冒頭に戻る。**その工事は、資産が無いうちにしかできない。**

## まとめ

- **「URLを変えるな」は、変える資産がある場合の原則。** 知られていないURLには当てはまらない
- 判断材料は画面ではなく **URL Inspection API の全数調査**から出る。「未登録N件」ではなく「どのURLがどの状態か」
- 複数世代のリネームがあるなら、**合成して1ホップにする**。連鎖は放置すると増える
- **ホップ数をテストで表現する。** リダイレクト先を自分に食わせ直せば数えられる
- 共有アセット、robots.txt、ネストしたホストの例外は個別に潰す
- ビルド時ガードは仕様変更で意味が反転する。**外さずに反転させる**
