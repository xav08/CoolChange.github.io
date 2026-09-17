import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from coolchange.cooling_reliability import (POLICY, classify_block, evaluate_scenario,
                                 local_diagnostics, write_public_json)
from coolchange.train_gwr import apply_scenarios, local_wls
from coolchange.audit_data import assert_exported_scenario


class CoolingScreenTests(unittest.TestCase):
    def classify(self, **changes):
        values = dict(slope=-.1, local_r2=.3, slopes=[-.09, -.1, -.11],
                      n_effective=100., canopy_sd=10.)
        values.update(changes)
        return classify_block(**values)

    def scenario(self, **changes):
        values = dict(uhi=8., canopy=20., slope=-.1, reasons=[],
                      support_min=0., support_max=60., delta=10.)
        values.update(changes)
        return evaluate_scenario(**values)

    def test_supported_negative_association_is_indicative(self):
        self.assertEqual(self.classify(), [])
        value = self.scenario()
        self.assertEqual(value["status"], "indicative")
        self.assertEqual(value["predicted_uhi"], 7.)
        self.assertEqual(value["cooling_c"], 1.)

    def test_nonnegative_slopes_never_become_zero_or_average_cooling(self):
        for slope in (0., .1):
            reasons = self.classify(slope=slope)
            self.assertIn("nonnegative_slope", reasons)
            value = self.scenario(slope=slope, reasons=reasons)
            self.assertEqual(value["status"], "unavailable")
            self.assertIsNone(value["predicted_uhi"])
            self.assertIsNone(value["cooling_c"])
            # Defense even when an upstream caller omits the classification.
            self.assertIsNone(self.scenario(slope=slope)["cooling_c"])

    def test_all_failure_reasons_are_preserved(self):
        reasons = self.classify(local_r2=.01, slopes=[-.1, .01, -.1],
                                n_effective=5, canopy_sd=.1)
        self.assertEqual(reasons, ["weak_local_fit", "unstable_direction", "insufficient_local_support"])
        self.assertEqual(self.scenario(reasons=reasons)["reason_codes"], reasons)

    def test_policy_boundaries(self):
        self.assertEqual(self.classify(local_r2=.1, n_effective=30, canopy_sd=1), [])
        self.assertIn("weak_local_fit", self.classify(local_r2=.0999))
        self.assertIn("insufficient_local_support", self.classify(n_effective=29.99))
        self.assertIn("insufficient_local_support", self.classify(canopy_sd=.9999))

    def test_direction_check_fails_closed(self):
        for slopes in ([-.1, np.nan, -.1], [-.1, 0., -.1], [], [-.1]):
            self.assertIn("unstable_direction", self.classify(slopes=slopes))

    def test_nonfinite_fit_is_unavailable(self):
        for field in ("slope", "local_r2", "n_effective", "canopy_sd"):
            self.assertIn("invalid_local_fit", self.classify(**{field: np.nan}))
        self.assertIsNone(self.scenario(slope=np.nan)["predicted_uhi"])

    def test_baseline_is_observed_even_when_estimate_unavailable(self):
        value = self.scenario(delta=0, slope=np.nan, reasons=["invalid_local_fit"])
        self.assertEqual(value["status"], "baseline")
        self.assertEqual(value["predicted_uhi"], 8.)
        self.assertEqual(value["cooling_c"], 0.)

    def test_local_range_is_checked_per_scenario(self):
        self.assertEqual(self.scenario(delta=5, support_max=25)["status"], "indicative")
        value = self.scenario(delta=10, support_max=25)
        self.assertEqual(value["reason_codes"], ["outside_local_canopy_range"])
        self.assertIsNone(value["cooling_c"])
        self.assertIsNone(self.scenario(support_min=21)["cooling_c"])

    def test_invalid_support_fails_closed(self):
        for change in ({"support_max": np.nan}, {"support_min": 70, "support_max": 60}):
            self.assertIn("invalid_local_fit", self.scenario(**change)["reason_codes"])

    def test_ceiling_limits_addition_without_removing_existing_canopy(self):
        value = self.scenario(canopy=98, delta=10, support_max=100)
        self.assertEqual(value["applied_delta_pp"], 2.)
        self.assertAlmostEqual(value["cooling_c"], .2)
        for canopy in (100.,):
            value = self.scenario(canopy=canopy, slope=.1, reasons=["nonnegative_slope"])
            self.assertEqual(value["status"], "no_change")
            self.assertEqual(value["canopy_pct"], canopy)
            self.assertEqual(value["predicted_uhi"], 8.)
        raw = apply_scenarios(np.array([8.]), np.array([90.]), np.array([-.1]))
        self.assertEqual(raw["uhi_plus0"][0], 8.)
        self.assertEqual(raw["uhi_plus10"][0], 7.)

    def test_invalid_user_inputs_are_rejected(self):
        for values in ({"delta": -1}, {"delta": np.nan}, {"canopy": 101}, {"uhi": np.inf}):
            with self.assertRaises(ValueError): self.scenario(**values)

    def test_effective_support_accounts_for_concentrated_weights(self):
        stats = local_diagnostics([0., 10., 20.], [1., 1., 0.])
        self.assertEqual(stats, (2., 5., 0., 10.))
        self.assertTrue(np.isnan(local_diagnostics([1.], [0.])[0]))
        self.assertEqual(local_diagnostics([5.,5.,5.], [1.,1.,1.])[1], 0.)

    def test_rank_deficient_fit_has_no_invented_slope(self):
        beta = local_wls(np.array([10.,10.,10.]), np.array([7.,8.,9.]), np.ones(3))
        self.assertTrue(np.isnan(beta).all())

    def test_json_null_and_strict_serialization(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public.json"
            value = self.scenario(slope=.1)
            write_public_json(value, path)
            self.assertIn('"cooling_c":null', path.read_text(encoding="utf-8"))
            self.assertIsNone(json.loads(path.read_text())["predicted_uhi"])
            before = path.read_bytes()
            with self.assertRaises(ValueError): write_public_json({"value": np.nan}, path)
            self.assertEqual(path.read_bytes(), before)

    def test_export_audit_accepts_matching_values(self):
        scenario = self.scenario()
        row = SimpleNamespace(mb_code16="20015920000", status_plus10="indicative",
                              reasons_plus10=np.nan, uhi_plus10=7., cooling_plus10=1., canopy_plus10=30.)
        assert_exported_scenario(row, scenario, scenario, 10)

    def test_export_audit_rejects_wrong_cooling_even_if_uhi_matches(self):
        scenario = self.scenario()
        row = SimpleNamespace(mb_code16="20015920000", status_plus10="indicative",
                              reasons_plus10=np.nan, uhi_plus10=7., cooling_plus10=999., canopy_plus10=30.)
        with self.assertRaises(AssertionError): assert_exported_scenario(row, scenario, scenario, 10)

    def test_export_audit_rejects_null_coerced_to_zero(self):
        scenario = self.scenario(slope=.1)
        row = SimpleNamespace(mb_code16="20015920000", status_plus10="unavailable",
                              reasons_plus10="nonnegative_slope", uhi_plus10=0., cooling_plus10=0., canopy_plus10=30.)
        with self.assertRaises(AssertionError): assert_exported_scenario(row, scenario, scenario, 10)

    def test_export_audit_rejects_changed_reason(self):
        scenario = self.scenario(slope=.1)
        row = SimpleNamespace(mb_code16="20015920000", status_plus10="unavailable",
                              reasons_plus10="outside_local_canopy_range", uhi_plus10=np.nan,
                              cooling_plus10=np.nan, canopy_plus10=30.)
        with self.assertRaises(AssertionError): assert_exported_scenario(row, scenario, scenario, 10)


if __name__ == "__main__":
    unittest.main()
