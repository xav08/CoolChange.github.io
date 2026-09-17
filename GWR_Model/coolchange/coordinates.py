"""Projected polygon centroids and strict training-input validation.

Coordinates are GWR distance anchors, not address point-in-polygon matches.
A polygon's area-weighted centroid can legitimately lie outside its boundary.
"""
import hashlib

import numpy as np
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform
from shapely import make_valid
from shapely.validation import explain_validity

TO_METRES = Transformer.from_crs(4326, 3111, always_xy=True)
TO_WGS84 = Transformer.from_crs(3111, 4326, always_xy=True)
# Conservative guard for this Melbourne-only dataset, not a membership test.
BOUNDS = (143.0, -39.5, 147.0, -36.5)


def polygon_centroid(geometry: dict, repairs: list | None = None) -> tuple[float, float]:
    """Use every polygon part and hole, at full precision in EPSG:3111."""
    if not geometry or geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("Expected nonempty GeoJSON Polygon or MultiPolygon")
    polygon = shape(geometry)
    if polygon.is_empty:
        raise ValueError("Empty source polygon")
    projected = transform(TO_METRES.transform, polygon)
    if not polygon.is_valid or not projected.is_valid:
        if repairs is None:
            raise ValueError("Invalid source polygon; explicit audited repair required")
        fixed = make_valid(projected)
        relative_area_change = abs(fixed.area - projected.area) / max(abs(projected.area), 1e-12)
        centre_shift = projected.centroid.distance(fixed.centroid)
        # Accept only negligible topology defects, never silently alter substantial
        # geometry. These tolerances and every affected ID are recorded in provenance.
        if (fixed.geom_type not in ("Polygon", "MultiPolygon") or fixed.is_empty
                or not fixed.is_valid or relative_area_change > 1e-6 or centre_shift > .01):
            raise ValueError("Source topology repair exceeds area/centroid tolerance")
        repairs.append({"reason": explain_validity(polygon) if not polygon.is_valid else explain_validity(projected),
                        "relative_area_change": relative_area_change,
                        "centroid_shift_m": centre_shift, "method": "shapely.make_valid in EPSG:3111"})
        projected = fixed
    if not projected.is_valid or not np.isfinite(projected.area) or projected.area <= 0:
        raise ValueError("Source polygon has invalid projected geometry or area")
    point = projected.centroid
    lon, lat = TO_WGS84.transform(point.x, point.y)
    if not (np.isfinite(lon) and np.isfinite(lat)):
        raise ValueError("Nonfinite centroid")
    return float(lon), float(lat)


def validate_ids(frame, label: str) -> None:
    ids = frame["mb_code16"]
    if ids.isna().any() or not ids.astype(str).str.fullmatch(r"\d{11}").all():
        raise ValueError(f"{label}: missing or invalid 2016 mesh-block ID")
    if ids.duplicated().any():
        raise ValueError(f"{label}: duplicate mesh-block IDs")


def validate_points(points, expected_ids=None) -> None:
    validate_ids(points, "coordinates")
    values = points[["lon", "lat"]].to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError("coordinates: missing or nonfinite lon/lat")
    xmin, ymin, xmax, ymax = BOUNDS
    valid = points.lon.between(xmin, xmax) & points.lat.between(ymin, ymax)
    if not valid.all():
        raise ValueError(f"coordinates: {int((~valid).sum())} points outside Melbourne guard bounds")
    if expected_ids is not None and set(points.mb_code16) != set(expected_ids):
        raise ValueError("coordinates: ID coverage differs from the training table")


def join_training_points(blocks, points):
    """Never silently drop unmatched IDs, duplicate rows, or invalid model inputs."""
    validate_ids(blocks, "mesh blocks")
    validate_points(points, blocks.mb_code16)
    values = blocks[["uhi_mean", "canopy_pct"]].to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError("mesh blocks: nonfinite heat or canopy")
    if not blocks.canopy_pct.between(0, 100).all():
        raise ValueError("mesh blocks: canopy percentage outside 0..100")
    return blocks.merge(points, on="mb_code16", how="left", validate="one_to_one")


def sha256_file(path) -> str:
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()
