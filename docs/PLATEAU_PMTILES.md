# PLATEAU データを PMTiles 化して MapLibre に表示する手順

国交省 [Project PLATEAU](https://www.mlit.go.jp/plateau/) が公開する 3D 都市モデル（CityGML）を、
配信しやすい単一ファイル形式の [PMTiles](https://github.com/protomaps/PMTiles) に変換し、
[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) でベクトルタイルとして表示するまでの手順。

## 全体の流れ

```
CityGML (.gml)            ① CityGML → GeoJSON
  │  PLATEAU GIS Converter
  ▼
GeoJSON (.geojson)        ② GeoJSON → MBTiles（ベクトルタイル化）
  │  tippecanoe
  ▼
MBTiles (.mbtiles)        ③ MBTiles → PMTiles（単一ファイル化）
  │  pmtiles CLI (go-pmtiles)
  ▼
PMTiles (.pmtiles)        ④ MapLibre GL JS で表示
```

ポイントは、ベクトルタイル生成（属性付きポリゴン化・ズームレベル分割）は実績のある
`tippecanoe` に任せ、PMTiles への単一ファイル化は公式 Go 製 CLI `pmtiles` に任せること。
この2つは Node.js のライブラリではなくネイティブバイナリなので、付属の Node.js スクリプトは
これらを呼び出す「オーケストレーター」として動作する。

## 0. 事前準備（ツールのインストール）

| ツール | 役割 | インストール例 |
|---|---|---|
| [nusamai](https://github.com/MIERUNE/plateau-gis-converter)（リポジトリ名は `plateau-gis-converter`、実行バイナリ名は `nusamai`） | CityGML → GeoJSON 変換 | GitHub Releases からバイナリ取得し `/usr/local/bin` に配置 |
| [tippecanoe](https://github.com/felt/tippecanoe) | GeoJSON → MBTiles（ベクトルタイル生成） | macOS: `brew install tippecanoe` / Linux: ソースビルド |
| [pmtiles CLI (go-pmtiles)](https://docs.protomaps.com/pmtiles/cli) | MBTiles → PMTiles | `go install github.com/protomaps/go-pmtiles@latest` または GitHub Releases |
| Node.js 18+ | 変換オーケストレーションスクリプトの実行 | 既存環境でOK |

それぞれ `--version` 等でPATHに通っていることを確認しておく。

## 1. PLATEAU データの取得

[G空間情報センター](https://www.geospatial.jp/ckan/dataset?tags=PLATEAU) または
[PLATEAU VIEW](https://www.mlit.go.jp/plateau/) のダウンロードサイトから、対象都市の
3D都市モデル（CityGML）データセットを取得し、zip を展開する。

展開すると次のようなフォルダ構成になる（建物モデルの例）。

```
<都市名>_city_<コード>_<年度>_citygml_1_op/
└── udx/
    ├── bldg/   ← 建築物モデル（最も一般的に使う）
    ├── tran/   ← 道路
    ├── urf/    ← 都市計画決定情報
    └── ...
└── *.gml      ← 個々のメッシュ単位のCityGMLファイル
```

PMTiles 化の対象として最もよく使われるのは建築物モデル（`udx/bldg/*.gml`）。

## 2. CityGML → GeoJSON 変換

```bash
nusamai <input_dir>/udx/bldg/*.gml --sink geojson --output bldg.geojson
```

CityGML には高さ・階数・用途・建築年などの属性（LOD0〜LOD2 ジオメトリ含む）が入っているため、
建物の3D形状そのものを使わず2Dポリゴン＋属性として地図表示したい場合は GeoJSON 出力で十分。
（3D表示が必要な場合は `--sink 3dtiles` で 3D Tiles を生成し、CesiumJS 等で表示する別経路になる）

ファイル数が多い大規模データセットでは、一度に渡すファイル数が OS の引数長上限に達することがある。
後述の Node.js スクリプトはこれを自動でチャンク分割して複数回 CLI を呼び出す。

## 3. GeoJSON → MBTiles（ベクトルタイル生成）

```bash
tippecanoe -o bldg.mbtiles -l bldg -Z10 -z16 --force bldg.geojson
```

- `-l bldg` : ベクトルタイルのレイヤー名（MapLibre のスタイルで参照する）
- `-Z` / `-z` : 最小 / 最大ズームレベル
- 建物のような大量フィーチャでは `--drop-densest-as-needed` 等の簡略化オプションも検討する

## 4. MBTiles → PMTiles（単一ファイル化）

```bash
pmtiles convert bldg.mbtiles bldg.pmtiles
```

これで `bldg.pmtiles` 1ファイルに、全ズームレベルのベクトルタイルが収まる。
PMTiles は HTTP Range リクエストでタイルを直接読めるため、静的ファイルサーバー
（S3 / Cloudflare R2 / GitHub Pages 等）に置くだけで配信できる（タイルサーバー不要）。

## 4.5. （代替手順）すでに MVT 配信形式で入手できる場合

G空間情報センターの都市によっては、CityGML を変換せずに、あらかじめベクトルタイル化された
**MVT**（`{z}/{x}/{y}.mvt` または `.pbf` のタイルピラミッド形式のディレクトリ）が
ダウンロードできる場合がある。その場合は手順1〜3（CityGML → GeoJSON → MBTiles）は不要で、
ディレクトリをそのまま PMTiles 化できる。

```bash
pip install pmtiles
pmtiles-convert bldg.pmtiles ./mvt_tiles_dir/
```

- `pmtiles-convert` は Python 版 `pmtiles` パッケージに含まれる CLI で、
  `{z}/{x}/{y}` のタイルディレクトリを直接読み取って PMTiles に変換できる
- 一方、Go 製 CLI（`pmtiles convert`）は MBTiles（SQLite）専用で、タイルディレクトリは読めない
- `nusamai` や `tippecanoe` も不要なため、CityGML から変換するより大幅に手順が少なくなる

CityGML 由来の経路と MVT 由来の経路は出力されるレイヤー名・属性スキーマが異なる場合があるため、
手順5（MapLibre 表示）の `source-layer` 名は、実際に使うデータに合わせて確認・調整すること
（`pmtiles show bldg.pmtiles` や [PMTiles Viewer](https://pmtiles.io/) でレイヤー名を確認できる）。

## 5. MapLibre GL JS での表示

ブラウザ側では `pmtiles` npm パッケージのプロトコルハンドラを MapLibre に登録し、
スタイルの `source` に `pmtiles://` URL を指定するだけでよい。

```js
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      bldg: {
        type: 'vector',
        url: 'pmtiles://https://example.com/bldg.pmtiles',
      },
    },
    layers: [
      {
        id: 'bldg-fill',
        type: 'fill',
        source: 'bldg',
        'source-layer': 'bldg',
        paint: { 'fill-color': '#d9743a', 'fill-opacity': 0.7 },
      },
    ],
  },
  center: [139.767, 35.681],
  zoom: 14,
});
```

具体的な動作例は `plateau-pmtiles/viewer/index.html` を参照（CDN 経由で依存解決済み、
ローカルファイルをそのままブラウザで開くだけで確認できる）。

## 6. Node.js での自動化

上記 ②③（GeoJSON → MBTiles → PMTiles）および ①（CityGML → GeoJSON）の全工程を
1コマンドで実行するスクリプトを `plateau-pmtiles/convert-plateau-to-pmtiles.mjs` に用意した。
使い方は `plateau-pmtiles/README.md` を参照。

```bash
node plateau-pmtiles/convert-plateau-to-pmtiles.mjs \
  --input ./13100_tokyo23-ku_2023_citygml_1_op \
  --package bldg \
  --out ./bldg.pmtiles \
  --layer bldg \
  --minzoom 10 \
  --maxzoom 16
```

## 参考リンク

- [Project PLATEAU](https://www.mlit.go.jp/plateau/)
- [nusamai / plateau-gis-converter (MIERUNE)](https://github.com/MIERUNE/plateau-gis-converter)
- [tippecanoe](https://github.com/felt/tippecanoe)
- [PMTiles](https://docs.protomaps.com/pmtiles/)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
