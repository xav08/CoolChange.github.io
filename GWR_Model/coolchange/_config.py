"""Paths and API base URL. CoolChange stays read-only."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
# Read this module's optional configuration, not the backend's credentials.
load_dotenv(ROOT / ".env")
DATA = ROOT / "data"
CONFIG = ROOT / "config"

DEFAULT_SEEDS = PROJECT_ROOT / "backend/src/db/seeds"
DEFAULT_CACHE = PROJECT_ROOT / "data-pipeline/.cache"
DEFAULT_RAW = PROJECT_ROOT / "data-pipeline/data/raw"


def configured_path(name, default):
    """Resolve relative overrides from GWR_Model, independent of shell location."""
    path = Path(os.environ.get(name) or default).expanduser()
    return (path if path.is_absolute() else ROOT / path).resolve()


SEEDS = configured_path("COOLCHANGE_SEEDS", DEFAULT_SEEDS)
CACHE = configured_path("COOLCHANGE_CACHE", DEFAULT_CACHE)
RAW = configured_path("COOLCHANGE_RAW", DEFAULT_RAW)
API = os.environ.get("COOLCHANGE_API", "http://localhost:3000").rstrip("/")

MESH_BLOCK_CSV = DATA / "mesh_block.csv"
PROJECTION_CSV = DATA / "mesh_block_projection.csv"
POINTS_CSV = DATA / "mesh_block_points.csv"
MODEL_JSON = DATA / "model.json"
GWR_MODEL_JSON = DATA / "gwr_model.json"
GWR_COEF_CSV = DATA / "gwr_coefficients.csv"
COMPARE_JSON = DATA / "model_comparison.json"
