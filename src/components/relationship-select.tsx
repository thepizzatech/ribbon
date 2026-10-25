import { ChevronDown } from "lucide-react";
import { RELATIONSHIPS, type Relationship } from "@/lib/gifts/model";

export function RelationshipSelect({
  value,
  onChange,
  label = "Relationship",
  includeSelf = false,
}: {
  value: Relationship;
  onChange: (value: Relationship) => void;
  label?: string;
  includeSelf?: boolean;
}) {
  return (
    <div className="select-wrap">
      <select
        className="field"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as Relationship)}
      >
        {RELATIONSHIPS.filter((item) => includeSelf || item.key !== "self" || value === "self").map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </select>
      <ChevronDown className="select-chevron" />
    </div>
  );
}
