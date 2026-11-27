#!/usr/bin/env python3
"""Match named OpenStreetMap building outlines to PLATEAU building IDs.

Usage: uv run --with osmium==4.3.2 --with shapely==2.2.0 \
    python tools/build-building-names.py JAPAN.osm.pbf data/building-shapes OUTPUT.json
"""
import argparse
from collections import defaultdict
import gzip
from hashlib import sha256
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory

import osmium
from shapely import STRtree, from_wkb, make_valid, union_all
from shapely.geometry import Polygon
from shapely.errors import GEOSException


# The smaller and the larger footprint must both be substantially covered.
MIN_COVERAGE = 0.72
MIN_IOU = 0.60
MIN_LEAD = 0.10


def read_plateau(folder):
    index_bytes = (folder / 'index.json').read_bytes()
    index = json.loads(index_bytes)
    buildings = []
    seen = set()
    for mesh, (digest, _, _) in index['parts'].items():
        archive = (folder / (mesh + '.json.gz')).read_bytes()
        if not sha256(archive).hexdigest().startswith(digest):
            raise ValueError(f'PLATEAU mesh {mesh} does not match its index')
        rows = json.loads(gzip.decompress(archive))['buildings']
        for building_id, name, lat, lon, _, _, _, columns in rows:
            if building_id in seen:
                continue
            seen.add(building_id)
            lon_scale = 10 * 111320 * math.cos(math.radians(lat))
            lat_scale = 10 * 110540
            rings = []
            for _, coords in columns:
                if len(coords) < 6:
                    continue
                ring = Polygon([(lon + x / lon_scale, lat + y / lat_scale)
                                for x, y in zip(coords[::2], coords[1::2])])
                if not ring.is_valid:
                    ring = make_valid(ring)
                if ring.area:
                    rings.append(ring)
            if rings:
                geometry = union_all(rings)
                if geometry.area:
                    buildings.append((building_id, bool(name and name.strip()), geometry))
    return buildings, sha256(index_bytes).hexdigest()


def building_name(tags):
    if tags.get('building') in (None, 'no', 'construction', 'roof'):
        return ''
    if tags.get('building:part', 'no') != 'no' or tags.get('area', 'yes') == 'no':
        return ''
    name = tags.get('name:ja', '').strip() or tags.get('name', '').strip()
    return name if len(name) <= 200 else ''


def extract_named_buildings(pbf, extract):
    # Geometries only need the nodes of named ways and the members of named relations.
    objects = (osmium.FileProcessor(pbf, osmium.osm.WAY | osmium.osm.RELATION)
               .with_filter(osmium.filter.KeyFilter('building'))
               .with_filter(osmium.filter.KeyFilter('name', 'name:ja')))
    with osmium.BackReferenceWriter(extract, ref_src=pbf) as writer:
        for obj in objects:
            if building_name(obj.tags):
                writer.add(obj)


def named_osm_buildings(pbf):
    factory = osmium.geom.WKBFactory()
    only_buildings = osmium.filter.KeyFilter('building')
    only_names = osmium.filter.KeyFilter('name', 'name:ja')
    areas_only = osmium.filter.EntityFilter(osmium.osm.AREA)
    objects = (osmium.FileProcessor(pbf).with_locations()
               .with_areas(osmium.filter.KeyFilter('building'), osmium.filter.KeyFilter('name', 'name:ja'))
               .with_filter(areas_only).with_filter(only_buildings).with_filter(only_names))
    for obj in objects:
        name = building_name(obj.tags)
        if not name:
            continue
        try:
            polygon = from_wkb(factory.create_multipolygon(obj))
        except (RuntimeError, ValueError, GEOSException):
            continue
        if not polygon.is_valid:
            polygon = make_valid(polygon)
        if polygon.area:
            kind = 'way' if obj.from_way() else 'relation'
            yield (name, f'{kind}/{obj.orig_id()}', polygon)


def match_osm(plateau, osm):
    shapes = [row[2] for row in plateau]
    tree = STRtree(shapes)
    matches = defaultdict(dict)
    for name, osm_id, outline in osm:
        size = outline.area
        rankings = []
        for index in tree.query(outline, predicate='intersects'):
            shape = shapes[index]
            area = shape.area
            if min(size, area) < MIN_COVERAGE * max(size, area):
                continue
            shared = outline.intersection(shape).area
            iou = shared / (size + area - shared)
            if shared >= 0.6 * max(size, area):
                rankings.append((iou, shared / max(size, area), int(index)))
        rankings.sort(reverse=True)
        if not rankings:
            continue
        iou, coverage, index = rankings[0]
        if iou < MIN_IOU or coverage < MIN_COVERAGE:
            continue
        if len(rankings) > 1 and iou - rankings[1][0] < MIN_LEAD:
            continue
        building_id, already_named, _ = plateau[index]
        if already_named:
            continue
        current = matches[building_id].get(name)
        if current is None or iou > current[0]:
            matches[building_id][name] = (iou, osm_id)
    return {building_id: [name, info[1]] for building_id, names in sorted(matches.items())
            if len(names) == 1 for name, info in names.items()}


def build_from_extract(osm, extract, plateau_folder, output):
    timestamp = osmium.FileProcessor(osm).header.get('osmosis_replication_timestamp')
    plateau, plateau_digest = read_plateau(plateau_folder)
    print(f'Matching OSM buildings against {len(plateau)} PLATEAU outlines', flush=True)
    names = match_osm(plateau, named_osm_buildings(extract))
    if not names:
        raise ValueError('No building names matched the PLATEAU dataset')
    result = {
        'format': 'AstroNotes OSM building name matches v1',
        'attribution': '© OpenStreetMap contributors (ODbL 1.0) https://www.openstreetmap.org/copyright',
        'osmSource': 'https://download.geofabrik.de/asia/japan/',
        'osmTimestamp': timestamp,
        'plateauSource': '3D都市モデル（Project PLATEAU）国土交通省 を加工して作成（公共データ利用規約 1.0）',
        'plateauIndexSha256': plateau_digest,
        'names': names,
    }
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Matched {len(names)} building names ({output.stat().st_size} bytes)', flush=True)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('osm', type=Path)
    args.add_argument('plateau', type=Path)
    args.add_argument('output', type=Path)
    options = args.parse_args()
    with TemporaryDirectory(prefix='astronotes-named-buildings-') as temporary:
        extract = Path(temporary) / 'named-buildings.osm.pbf'
        print('Extracting named OpenStreetMap buildings', flush=True)
        extract_named_buildings(options.osm, extract)
        build_from_extract(options.osm, extract, options.plateau, options.output)


if __name__ == '__main__':
    main()
