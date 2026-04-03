/**
 * Photon geocoding API client.
 * Source: https://photon.komoot.io
 *
 * Uses Photon (NOT Nominatim) for autocomplete-compatible geocoding.
 * Nominatim's usage policy explicitly prohibits search-as-you-type.
 * Photon is also OSM-based, free, and has no API key requirement.
 */

/** A single geocoding result from the Photon API (GeoJSON Feature). */
export interface PhotonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    /** [longitude, latitude] — note: GeoJSON uses lon,lat order */
    coordinates: [number, number];
  };
  properties: {
    name: string;
    country: string;
    /** ISO 2-letter country code (e.g., 'BR', 'US') */
    countrycode: string;
    state?: string;
    city?: string;
    osm_type: string;
    osm_id: number;
    /** Location type: 'city', 'state', 'country', etc. */
    type: string;
  };
}

interface PhotonResponse {
  type: 'FeatureCollection';
  features: PhotonFeature[];
}

/**
 * Search for locations using the Photon geocoding API.
 *
 * @param query - Search string (city, state, country, etc.)
 * @param limit - Maximum number of results (default 5)
 * @returns Array of PhotonFeature results, or empty array on error
 */
export async function searchLocations(query: string, limit = 5): Promise<PhotonFeature[]> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`;
    const res = await fetch(url);
    const data: PhotonResponse = await res.json();
    return data.features ?? [];
  } catch (err) {
    console.warn('[photonGeocoder] Failed to search locations:', err);
    return [];
  }
}
