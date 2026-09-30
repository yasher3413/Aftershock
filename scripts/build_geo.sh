#!/usr/bin/env bash
# Build web/public/geo/north-america.topo.json from Natural Earth 1:50m
# (public domain): country outlines for Canada, the US, and Mexico, plus
# state and province lines for the US and Canada. Needs mapshaper and curl.
set -euo pipefail
cd "$(dirname "$0")/.."
WORK=data/geo
OUT=web/public/geo/north-america.topo.json
BASE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
mkdir -p "$WORK" "$(dirname "$OUT")"
[ -f "$WORK/countries.geojson" ] || curl -fsSL "$BASE/ne_50m_admin_0_countries.geojson" -o "$WORK/countries.geojson"
[ -f "$WORK/states.geojson" ] || curl -fsSL "$BASE/ne_50m_admin_1_states_provinces.geojson" -o "$WORK/states.geojson"
[ -f "$WORK/lakes.geojson" ] || curl -fsSL "$BASE/ne_50m_lakes.geojson" -o "$WORK/lakes.geojson"

# Bounding box: Pacific coast to Newfoundland, Mexico to 62N.
BBOX=-170,14,-50,72

mapshaper -i "$WORK/countries.geojson" \
  -filter '["CAN","USA","MEX"].indexOf(ADM0_A3) > -1' \
  -clip bbox=$BBOX \
  -filter-fields ADM0_A3 -rename-fields code=ADM0_A3 \
  -simplify 30% keep-shapes \
  -rename-layers land \
  -o "$WORK/land.json" format=geojson

mapshaper -i "$WORK/states.geojson" \
  -filter '["CAN","USA"].indexOf(adm0_a3) > -1' \
  -clip bbox=$BBOX \
  -filter-fields adm0_a3,postal -rename-fields country=adm0_a3 \
  -simplify 20% keep-shapes \
  -innerlines \
  -rename-layers borders \
  -o "$WORK/borders.json" format=geojson

mapshaper -i "$WORK/lakes.geojson" \
  -filter 'this.area > 3e9' \
  -clip bbox=-125,40,-70,60 \
  -filter-fields name \
  -simplify 15% keep-shapes \
  -rename-layers lakes \
  -o "$WORK/lakes-na.json" format=geojson

mapshaper -i "$WORK/land.json" "$WORK/borders.json" "$WORK/lakes-na.json" combine-files \
  -o "$OUT" format=topojson quantization=1e5
ls -l "$OUT"
