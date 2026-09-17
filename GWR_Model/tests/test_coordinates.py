"""Regression coverage for coordinate corruption and silent join/data loss."""
import unittest

import numpy as np
import pandas as pd
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.ops import transform

from coolchange.coordinates import (TO_METRES, TO_WGS84, polygon_centroid,
                         join_training_points, validate_points)


class CoordinateTests(unittest.TestCase):
    def to_geojson(self, geometry):
        return mapping(transform(TO_WGS84.transform, geometry))

    def assert_centre(self, geometry, expected):
        lon, lat = polygon_centroid(self.to_geojson(geometry))
        x, y = TO_METRES.transform(lon, lat)
        self.assertAlmostEqual(x, expected[0], delta=0.002)
        self.assertAlmostEqual(y, expected[1], delta=0.002)

    def test_small_polygon_does_not_lose_precision(self):
        x, y = 2500000, 2400000
        p = Polygon([(x,y),(x+1,y),(x+1,y+1),(x,y+1)])
        self.assert_centre(p, (x+.5,y+.5))

    def test_hole_contributes_negative_area(self):
        x,y = 2500000,2400000
        p = Polygon([(x,y),(x+100,y),(x+100,y+100),(x,y+100)],
                    [[(x+10,y+10),(x+30,y+10),(x+30,y+30),(x+10,y+30)]])
        centre = (10000*50-400*20)/9600
        self.assert_centre(p,(x+centre,y+centre))

    def test_all_multipolygon_parts_contribute(self):
        x,y = 2500000,2400000
        a = Polygon([(x,y),(x+10,y),(x+10,y+10),(x,y+10)])
        b = Polygon([(x+100,y),(x+120,y),(x+120,y+20),(x+100,y+20)])
        p = MultiPolygon([a,b])
        self.assert_centre(p,(x+89,y+9))
        self.assert_centre(MultiPolygon([b,a]),(x+89,y+9))

    def test_invalid_geometry_is_rejected(self):
        for geometry in ({}, {"type":"Polygon","coordinates":[]},
                         {"type":"Polygon","coordinates":[[[145,-38],[146,-37],[145,-37],[146,-38],[145,-38]]]}):
            with self.assertRaises(ValueError):
                polygon_centroid(geometry)

    def test_negligible_topology_repair_is_explicit_and_logged(self):
        x,y = 2500000,2400000
        a=Polygon([(x,y),(x+10,y),(x+10,y+10),(x,y+10)])
        b=Polygon([(x+10-1e-6,y+.1),(x+20,y+.1),(x+20,y+10.1),(x+10-1e-6,y+10.1)])
        geometry=self.to_geojson(MultiPolygon([a,b]))
        with self.assertRaises(ValueError): polygon_centroid(geometry)
        repairs=[]
        polygon_centroid(geometry,repairs=repairs)
        self.assertEqual(len(repairs),1)
        self.assertLess(repairs[0]["relative_area_change"],1e-6)

    def test_large_topology_repair_is_rejected_even_with_audit(self):
        geometry={"type":"Polygon","coordinates":[[[145,-38],[146,-37],[145,-37],[146,-38],[145,-38]]]}
        with self.assertRaises(ValueError): polygon_centroid(geometry,repairs=[])

    def points(self):
        return pd.DataFrame({"mb_code16":["20015920000","20015930000"],
                             "lon":[145.,145.01],"lat":[-38.,-38.01]})

    def test_nonfinite_and_out_of_region_points_rejected(self):
        for value in (np.nan, np.inf, 230.447917):
            points=self.points(); points.loc[0,"lon"]=value
            with self.assertRaises(ValueError): validate_points(points)

    def test_duplicate_and_missing_ids_rejected(self):
        points=self.points()
        with self.assertRaises(ValueError): validate_points(pd.concat([points,points]))
        with self.assertRaises(ValueError): validate_points(points,["20015920000"])
        points.loc[0,"mb_code16"]=""
        with self.assertRaises(ValueError): validate_points(points)

    def test_join_keeps_rows_with_missing_unrelated_equity_fields(self):
        points=self.points()
        blocks=pd.DataFrame({"mb_code16":points.mb_code16, "uhi_mean":[8.,9.],
                             "canopy_pct":[10.,20.],"irsd_score":[np.nan,1000.]})
        joined=join_training_points(blocks,points.iloc[::-1])
        self.assertEqual(joined.mb_code16.tolist(),blocks.mb_code16.tolist())
        self.assertEqual(len(joined),2)
        with self.assertRaises(ValueError): join_training_points(blocks,points.iloc[:1])
        blocks.loc[0,"canopy_pct"]=np.inf
        with self.assertRaises(ValueError): join_training_points(blocks,points)


if __name__ == "__main__":
    unittest.main()
