"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiUploadImage } from "@/lib/api";
import type { AnalyzeResponse } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { LocationPicker, type LatLng } from "@/components/ui/LocationPicker";
import {
  Camera,
  Loader2,
  ImageIcon,
  X,
  AlertTriangle,
  CheckCircle2,
  Car,
  MapPin,
} from "lucide-react";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [licensePlate, setLicensePlate] = useState("");
  const [pinCoords, setPinCoords] = useState<LatLng | null>(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPick = (f: File | null) => {
    setError(null);
    setResult(null);
    if (!f) { setFile(null); return; }
    if (!ACCEPTED.includes(f.type)) {
      setError("Unsupported file type. Use JPEG, PNG, or WebP.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File is too large. Maximum size is 10 MB.");
      return;
    }
    setFile(f);
  };

  const onLocationChange = useCallback((coords: LatLng, label: string) => {
    setPinCoords(coords);
    setLocationLabel(label);
  }, []);

  const onSubmit = async () => {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiUploadImage<AnalyzeResponse>(
        "/violations/analyze",
        file,
        {
          licensePlate:  licensePlate.trim() || undefined,
          latitude:      pinCoords?.lat,
          longitude:     pinCoords?.lng,
          locationLabel: locationLabel || undefined,
        },
      );
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.message ||
            `Analysis failed (${err.status}). Please try a different image.`,
        );
      } else {
        setError("Analysis failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Submit a new report"
        description="Take a clear photo of the parked vehicle. We'll pre-check it for quality before sending it to the AI."
      />

      <div className="grid gap-6 p-4 sm:p-6 md:p-8 lg:grid-cols-2">
        {/* ── Left column: photo + details ── */}
        <div className="space-y-6">
          {/* Photo upload */}
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">1. Upload photo</h2>
            <p className="mt-1 text-xs text-slate-500">JPEG, PNG, or WebP. Max 10 MB.</p>

            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onPick(e.dataTransfer.files?.[0] || null);
              }}
              className="mt-4 flex aspect-video cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40"
            >
              {preview ? (
                <div className="relative h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt="Upload preview"
                    className="h-full w-full rounded-md object-contain"
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-700 shadow hover:bg-white"
                    aria-label="Remove image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <ImageIcon className="h-8 w-8" />
                  <p className="text-sm font-medium">Click to select or drop an image here</p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED.join(",")}
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] || null)}
              />
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </section>

          {/* License plate */}
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Car className="h-4 w-4 text-slate-500" />
              2. License plate <span className="font-normal text-slate-400">(optional)</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Enter the vehicle's license plate number if it is visible in the photo.
            </p>
            <input
              type="text"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
              placeholder="e.g. ABC-1234"
              maxLength={20}
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono uppercase placeholder:font-sans placeholder:normal-case focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </section>

          {/* Location picker */}
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MapPin className="h-4 w-4 text-slate-500" />
              3. Pin the location <span className="font-normal text-slate-400">(optional)</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Click on the map to mark exactly where the violation occurred.
            </p>
            <div className="mt-3">
              <LocationPicker value={pinCoords} onChange={onLocationChange} />
            </div>
            {locationLabel && (
              <p className="mt-2 truncate text-xs text-slate-600">
                📍 {locationLabel}
              </p>
            )}
          </section>

          <button
            onClick={onSubmit}
            disabled={!file || submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analysing image…
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                Analyse with SnapPark
              </>
            )}
          </button>
        </div>

        {/* ── Right column: AI verdict ── */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">4. AI verdict</h2>
          <p className="mt-1 text-xs text-slate-500">
            The result appears here once analysis completes (≈ 2–5 seconds).
          </p>

          {!result && !submitting && (
            <div className="mt-6 flex h-64 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-500">
              No analysis yet.
            </div>
          )}

          {submitting && (
            <div className="mt-6 flex h-64 items-center justify-center rounded-md bg-slate-50 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Quality-checking and analysing your photo…
            </div>
          )}

          {result && (
            <div className="mt-6 space-y-4">
              <div
                className={`rounded-md p-4 ${
                  result.analysis.violationConfirmed
                    ? "bg-red-50 text-red-900"
                    : "bg-emerald-50 text-emerald-900"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  {result.analysis.violationConfirmed ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5" />
                  )}
                  {result.analysis.violationConfirmed
                    ? `Violation detected: ${result.analysis.violationType}`
                    : "No violation detected"}
                </div>
                {result.analysis.confidence != null && (
                  <p className="mt-1 text-xs opacity-80">
                    Confidence: {Math.round(result.analysis.confidence * 100)}%
                  </p>
                )}
              </div>

              {result.analysis.explanation && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Explanation
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {result.analysis.explanation}
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => router.push(`/cases/${result.caseId}`)}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  View case
                </button>
                <button
                  onClick={() => { setFile(null); setResult(null); setLicensePlate(""); setPinCoords(null); setLocationLabel(""); }}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Submit another
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
