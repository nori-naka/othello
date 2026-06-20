# plateau-pmtiles

PLATEAU の CityGML データを PMTiles（単一ファイルのベクトルタイル）に変換し、
MapLibre GL JS で表示するためのツール一式。詳しい手順の解説は
[`docs/PLATEAU_PMTILES.md`](../docs/PLATEAU_PMTILES.md) を参照。

## 必要なツール（事前インストール）

- [nusamai](https://github.com/MIERUNE/plateau-gis-converter)（CityGML → GeoJSON。リポジトリ名は `plateau-gis-converter`、実行バイナリ名は `nusamai`）
- [tippecanoe](https://github.com/felt/tippecanoe)（GeoJSON → MBTiles）
- [pmtiles CLI (go-pmtiles)](https://docs.protomaps.com/pmtiles/cli)（MBTiles → PMTiles）
- Node.js 18 以上

いずれも PATH 上で実行できる状態にしておくこと。

## 使い方

```bash
node convert-plateau-to-pmtiles.mjs \
  --input ./13100_tokyo23-ku_2023_citygml_1_op \
  --package bldg \
  --out ./output/bldg.pmtiles \
  --minzoom 10 \
  --maxzoom 16
```

`--input` には、PLATEAU からダウンロードした zip を展開した際にできる、
`udx/` ディレクトリを含むデータセットのルートを指定する。

オプション一覧は `--help` で確認できる。

```bash
node convert-plateau-to-pmtiles.mjs --help
```

## 生成した PMTiles を表示する

`viewer/index.html` をブラウザで直接開く（またはローカルサーバーで配信する）と、
MapLibre GL JS + pmtiles プロトコルで表示を確認できる。
ファイル内の `PMTILES_URL` を生成した `.pmtiles` ファイルのパス／URLに書き換えること。

ローカルファイルを Range リクエストで読むため、`file://` で直接開くとブラウザによっては
動作しない場合がある。その場合は次のように簡易サーバーを立てる。

```bash
npx serve .
# あるいは
python3 -m http.server 8080
```
