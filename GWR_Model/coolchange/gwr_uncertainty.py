"""Augment an existing GWR export without overwriting it or changing point estimates.

python -m coolchange.gwr_uncertainty --output-dir data/uncertainty_v1
"""
from __future__ import annotations
import argparse
import collections
import json
from pathlib import Path
import platform

import numpy as np
import pandas as pd
import sklearn
from sklearn.neighbors import NearestNeighbors

from coolchange._config import DATA, MESH_BLOCK_CSV, POINTS_CSV, GWR_COEF_CSV, GWR_MODEL_JSON
from coolchange.coordinates import sha256_file
from coolchange.train_gwr import load_joined, project_metres, bisquare_weights, local_wls
from coolchange.tree_planting import ASSUMPTIONS_PATH, simulate_trees
from coolchange.uncertainty import METHOD, LEVEL, CRITICAL, coefficient_interval, cooling_interval, verify_input_hash


def local_operator(x, weights):
    """B=(X'WX)^-1 X'W via SVD; kernel weights are NOT inverse error variances."""
    if (x.ndim != 1 or weights.shape != x.shape or len(x) < 2 or
            not np.isfinite(x).all() or not np.isfinite(weights).all() or (weights < 0).any()):
        raise ValueError('Finite feature and nonnegative matching weights required')
    design = np.column_stack((np.ones(len(x)), x))
    root = np.sqrt(weights)
    weighted = root[:, None] * design
    if np.linalg.matrix_rank(weighted) < 2:
        raise ValueError('Rank-deficient local design; no interval exported')
    return np.linalg.pinv(weighted) * root[None, :]


def fit_uncertainty(xy, x, y, k):
    n = len(y)
    if (not isinstance(k, int) or isinstance(k, bool) or not 2 < k <= n
            or xy.shape != (n, 2) or x.shape != (n,) or y.shape != (n,)
            or not all(np.isfinite(a).all() for a in (xy, x, y))):
        raise ValueError('Finite inputs and 2 < k <= n required')
    nn = NearestNeighbors(n_neighbors=k, algorithm='kd_tree').fit(xy)
    distances, indices = nn.kneighbors(xy)
    weights = bisquare_weights(distances)
    beta = np.empty((n, 2))
    variance_factor = np.empty((n, 2))
    trace_s = trace_sts = 0.0
    for i, neighbors in enumerate(indices):
        w = weights[i]
        operator = local_operator(x[neighbors], w)
        # Preserve the same estimator used by the existing training implementation.
        beta[i] = local_wls(x[neighbors], y[neighbors], w)
        variance_factor[i] = np.sum(operator ** 2, axis=1)
        row = np.array([1.0, x[i]]) @ operator
        trace_s += float(row[neighbors == i].sum())
        trace_sts += float(row @ row)
    predicted = beta[:, 0] + beta[:, 1] * x
    residual = y - predicted
    df = n - 2 * trace_s + trace_sts
    if not np.isfinite(beta).all() or not np.isfinite(df) or df <= 0:
        raise ValueError('Invalid residual degrees of freedom or fitted parameters')
    rss = float(residual @ residual)
    sigma2 = rss / df
    standard_errors = np.sqrt(sigma2 * variance_factor)
    if not np.isfinite(standard_errors).all():
        raise ValueError('Nonfinite standard errors')
    diagnostics = {'n_blocks': n, 'n_neighbors': k, 'trace_s': trace_s,
                   'trace_sts': trace_sts, 'residual_df': df,
                   'residual_sum_squares': rss, 'residual_variance': sigma2,
                   'residual_variance_formula': 'RSS / (n - 2*trace(S) + trace(S.T*S))'}
    return beta, standard_errors, residual, diagnostics


def residual_moran(xy, residual, permutations=199):
    """Descriptive directed row-standardized 8-NN Moran I; not a calibration step."""
    count = min(8, len(residual) - 1)
    idx = NearestNeighbors(n_neighbors=count + 1).fit(xy).kneighbors(xy, return_distance=False)
    idx = np.asarray([row[row != i][:count] for i, row in enumerate(idx)])
    z = residual - residual.mean()
    den = float(z @ z)
    if den == 0:
        return {'status': 'constant_residuals'}
    def statistic(v):
        return float(np.sum(v * v[idx].mean(axis=1)) / den)
    observed = statistic(z)
    rng = np.random.default_rng(42)
    expected = -1 / (len(z) - 1)
    extreme = sum(abs(statistic(rng.permutation(z)) - expected) >= abs(observed - expected)
                  for _ in range(permutations))
    return {'status': 'diagnostic_only', 'neighbors': count, 'weights': 'directed_row_standardized',
            'moran_i': observed, 'permutation_p_two_sided': (extreme + 1) / (permutations + 1),
            'permutations': permutations, 'seed': 42}


def augment(payload, slopes, errors, metadata):
    if len(payload['blocks']) != len(slopes) or len(slopes) != len(errors):
        raise ValueError('Coefficient and block counts differ')
    payload['uncertainty'] = metadata
    for i, block in enumerate(payload['blocks']):
        t = block['tree_planting']
        if block['status'] == 'indicative':
            if not np.isclose(slopes[i], t['simulation_slope'], rtol=1e-10, atol=1e-10):
                raise ValueError(f"Refitted slope differs for {block['mb_code16']}")
            # Center on original stored point estimate, preserving it byte-for-number.
            t['coefficient_uncertainty'] = coefficient_interval(t['simulation_slope'], float(errors[i]))
        else:
            t['coefficient_uncertainty'] = None
        for s in block['scenarios']:
            s['cooling_interval'] = cooling_interval(t['coefficient_uncertainty'], s['applied_delta_pp'], s['status'])
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-export', type=Path, default=DATA / 'simulator_scenarios.json')
    parser.add_argument('--output-dir', type=Path, default=DATA / 'uncertainty_v1')
    args = parser.parse_args()
    # Refuse overwrite: each generated directory is a reviewable, separate release.
    if args.output_dir.exists():
        raise SystemExit('Output directory already exists; choose a new directory')
    payload = json.loads(args.source_export.read_text())
    if payload.get('schema_version') != 3 or 'uncertainty' in payload:
        raise ValueError('Expected original schema 3 export without uncertainty extension')
    input_verification = {}
    for key, path in [('mesh_block_sha256', MESH_BLOCK_CSV), ('points_sha256', POINTS_CSV),
                      ('planting_assumptions_sha256', ASSUMPTIONS_PATH)]:
        input_verification[key] = verify_input_hash(path, payload['inputs'][key])
    model = json.loads(GWR_MODEL_JSON.read_text())
    if any(model['inputs'].get(key) != payload['inputs'][key] for key in input_verification):
        raise ValueError('Model and export training provenance differ')
    if (model['kernel'], model['target'], model['feature']) != ('adaptive_bisquare', 'uhi_mean', 'canopy_pct'):
        raise ValueError('Unsupported model specification')
    df = load_joined(None)
    old = pd.read_csv(GWR_COEF_CSV, dtype={'mb_code16': str})
    codes = df.mb_code16.tolist()
    if codes != old.mb_code16.tolist() or codes != [b['mb_code16'] for b in payload['blocks']]:
        raise ValueError('Training, coefficient and export block order must match')
    if len(df) != model['n_blocks'] or not np.all(old.n_neighbors == model['n_neighbors']):
        raise ValueError('Model size/bandwidth mismatch')
    for col, values in [('observed_uhi', df.uhi_mean), ('observed_canopy_pct', df.canopy_pct)]:
        if not np.array_equal(values.to_numpy(), np.array([b[col] for b in payload['blocks']])):
            raise ValueError(f'Export baseline mismatch: {col}')
    xy = project_metres(df.lon.to_numpy(), df.lat.to_numpy())
    print('Refitting fixed-bandwidth GWR and computing covariance...', flush=True)
    beta, se, residual, diagnostics = fit_uncertainty(xy, df.canopy_pct.to_numpy(), df.uhi_mean.to_numpy(), model['n_neighbors'])
    previous = old[['intercept', 'slope']].to_numpy()
    if not np.allclose(beta, previous, rtol=1e-10, atol=1e-10):
        raise ValueError('Existing fit could not be reproduced; no new release written')
    diagnostics['maximum_absolute_coefficient_difference'] = float(np.max(np.abs(beta - previous)))
    diagnostics['residual_spatial_autocorrelation'] = residual_moran(xy, residual)
    metadata = {'version': 'uncertainty-v1', 'method': METHOD, 'level': LEVEL,
                'critical_value': CRITICAL, 'coverage_validated': False,
                'scope': 'conditional_mean_cooling', 'pointwise': True,
                'source_export_sha256': sha256_file(args.source_export),
                'source_coefficients_sha256': sha256_file(GWR_COEF_CSV),
                'source_model_sha256': sha256_file(GWR_MODEL_JSON),
                'input_file_verification': input_verification,
                'coefficient_units': 'degrees_C_per_canopy_percentage_point',
                'variance_assumption': 'independent_homoskedastic_errors',
                'conditioned_on': ['fixed_bandwidth', 'coordinates', 'observed_baseline', 'canopy_change'],
                'excludes': ['spatial_error_correlation', 'local_smoothing_bias', 'bandwidth_selection',
                            'screening_selection', 'measurement_error', 'tree_growth_and_survival',
                            'site_capacity', 'causal_effect_uncertainty', 'future_observation_noise'],
                'notice': 'Approximate nominal pointwise 95% model-based interval for the conditional mean association. Coverage is not validated. Spatial error correlation is excluded and can make intervals too narrow. Not a future-temperature prediction interval or a causal cooling guarantee. Negative bounds are retained.',
                'fit': diagnostics}
    augment(payload, beta[:, 1], se[:, 1], metadata)
    intervals = [s['cooling_interval'] for b in payload['blocks'] for s in b['scenarios'] if s['cooling_interval'] is not None]
    diagnostics_report = {'method': metadata, 'block_status_counts': dict(collections.Counter(b['status'] for b in payload['blocks'])),
                         'scenario_intervals': len(intervals), 'intervals_including_zero': sum(v['includes_zero'] for v in intervals),
                         'slope_se_quantiles_05_50_95': np.quantile(se[:, 1], [.05, .5, .95]).tolist(),
                         'python_version': platform.python_version(), 'numpy_version': np.__version__,
                         'pandas_version': pd.__version__, 'sklearn_version': sklearn.__version__}
    args.output_dir.mkdir(parents=True)
    out = args.output_dir / 'simulator_scenarios.json'
    out.write_text(json.dumps(payload, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n')
    coefficients = pd.DataFrame({'mb_code16': codes, 'slope': old.slope, 'slope_standard_error': se[:, 1],
                                 'slope_lower_95': old.slope - CRITICAL * se[:, 1],
                                 'slope_upper_95': old.slope + CRITICAL * se[:, 1],
                                 'intercept_standard_error': se[:, 0]})
    coefficients.to_csv(args.output_dir / 'gwr_coefficient_uncertainty.csv', index=False)
    example_block = next(b for b in payload['blocks'] if b['mb_code16'] == '20631942810')
    example = simulate_trees(example_block, 10, 'B')
    (args.output_dir / 'tree_planting_example.json').write_text(json.dumps(example, indent=2, allow_nan=False) + '\n')
    diagnostics_report['export_sha256'] = sha256_file(out)
    diagnostics_report['example'] = example
    (args.output_dir / 'validation_report.json').write_text(json.dumps(diagnostics_report, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: v for k, v in diagnostics_report.items() if k not in ('method', 'example')}, indent=2))
    print(f'Wrote {out}')


if __name__ == '__main__':
    main()
