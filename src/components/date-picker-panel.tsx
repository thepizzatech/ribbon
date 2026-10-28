import { useEffect, useRef } from "react";
import { DayFlag, DayPicker, SelectionState, UI, type Modifiers } from "react-day-picker";
import { Button, Switch } from "@/components/ui";
import {
  LEAP_YEAR,
  pickerDateToValue,
  valueToPickerDate,
  yearRange,
  type DateMode,
} from "@/lib/date-field";

const classNames = {
  [UI.Root]: "dp-root",
  [UI.Months]: "dp-months",
  [UI.Month]: "dp-month",
  [UI.MonthCaption]: "dp-caption",
  [UI.Dropdowns]: "dp-dropdowns",
  [UI.DropdownRoot]: "dp-dropdown-root",
  [UI.Dropdown]: "dp-dropdown",
  [UI.CaptionLabel]: "dp-caption-label",
  [UI.Nav]: "dp-nav",
  [UI.PreviousMonthButton]: "dp-nav-btn",
  [UI.NextMonthButton]: "dp-nav-btn",
  [UI.Chevron]: "dp-chevron",
  [UI.MonthGrid]: "dp-grid",
  [UI.Weekdays]: "dp-weekdays",
  [UI.Weekday]: "dp-weekday",
  [UI.Week]: "dp-week",
  [UI.Day]: "dp-day",
  [UI.DayButton]: "dp-day-btn",
  [SelectionState.selected]: "is-selected",
  [DayFlag.today]: "is-today",
  [DayFlag.outside]: "is-outside",
  [DayFlag.disabled]: "is-disabled",
};

/** "Wednesday, October 28, 2026": it holds the number that is written on the button ("28"), as screen readers and voice control expect. */
const dayLabel = (day: Date, modifiers: Modifiers) =>
  `${modifiers.today ? "Today, " : ""}${day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${modifiers.selected ? ", selected" : ""}`;

export type PanelProps = {
  mode: DateMode;
  value: string;
  /** Whether the year counts: always for a plain date, never for month and day, the switch decides for a birthday. */
  known: boolean;
  required?: boolean;
  minYear?: number;
  maxYear?: number;
  onPick: (value: string) => void;
  onClear: () => void;
  onKnownChange: (known: boolean) => void;
  switchId: string;
};

export default function DatePickerPanel({
  mode,
  value,
  known,
  required,
  minYear,
  maxYear,
  onPick,
  onClear,
  onKnownChange,
  switchId,
}: PanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const selected = valueToPickerDate(value);
  const yearless = !known;
  const years = yearRange(mode, value, today.getFullYear(), minYear, maxYear);
  const from = yearless ? new Date(LEAP_YEAR, 0, 1) : new Date(years.from, 0, 1);
  const to = yearless ? new Date(LEAP_YEAR, 11, 31) : new Date(years.to, 11, 31);
  const start = selected ?? (yearless ? new Date(LEAP_YEAR, today.getMonth(), 1) : today);

  // Keyboard users land on a day, so the arrow keys work straight away. A floating panel isn't placed yet on its first frame, so try again until focus sticks.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    let tries = 0;
    const focusDay = () => {
      const day =
        root.querySelector<HTMLElement>('.dp-day-btn[tabindex="0"]') ??
        root.querySelector<HTMLElement>(".dp-day-btn:not([disabled])");
      day?.focus({ preventScroll: true });
      if (!root.contains(document.activeElement) && tries++ < 8)
        frame = requestAnimationFrame(focusDay);
    };
    focusDay();
    root.scrollIntoView({ block: "nearest" });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={rootRef} className="dp-panel">
      {mode === "optional-year" ? (
        <Switch
          id={switchId}
          label="I don’t know the year"
          checked={!known}
          onChange={(unknown) => onKnownChange(!unknown)}
        />
      ) : null}
      <DayPicker
        key={yearless ? "no-year" : "year"}
        mode="single"
        required
        selected={selected}
        onSelect={(day) => {
          if (day) onPick(pickerDateToValue(day, mode, known));
        }}
        defaultMonth={start}
        startMonth={from}
        endMonth={to}
        disabled={yearless ? undefined : { before: from, after: to }}
        captionLayout={yearless ? "dropdown-months" : "dropdown"}
        weekStartsOn={1}
        showOutsideDays={!yearless}
        fixedWeeks
        classNames={classNames}
        labels={{ labelDayButton: dayLabel }}
        // With no year there is nothing to say about 2000 (it is only drawn in a leap year): name the month alone.
        formatters={
          yearless
            ? {
                formatCaption: (month) => month.toLocaleDateString(undefined, { month: "long" }),
                formatYearCaption: () => "",
              }
            : undefined
        }
      />
      {mode === "date" || (!required && value) ? (
        <div className="dp-foot">
          {mode === "date" ? (
            <Button
              variant="ghost"
              small
              onClick={() => onPick(pickerDateToValue(today, mode, true))}
            >
              Today
            </Button>
          ) : null}
          {!required && value ? (
            <Button variant="ghost" small onClick={onClear}>
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
