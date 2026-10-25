import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/gifts/api";
import { xapi, type CsvPreview, type CsvResult, type CsvType } from "@/lib/gifts/api-extra";
import { downloadLedger } from "@/lib/gifts/export";
import { parseBackup } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";
import { useSession } from "@/lib/gifts/use-session";
import { toast } from "@/lib/toast";

const msg = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback);
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function JsonSection() {
  const importBackup = useLedger((s) => s.importBackup);
  const clearLedger = useLedger((s) => s.clearLedger);
  const loadSample = useLedger((s) => s.loadSample);
  const session = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <section className="card stack" aria-labelledby="json-title">
      <div>
        <h2 className="card-title" id="json-title">
          Export and import
        </h2>
        <p className="card-sub">A full copy of your ledger as one file. Importing replaces what’s here.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            downloadLedger(useLedger.getState());
            toast("Ledger exported");
          }}
        >
          <Download size={14} strokeWidth={1.5} /> Export ledger
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Import ledger
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Ledger file to import"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const parsed = parseBackup(String(reader.result ?? ""));
              if (!parsed || parsed.people.length === 0) return setMessage("That file isn’t a Ribbon ledger.");
              importBackup(parsed);
              setMessage("Ledger replaced from the file.");
            };
            reader.readAsText(file);
          }}
        />
        {session.data?.sampleData ? (
          <Button
            variant="ghost"
            onClick={() => {
              loadSample();
              setMessage("Sample household loaded.");
            }}
          >
            Load sample household
          </Button>
        ) : null}
        {confirmClear ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearLedger();
                setConfirmClear(false);
                setMessage("Ledger cleared.");
              }}
            >
              Clear all
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirmClear(true)}>
            Clear ledger
          </Button>
        )}
      </div>
      {message ? <p className="text-sm text-muted" role="status">{message}</p> : null}
    </section>
  );
}

function CsvSection() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<CsvType>("gifts");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [createPeople, setCreatePeople] = useState(true);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(nextType: CsvType, nextText: string, nextMapping?: Record<string, number | null>) {
    setMessage("");
    try {
      const data = await xapi.csvPreview(nextType, nextText, nextMapping);
      setPreview(data);
      setMapping(data.mapping);
    } catch (error) {
      setPreview(null);
      setMessage(msg(error, "Couldn’t read that file."));
    }
  }

  const doImport = useMutation({
    mutationFn: () => xapi.csvImport(type, text, mapping, createPeople),
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      setText("");
      setFileName("");
      void queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (error) => setMessage(msg(error, "The import didn’t work.")),
  });

  const reset = () => {
    setPreview(null);
    setText("");
    setFileName("");
    setResult(null);
    setMessage("");
  };

  return (
    <section className="card stack" aria-labelledby="csv-title">
      <div>
        <h2 className="card-title" id="csv-title">
          Spreadsheet (CSV)
        </h2>
        <p className="card-sub">Bring gifts, people or wishlist items in from a spreadsheet, or take them out. You’ll see a preview first.</p>
      </div>
      <div className="segment" role="group" aria-label="What to import">
        {(["gifts", "people", "wishlist"] as CsvType[]).map((t) => (
          <button
            key={t}
            type="button"
            className={type === t ? "is-on" : ""}
            onClick={() => {
              setType(t);
              reset();
            }}
          >
            {t === "gifts" ? "Gifts" : t === "people" ? "People" : "Wishlists"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-secondary press" href={xapi.csvUrl("export", type)}>
          <Download size={14} strokeWidth={1.5} /> Export CSV
        </a>
        <a className="btn btn-secondary press" href={xapi.csvUrl("template", type)}>
          Blank template
        </a>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Choose a CSV to import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="CSV file to import"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setResult(null);
            const reader = new FileReader();
            reader.onload = () => {
              const content = String(reader.result ?? "");
              setText(content);
              setFileName(file.name);
              void run(type, content);
            };
            reader.readAsText(file);
          }}
        />
      </div>

      {preview ? (
        <div className="csv-preview stack" aria-live="polite">
          <p className="text-sm">
            <b>{fileName}</b>: {preview.counts.total} rows · <b>{preview.counts.valid}</b> ready
            {preview.counts.duplicates ? ` · ${preview.counts.duplicates} already here (skipped)` : ""}
            {preview.counts.invalid ? ` · ${preview.counts.invalid} need fixing` : ""}
          </p>
          <div className="csv-map">
            {preview.fields.map((field) => (
              <label key={field.key} className="lbl">
                {field.label}
                {field.required ? " *" : ""}
                <span className="select-wrap">
                  <select
                    className="field"
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => {
                      const next = { ...mapping, [field.key]: e.target.value === "" ? null : Number(e.target.value) };
                      setMapping(next);
                      void run(type, text, next);
                    }}
                  >
                    <option value="">Skip</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            ))}
          </div>
          {preview.problems.length ? <p className="text-sm text-primary" role="alert">{preview.problems.join(" ")}</p> : null}
          {preview.newPeople.length ? (
            <label className="check">
              <input type="checkbox" checked={createPeople} onChange={(e) => setCreatePeople(e.target.checked)} />
              Add {preview.newPeople.length} new {preview.newPeople.length === 1 ? "person" : "people"} ({preview.newPeople.slice(0, 4).join(", ")}
              {preview.newPeople.length > 4 ? "…" : ""})
            </label>
          ) : null}
          <div className="table-wrap">
            <table className="csv-table">
              <thead>
                <tr>
                  <th>Line</th>
                  {preview.fields.filter((f) => mapping[f.key] != null).map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 8).map((row) => (
                  <tr key={row.line} className={row.duplicate ? "is-dup" : row.ok ? "" : "is-bad"}>
                    <td>{row.line}</td>
                    {preview.fields.filter((f) => mapping[f.key] != null).map((f) => (
                      <td key={f.key}>{String(row.values[f.key] ?? "")}</td>
                    ))}
                    <td>{row.duplicate ? "Already here" : row.ok ? "OK" : row.errors.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
            <Button disabled={doImport.isPending || preview.counts.valid === 0 || preview.problems.length > 0} onClick={() => doImport.mutate()}>
              Import {preview.counts.valid} {preview.counts.valid === 1 ? "row" : "rows"}
            </Button>
          </div>
        </div>
      ) : null}
      {result ? (
        <div className="notice" role="status">
          Imported {result.added}. {result.duplicates ? `${result.duplicates} duplicates skipped. ` : ""}
          {result.invalid ? `${result.invalid} rows skipped. ` : ""}
          {result.newPeople.length ? `Added ${result.newPeople.join(", ")}.` : ""}
        </div>
      ) : null}
      {message ? <p className="text-sm text-primary" role="alert">{message}</p> : null}
    </section>
  );
}

function BackupSection() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["backups"], queryFn: xapi.backups });
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const apply = (backups: Awaited<ReturnType<typeof xapi.backups>>["backups"]) =>
    queryClient.setQueryData(["backups"], (old: Awaited<ReturnType<typeof xapi.backups>> | undefined) => (old ? { ...old, backups, schedule: { ...old.schedule, count: backups.length } } : old));
  const make = useMutation({
    mutationFn: () => xapi.makeBackup(),
    onSuccess: (d) => {
      apply(d.backups);
      toast("Backup made");
    },
    onError: (e) => setMessage(msg(e, "Couldn’t make a backup.")),
  });
  const del = useMutation({ mutationFn: (name: string) => xapi.deleteBackup(name), onSuccess: (d) => apply(d.backups), onError: (e) => setMessage(msg(e, "Couldn’t delete that.")) });
  const done = (r: { safetyBackup: string; signedOut: boolean }) => {
    setMessage(`Restored. A safety copy of what was here is saved as ${r.safetyBackup}. Reloading…`);
    setTimeout(() => window.location.reload(), 1200);
  };
  const restore = useMutation({ mutationFn: (name: string) => xapi.restoreBackup(name), onSuccess: done, onError: (e) => setMessage(msg(e, "Couldn’t restore.")) });
  const upload = useMutation({ mutationFn: (file: File) => xapi.restoreUpload(file), onSuccess: done, onError: (e) => setMessage(msg(e, "Couldn’t restore from that file.")) });
  const schedule = list.data?.schedule;

  if (list.error instanceof ApiError && list.error.status === 403) {
    return (
      <section className="card stack" aria-labelledby="bk-title">
        <h2 className="card-title" id="bk-title">
          Server backups
        </h2>
        <p className="card-sub">Only the person who set up Ribbon can manage server backups.</p>
      </section>
    );
  }

  return (
    <section className="card stack" aria-labelledby="bk-title" data-tour="backup">
      <div>
        <h2 className="card-title" id="bk-title">
          Server backups
        </h2>
        <p className="card-sub">
          Whole-database copies stored next to your data.{" "}
          {schedule
            ? schedule.enabled
              ? `Automatic: ${schedule.cron}${schedule.next ? `, next ${new Date(schedule.next).toLocaleString()}` : ""}. Keeps the latest ${schedule.keep}.`
              : "Automatic backups are off (set BACKUP_CRON to turn them on)."
            : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => make.mutate()} disabled={make.isPending}>
          Back up now
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Restore from a file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".sqlite,.db,application/octet-stream"
          className="sr-only"
          aria-label="Backup file to restore"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && window.confirm("Replace everything on this server with the contents of that file? A safety copy is saved first.")) upload.mutate(file);
          }}
        />
      </div>
      <ul className="m-0 list-none p-0">
        {(list.data?.backups ?? []).map((b) => (
          <li className="kv" key={b.name}>
            <span className="k">
              {b.name}
              <span className="sub">
                {b.kind === "auto" ? "Automatic" : b.kind === "manual" ? "Manual" : "Safety copy"} · {size(b.size)} · {new Date(b.createdAt).toLocaleString()}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <a className="icon-btn sm" href={xapi.backupUrl(b.name)} aria-label={`Download ${b.name}`}>
                <Download size={14} strokeWidth={1.5} />
              </a>
              {confirming === b.name ? (
                <>
                  <Button variant="danger" onClick={() => restore.mutate(b.name)} disabled={restore.isPending}>
                    Confirm restore
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setConfirming(b.name)}>
                    Restore
                  </Button>
                  <button type="button" className="icon-btn sm" aria-label={`Delete ${b.name}`} onClick={() => window.confirm(`Delete ${b.name}?`) && del.mutate(b.name)}>
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {list.data && list.data.backups.length === 0 ? <p className="text-sm text-muted">No backups yet.</p> : null}
      {message ? <p className="text-sm" role="status">{message}</p> : null}
    </section>
  );
}

export function DataTab() {
  return (
    <div className="settings-grid">
      <BackupSection />
      <CsvSection />
      <JsonSection />
    </div>
  );
}
