---
title: "週35万DLのnpmパッケージが8年放置されていた理由は、Issueではなくテストだった"
emoji: "🈁"
type: "tech"
topics: ["npm", "oss", "javascript", "自然言語処理", "日本語"]
published: false
---

`kuromoji` は日本語形態素解析器の JavaScript 実装で、週に約 336,000 回ダウンロードされている。最後にリリースされたのは **2018年3月19日**だ。

Open Issue は15件。Firefox で動かない、外部URLから辞書を読めない、React Native で使えない。放置されたパッケージの典型に見える。

先日これをフォークして保守を引き受けた。作業してみて分かったのは、**このプロジェクトが止まった理由は Issue の数ではなかった**ということだ。

## テストが走らない

最初にやったのは `npm test` だった。

```
$ npm test
> gulp test

/node_modules/natives/index.js:14
    return runInThisContext(...)
...
```

クラッシュする。テストが1件も実行されないまま落ちる。

原因は `gulp@^3` だ。gulp 3 は内部で `graceful-fs` 経由で `natives` パッケージを使っていて、これが Node 12 以降で動かない。2018年当時は問題なかったが、その後の Node ではビルドツール自体が起動しなくなった。

つまり **2019年以降、このリポジトリでは誰もテストを実行できていない**。

これが何を意味するか。新しく来た人は、目の前の失敗が「自分の環境の問題」なのか「本当のバグ」なのか「元から壊れている」のかを**切り分けられない**。修正を書いても、それが何かを壊していないことを確認できない。レビューする側も同じだ。

Issue が15件あるから止まったのではなく、**検証手段が失われたから、Issue を減らせなくなった**。順序が逆だった。

試しに gulp を迂回して mocha を直接叩いてみた。

```
$ npx mocha --recursive test/
  52 passing (1s)
```

**52件、全部通る。** 解析器そのものは Node 23 でも健在だった。腐っていたのは周辺だけだ。

だから最初にやるべきことは、Issue を潰すことではなく、**テストを走る状態に戻すこと**だった。gulp を捨て、mocha を直接呼び、esbuild でバンドルし、GitHub Actions を追加した。上流には CI が一度も存在しなかった。

## 3つの Issue が同じ原因だった

テストが走るようになってから Issue を見直すと、景色が変わった。

- \#37 「外部URLから辞書を読み込めない」
- \#39 「Chrome拡張のデータフォルダURLを受け付けない」
- \#43 「ローカルでは動くのにWebサーバー上で動かない」

別々に報告された3件だが、原因は1行だった。

```js
var path = require("path");
loadArrayBuffer(path.join(dic_path, filename), ...)
```

Node の `path.join` は POSIX パスの正規化をする。URL に使うとこうなる。

```js
path.join("https://cdn.example.com/dict", "base.dat.gz")
// => "https:/cdn.example.com/dict/base.dat.gz"
```

**`//` が `/` に潰れる。** 絶対URLを渡した全員が 404 を踏む。ローカルの相対パスでは正常に動くので、「自分の環境だけおかしいのでは」という報告になり、3人が別々の症状として起票していた。

しかも `path` は Node の組み込みモジュールなので、ブラウザ向けにバンドルするときに shim が必要になる。バンドルサイズにも効いていた。

修正は素朴な結合に置き換えるだけだ。URLでも POSIX パスでも正しく、Node の `fs` は Windows でもスラッシュを受け付ける。

```js
function joinPath(base, filename) {
    if (!base) return filename;
    return base.replace(/[\/\\]+$/, "") + "/" + filename;
}
```

3件の Issue が閉じ、ブラウザバンドルから Node 組み込みが1つ消えた。

## Firefox だけ落ちる

\#47「Firefox で ArrayBuffer の読み込みエラーになる」。

辞書は gzip 圧縮されていて、展開後のバッファを型付き配列で読む。

```js
var cc_buffer = new Int16Array(buffer);
```

`Int16Array` は要素サイズが2バイトなので、**バッファの byteLength が奇数だと `RangeError` を投げる**。展開後にパディングが付くかどうかは gunzip の実装依存で、Chrome では通り Firefox では落ちる。同じ `.gz` ファイルなのにブラウザによって結果が違う理由がこれだった。

面白いのは、**この修正のPRは5年前から出ていた**ことだ（\#48）。マージされないまま残っていた。

ただしその PR は `Uint32Array` の1箇所しか守っていない。同じ危険は `Int16Array`（接続コスト）と `Int32Array`（trie）にもある。3つとも同じガードを通すようにした。

```js
function alignedTypedArray(TypedArray, buffer) {
    var alignment = TypedArray.BYTES_PER_ELEMENT;
    var remainder = buffer.byteLength % alignment;
    if (remainder === 0) return new TypedArray(buffer);
    return new TypedArray(buffer.slice(0, buffer.byteLength - remainder));
}
```

端数のバイトにデータは入っていない（辞書ビルダーは要素単位で書く）ので、切り捨てて損失はない。

## 依存を2つ外したら 308KB が 69KB になった

`package.json` の依存は3つだった。

```json
"dependencies": {
  "async": "^2.0.1",
  "doublearray": "0.0.2",
  "zlibjs": "^0.3.1"
}
```

`async` は辞書ファイルの並列読み込みに使われていた。`Promise.all` で置き換えられる。Node 4 以降なら標準にある。

`zlibjs` はブラウザでの gunzip 用。最後の公開は2016年で、minify 済みの展開器が全利用者のバンドルに入っていた。今は `DecompressionStream` がプラットフォーム側にある。

```js
const res = await fetch(url);
const buf = await new Response(
  res.body.pipeThrough(new DecompressionStream("gzip"))
).arrayBuffer();
```

ブラウザバンドルは **308KB から 69KB** になった。77%減で、大半は zlibjs だった。

ここで1つ判断がある。上流には「zlibjs を外すために辞書を非圧縮で配る」という PR（\#33）も出ていた。それは採らなかった。**自前の CDN で `.gz` を配信している利用者が全員壊れる**し、転送量も約3倍になる。`DecompressionStream` なら形式を触らずに依存だけ消せる。

放置プロジェクトを引き取るときは、**壊す変更と壊さない変更を分ける**のが一番大事だと思う。既存利用者が10万人いるかもしれないという前提で触る。

## 再現しない Issue も記録した

`kuroshiro`（この解析器を使うふりがな/ローマ字ライブラリ）側に、こういう Issue があった。

> \#53 座って → "suwatsute" になる。"suwatte" が正しいのでは

解析器の問題として報告されていたが、確かめると `座っ[スワッ]` + `て[テ]` と正しく返る。解析器のバグではない。

さらに調べると、報告されたコード（`mode: "normal"`）では**再現しなかった**。壊れているのは `furigana` モードの方だった。こちらはルビ出力用で、各セグメントを独立してローマ字化する。促音が単独になると重ねる相手の子音が無く、変換表にも無いので、リテラルの `tsu` に落ちる。

```
座って   →  座[suwa] っ[tsu] て[te]     ← 壊れている
真っ赤   →  真[ma]   っ[tsu] 赤[ka]
カッター  →  カ[ka]   ッ[tsu] タ[ta]
```

促音を後続セグメントに併合してやれば、既存の重ね処理がそのまま効く。

```
座って   →  座[suwa] って[tte]
真っ赤   →  真[ma]   っ赤[kka]
```

**報告された症状と実際の不具合が違う**というのは、放置リポジトリではよく起きる。報告者は正しく困っていて、原因の特定だけが間違っている。再現しない Issue も「再現しなかった」と結果を書いて残した方がいい。次に同じ調査をする人の時間を返せる。

## 引き取るときにやったこと、やらなかったこと

やったこと。

- ツールチェーンを動く状態に戻す（最優先）
- CI を追加する（上流には無かった）
- 再現するバグを、回帰テストとともに直す
- 8年前の依存を外す（ただし互換を壊さない方法で）
- ESM と型定義を足す
- **上流に PR を出す**

やらなかったこと。

- パッケージ名を乗っ取る。別スコープで公開した
- 辞書フォーマットを変える
- 内部実装を書き直す。Viterbi や辞書まわりのコードは触っていない。フォークの最初の仕事は**信用されること**で、大きく書き換えるのはその逆になる

上流には最小差分の PR を出した。ツールチェーンの刷新は混ぜず、バグ修正だけに絞ってある。メンテナが戻ってこない可能性は高いが、Issue を検索で見つけた人が「修正はもう存在する」と分かる状態にはなる。

## 教訓

**Issue の数は、プロジェクトの状態を測る指標としてあまり当てにならない。**

Issue が15件あることより、`npm test` が動かないことの方が重症だった。前者は作業量だが、後者は**作業できるかどうか**の問題だからだ。

放置リポジトリを引き取るか判断するなら、まずこれを見るといい。

1. テストは走るか。走らないなら、その原因はコードか、ツールチェーンか
2. Issue のうち、実際に再現するのは何件か
3. 既にマージされていない修正PRが転がっていないか

今回は3つとも当たりだった。テストは通る（52件）、Issue の一部は再現せず、修正PRは5年放置されていた。**壊れていたのは、直せる状態そのものだった。**

---

作ったものはこちら。

- [@faanau/kuromoji](https://www.npmjs.com/package/@faanau/kuromoji) — npm
- [faanau/kuromoji-js](https://github.com/faanau/kuromoji-js) — GitHub

自分たちで使っているから保守している。[jpn.fan](https://jpn.fan) という、漫画の日本語を英語圏の学習者向けに読み解くサイトで、155本の記事に付いているふりがなの検証にこの解析器を使っている。壊れたら最初に困るのは自分たちだ、という状態にしてある。
