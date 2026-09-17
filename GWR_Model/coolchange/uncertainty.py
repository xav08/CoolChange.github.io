"""Conditional, nominal pointwise GWR intervals; not calibrated prediction intervals."""
from statistics import NormalDist
import math
import hashlib

METHOD = 'gwr_coefficient_normal_v1'
LEVEL = 0.95
CRITICAL = NormalDist().inv_cdf((1 + LEVEL) / 2)


def verify_input_hash(path, expected):
    """Accept only exact bytes or a proven CSV newline-only conversion by Git."""
    raw = path.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual == expected:
        return {'sha256': actual, 'match': 'exact'}
    if path.suffix == '.csv':
        lf = raw.replace(b'\r\n', b'\n')
        for name, candidate in [('lf', lf), ('crlf', lf.replace(b'\n', b'\r\n'))]:
            if hashlib.sha256(candidate).hexdigest() == expected:
                return {'sha256': actual, 'match': f'newline_only_to_{name}', 'matched_sha256': expected}
    raise ValueError(f'Stale input: {path.name}; content hash does not match')


def validate_coefficient_interval(coefficient, slope=None):
    if (not isinstance(coefficient, dict) or coefficient.get('method') != METHOD
            or coefficient.get('level') != LEVEL or coefficient.get('coverage_validated') is not False):
        raise ValueError('Unsupported coefficient uncertainty or coverage claim')
    values = [coefficient.get(k) for k in ('lower', 'upper', 'standard_error')]
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values):
        raise ValueError('Finite coefficient interval required')
    lower, upper, se = values
    center = (lower + upper) / 2 if slope is None else slope
    if (se < 0 or not math.isclose(lower, center - CRITICAL * se, rel_tol=1e-10, abs_tol=1e-10)
            or not math.isclose(upper, center + CRITICAL * se, rel_tol=1e-10, abs_tol=1e-10)):
        raise ValueError('Inconsistent coefficient interval arithmetic')


def coefficient_interval(slope, standard_error):
    if not all(math.isfinite(v) for v in (slope, standard_error)) or standard_error < 0:
        raise ValueError('Finite slope and nonnegative standard error required')
    return {'method': METHOD, 'level': LEVEL, 'coverage_validated': False,
            'standard_error': standard_error,
            'lower': slope - CRITICAL * standard_error,
            'upper': slope + CRITICAL * standard_error}


def cooling_interval(coefficient, delta_pp, status):
    # Zero addition is a deterministic baseline, not an estimated cooling effect.
    if status != 'indicative':
        return None
    validate_coefficient_interval(coefficient)
    if not math.isfinite(delta_pp) or delta_pp <= 0:
        raise ValueError('An indicative interval requires positive finite canopy addition')
    lower = -coefficient['upper'] * delta_pp
    upper = -coefficient['lower'] * delta_pp
    return {'method': METHOD, 'level': LEVEL, 'coverage_validated': False,
            'lower_c': lower, 'upper_c': upper,
            'includes_zero': lower <= 0 <= upper}
