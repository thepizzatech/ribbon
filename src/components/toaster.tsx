import { Check } from "lucide-react";
import { useToast } from "@/lib/toast";

export function Toaster() {
  const { id, message } = useToast();
  return (
    <div aria-live="polite" role="status">
      {message ? (
        <div key={id} className="toaster">
          <Check size={16} strokeWidth={2} aria-hidden="true" />
          {message}
        </div>
      ) : null}
    </div>
  );
}
