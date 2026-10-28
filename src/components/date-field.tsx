import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { datePickerClosed, datePickerOpened } from "@/lib/date-picker-state";
import {
  describeDate,
  formatDateText,
  HELP,
  parseDateText,
  partsOf,
  setYearKnown,
  yearIsUnknown,
  type DateMode,
} from "@/lib/date-field";
import { cn } from "@/lib/utils";

// The calendar (react-day-picker and its dates) is only fetched the first time someone reaches for it.
const loadPanel = () => import("@/components/date-picker-panel");
const Panel = lazy(loadPanel);

export type DateFieldProps = {
  /** "" or the stored form for the mode: YYYY-MM-DD, --MM-DD (mode "optional-year") or MM-DD (mode "month-day"). */
  value: string;
  onChange: (value: string) => void;
  mode?: DateMode;
  label?: string;
  "aria-label"?: string;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  /** "input": every readable edit is passed up at once. "blur": typing is passed up when the box loses focus or on Enter. Picking is always at once. */
  commitOn?: "input" | "blur";
  /** A narrow box for rows with little room (the occasion list). */
  compact?: boolean;
  minYear?: number;
  maxYear?: number;
  className?: string;
};

const PLACEHOLDER: Record<DateMode, string> = {
  date: "YYYY-MM-DD",
  "optional-year": "Optional",
  "month-day": "MM-DD",
};

/**
 * A date as text you can type or a calendar you can pick from. Both give the same stored value; either way the calendar page picks it up.
 * On a phone, inside a bottom sheet, the calendar opens in the sheet (below the box) instead of floating over it.
 */
export function DateField({
  value,
  onChange,
  mode = "date",
  label,
  "aria-label": ariaLabel,
  hint,
  placeholder,
  required,
  commitOn = "input",
  compact,
  minYear,
  maxYear,
  className,
}: DateFieldProps) {
  const uid = useId();
  const inputId = `df-${uid}`;
  const errorId = `${inputId}-err`;
  const panelId = `${inputId}-panel`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(() => formatDateText(value));
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [inline, setInline] = useState(false);
  const [unknownYear, setUnknownYear] = useState(false); // only matters while there is no date yet
  const emitted = useRef(value);
  const rememberedYear = useRef(new Date().getFullYear());
  const name = label ?? ariaLabel ?? "Date";

  // A change that came from outside (a picked day, another form opening) replaces what is typed.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setDraft(formatDateText(value));
    setInvalid(false);
  }, [value]);

  useEffect(() => {
    const year = partsOf(value)?.year;
    if (year) rememberedYear.current = year;
  }, [value]);

  // An unreadable date stops the form from submitting (the browser shows this message), instead of quietly saving something else.
  useEffect(() => {
    inputRef.current?.setCustomValidity(invalid ? HELP[mode] : "");
  }, [invalid, mode]);

  useEffect(() => {
    if (!open) return;
    datePickerOpened();
    return datePickerClosed;
  }, [open]);

  const known =
    mode === "date" || (mode === "optional-year" && (value ? !yearIsUnknown(value) : !unknownYear));

  function commit(text: string, normalise: boolean) {
    const parsed = parseDateText(text, mode);
    if (!parsed.ok) return setInvalid(true);
    setInvalid(false);
    if (normalise) setDraft(formatDateText(parsed.value));
    if (parsed.value !== emitted.current) {
      emitted.current = parsed.value;
      onChange(parsed.value);
    }
  }

  function pick(next: string) {
    emitted.current = next;
    setDraft(formatDateText(next));
    setInvalid(false);
    onChange(next);
    close();
  }

  function close() {
    setOpen(false);
    // The popover hands focus back by itself; the inline panel has to do it here.
    if (inline) triggerRef.current?.focus();
  }

  function openPicker() {
    setInline(
      window.matchMedia("(max-width: 767px)").matches &&
        Boolean(rootRef.current?.closest(".sheet-panel")),
    );
    setOpen(true);
  }

  function changeKnown(nextKnown: boolean) {
    if (!value) return setUnknownYear(!nextKnown);
    const next = setYearKnown(value, nextKnown, rememberedYear.current);
    emitted.current = next;
    setDraft(formatDateText(next));
    onChange(next);
  }

  const panel = (
    <Suspense
      fallback={
        <div className="dp-panel dp-loading" role="status">
          Loading calendar…
        </div>
      }
    >
      <Panel
        mode={mode}
        value={value}
        known={known}
        required={required}
        minYear={minYear}
        maxYear={maxYear}
        onPick={pick}
        onClear={() => pick("")}
        onKnownChange={changeKnown}
        switchId={`${inputId}-year`}
      />
    </Suspense>
  );

  return (
    <div
      ref={rootRef}
      className={cn("lbl dp-field", compact && "dp-compact", open && inline && "dp-open-inline", className)}
      onKeyDown={(event) => {
        // Escape closes the calendar and nothing else, wherever focus is inside this field (the popover does its own).
        if (event.key !== "Escape" || !open || !inline) return;
        event.stopPropagation();
        event.preventDefault();
        close();
      }}
    >
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <Popover.Root
        open={open && !inline}
        onOpenChange={(next) => {
          if (next) openPicker();
          else setOpen(false);
        }}
      >
        <Popover.Anchor asChild>
          <div className="dp-control">
            <input
              ref={inputRef}
              id={inputId}
              className="field dp-input"
              value={draft}
              placeholder={placeholder ?? PLACEHOLDER[mode]}
              required={required}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label={label ? undefined : ariaLabel}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                if (commitOn === "input" || !event.target.value.trim())
                  commit(event.target.value, false);
                else setInvalid(false);
              }}
              onBlur={(event) => commit(event.target.value, true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit(event.currentTarget.value, true);
              }}
            />
            <Popover.Trigger asChild>
              <button
                ref={triggerRef}
                type="button"
                className="dp-trigger"
                aria-label={`Choose ${name.toLowerCase()} from a calendar${value ? `, now ${describeDate(value)}` : ""}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                {...(open && inline ? { "aria-controls": panelId } : {})}
                onPointerEnter={() => void loadPanel()}
                onFocus={() => void loadPanel()}
                onClick={(event) => {
                  // Inline panels aren't a Popover, so the trigger has to toggle them itself.
                  if (inline && open) {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
              >
                <CalendarDays size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </Popover.Trigger>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            className="dp-pop"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            aria-label={`${name} calendar`}
            onInteractOutside={(event) => {
              // Typing in this field's own text box keeps the calendar open; Escape then closes only the calendar.
              if (event.target instanceof Node && inputRef.current?.contains(event.target)) event.preventDefault();
            }}
            onOpenAutoFocus={
              (event) => event.preventDefault() /* the panel puts focus on a day itself */
            }
          >
            {panel}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {open && inline ? (
        <div id={panelId} role="group" aria-label={`${name} calendar`} className="dp-inline">
          {panel}
        </div>
      ) : null}
      {invalid ? (
        <span id={errorId} className="dp-error" role="alert">
          {HELP[mode]}
        </span>
      ) : hint ? (
        <span className="font-normal">{hint}</span>
      ) : null}
    </div>
  );
}
