import { create } from 'zustand';

/**
 * Basemap detail preference. "dark" is the Trace aesthetic (minimal, lime pops);
 * "liberty" is the information-dense OSM style (place names, POIs, water) for
 * users who want Google-Maps-like orientation. Both from OpenFreeMap, keyless.
 */
export const MAP_STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
} as const;

export type MapStyleKey = keyof typeof MAP_STYLES;

type MapStyleState = {
  styleKey: MapStyleKey;
  toggle: () => void;
};

export const useMapStyle = create<MapStyleState>((set) => ({
  styleKey: 'dark',
  toggle: () => set((s) => ({ styleKey: s.styleKey === 'dark' ? 'liberty' : 'dark' })),
}));
