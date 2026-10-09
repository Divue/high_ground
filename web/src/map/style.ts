// Dark "Chennai at 2 AM" basemap from the Protomaps PMTiles extract, using the design tokens.
import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps'
import type { StyleSpecification } from 'maplibre-gl'
import { DATA_BASE, DOMAIN_BBOX } from '../config'

function flavor(): Flavor {
  const f = { ...namedFlavor('dark') }
  // Night palette v2: a near-black, blue-tinged city so the floodwater is the brightest thing on the map.
  const ink = '#08141A'
  Object.assign(f, {
    background: '#050D12',   // the sea and the edge of the basemap extract
    earth: '#0A161C',
    park_a: '#0C1C21', park_b: '#0C1C21', wood_a: '#0C1C21', wood_b: '#0C1C21', scrub_a: '#0C1B20', scrub_b: '#0C1B20',
    hospital: '#0F1F26', industrial: '#0B181E', school: '#0E1D24', pedestrian: '#0F1E25', aerodrome: '#0D1B21',
    zoo: '#0C1C21', military: '#0B181E', beach: '#111F25', sand: '#111F25', glacier: ink,
    water: '#04090C',        // lakes and rivers darker than land, so they never read as flooding
    buildings: '#15252C',
    minor_service: '#16252C', minor_a: '#1C2D35', minor_b: '#1C2D35', link: '#2A3E48', other: '#16252C',
    major: '#2F4652', highway: '#41606F',     // wet asphalt catching the street lights
    minor_casing: ink, minor_service_casing: ink, link_casing: ink, major_casing_early: ink, major_casing_late: ink,
    highway_casing_early: ink, highway_casing_late: ink,
    bridges_minor: '#1C2D35', bridges_major: '#2F4652', bridges_highway: '#41606F', bridges_link: '#2A3E48', bridges_other: '#16252C',
    railway: '#1F3039', boundaries: '#1F3039',
    roads_label_minor: '#7C8E96', roads_label_minor_halo: ink, roads_label_major: '#9AABB2', roads_label_major_halo: ink,
    subplace_label: '#66798280', subplace_label_halo: ink, city_label: '#C9D4D8', city_label_halo: ink,
    runway: '#16252C',
    ocean_label: '#3D525C', address_label: '#6E8088', address_label_halo: ink,
  })
  return f
}

/** Required by the Copernicus DEM licence wherever the terrain or anything derived from it is shown. */
export const COPERNICUS_NOTICE = 'Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus 2014–2018, provided under COPERNICUS by the EU and ESA'

export function baseStyle(): StyleSpecification {
  const base = layers('protomaps', flavor(), { lang: 'en' })
    // our own 3D buildings replace the flat ones; POI icons stay off for a quiet map
    // no POIs, no highway shields (black badges everywhere compete with the water)
    .filter((l) => l.id !== 'buildings' && !l.id.startsWith('pois') && l.id !== 'roads_shields')
    // sentence case everywhere: no all-caps neighbourhood labels
    .map((l) => (l.type === 'symbol' ? { ...l, layout: { ...(l.layout ?? {}), 'text-transform': 'none' } } : l)) as ReturnType<typeof layers>
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/dark',
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${new URL(`${DATA_BASE}/basemap/chennai.pmtiles`, window.location.href).href}`,
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
      terrain: {
        type: 'raster-dem',
        // keep the {z}/{x}/{y} braces literal (new URL() would percent-encode them)
        tiles: [`${new URL(`${DATA_BASE}/terrain/`, window.location.href).href}{z}/{x}/{y}.png`],
        tileSize: 256, encoding: 'mapbox', minzoom: 8, maxzoom: 14, bounds: DOMAIN_BBOX,
        attribution: COPERNICUS_NOTICE,
      },
    },
    layers: [
      ...base.filter((l) => l.type !== 'symbol'),
      {
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'protomaps',
        'source-layer': 'buildings',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'height'], 8],
            4, '#17262D', 12, '#1D2F37', 30, '#253A44', 60, '#2E4652',
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
          // the city rises in as you come down, instead of popping in
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.9],
          'fill-extrusion-vertical-gradient': true,
        },
      },
      // labels after the 3D buildings so names are never cut through
      ...base.filter((l) => l.type === 'symbol'),
    ],
    // a storm night: dark sky over a misty horizon, so the far city fades into rain haze
    sky: {
      'sky-color': '#02070A', 'horizon-color': '#1F3946', 'fog-color': '#0C1B22',
      'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0.6,
    },
    // a cool moonlight from the upper left: walls facing it read lighter, so buildings look solid
    light: { anchor: 'viewport', color: '#DCEAF2', intensity: 0.5, position: [1.3, 210, 35] },
  } as StyleSpecification
}
