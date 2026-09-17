import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from coolchange._config import ROOT, configured_path
from coolchange.audit_data import load_history
from coolchange.verify_artifacts import verify_artifacts
from coolchange import fetch_data


class PortabilityTests(unittest.TestCase):
    def test_coordinate_cache_accepts_only_proven_newline_conversion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            points = root / "mesh_block_points.csv"
            blocks = root / "mesh_block.csv"
            points.write_bytes(b"mb_code16,lon,lat\n20631942810,145,-38\n")
            blocks.write_bytes(b"mb_code16\n20631942810\n")
            manifest = {key: hashlib.sha256(path.read_bytes().replace(b"\n", b"\r\n")).hexdigest()
                        for key, path in (("points_sha256", points), ("mesh_block_sha256", blocks))}
            (root / "coordinate_provenance.json").write_text(json.dumps(manifest))
            with patch.multiple(fetch_data, DATA=root, POINTS_CSV=points, MESH_BLOCK_CSV=blocks), \
                    patch.object(fetch_data, "pull_points_from_arcgis") as download:
                fetch_data.copy_or_build_points()
                download.assert_not_called()
                points.write_bytes(points.read_bytes().replace(b"145", b"146"))
                fetch_data.copy_or_build_points()
                download.assert_called_once()

    def test_relative_configuration_does_not_follow_working_directory(self):
        with patch.dict(os.environ, {"COOLCHANGE_SEEDS": "../backend/src/db/seeds"}):
            expected = ROOT.parent / "backend/src/db/seeds"
            self.assertEqual(configured_path("COOLCHANGE_SEEDS", Path("unused")), expected.resolve())

    def test_history_is_optional_but_requested_missing_history_fails(self):
        self.assertIsNone(load_history(None, ["20631942810"]))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                load_history(Path(directory), ["20631942810"])

    def test_history_retains_old_invalid_coordinates_and_checks_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "mesh_block_points.csv").write_text(
                "mb_code16,lon,lat\n20631942810,0,0\n20631942811,145,-38\n")
            (root / "gwr_model.json").write_text(json.dumps({"gwr": {"rmse": 1.2}}))
            result = load_history(root, ["20631942811", "20631942810"])
            self.assertEqual(result["bad_ids"].tolist(), ["20631942810"])
            self.assertEqual(result["gwr"], {"rmse": 1.2})
            with self.assertRaisesRegex(ValueError, "cover"):
                load_history(root, ["20631942810"])

    def test_release_verification_rejects_changed_and_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "example.json"
            path.write_bytes(b"{}")
            manifest = {"files": {"example.json": {
                "bytes": 2, "sha256": hashlib.sha256(b"{}").hexdigest()}}}
            self.assertEqual(verify_artifacts(root, manifest), 1)
            path.write_bytes(b"[]")
            with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                verify_artifacts(root, manifest)
            path.unlink()
            with self.assertRaisesRegex(ValueError, "Missing"):
                verify_artifacts(root, manifest)


if __name__ == "__main__":
    unittest.main()
