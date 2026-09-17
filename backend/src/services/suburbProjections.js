const pool = require("../db/pool");
const { projectionUnavailable } = require("../http/errors");

// Read every warming level together: neither the legend nor colour domain is
// derived from the selected suburb or level. NULL upper bounds remain open.
const bandsSql = `/* projectionBands */
SELECT days_label, days_lower, days_upper
FROM mesh_block_projection
GROUP BY days_label, days_lower, days_upper
ORDER BY days_lower, days_upper NULLS LAST, days_label`;

const suburbsSql = `/* suburbProjections */
WITH counts AS (
  SELECT m.sa2_code16, p.warming_level, p.days_label, p.days_lower,
         p.days_upper, COUNT(*) AS n
  FROM mesh_block_projection p JOIN mesh_block m USING (mb_code16)
  GROUP BY m.sa2_code16, p.warming_level, p.days_label, p.days_lower, p.days_upper
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY sa2_code16, warming_level
    ORDER BY n DESC, days_lower DESC, days_upper DESC NULLS FIRST, days_label
  ) AS rank FROM counts
), predominant AS (
  SELECT * FROM ranked WHERE rank = 1
), targets AS (
  SELECT s.sa2_code16, s.geom, l.warming_level
  FROM map_suburb_geometry s
  CROSS JOIN (VALUES (1.2), (1.5), (2.0), (3.0)) l(warming_level)
)
SELECT RTRIM(t.sa2_code16) AS sa2_code16, t.warming_level,
       COALESCE(p.days_label, donor.days_label) AS days_label,
       COALESCE(p.days_lower, donor.days_lower) AS days_lower,
       CASE WHEN p.sa2_code16 IS NOT NULL THEN p.days_upper ELSE donor.days_upper END AS days_upper,
       RTRIM(COALESCE(p.sa2_code16, donor.sa2_code16)) AS source_sa2_code16
FROM targets t
LEFT JOIN predominant p USING (sa2_code16, warming_level)
LEFT JOIN LATERAL (
  SELECT d.* FROM predominant d
  JOIN map_suburb_geometry g ON g.sa2_code16 = d.sa2_code16
  WHERE p.sa2_code16 IS NULL AND d.warming_level = t.warming_level
    AND d.sa2_code16 <> t.sa2_code16
  ORDER BY
    CASE WHEN ST_Touches(t.geom, g.geom) THEN 0 ELSE 1 END,
    CASE WHEN ST_Touches(t.geom, g.geom) THEN
      ST_Length(ST_Intersection(ST_Boundary(t.geom), ST_Boundary(g.geom))::geography)
    ELSE 0 END DESC,
    ST_Distance(t.geom::geography, g.geom::geography), d.sa2_code16
  LIMIT 1
) donor ON p.sa2_code16 IS NULL
ORDER BY t.sa2_code16, t.warming_level`;

let cached = null;
function resetProjectionCache() { cached = null; }

function shapeBand(row) {
  return {
    days_label: row.days_label,
    days_lower: row.days_lower == null ? null : Number(row.days_lower),
    days_upper: row.days_upper == null ? null : Number(row.days_upper),
  };
}

async function getSuburbProjections() {
  if (!cached) {
    cached = (async () => {
      try {
        const [bands, suburbs] = await Promise.all([pool.query(bandsSql), pool.query(suburbsSql)]);
        if (!bands.rows.length || !suburbs.rows.length) throw projectionUnavailable();
        const classes = bands.rows.map(shapeBand);
        const endpoints = classes.flatMap(b => [b.days_lower, b.days_upper]).filter(v => v != null);
        return {
          scale: { min: Math.min(...endpoints), max: Math.max(...endpoints) },
          bands: classes,
          suburbs: suburbs.rows.map(row => ({
            sa2_code16: row.sa2_code16.trim(),
            warming_level: Number(row.warming_level),
            ...shapeBand(row),
            // Retain provenance for auditing; the map does not display a donor label.
            source_sa2_code16: row.source_sa2_code16?.trim() ?? null,
          })),
        };
      } catch {
        cached = null; // A failed read must be retryable, never cached as success.
        throw projectionUnavailable();
      }
    })();
  }
  return cached;
}

module.exports = { getSuburbProjections, resetProjectionCache, bandsSql, suburbsSql };
