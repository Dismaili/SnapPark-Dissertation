import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub the Google Maps loader so the component can render the various
// "not ready" states without ever touching the real SDK.
const mockUseJsApiLoader = vi.fn();
vi.mock('@react-google-maps/api', () => ({
  GoogleMap: ({ children }: any) => <div data-testid="map">{children}</div>,
  Marker: () => <div data-testid="marker" />,
  useJsApiLoader: () => mockUseJsApiLoader(),
}));

vi.mock('lucide-react', () => {
  const Stub = () => <span />;
  return { MapPin: Stub, Loader2: Stub, AlertTriangle: Stub };
});

beforeEach(() => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
});

describe('LocationPicker', () => {
  it('renders the missing-API-key warning when env is not set', async () => {
    mockUseJsApiLoader.mockReturnValue({ isLoaded: false, loadError: undefined });
    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    render(<LocationPicker value={null} onChange={() => {}} />);
    expect(screen.getByText(/Map unavailable/i)).toBeInTheDocument();
  });

  it('renders the load-error state when the SDK fails', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'fake';
    mockUseJsApiLoader.mockReturnValue({ isLoaded: false, loadError: new Error('boom') });
    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    render(<LocationPicker value={null} onChange={() => {}} />);
    expect(screen.getByText(/Failed to load Google Maps/i)).toBeInTheDocument();
  });

  it('renders the loading state while the SDK is initialising', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'fake';
    mockUseJsApiLoader.mockReturnValue({ isLoaded: false, loadError: undefined });
    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    render(<LocationPicker value={null} onChange={() => {}} />);
    expect(screen.getByText(/Loading map/i)).toBeInTheDocument();
  });

  it('renders the map + helper when ready (no pin yet)', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'fake';
    mockUseJsApiLoader.mockReturnValue({ isLoaded: true, loadError: undefined });
    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    render(<LocationPicker value={null} onChange={() => {}} />);
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(screen.getByText(/Click on the map/i)).toBeInTheDocument();
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument();
  });

  it('renders a marker + coordinates when value is provided', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'fake';
    mockUseJsApiLoader.mockReturnValue({ isLoaded: true, loadError: undefined });
    const { LocationPicker } = await import('../../src/components/ui/LocationPicker');
    render(<LocationPicker value={{ lat: 42.5, lng: 21.1 }} onChange={() => {}} />);
    expect(screen.getByTestId('marker')).toBeInTheDocument();
    expect(screen.getByText(/42\.50000, 21\.10000/)).toBeInTheDocument();
  });
});
