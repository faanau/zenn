---
title: "Search Console の画面では「どのURLが未登録か」が分からない — URL Inspection API で全数調査する"
emoji: "🔎"
type: "tech"
topics: ["seo", "searchconsole", "googleapi", "python"]
published: false
---

Search Console のインデックス作成レポートは、こういう形で結果を出す。

```
未登録 78    理由 5
  クロール済み - インデックス未登録   35
  検出 - インデックス未登録           35
  アクセス禁止（403）                  5
  見つかりませんでした（404）           3
  ページにリダイレクトがあります        3
```

件数は分かる。**どのURLがどれに該当するのかは、この画面からは追えない。** 理由ごとに詳細を開けば一部は見られるが、サンプルであって全量ではないし、サイト全体を横断して「今どのURLがどの状態か」を一覧にすることはできない。

サイトが伸びない原因を切り分けたいとき、必要なのはまさにその一覧だ。

## URL Inspection API を使う

`urlInspection.index.inspect` は、URL 1本ごとに Google の内部状態を返す。

```
POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
{
  "inspectionUrl": "https://example.com/page/",
  "siteUrl": "sc-domain:example.com",
  "languageCode": "ja"
}
```

返ってくる `indexStatusResult` の主なフィールド。

| フィールド | 意味 |
|---|---|
| `verdict` | `PASS` / `NEUTRAL` / `FAIL` |
| `coverageState` | 人間可読の状態文字列。ここがいちばん重要 |
| `lastCrawlTime` | 最終クロール日時。**無ければ一度もクロールされていない** |
| `pageFetchState` | 取得結果 |
| `robotsTxtState` | robots による許可状態 |
| `googleCanonical` | Google が選んだ正規URL |
| `userCanonical` | こちらが宣言した正規URL |

`coverageState` に出る代表的な値。

- `Submitted and indexed`
- `Crawled - currently not indexed`
- `Discovered - currently not indexed`
- **`URL is unknown to Google`**

最後のものが曲者で、**画面のレポートにはこの区分が存在しない**。sitemap に載せて送信済みでも、Google がまだそのURLを認識していない状態がある。レポート上は単に集計対象外なので、「78件が未登録」という数字を見ても、その裏に「そもそも知られていないURLが133本ある」ことは見えない。

## 実際にやってみた結果

自分たちのサイト（当時 live 151URL）を全数調査した。

```
URL is unknown to Google        133
Crawled - currently not indexed  17
Submitted and indexed             1
```

**クロールされたことがあるURLが 151 中 18 本しかなかった。**

ホスト別に見ると、もっとはっきりした。

| ホスト | Google が知らないURL |
|---|---|
| A | 37 / 37（全部） |
| B | 35 / 35（全部） |
| C | 35 / 35（全部） |
| D | 23 / 38 |

4サイトのうち3つは、**1ページもクロールされたことがなかった**。sitemap は送信済みで、Google は7/27にそれを取得していた。URLは渡っているのに、クロールに来ていない。

画面のレポートを見ている限り、「クロール済み-未登録が35件ある。中身を厚くしよう」という結論になる。実際には**厚さ以前に、大半のURLは読まれてすらいなかった**。打つべき手がまるで違う。

## スクリプト

認証は ADC（Application Default Credentials）で済ませるのが早い。

```bash
gcloud auth application-default login \
  --scopes=openid,\
https://www.googleapis.com/auth/userinfo.email,\
https://www.googleapis.com/auth/cloud-platform,\
https://www.googleapis.com/auth/webmasters.readonly
```

`webmasters.readonly` を忘れると、後で 403 `insufficient authentication scopes` になる。読み取りだけならこれで足りる。sitemap の送信・削除まで API でやるなら `.readonly` を外す。

```python
import json, subprocess, urllib.request, concurrent.futures, collections, re

TOKEN = subprocess.run(
    ['gcloud', 'auth', 'application-default', 'print-access-token'],
    capture_output=True, text=True).stdout.strip()

SITE = 'sc-domain:example.com'
ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'


def inspect(url):
    body = {'inspectionUrl': url, 'siteUrl': SITE, 'languageCode': 'ja'}
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={
            'Authorization': 'Bearer ' + TOKEN,
            'x-goog-user-project': 'your-gcp-project',
            'Content-Type': 'application/json',
        })
    try:
        d = json.load(urllib.request.urlopen(req, timeout=60))
        i = d.get('inspectionResult', {}).get('indexStatusResult', {})
        return {
            'url': url,
            'coverage': i.get('coverageState'),
            'lastCrawl': (i.get('lastCrawlTime') or '')[:10],
            'googleCanonical': i.get('googleCanonical', ''),
        }
    except Exception as e:
        return {'url': url, 'error': str(e)}


# sitemap から対象URLを集める
def urls_from_sitemap(index_url):
    out = []
    idx = urllib.request.urlopen(index_url, timeout=30).read().decode()
    for sm in re.findall(r'<loc>(.*?)</loc>', idx):
        xml = urllib.request.urlopen(sm, timeout=30).read().decode()
        out += re.findall(r'<loc>(.*?)</loc>', xml)
    return out


urls = urls_from_sitemap('https://example.com/sitemap.xml')

with concurrent.futures.ThreadPoolExecutor(6) as ex:
    results = list(ex.map(inspect, urls))

counts = collections.Counter(r.get('coverage') for r in results)
for state, n in counts.most_common():
    print(f'{n:5}  {state}')

print('\ncrawled at least once:',
      sum(1 for r in results if r.get('lastCrawl')), '/', len(results))
```

### 実務上の注意

- **クォータは 1日2000件 / 1分600件**（プロパティ単位）。数千URLあるサイトは分割するか、代表サンプルで回す
- **並列度は6程度**に抑えた方がいい。上げすぎると 429 が返る。実測では 151URL で2分ほどかかった
- `x-goog-user-project` に GCP プロジェクトIDが要る。ADC で認証する場合はほぼ必須
- **ドメインプロパティ（`sc-domain:`）を使うとサブドメイン横断で調べられる**。URLプレフィックスのプロパティだと、ホストごとに分かれてしまう

## 何が分かるか

この3つの数字を定点観測するのが、いちばん実用的だと思う。

```
unknown-to-Google / crawled-not-indexed / indexed
```

それぞれ意味が違う。

- **unknown が多い** → 発見されていない。リンクとクロールバジェットの問題。中身を書いても解決しない
- **crawled-not-indexed が多い** → 読まれた上で価値判断されている。中身か重複の問題
- **indexed が増えている** → 効いている

表示回数やクリック数は、この3つが動いてからでないと意味を持たない。**インデックスされていないページは、どれだけ良くても0回表示される。**

## sitemap API も同時に使える

同じ認証で `webmasters/v3` の sitemap API が叩ける。送信状態の確認と、古いエントリの削除ができる。

```python
# 登録済み sitemap の一覧
GET https://searchconsole.googleapis.com/webmasters/v3/sites/{SITE}/sitemaps

# 送信（書き込みスコープが要る）
PUT .../sitemaps/{urlencoded-feedpath}

# 削除
DELETE .../sitemaps/{urlencoded-feedpath}
```

サイト構成を変えたあと、**古い sitemap のエントリが残り続ける**ことがよくある。画面から1つずつ消すより API の方が早いし、消し忘れも起きない。

なお `contents[].indexed` というフィールドが返るが、**これは長らく 0 固定**で、実際のインデックス数ではない。ここを信用しないこと。

---

この調査は [jpn.fan](https://jpn.fan) の改善作業で行ったもの。「なぜインデックスされないのか」を画面から推測していた段階では手が止まっていて、API で全数を出して初めて、打つべき手が変わった。
