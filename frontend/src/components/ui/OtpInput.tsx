"use client";

import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
};

/**
 * Four (or N) separate digit inputs that behave as a single OTP field.
 * Auto-advances on input, supports backspace-to-previous, and accepts pasted
 * codes. The string state is owned by the parent so it can be submitted as
 * part of the form.
 */
export function OtpInput({ value, onChange, length = 4, autoFocus = true, disabled = false }: Props) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const setDigit = (index: number, digit: string) => {
    const padded = value.padEnd(length, " ");
    const next   = padded.slice(0, index) + digit + padded.slice(index + 1);
    onChange(next.replace(/\s+$/, ""));
  };

  const handleChange = (index: number, raw: string) => {
    // Strip non-digits — keeps the field honest even if the user pastes.
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setDigit(index, "");
      return;
    }
    if (digits.length === 1) {
      setDigit(index, digits);
      if (index < length - 1) refs.current[index + 1]?.focus();
      return;
    }
    // Multi-digit input (typically a paste): fill from this position onwards.
    const slice = digits.slice(0, length - index);
    const merged = (value.padEnd(length, " ").slice(0, index) + slice).padEnd(length, " ");
    onChange(merged.replace(/\s+$/, "").slice(0, length));
    const targetIndex = Math.min(index + slice.length, length - 1);
    refs.current[targetIndex]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      e.preventDefault();
      setDigit(index - 1, "");
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          pattern="\d*"
          maxLength={length}
          autoComplete="one-time-code"
          disabled={disabled}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="h-14 w-12 rounded-md border border-slate-300 text-center text-2xl font-semibold text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:bg-slate-100"
        />
      ))}
    </div>
  );
}
