export function Mark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="currentColor" d="M12 3h8v17l-4 5-4-5V3z" />
      <path fill="var(--color-background)" d="M12 3h8l-4 6-4-6z" />
    </svg>
  );
}
