"""Build the building-height tiles in public/buildings/ from open data.

Sources, in the order a footprint takes its height:
  1. OpenStreetMap `height`, through the Overture Maps buildings theme (kind 1, measured).
  2. NUS Urban Analytics Lab hdb3d-data model height, joined by OSM way id (kind 2, from storeys).
  3. OpenStreetMap `building:levels` (Overture `num_floors`) x 3.5 m (kind 2, from storeys).
  4. A default by building class: 2 storeys for houses, 4 for everything else (kind 3, estimated).
Open structures (roofs, shelters, carports) without a height are left out.

Tiles are 256 px PNGs at zooms 13-15. Each pixel stores the height above ground in decimetres
in red (high byte) and green (low byte), and the kind in blue; 0 everywhere means no building.
Zoom 15 is the source; 13 and 14 keep the tallest of each 2x2 block.

Needs: pip install pyarrow shapely pillow numpy. Usage, from the repo root:
    python3 scripts/buildings/build_buildings.py [--release 2026-10-21.0] [--hdb3d path/to/hdb.json] [--overture cached.parquet]
The Overture release is read from the public S3 bucket unless --overture names a cached copy.
hdb.json: https://raw.githubusercontent.com/ualsg/hdb3d-data/master/hdb.json (about 91 MB).
"""
import argparse
import collections
import io
import json
import math
import os
import shutil

import numpy as np
import shapely
from PIL import Image, ImageDraw

BOUNDS = (103.596, 1.2, 104.10, 1.4835)  # west, south, east, north: Singapore within the DEM bounds
ZOOM = 15
LOWER_ZOOMS = (14, 13)
TILE = 256
OUT = "public/buildings"
STOREY_M = 3.5
LOW_RISE = {"house", "terrace", "semidetached_house", "detached", "bungalow", "hut", "shed", "garage", "garages", "cabin", "farm_auxiliary", "static_caravan"}
OPEN = {"roof", "shelter", "carport", "canopy", "bridge", "ruins", "construction"}
DEFAULT_LOW_M, DEFAULT_OTHER_M = 2 * STOREY_M, 4 * STOREY_M
MAX_DM = 65535

p = argparse.ArgumentParser()
p.add_argument("--release", default="2026-10-21.0")
p.add_argument("--hdb3d")
p.add_argument("--overture")
args = p.parse_args()


def read_overture():
    import pyarrow.parquet as pq
    cols = ["geometry", "bbox", "height", "num_floors", "sources", "class"]
    if args.overture:
        return pq.read_table(args.overture, columns=cols).to_pylist()
    import pyarrow.compute as pc
    import pyarrow.dataset as ds
    import pyarrow.fs as fs
    s3 = fs.S3FileSystem(anonymous=True, region="us-west-2")
    data = ds.dataset(f"overturemaps-us-west-2/release/{args.release}/theme=buildings/type=building/", filesystem=s3, format="parquet")
    w, s, e, n = BOUNDS
    f = (pc.field("bbox", "xmin") > w) & (pc.field("bbox", "xmax") < e) & (pc.field("bbox", "ymin") > s) & (pc.field("bbox", "ymax") < n)
    return data.to_table(columns=cols, filter=f).to_pylist()


def read_hdb3d(path):
    """OSM way id -> model height in metres (top of the LoD1 solid)."""
    if not path:
        return {}
    d = json.load(open(path))
    verts = d["vertices"]
    heights = {}
    for key, obj in d["CityObjects"].items():
        if not key.startswith("way/"):
            continue
        top = 0.0
        stack = [obj["geometry"][0]["boundaries"]]
        while stack:
            item = stack.pop()
            if isinstance(item, int):
                top = max(top, verts[item][2])
            else:
                stack.extend(item)
        if top > 0:
            heights["w" + key[4:]] = top
    return heights


def resolve(b, hdb):
    src = b["sources"][0] if b["sources"] else {}
    osm_id = (src.get("record_id") or "").split("@")[0] if src.get("dataset") == "OpenStreetMap" else ""
    if b["height"] is not None and b["height"] > 0:
        return b["height"], 1, "osm-height"
    if osm_id in hdb:
        return hdb[osm_id], 2, "hdb3d"
    if b["num_floors"]:
        return b["num_floors"] * STOREY_M, 2, "osm-levels"
    cls = b["class"] or ""
    if cls in OPEN:
        return None, 0, "open-structure"
    return (DEFAULT_LOW_M if cls in LOW_RISE else DEFAULT_OTHER_M), 3, "class-default"


def world_px(lon, lat, z):
    n = 2 ** z * TILE
    r = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def rings(geom):
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom] if geom.geom_type == "Polygon" else []
    for poly in polys:
        yield [list(poly.exterior.coords)] + [list(i.coords) for i in poly.interiors]


def encode(heights_dm, kinds):
    rgba = np.zeros((TILE, TILE, 4), np.uint8)
    rgba[..., 0] = heights_dm >> 8
    rgba[..., 1] = heights_dm & 255
    rgba[..., 2] = kinds
    rgba[..., 3] = 255
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def main():
    hdb = read_hdb3d(args.hdb3d)
    rows = read_overture()
    rules = collections.Counter()
    area_by_kind = collections.Counter()
    items = []
    for b in rows:
        h, kind, rule = resolve(b, hdb)
        rules[rule] += 1
        if h is None:
            continue
        geom = shapely.from_wkb(b["geometry"])
        area_by_kind[kind] += geom.area * 111_320 ** 2
        items.append((h, kind, geom))
    items.sort(key=lambda t: t[0])  # taller buildings drawn last win where footprints overlap

    # Draw every footprint into each zoom-15 tile it touches.
    tiles = {}
    for h, kind, geom in items:
        dm = min(MAX_DM, max(1, round(h * 10)))
        x0, y1 = world_px(geom.bounds[0], geom.bounds[1], ZOOM)
        x1, y0 = world_px(geom.bounds[2], geom.bounds[3], ZOOM)
        for tx in range(int(x0 // TILE), int(x1 // TILE) + 1):
            for ty in range(int(y0 // TILE), int(y1 // TILE) + 1):
                t = tiles.get((tx, ty))
                if t is None:
                    t = tiles[(tx, ty)] = (Image.new("I", (TILE, TILE)), Image.new("L", (TILE, TILE)))
                dh, dk = ImageDraw.Draw(t[0]), ImageDraw.Draw(t[1])
                for ring_set in rings(geom):
                    for i, ring in enumerate(ring_set):
                        pts = [tuple(np.subtract(world_px(lon, lat, ZOOM), (tx * TILE, ty * TILE))) for lon, lat in ring]
                        dh.polygon(pts, fill=0 if i else dm)
                        dk.polygon(pts, fill=0 if i else kind)

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    total = 0
    level = {k: (np.array(v[0], np.int64).astype(np.uint16), np.array(v[1], np.uint8)) for k, v in tiles.items()}
    for z in (ZOOM, *LOWER_ZOOMS):
        if z != ZOOM:
            parents = {}
            for (tx, ty), (hd, kd) in level.items():
                px, py = tx // 2, ty // 2
                ph, pk = parents.setdefault((px, py), (np.zeros((TILE, TILE), np.uint16), np.zeros((TILE, TILE), np.uint8)))
                # Tallest of each 2x2 block, with that pixel's kind.
                blocks = hd.reshape(128, 2, 128, 2).transpose(0, 2, 1, 3).reshape(128, 128, 4)
                kblocks = kd.reshape(128, 2, 128, 2).transpose(0, 2, 1, 3).reshape(128, 128, 4)
                pick = blocks.argmax(axis=2)
                ox, oy = (tx % 2) * 128, (ty % 2) * 128
                ph[oy:oy + 128, ox:ox + 128] = np.take_along_axis(blocks, pick[..., None], 2)[..., 0]
                pk[oy:oy + 128, ox:ox + 128] = np.take_along_axis(kblocks, pick[..., None], 2)[..., 0]
            level = parents
        for (tx, ty), (hd, kd) in level.items():
            if not hd.any():
                continue
            os.makedirs(f"{OUT}/{z}/{tx}", exist_ok=True)
            png = encode(hd, kd)
            total += len(png)
            with open(f"{OUT}/{z}/{tx}/{ty}.png", "wb") as fh:
                fh.write(png)

    area = sum(area_by_kind.values())
    manifest = {
        "sources": [
            {"name": "Overture Maps buildings", "release": args.release, "licence": "ODbL-1.0", "attribution": "© OpenStreetMap contributors, Overture Maps Foundation"},
            {"name": "NUS Urban Analytics Lab hdb3d-data", "version": "2019-08-25", "used": bool(hdb), "attribution": "NUS Urban Analytics Lab, HDB, OpenStreetMap contributors, OneMap"},
        ],
        "licence": "ODbL-1.0 (derived database)",
        "bounds": list(BOUNDS), "zooms": [*LOWER_ZOOMS[::-1], ZOOM], "sourceZoom": ZOOM,
        "encoding": "height above ground in decimetres = R*256 + G; B = kind (1 measured, 2 from storeys, 3 class default)",
        "storeyM": STOREY_M, "defaultLowRiseM": DEFAULT_LOW_M, "defaultOtherM": DEFAULT_OTHER_M,
        "footprints": len(rows), "rules": dict(rules),
        "areaShareByKind": {str(k): round(v / area, 4) for k, v in sorted(area_by_kind.items())},
        "bytes": total,
    }
    with open(f"{OUT}/manifest.json", "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(json.dumps(manifest, indent=2))


main()
