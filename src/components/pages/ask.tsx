import { useSearch } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, TextArea } from "@/components/ui";
import { askLedger } from "@/lib/ask";
import { serializeLedger, todayISO, yearsOf } from "@/lib/gifts/model";
import { useLedger } from "@/lib/gifts/store";

export function AskPage() {
  const householdName = useLedger((state) => state.householdName);
  const people = useLedger((state) => state.people);
  const gifts = useLedger((state) => state.gifts);
  const year = yearsOf(gifts)[0] ?? 2026;
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { q } = useSearch({ from: "/_app/ask" });
  const asked = useRef<string | null>(null);

  const prompts = [
    { label: "Thank-yous", question: "Who still needs a thank-you, and for which gifts?" },
    { label: "Still to give", question: "Which gifts are still ideas or purchased and not delivered? Group them by person." },
    { label: `${year} recap`, question: `Summarize gifts given and received in ${year}. Mention occasions and amounts when they are known.` },
    { label: "Who with whom", question: "Who did our household give gifts to, and who gave gifts to us? Note anyone one-sided." },
    {
      label: "Year note",
      question: `Write a short year note for ${year} about this household's gifts. One short paragraph on what we received, one on what we gave, then anything still unfinished. Only use the ledger.`,
    },
  ];

  async function ask(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (trimmed.length < 2 || pending) return;
    if (gifts.length === 0) {
      setAnswer("");
      setError("Add a gift first. The assistant only answers from what is in the ledger.");
      return;
    }
    setQuestion(trimmed);
    setPending(true);
    setError("");
    setAnswer("");
    try {
      const ledger = serializeLedger({
        householdName,
        people,
        gifts,
        today: todayISO(),
      });
      const result = await askLedger({ data: { question: trimmed, ledger } });
      if (!result.ok) setError(result.error);
      else setAnswer(result.text);
    } catch {
      setError("The assistant couldn’t answer just now.");
    } finally {
      setPending(false);
    }
  }

  // Arriving from an Overview insight: ask its question once.
  useEffect(() => {
    if (!q || asked.current === q) return;
    asked.current = q;
    void ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per incoming question
  }, [q]);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Ask</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">Questions and a year note, answered only from this ledger.</p>
        </div>
      </div>

      <div className="chip-row">
        {prompts.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            className="chip press"
            disabled={pending}
            onClick={() => void ask(prompt.question)}
          >
            {prompt.label}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <TextArea
          value={question}
          maxLength={500}
          placeholder="What did we give May last Christmas?"
          aria-label="Question"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button type="submit" disabled={pending || question.trim().length < 2}>
          {pending ? "Reading the ledger…" : "Ask"}
        </Button>
      </form>

      {error ? (
        <p className="card text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {pending ? <p className="text-sm text-muted">Reading the ledger…</p> : null}

      {answer ? (
        <article className="card">
          <h2 className="card-title flex items-center gap-2">
            <Sparkles size={16} strokeWidth={1.5} aria-hidden="true" /> Answer
          </h2>
          <div className="mt-3">
            <Prose text={answer} />
          </div>
        </article>
      ) : null}

      <p className="text-sm text-muted">
        A question sends the gift list to the assistant. Nothing is sent until you ask. The ledger itself stays on your server.
      </p>
    </div>
  );
}

function Prose({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push(<p key={blocks.length}>{clean(paragraph.join(" "))}</p>);
    paragraph = [];
  }

  function flushBullets() {
    if (bullets.length === 0) return;
    const items = bullets;
    blocks.push(
      <ul key={blocks.length} className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={index} className="flex gap-3">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-out" />
            <span>{clean(item)}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushBullets();
      continue;
    }
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
    if (bullet?.[1]) {
      flushParagraph();
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();

  return <div className="flex flex-col gap-3 text-sm leading-relaxed">{blocks}</div>;
}

function clean(value: string) {
  return value.replace(/\*\*/g, "").replace(/^#+\s*/, "");
}
