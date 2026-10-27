import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
};

// Keep the editing string separate so clearing a numeric field does not insert 0.
export default function SecondsInput({
  value,
  onChange,
  min = 0,
  max = 30,
  disabled,
}: Props) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step="any"
      value={draft}
      disabled={disabled}
      onFocus={(event) => {
        focused.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const number = Number(next);
        if (
          next !== "" &&
          Number.isFinite(number) &&
          number >= min &&
          number <= max
        )
          onChange(number);
      }}
      onBlur={() => {
        focused.current = false;
        const number = draft === "" ? value : Number(draft);
        const next = Math.max(
          min,
          Math.min(max, Number.isFinite(number) ? number : value),
        );
        setDraft(String(next));
        if (next !== value) onChange(next);
      }}
    />
  );
}
