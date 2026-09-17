import copy
import math
import unittest
from types import SimpleNamespace

import pandas as pd

from coolchange.cooling_reliability import POLICY
from coolchange.tree_planting import ASSUMPTIONS, PROFILES, attach_planting, block_parameters, simulate_trees


class TreePlantingTests(unittest.TestCase):
    def block(self, **changes):
        row = SimpleNamespace(mb_code16="example", area_sqkm=.01, canopy_pct=10.,
                              local_canopy_min=0., local_canopy_max=30., slope=-.1,
                              cooling_status="indicative")
        for key, value in changes.items():
            setattr(row, key, value)
        return {"mb_code16": row.mb_code16, "observed_uhi": 8.,
                "observed_canopy_pct": row.canopy_pct, "status": row.cooling_status,
                "reason_codes": [] if row.cooling_status == "indicative" else ["weak_local_fit"],
                "tree_planting": block_parameters(row)}

    def test_square_kilometres_are_converted_before_percentage(self):
        result = simulate_trees(self.block(), 10)
        self.assertEqual(result["area_m2"], 10000.)
        self.assertEqual(result["new_canopy_area_m2"], 503.)
        self.assertAlmostEqual(result["delta_canopy_pp"], 5.03)
        self.assertAlmostEqual(result["cooling_c"], .503)
        self.assertAlmostEqual(result["predicted_uhi"], 7.497)

    def test_reference_sizes_match_diameters_and_percentage_bound(self):
        for profile in PROFILES.values():
            self.assertAlmostEqual(profile["mature_canopy_area_m2"],
                                   math.pi * (profile["diameter_m"] / 2) ** 2, delta=.05)
        self.assertEqual(POLICY["canopy_ceiling_pct"], ASSUMPTIONS["canopy_accounting"]["physical_percentage_bound"])

    def test_profiles_and_explicit_overlap_fraction_change_net_canopy(self):
        for name, tree in PROFILES.items():
            result = simulate_trees(self.block(), 1, name, .5)
            self.assertEqual(result["new_canopy_area_m2"], tree["mature_canopy_area_m2"] * .5)
        with self.assertRaises(ValueError):
            simulate_trees(self.block(), 1, "unknown")

    def test_only_nonnegative_whole_tree_counts_are_accepted(self):
        for count in (-1, .5, True, "10", None):
            with self.assertRaises(ValueError):
                simulate_trees(self.block(), count)

    def test_model_bound_is_integer_and_one_more_is_unavailable(self):
        block = self.block()
        self.assertEqual(block["tree_planting"]["default_limits_by_profile"]["B"]["max_trees_with_estimate"], 39)
        self.assertEqual(simulate_trees(block, 39)["status"], "indicative")
        result = simulate_trees(block, 40)
        self.assertIsNone(result["cooling_c"])
        self.assertIn("outside_local_canopy_range", result["reason_codes"])
        self.assertEqual(result["evaluated_trees"], 40)

    def test_request_over_percentage_bound_is_not_partially_planted(self):
        block = self.block(canopy_pct=99., local_canopy_max=100.)
        self.assertEqual(simulate_trees(block, 1)["status"], "indicative")
        result = simulate_trees(block, 2)
        self.assertIn("exceeds_percentage_bound", result["reason_codes"])
        self.assertIsNone(result["evaluated_trees"])
        self.assertIsNone(result["cooling_c"])

    def test_capacity_unknown_is_distinct_from_assessed_zero(self):
        result = simulate_trees(self.block(), 1)
        self.assertIsNone(result["limits"]["site_capacity_trees"])
        self.assertEqual(result["feasibility_status"], "not_assessed")
        result = simulate_trees(self.block(), 1, site_capacity_trees=0, site_capacity_source="Example site assessment")
        self.assertIn("exceeds_supplied_site_capacity", result["reason_codes"])
        self.assertIsNone(result["cooling_c"])
        self.assertEqual(simulate_trees(self.block(), 0, site_capacity_trees=0,
                                       site_capacity_source="Example assessment")["status"], "baseline")

    def test_capacity_requires_traceable_source_and_integer(self):
        for args in ({"site_capacity_trees": 4}, {"site_capacity_trees": 4, "site_capacity_source": " "},
                     {"site_capacity_trees": 1.5, "site_capacity_source": "Example"},
                     {"site_capacity_source": "Example"}):
            with self.assertRaises(ValueError):
                simulate_trees(self.block(), 1, **args)

    def test_supplied_capacity_restricts_model_slider_limit(self):
        result = simulate_trees(self.block(), 4, site_capacity_trees=4, site_capacity_source="Example")
        self.assertEqual(result["limits"]["max_trees_with_estimate"], 4)
        self.assertEqual(result["status"], "indicative")

    def test_unreliable_block_does_not_acquire_a_tree_cooling_estimate(self):
        block = self.block(cooling_status="unavailable")
        self.assertIsNone(block["tree_planting"]["simulation_slope"])
        result = simulate_trees(block, 1)
        self.assertIsNone(result["limits"]["max_trees_with_estimate"])
        self.assertIsNone(result["cooling_c"])
        self.assertIn("weak_local_fit", result["reason_codes"])
        baseline = simulate_trees(block, 0)
        self.assertEqual((baseline["status"], baseline["predicted_uhi"], baseline["cooling_c"]), ("baseline", 8., 0.))

    def test_invalid_geometry_area_or_support_is_rejected(self):
        for changes in ({"area_sqkm": 0}, {"area_sqkm": math.nan},
                        {"local_canopy_min": 40}, {"local_canopy_max": 101}):
            with self.assertRaises(ValueError): self.block(**changes)
        for fraction in (0., -1., 1.1, math.nan, math.inf, 5e-324):
            with self.assertRaises(ValueError): simulate_trees(self.block(), 1, net_canopy_fraction=fraction)

    def test_maturity_is_not_a_calendar_year_prediction(self):
        result = simulate_trees(self.block(), 1)
        self.assertEqual(result["horizon_label"], "At maturity")
        self.assertFalse(result["maturity_is_guaranteed"])
        self.assertIsNone(ASSUMPTIONS["maturity"]["annual_growth_curve"])

    def test_export_rejects_mismatched_block_count(self):
        with self.assertRaises(ValueError): attach_planting(pd.DataFrame(), {"blocks": [self.block()]})

    def test_calculation_does_not_mutate_shared_export(self):
        block = self.block()
        original = copy.deepcopy(block)
        simulate_trees(block, 40)
        self.assertEqual(block, original)


if __name__ == "__main__":
    unittest.main()
