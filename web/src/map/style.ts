// Dark "Chennai at 2 AM" basemap from the Protomaps PMTiles extract, using the design tokens.
import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps'
import type { StyleSpecification } from 'maplibre-gl'
import { DATA_BASE, DOMAIN_BBOX, TOKENS } from '../config'

function flavor(): Flavor {
  const f = { ...namedFlavor('dark') }
  const sky = TOKENS.stormSky
  const asphalt = TOKENS.wetAsphalt
  Object.assign(f, {
    background: '#0B2029',   // same as water: no seam at the edge of the basemap extract
    earth: sky,
    park_a: '#16363F', park_b: '#16363F', wood_a: '#16363F', wood_b: '#16363F', scrub_a: '#163540', scrub_b: '#163540',
    hospital: '#183843', industrial: '#152F3A', school: '#16343F', pedestrian: '#18343E', aerodrome: '#16333E',
    zoo: '#16363F', military: '#152F3A', beach: '#1A3A44', sand: '#1A3A44', glacier: sky,
    water: '#0B2029',
    buildings: '#1C3A46',
    minor_service: '#2A424D', minor_a: '#304A55', minor_b: '#304A55', link: '#344E59', other: '#2A424D',
    major: asphalt, highway: '#4A626D',
    minor_casing: sky, minor_service_casing: sky, link_casing: sky, major_casing_early: sky, major_casing_late: sky,
    highway_casing_early: sky, highway_casing_late: sky,
    bridges_minor: '#304A55', bridges_major: asphalt, bridges_highway: '#4A626D', bridges_link: '#344E59', bridges_other: '#2A424D',
    railway: '#2C4550', boundaries: '#2C4550',
    roads_label_minor: '#8FA2AA', roads_label_minor_halo: sky, roads_label_major: '#A9B8BE', roads_label_major_halo: sky,
    subplace_label: '#9FB0B6', subplace_label_halo: sky, city_label: TOKENS.rainGrey, city_label_halo: sky,
    ocean_label: '#4E6A75', address_label: '#7D9099', address_label_halo: sky,
  })
  return f
}

export function baseStyle(): StyleSpecification {
  const base = layers('protomaps', flavor(), { lang: 'en' })
    // our own 3D buildings replace the flat ones; POI icons stay off for a quiet map
    .filter((l) => l.id !== 'buildings' && !l.id.startsWith('pois'))
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
        tiles: [new URL(`${DATA_BASE}/terrain/{z}/{x}/{y}.png`, window.location.href).href],
        tileSize: 256, encoding: 'mapbox', minzoom: 8, maxzoom: 14, bounds: DOMAIN_BBOX,
        attribution: 'Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus 2014–2018, provided under COPERNICUS by the EU and ESA',
      },
    },
    layers: [
      ...base,
      {
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'protomaps',
        'source-layer': 'buildings',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'height'], 8],
            4, '#2E4651', 12, TOKENS.wetAsphalt, 30, '#4C5F63', 60, '#5E6A63',
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      },
    ],
    sky: {
      'sky-color': '#0A1C24', 'horizon-color': '#1B3B47', 'fog-color': '#14303D',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.3, 'atmosphere-blend': 0.4,
    },
  } as StyleSpecification
}
