"use client";

import { useCallback, useRef, useState } from "react";
import {
  GoogleMap,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";
import { MapPin, Loader2, AlertTriangle } from "lucide-react";

const MAP_CONTAINER_STYLE = { width: "100%", height: "280px" };

// Default centre — Athens, Greece (fits the dissertation's target region).
const DEFAULT_CENTER = { lat: 37.9838, lng: 23.7275 };

export type LatLng = { lat: number; lng: number };

interface Props {
  value: LatLng | null;
  onChange: (coords: LatLng, label: string) => void;
}

/**
 * Interactive map that lets the user drop a pin to mark where the violation
 * occurred. Clicking anywhere on the map places (or moves) the marker and
 * reverse-geocodes the position to a human-readable address label.
 *
 * Requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to be set.
 */
export function LocationPicker({ value, onChange }: Props) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries: ["geocoding"],
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onMapClick = useCallback(
    async (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const coords: LatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };

      // Optimistically update the pin position
      onChange(coords, `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);

      // Reverse-geocode to a human-readable label
      if (typeof window !== "undefined" && window.google?.maps?.Geocoder) {
        setGeocoding(true);
        const geocoder = new window.google.maps.Geocoder();
        try {
          const result = await geocoder.geocode({ location: coords });
          const label =
            result.results[0]?.formatted_address ??
            `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
          onChange(coords, label);
        } catch {
          // If reverse-geocode fails just keep the coordinate string
        } finally {
          setGeocoding(false);
        }
      }
    },
    [onChange],
  );

  if (!apiKey) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Map unavailable — set{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
          in your environment to enable the location picker.
        </span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Failed to load Google Maps. Check your API key.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading map…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={value ?? DEFAULT_CENTER}
          zoom={value ? 16 : 12}
          onClick={onMapClick}
          onLoad={onMapLoad}
          options={{
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
          }}
        >
          {value && <Marker position={value} />}
        </GoogleMap>
      </div>

      {value ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-600">
          <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          {geocoding ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Resolving address…
            </span>
          ) : (
            <span>
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </span>
          )}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          Click on the map to drop a pin at the exact location of the violation.
        </p>
      )}
    </div>
  );
}
