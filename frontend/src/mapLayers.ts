import { ColorScheme } from '@vis.gl/react-google-maps'
import { useState } from 'react'

// Which base map is shown and which Google overlays are drawn on top.
// Saved in this browser so the choice survives a reload.

export type MapStyle = 'dark' | 'light' | 'satellite' | 'hybrid' | 'terrain'

export type MapLayers = {
  style: MapStyle
  traffic: boolean // live traffic on the roads
  transit: boolean // bus and rail lines
}

export const DEFAULT_LAYERS: MapLayers = { style: 'dark', traffic: false, transit: false }

/**
 * How each style maps onto Google's map type and color scheme.
 * Changing the color scheme rebuilds the map, so the imagery styles reuse dark.
 */
export const MAP_STYLES: Record<MapStyle, { label: string; mapTypeId: string; colorScheme: ColorScheme }> = {
  dark: { label: 'Dark', mapTypeId: 'roadmap', colorScheme: ColorScheme.DARK },
  light: { label: 'Light', mapTypeId: 'roadmap', colorScheme: ColorScheme.LIGHT },
  satellite: { label: 'Satellite', mapTypeId: 'satellite', colorScheme: ColorScheme.DARK },
  hybrid: { label: 'Hybrid', mapTypeId: 'hybrid', colorScheme: ColorScheme.DARK },
  terrain: { label: 'Terrain', mapTypeId: 'terrain', colorScheme: ColorScheme.LIGHT },
}

const STORAGE_KEY = 'doorstep.mapLayers'

function load(): MapLayers {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<MapLayers>
    return {
      style: saved.style && saved.style in MAP_STYLES ? saved.style : DEFAULT_LAYERS.style,
      traffic: saved.traffic === true,
      transit: saved.transit === true,
    }
  } catch {
    return DEFAULT_LAYERS
  }
}

function save(layers: MapLayers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layers))
  } catch {
    // Storage blocked: the choice just won't survive a reload.
  }
}

export function useMapLayers() {
  const [layers, setLayers] = useState<MapLayers>(load)
  const update = (next: MapLayers) => {
    setLayers(next)
    save(next)
  }
  return [layers, update] as const
}
