"""Building height coverage in Singapore from the Overture Maps buildings theme.

Reads the release straight from the public S3 bucket (no STAC lookup) and prints how many
footprints carry a height or a storey count, by source. Needs: pip install pyarrow shapely numpy.

    python3 scripts/buildings/overture_coverage.py [release]   # default 2026-10-21.0
"""
import collections
import sys

import numpy as np
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as fs
import shapely

RELEASE = sys.argv[1] if len(sys.argv) > 1 else "2026-10-21.0"
BOUNDS = (103.596, 1.2, 104.10, 1.4835)  # west, south, east, north; DEM bounds trimmed to the island
M_PER_DEG = 111_320


def in_singapore(b):
    """Crude mask that drops Johor north of the strait; good to about a percent for coverage shares."""
    x = (b["xmin"] + b["xmax"]) / 2
    y = (b["ymin"] + b["ymax"]) / 2
    return not (y > 1.47 or (x < 103.98 and y > 1.452) or (x < 103.73 and y > 1.43))


s3 = fs.S3FileSystem(anonymous=True, region="us-west-2")
data = ds.dataset(f"overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/", filesystem=s3, format="parquet")
w, s, e, n = BOUNDS
f = (pc.field("bbox", "xmin") > w) & (pc.field("bbox", "xmax") < e) & (pc.field("bbox", "ymin") > s) & (pc.field("bbox", "ymax") < n)
rows = [r for r in data.to_table(columns=["geometry", "bbox", "height", "num_floors", "sources"], filter=f).to_pylist() if in_singapore(r["bbox"])]

by_source, with_height = collections.Counter(), collections.Counter()
area = known_area = 0.0
floors_only = big = big_known = 0
heights, floors = [], []
for r in rows:
    src = r["sources"][0]["dataset"] if r["sources"] else "unknown"
    by_source[src] += 1
    a = shapely.from_wkb(r["geometry"]).area * M_PER_DEG ** 2
    known = r["height"] is not None or r["num_floors"] is not None
    area += a
    known_area += a if known else 0
    if a > 1000:
        big += 1
        big_known += known
    if r["height"] is not None:
        with_height[src] += 1
        heights.append(r["height"])
    elif r["num_floors"] is not None:
        floors_only += 1
    if r["num_floors"]:
        floors.append(r["num_floors"])

print(f"Overture {RELEASE}: {len(rows)} footprints in Singapore")
print("by source:", by_source.most_common())
print("with height, by source:", with_height.most_common())
print(f"storeys only: {floors_only}")
print(f"height or storeys: {100 * known_area / area:.1f}% of footprint area; {100 * big_known / big:.1f}% of {big} footprints over 1000 m2")
print("height p10/p50/p90/max:", np.percentile(heights, [10, 50, 90]).round(1), max(heights))
print("storeys p50/p90/max:", np.percentile(floors, [50, 90]), max(floors))
