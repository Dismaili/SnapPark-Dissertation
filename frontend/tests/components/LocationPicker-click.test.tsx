import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Make the Google Maps loader appear ready and capture the onClick handler
// so we can drive it without a real map.
let capturedOnClick: ((e: any) => void) | null = null;
vi.mock('@react-google-maps/api', () => ({
  GoogleMap: ({ onClick, children }: any) => {
    capturedOnClick = onClick;
    return <div data-testid="map">{children}</div>;
  },
  Marker: () => <div data-testid="marker" />,
  useJsApiLoader: () => ({ isLoaded: true, loadError: undefined }),
}));

vi.mock('lucide-react', () => {
  const Stub = () => <span />;
  return { MapPin: Stub, Loader2: Stub, AlertTriangle: Stub };
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'fake';
  capturedOnClick = null;
});

describe('LocationPicker — onClick flow', () => {
  it('drops a pin, immediately calls onChange with coordinate-string label, then refines via geocoder', async () => {
    // Stub the geocoder so the async refinement path runs.
    (globalThis as any).window.google = {
      maps: {
        Geocoder: class {
          async geocode() {
            return { results: [{ formatted_address: '123 Test Street, Athens' }] };
          }
        },
      },
    };

    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);

    expect(capturedOnClick).not.toBeNull();
    await capturedOnClick!({ latLng: { lat: () => 42.5, lng: () => 21.1 } });

    // First synchronous call uses the coordinate string.
    expect(onChange).toHaveBeenNthCalledWith(1, { lat: 42.5, lng: 21.1 }, '42.50000, 21.10000');
    // Second call uses the geocoded label.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ lat: 42.5, lng: 21.1 }, '123 Test Street, Athens');
    });
  });

  it('falls back to the coordinate string when the geocoder rejects', async () => {
    (globalThis as any).window.google = {
      maps: {
        Geocoder: class { async geocode() { throw new Error('quota'); } },
      },
    };
    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);
    await capturedOnClick!({ latLng: { lat: () => 0.123456, lng: () => 1.234567 } });
    // No second call with a different label — the first label sticks.
    expect(onChange).toHaveBeenCalledWith({ lat: 0.123456, lng: 1.234567 }, '0.12346, 1.23457');
  });

  it('ignores clicks without latLng (defensive against API edge cases)', async () => {
    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);
    await capturedOnClick!({ latLng: null });
    expect(onChange).not.toHaveBeenCalled();
  });
});
