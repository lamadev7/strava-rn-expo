import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { create } from 'zustand';

/**
 * Basemap preference, picked via the segmented switcher:
 * - "light"     — the Trace aesthetic (warm minimal, orange pops). OpenFreeMap Positron, keyless.
 * - "dark"      — near-black basemap; also forced during the cinematic replay. OpenFreeMap, keyless.
 * - "liberty"   — information-dense OSM style (place names, POIs). OpenFreeMap, keyless.
 * - "satellite" — Esri World Imagery draped over AWS Terrarium 3D terrain.
 *   Both free with attribution, keyless. Photorealistic 3D buildings are NOT
 *   available free anywhere (Google 3D Tiles is paid, Apple is MapKit-only).
 */

/** Esri World Imagery + Terrarium DEM as an inline MapLibre style */
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    terrainSource: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 15,
      encoding: 'terrarium',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0B0F0B' } },
    { id: 'satellite', type: 'raster', source: 'satellite' },
  ],
  terrain: { source: 'terrainSource', exaggeration: 1.15 },
};

export type MapStyleKey = 'light' | 'dark' | 'liberty' | 'satellite';

export const MAP_STYLES: Record<MapStyleKey, string | StyleSpecification> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  satellite: SATELLITE_STYLE,
};

type MapStyleState = {
  styleKey: MapStyleKey;
  setStyle: (key: MapStyleKey) => void;
};

export const useMapStyle = create<MapStyleState>((set) => ({
  styleKey: 'light',
  setStyle: (styleKey) => set({ styleKey }),
}));
