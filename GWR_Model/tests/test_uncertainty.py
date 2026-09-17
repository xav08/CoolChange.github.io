import copy
import unittest
import numpy as np
from sklearn.neighbors import NearestNeighbors
from coolchange.gwr_uncertainty import fit_uncertainty, local_operator, augment
from coolchange.train_gwr import bisquare_weights
from coolchange.uncertainty import coefficient_interval, cooling_interval, CRITICAL


class UncertaintyTests(unittest.TestCase):
    def test_dense_reference_matches_streamed_covariance(self):
        rng = np.random.default_rng(32)
        xy = rng.normal(size=(80, 2))
        x = rng.uniform(0, 70, 80)
        y = 8 - .1 * x + rng.normal(size=80)
        k = 35
        beta, se, residual, info = fit_uncertainty(xy, x, y, k)
        dist, idx = NearestNeighbors(n_neighbors=k, algorithm='kd_tree').fit(xy).kneighbors(xy)
        weights = bisquare_weights(dist)
        X = np.column_stack((np.ones(80), x))
        S = np.zeros((80, 80))
        operators = []
        for i in range(80):
            W = np.zeros((80, 80))
            W[idx[i], idx[i]] = weights[i]
            B = np.linalg.solve(X.T @ W @ X, X.T @ W)
            operators.append(B)
            S[i] = X[i] @ B
            np.testing.assert_allclose(beta[i], B @ y, atol=1e-11)
        df = 80 - 2 * np.trace(S) + np.trace(S.T @ S)
        sigma2 = np.sum((y - S @ y) ** 2) / df
        np.testing.assert_allclose(info['residual_df'], df, atol=1e-11)
        expected = [np.sqrt(np.diag(sigma2 * B @ B.T)) for B in operators]
        np.testing.assert_allclose(se, expected, atol=1e-11)

    def test_equal_weights_matches_statsmodels_ols(self):
        import statsmodels.api as sm
        rng = np.random.default_rng(4)
        x = rng.uniform(0, 30, 100)
        y = 5 - .2 * x + rng.normal(size=100)
        X = sm.add_constant(x)
        fit = sm.OLS(y, X).fit()
        B = local_operator(x, np.ones(100))
        np.testing.assert_allclose(B @ y, fit.params, atol=1e-12)
        np.testing.assert_allclose(np.sqrt(np.diag(fit.scale * B @ B.T)), fit.bse, atol=1e-12)

    def test_known_noise_monte_carlo_checks_weight_squared_covariance(self):
        rng = np.random.default_rng(123)
        x = rng.uniform(0, 50, 100)
        w = np.linspace(.01, 1, 100) ** 2
        B = local_operator(x, w)
        errors = rng.normal(size=(100, 10000))
        estimates = (B @ (7 - .1 * x)[:, None] + B @ errors)[1]
        se = np.sqrt(np.sum(B[1] ** 2))
        coverage = np.mean(np.abs(estimates + .1) <= CRITICAL * se)
        self.assertTrue(.94 < coverage < .96, coverage)
        self.assertAlmostEqual(np.std(estimates) / se, 1, delta=.03)

    def test_rank_deficient_fails(self):
        with self.assertRaises(ValueError):
            local_operator(np.ones(10), np.ones(10))

    def test_transform_retains_negative_and_zero_bounds(self):
        c = coefficient_interval(-.01, .02)
        v = cooling_interval(c, 5, 'indicative')
        self.assertLess(v['lower_c'], 0)
        self.assertGreater(v['upper_c'], 0)
        self.assertTrue(v['includes_zero'])
        self.assertAlmostEqual(v['lower_c'], -c['upper'] * 5)
        for status in ('baseline', 'no_change', 'unavailable'):
            self.assertIsNone(cooling_interval(c, 0, status))
        self.assertIsNone(cooling_interval(None, 5, 'unavailable'))
        with self.assertRaises(ValueError):
            cooling_interval(c, -1, 'indicative')
        with self.assertRaises(ValueError):
            coefficient_interval(-.1, -1)

    def test_addition_preserves_existing_values(self):
        original = {'blocks': [{'mb_code16': '12345678901', 'status': 'indicative',
                    'tree_planting': {'simulation_slope': -.1}, 'scenarios': [
                    {'status': 'indicative', 'applied_delta_pp': 3.2, 'cooling_c': .32},
                    {'status': 'unavailable', 'applied_delta_pp': 50, 'cooling_c': None}]}]}
        result = augment(copy.deepcopy(original), [-.1], [.03], {})
        self.assertIsNone(result['blocks'][0]['scenarios'][1]['cooling_interval'])
        del result['uncertainty']
        for block in result['blocks']:
            del block['tree_planting']['coefficient_uncertainty']
            for s in block['scenarios']:
                del s['cooling_interval']
        self.assertEqual(original, result)

class InputAndTreeIntervalTests(unittest.TestCase):
    def test_newline_only_hash_equivalence_does_not_accept_changed_values(self):
        import hashlib
        import tempfile
        from pathlib import Path
        from coolchange.uncertainty import verify_input_hash
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.csv'
            path.write_bytes(b'x,y\n1,2\n')
            expected = hashlib.sha256(b'x,y\r\n1,2\r\n').hexdigest()
            self.assertEqual(verify_input_hash(path, expected)['match'], 'newline_only_to_crlf')
            path.write_bytes(b'x,y\n1,3\n')
            with self.assertRaises(ValueError):
                verify_input_hash(path, expected)

    def test_invalid_coefficient_and_fit_inputs_fail(self):
        c = coefficient_interval(-.1, .02)
        for key, value in [('method', 'unknown'), ('coverage_validated', True),
                           ('lower', 99), ('standard_error', float('nan'))]:
            bad = dict(c, **{key: value})
            with self.assertRaises(ValueError):
                cooling_interval(bad, 5, 'indicative')
        with self.assertRaises(ValueError):
            cooling_interval(None, 5, 'indicative')
        for k in (2, 6, True, 3.5):
            with self.assertRaises(ValueError):
                fit_uncertainty(np.ones((5, 2)), np.ones(5), np.ones(5), k)

    def test_tree_count_interval_and_rejected_request(self):
        from coolchange.tree_planting import simulate_trees
        block = {'mb_code16': '12345678901', 'observed_canopy_pct': 10., 'observed_uhi': 8.,
                 'status': 'indicative', 'reason_codes': [], 'tree_planting': {
                     'area_m2': 10000., 'simulation_slope': -.1,
                     'local_canopy_min_pct': 0., 'local_canopy_max_pct': 30.,
                     'coefficient_uncertainty': coefficient_interval(-.1, .08)}}
        result = simulate_trees(block, 10)
        v = result['cooling_interval']
        self.assertTrue(v['includes_zero'])
        self.assertAlmostEqual(v['lower_c'], -block['tree_planting']['coefficient_uncertainty']['upper'] * 5.03)
        self.assertAlmostEqual(simulate_trees(block, 20)['cooling_interval']['upper_c'], v['upper_c'] * 2)
        self.assertIsNone(simulate_trees(block, 0)['cooling_interval'])
        self.assertIsNone(simulate_trees(block, 10000)['cooling_interval'])
        self.assertIsNone(simulate_trees(block, 50)['cooling_interval'])
        block['tree_planting']['coefficient_uncertainty'] = coefficient_interval(-.2, .08)
        with self.assertRaises(ValueError):
            simulate_trees(block, 10)


if __name__ == '__main__':
    unittest.main()
