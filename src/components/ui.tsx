import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { datePickerIsOpen } from "@/lib/date-picker-state";
import { cn } from "@/lib/utils";

export { DateField } from "@/components/date-field";

type Variant = "primary" | "secondary" | "ghost" | "danger";


const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export function Button({
  variant = "primary",
  block,
  pill,
  small,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; pill?: boolean; small?: boolean }) {
  return (
    <button
      type={type}
      className={cn("btn press", variantClass[variant], block && "btn-block", pill && "btn-pill", small && "btn-sm", className)}
      {...props}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}) {
  const labelId = `sw-${id ?? label}`;
  return (
    // A <label>, so a tap anywhere on the bordered row toggles the switch, not just the 44x26 track.
    <label className="switch-row">
      <span id={labelId}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        className="switch"
        onClick={() => onChange(!checked)}
      />
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="lbl">
      {label}
      {children}
      {hint ? <span className="font-normal">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="field" {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="field" {...props} />;
}

const IN_DIALOG = '[role="dialog"], [role="alertdialog"]';
// The last element that had focus outside any dialog. Used when one sheet hands over to another (event details -> Edit).
let lastOutsideDialog: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target !== document.body && !target.closest(IN_DIALOG)) lastOutsideDialog = target;
    },
    true,
  );
}

/** What to give focus back to when a sheet that is opening now closes. Read while rendering, before the sheet moves focus. */
function openerForSheet(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null; // e.g. Safari doesn't focus a button on click
  return active.closest(IN_DIALOG) ? lastOutsideDialog : active;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // These dialogs are controlled and have no <Dialog.Trigger>, so Radix has nothing to hand focus back to.
  // Remember what had focus when the sheet opened and return it there on close (Escape, Close, or a save).
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Captured during render, not in Radix's onOpenAutoFocus: an input with autoFocus (Add event) has already taken focus by then.
  if (open && !wasOpen.current && typeof document !== "undefined") opener.current = openerForSheet();
  wasOpen.current = open;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className="sheet-panel"
          // A calendar open inside the sheet takes the first Escape; the sheet stays.
          onEscapeKeyDown={(event) => {
            if (datePickerIsOpen()) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            const target = opener.current;
            opener.current = null;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
        >
          <div className="handle" />
          <div className="sheet-head">
            <div className="min-w-0">
              <Dialog.Title className="display text-2xl text-foreground">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="sheet-body">{children}</div>
          {footer ? <div className="sheet-actions">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
