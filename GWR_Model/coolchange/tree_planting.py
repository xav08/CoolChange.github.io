"""Source-backed reference tree sizes and conditional mature-canopy scenarios.

No species growth curve, site capacity or canopy overlap is inferred from a mesh block.
"""
import json
import math
from coolchange._config import CONFIG

from coolchange.cooling_reliability import evaluate_scenario

ASSUMPTIONS_PATH = CONFIG / "planting_assumptions.json"
ASSUMPTIONS = json.loads(ASSUMPTIONS_PATH.read_text(encoding="utf-8"))
PROFILES = ASSUMPTIONS["profiles"]


def validate_count(value, name="tree_count"):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer")


def checked_profile(profile):
    if profile not in PROFILES:
        raise ValueError("tree_profile must be A, B or C")
    return PROFILES[profile]


def block_parameters(row):
    area = float(row.area_sqkm) * 1_000_000.0
    if not math.isfinite(area) or area <= 0:
        raise ValueError(f"{row.mb_code16}: positive finite block area is required")
    if not all(math.isfinite(v) for v in (row.canopy_pct, row.local_canopy_min, row.local_canopy_max)):
        raise ValueError(f"{row.mb_code16}: finite canopy support is required")
    parameters = {
        "area_m2": area,
        "simulation_slope": float(row.slope) if row.cooling_status == "indicative" else None,
        "local_canopy_min_pct": float(row.local_canopy_min),
        "local_canopy_max_pct": float(row.local_canopy_max),
        "site_capacity_trees": None,
        "site_capacity_status": "not_assessed",
    }
    parameters["default_limits_by_profile"] = {}
    for name in PROFILES:
        limits = capacity_limits(row.canopy_pct, parameters, name)
        parameters["default_limits_by_profile"][name] = {
            key: limits[key] for key in ("max_trees_with_estimate", "canopy_domain_max_trees")}
    return parameters


def capacity_limits(canopy, parameters, profile="B", net_canopy_fraction=1.0,
                    site_capacity_trees=None, site_capacity_source=None):
    tree = checked_profile(profile)
    area = parameters["area_m2"]
    if not math.isfinite(area) or area <= 0 or not math.isfinite(canopy) or not 0 <= canopy <= 100:
        raise ValueError("Positive block area and canopy in 0..100 required")
    if not math.isfinite(net_canopy_fraction) or not 0 < net_canopy_fraction <= 1:
        raise ValueError("net_canopy_fraction must be greater than 0 and at most 1")
    if site_capacity_trees is not None:
        validate_count(site_capacity_trees, "site_capacity_trees")
        if not isinstance(site_capacity_source, str) or not site_capacity_source.strip():
            raise ValueError("A source is required for supplied site capacity")
    elif site_capacity_source is not None:
        raise ValueError("A source without a site capacity is not a capacity assessment")
    effective_crown = tree["mature_canopy_area_m2"] * net_canopy_fraction
    if effective_crown <= 0 or not math.isfinite(area / effective_crown):
        raise ValueError("Net crown fraction is too small for a finite capacity calculation")
    full_count = math.floor(max(0., 100 - canopy) / 100 * area / effective_crown + 1e-9)
    lower, upper = parameters["local_canopy_min_pct"], parameters["local_canopy_max_pct"]
    if not all(math.isfinite(v) for v in (lower, upper)) or not 0 <= lower <= upper <= 100:
        raise ValueError("Invalid local canopy support")
    domain_count = math.floor(max(0., upper - canopy) / 100 * area / effective_crown + 1e-9)
    slope = parameters["simulation_slope"]
    estimable = slope is not None and math.isfinite(slope) and slope < 0 and lower <= canopy <= upper
    max_estimate = min(domain_count, full_count) if estimable else None
    if max_estimate is not None and site_capacity_trees is not None:
        max_estimate = min(max_estimate, site_capacity_trees)
    return {
        "max_trees_with_estimate": max_estimate,
        "canopy_domain_max_trees": domain_count,
        "percentage_bound_max_trees": full_count,
        "site_capacity_trees": site_capacity_trees,
        "site_capacity_source": site_capacity_source,
        "site_capacity_status": "not_assessed" if site_capacity_trees is None else "provided_not_verified",
        "limit_meaning": "Maximum whole-tree count supported by this scenario calculation, not a site planting capacity.",
    }


def simulate_trees(block, tree_count, profile="B", net_canopy_fraction=1.0,
                   site_capacity_trees=None, site_capacity_source=None):
    validate_count(tree_count)
    tree = checked_profile(profile)
    parameters = block["tree_planting"]
    canopy, uhi = block["observed_canopy_pct"], block["observed_uhi"]
    limits = capacity_limits(canopy, parameters, profile, net_canopy_fraction,
                             site_capacity_trees, site_capacity_source)
    response = {
        "mb_code16": block["mb_code16"], "assumptions_version": ASSUMPTIONS["version"],
        "requested_trees": tree_count, "evaluated_trees": None, "tree_profile": profile,
        "mature_canopy_per_tree_m2": tree["mature_canopy_area_m2"],
        "net_canopy_fraction": net_canopy_fraction, "area_m2": parameters["area_m2"],
        "limits": limits, "horizon_label": "At maturity",
        "illustrative_horizon_years": ASSUMPTIONS["maturity"]["illustrative_horizon_years"],
        "maturity_is_guaranteed": False, "status": "unavailable", "reason_codes": [],
        "new_canopy_area_m2": None, "canopy_pct": None, "delta_canopy_pp": None,
        "predicted_uhi": None, "cooling_c": None,
        "feasibility_status": limits["site_capacity_status"],
        "notice": "Mature-canopy scenario assuming survival and the stated net canopy contribution. Planting locations and growth timing require site-specific assessment.",
    }
    has_uncertainty = "coefficient_uncertainty" in parameters
    if has_uncertainty:
        response["cooling_interval"] = None
        if block["status"] == "indicative":
            from coolchange.uncertainty import validate_coefficient_interval
            validate_coefficient_interval(parameters["coefficient_uncertainty"], parameters["simulation_slope"])
    # Reject whole-tree requests beyond capacity; never silently turn a tree into
    # a fractional crown by clipping the requested canopy to a percentage ceiling.
    if tree_count > limits["percentage_bound_max_trees"]:
        response["reason_codes"].append("exceeds_percentage_bound")
    if site_capacity_trees is not None and tree_count > site_capacity_trees:
        response["reason_codes"].append("exceeds_supplied_site_capacity")
    if response["reason_codes"]:
        return response
    new_area = tree_count * tree["mature_canopy_area_m2"] * net_canopy_fraction
    delta = new_area / parameters["area_m2"] * 100
    response.update(evaluated_trees=tree_count, new_canopy_area_m2=new_area,
                    canopy_pct=canopy + delta, delta_canopy_pp=delta)
    reasons = list(block["reason_codes"])
    if block["status"] != "indicative" and not reasons:
        reasons.append("invalid_local_fit")
    slope = parameters["simulation_slope"]
    estimate = evaluate_scenario(uhi, canopy, float("nan") if slope is None else slope, reasons,
                                 parameters["local_canopy_min_pct"], parameters["local_canopy_max_pct"], delta)
    for key in ("status", "reason_codes", "predicted_uhi", "cooling_c"):
        response[key] = estimate[key]
    if has_uncertainty:
        from coolchange.uncertainty import cooling_interval
        response["cooling_interval"] = cooling_interval(parameters["coefficient_uncertainty"], delta, response["status"])
    return response


def attach_planting(frame, payload):
    if len(frame) != len(payload["blocks"]):
        raise ValueError("Tree parameters and public blocks have different lengths")
    for row, block in zip(frame.itertuples(index=False), payload["blocks"]):
        if row.mb_code16 != block["mb_code16"]:
            raise ValueError("Tree parameters do not match block order")
        block["tree_planting"] = block_parameters(row)
    payload["planting_assumptions"] = ASSUMPTIONS
    payload["schema_version"] = 3
    payload["notice"] = "Indicative association at maturity. Site capacity is unknown unless separately supplied. No calibrated uncertainty intervals or local growth curve."
