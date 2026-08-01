---
title: "37語のスタブが2000語の記事を押さえつけていた — キーワード共食いを機械的に検出する"
emoji: "🍽️"
type: "tech"
topics: ["seo", "コンテンツ管理", "nodejs", "品質管理"]
published: false
---

同じ語を狙うページが2つあると、検索での勝率は2倍にならない。**信号が割れて、Googierがどちらか一方を選ぶ。**

うちのサイトでは、Google が選んでいたのは悪い方だった。

```
/c/naruto/glossary/dattebayo/     37語のスタブ
/c/naruto/pitfalls/dattebayo/   2003語の完成記事
```

スラッグが同じで、セクションだけ違う。**37語の空箱が、2000語の記事の邪魔をしていた。**

手で探すのは無理なので、検出を書いた。

## 3つのクラス

共食いと一口に言っても、白黒のつき方が違う。分けて扱わないと、判断できるものと判断できないものが混ざって使い物にならない。

### クラスA：同じキャラ・同じスラッグ・違うセクション

```
naruto/dattebayo
   pitfalls  2003語
   glossary    37語
```

**議論の余地なく欠陥。** 1つの語に2つのURLがある。

3件見つかった。全部「短い方がglossaryやidioms、長い方がpitfalls」というパターンだった。用語集を先に薄く作り、後から本格的な記事を書いた結果、**用語集側が残っていた**。

### クラスB：同じキャラ・同じ日本語原文・違うスラッグ

こちらは事故ではなく**構造**だった。

| 日本語原文 | 主 | 重複 |
|---|---|---|
| おれは助けてもらわねェと生きていけねェ自信がある！！ | `gems/confidence-in-needing-help` 3443語 | `wisdom/cant-live-without-help` 1006語 |
| 仲間だろうが！！！ | `pitfalls/nakama-five-ways` 3234語 | `wisdom/nakama-darou-ga` 809語 |
| 海賊王に おれはなる！！ | `pitfalls/kaizoku-ou-ni-ore-wa-naru` 3052語 | `wisdom/king-of-the-pirates-vow` 1098語 |

6組あり、**全部が同じ形**をしていた。`wisdom` コレクションと `gems`/`pitfalls` コレクションが、同じ引用セットから作られていたためだ。

つまり**キャラを1人追加するたびに再生産される**。個別に6件直しても意味がない。方針を決める必要があった。

決めたのはこれ。

> **ONE LINE, ONE ARTICLE.**
> `wisdom` は、既に長文記事がある台詞を扱わない。

### クラスC：違うキャラ・同じスラッグ

```
glossary/hashira:       キャラA(310語), キャラB(29語)
idioms/meikyo-shisui:   キャラA(142語), キャラB(24語)
```

これは**たいてい正常**。2人のキャラが同じ四字熟語を使うことはある。要件は「互いのコピーになっていないこと」で、各キャラの文脈からその語を読む形になっていればいい。

自動判定はできないので、報告だけして人が見る。

## 検出コード

コンテンツはJSONで、複数リポジトリに分かれている。同じバケット・同じURL空間に出るので、**リポジトリを跨いだ衝突も本物の衝突**だ。両方を走査する。

```js
const classA = [...group(e => `${e.character} ${e.slug}`).values()]
  .filter(v => new Set(v.map(e => e.section)).size > 1);

const classB = [...group(e => (e.jp ? `${e.character} ${e.jp}` : null)).values()]
  .map(v => v.filter(e => !e.retired))     // 退役済みは競合しない
  .filter(v => new Set(v.map(e => e.slug)).size > 1);

const classC = [...group(e => `${e.section} ${e.slug}`).values()]
  .filter(v => new Set(v.map(e => e.character)).size > 1);
```

語数は**散文だけ**を数える。出典リストやメタデータで嵩増しできないように。

```js
const NON_PROSE = new Set([
  'slug', 'characterSlug', 'sources', 'references',
  'seoTitle', 'supersededBy', 'mangaPanelJp', 'mangaPanelEn',
]);
```

## 書く前に聞けるようにする

検出だけだと、**衝突が起きてから気づく**。書き始める前に確認できる形も足した。

```
$ node scripts/check/keyword-overlap.mjs --term dattebayo

Pre-flight: "dattebayo"
  2 existing entr(ies) already touch this term:

    2003w  /c/naruto/pitfalls/dattebayo/
           642 Balloons, Zero Translations: The Dattebayo Problem
      37w  /c/naruto/glossary/dattebayo/

  Decide before writing: EXTEND the longest one, or pick a genuinely
  different angle and link it to that page as the primary.
  Do NOT create a second page on the same term.
```

スラッグ・日本語原文・タイトルを横断検索する。判断は3択に絞れる。

- **実質的な記事がある** → 拡張する。新ファイルを作らない
- **スタブだけある** → そのスタブを埋める。良い版を別の場所に書いてスタブを残さない
- **何も無い** → 書いてよい

「良い版を別の場所に書いてスタブを残す」が**いちばんやりがちで、いちばん悪い**。まさにクラスAがそれだった。

## 退役の設計

重複を見つけたあと、短い方をどうするか。**削除は選ばなかった。**

理由は2つある。1つは、その本文にも書く価値のある内容が含まれていて、後で主記事に統合できること。もう1つは、URLが既に存在していて内部リンクも張られていること。

3ステップにした。

```json
{
  "noindex": true,
  "supersededBy": "/c/luffy/gems/confidence-in-needing-help/"
}
```

1. **コンテンツJSON**: `noindex` + `supersededBy`。本文はリポジトリに残る
2. **CDN**: 該当URLを主記事へ301
3. **リンク元の張り替え**

3が地味に面倒で、記事本文のマークダウンから相互リンクが張られている。ここは**レンダリング時に自動で書き換える**ようにした。

```js
// 退役マップをコンテンツ自身から導出して、href を書き換える
export async function rewriteRetiredLinks(html) {
  const map = await getRetiredLinks();
  let out = html;
  for (const [from, to] of map) {
    out = out.split(`href="${from}"`).join(`href="${to}"`);
  }
  return out;
}
```

**書き手が「どれが退役したか」を知る必要が無い。** 手動キュレーションされたデータ（トップページのカルーセルなど）だけは個別に直す。

### 「退役したのに301が無い」を検出する

3ステップのうち2を忘れると、**URLが404になる**。リダイレクトのつもりが消滅になる。

なので相互チェックを入れた。

```js
for (const e of retired) {
  const from = url(e).replace(/\/$/, '');
  if (!cfSource.includes(`'${from}'`)) missingRedirect.push(e);
}
```

コンテンツ側の `supersededBy` と、CDN設定側のリダイレクトマップを突き合わせる。**別のリポジトリにある2つのファイルの整合性**なので、片方だけ見ていても気づけない。

```
── retired (noindex + supersededBy)  (10) ──
   301 ok  /c/luffy/wisdom/cant-live-without-help/  ->  /c/luffy/gems/confidence-in-needing-help/
   301 ok  /c/naruto/glossary/dattebayo/            ->  /c/naruto/pitfalls/dattebayo/
   ...
```

## ゲートにする

一通り片付いたら、`--strict` を公開手順に入れる。

```
$ node scripts/check/keyword-overlap.mjs --strict
FAIL: 3 class-A collision(s), 1 retired page(s) with no 301.
```

クラスA、クラスB、301欠落で落ちる。**新しい重複は本番に到達できない。**

ただし**既存の衝突を片付けるまでは入れられない**。最初から strict にすると、既知の問題で毎回落ちて、そのうち `--no-verify` が常態化する。「片付けてからゲートにする」の順序が要る。

## まとめ

- 共食いは**種類ごとに白黒のつき方が違う**。同じ扱いにすると判断不能になる
- **同じスラッグ・別セクション**は無条件で欠陥。だいたい「用語集を先に薄く作った」跡
- **同じ原文・別スラッグ**が大量にあるなら、それは事故ではなく**設計の問題**。個別に直しても再生産される
- 検出だけでなく、**書く前に聞ける形**を用意する。「良い版を別の場所に書いてスタブを残す」が最悪パターン
- 退役は削除ではなく `noindex` + リダイレクト。**本文は残す**
- コンテンツ側とCDN側の**整合性を機械的に確認する**。片方だけ見ても気づけない
- ゲートは**既存の問題を片付けてから**入れる

最初に見つけた3件は、どれも2000語級の完成記事を数十語のスタブが押さえつけていた。**潰せば純粋にプラス**という、珍しくコストのかからない改善だった。
