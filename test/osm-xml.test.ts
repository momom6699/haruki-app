import { describe, expect, it } from 'vitest';
import { osmXmlToOverpass } from '../scripts/lib/osm-xml.mjs';

type Element = { type: string; tags: Record<string, string>; geometry?: { lat: number; lon: number }[] };

/**
 * openstreetmap.org の Export が返す XML を、Overpass の JSON と同じ形へ揃える読み取り。
 * ここが黙って空を返すと「実データを渡したのに地物が増えない」という分かりにくい失敗になる。
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
 <bounds minlat="35.68" minlon="139.75" maxlat="35.69" maxlon="139.76"/>
 <node id="1" lat="35.6850" lon="139.7520"/>
 <node id="2" lat="35.6860" lon="139.7530"/>
 <node id="3" lat="35.6870" lon="139.7540"/>
 <node id="9" lat="35.6800" lon="139.7500">
  <tag k="amenity" v="cafe"/>
 </node>
 <way id="10">
  <nd ref="1"/>
  <nd ref="2"/>
  <nd ref="3"/>
  <tag k="highway" v="primary"/>
  <tag k="name" v="内堀通り &amp; Uchibori"/>
 </way>
 <way id="11">
  <nd ref="1"/>
  <tag k="natural" v="water"/>
 </way>
</osm>`;

describe('osmXmlToOverpass', () => {
  const elements: Element[] = osmXmlToOverpass(XML).elements;
  const ways = elements.filter((e) => e.type === 'way');

  it('keeps ways with their geometry resolved from node refs', () => {
    expect(ways[0].tags.highway).toBe('primary');
    expect(ways[0].geometry).toEqual([
      { lat: 35.685, lon: 139.752 },
      { lat: 35.686, lon: 139.753 },
      { lat: 35.687, lon: 139.754 },
    ]);
  });

  it('decodes entities in tag values', () => {
    expect(ways[0].tags.name).toBe('内堀通り & Uchibori');
  });

  it('drops ways too short to draw, and untagged nodes', () => {
    expect(ways).toHaveLength(1);
    expect(elements.filter((e) => e.type === 'node')).toHaveLength(1);
  });
});
