import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Send } from "lucide-react";
import { Button } from "../../ui";
import { typingMention, type Mention } from "./mentions";
import "./conversation.css";

export interface Message {
  id: string;
  sender: string;
  body: string;
  ts: number;
  mine: boolean;
  pending?: boolean;
  /** the sender's name in this room */
  name?: string;
  /** people the message mentions */
  mentions?: Mention[];
  /** it mentions this account */
  forMe?: boolean;
}

/** The words, with each mention picked out. */
function Words({ body, mentions }: { body: string; mentions?: Mention[] }) {
  const names = (mentions ?? []).map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{body}</>;
  const quoted = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@?(?:${quoted.join("|")}))`, "g"));
  return <>{parts.map((part, i) => (i % 2 ? <span key={i} className="chat-mention">{part}</span> : part))}</>;
}

export function Timeline({ messages, room }: { messages: Message[]; room: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [below, setBelow] = useState(false);
  const last = messages[messages.length - 1];
  const bottom = () => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
    following.current = true;
    setBelow(false);
  };
  useEffect(() => { bottom(); }, [room]);
  useEffect(() => {
    if (following.current || last?.mine) bottom();
    else setBelow(true);
  }, [messages.length, last?.id]);
  return (
    <div className="chat-timeline-wrap">
      <div ref={scroll} className="chat-timeline" role="log" aria-label="Messages" tabIndex={0}
        onScroll={() => {
          const el = scroll.current!;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
          if (following.current) setBelow(false);
        }}>
        <div className="chat-messages">
          {!messages.length && <div className="chat-empty"><strong>{room ? "Start the conversation" : "Choose a room"}</strong><p>{room ? "No messages here yet. Say hello." : "Your conversations appear here."}</p></div>}
          {messages.map((m, i) => {
            const previous = messages[i - 1];
            const date = new Date(m.ts);
            const newDay = !previous || date.toDateString() !== new Date(previous.ts).toDateString();
            const grouped = !newDay && previous.sender === m.sender && m.ts - previous.ts < 300_000;
            return <div key={m.id}>
              {newDay && <div className="chat-date"><span>{date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></div>}
              <article className="chat-message" data-mine={m.mine} data-grouped={grouped} data-for-me={!!m.forMe}>
                <span className="chat-avatar" aria-hidden="true">{grouped ? "" : (m.name || m.sender.replace(/^@/, ""))[0]?.toUpperCase()}</span>
                <div className="chat-message-content">
                  {!grouped && <div className="chat-message-meta"><strong title={m.sender}>{m.mine ? "You" : m.name || m.sender.replace(/^@/, "").split(":")[0]}</strong><time dateTime={date.toISOString()}>{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>}
                  <p><Words body={m.body} mentions={m.mentions} /></p>
                  {m.pending && <span className="chat-pending">Sending…</span>}
                </div>
              </article>
            </div>;
          })}
        </div>
      </div>
      {below && <div className="chat-latest"><Button icon={ArrowDown} onClick={bottom}>Latest messages</Button></div>}
    </div>
  );
}

export function Composer({ value, onChange, onSend, name, people = [], disabled = false, busy = false }: {
  value: string; onChange: (value: string) => void; onSend: (event: FormEvent) => void;
  name: string; people?: Mention[]; disabled?: boolean; busy?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const hint = useId();
  const list = useId();
  const [cursor, setCursor] = useState(0);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  // Where the cursor goes once a picked name is in the box, set before the next key lands.
  const place = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (place.current == null || !input.current) return;
    input.current.setSelectionRange(place.current, place.current);
    setCursor(place.current);
    place.current = null;
  }, [value]);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(input.current.scrollHeight, 160)}px`;
  }, [value]);

  // Typing @ offers the people in the room; Escape puts the list away for that word.
  const typing = people.length ? typingMention(value, cursor) : null;
  const matches = typing
    ? people
        .filter((p) => p.name.toLowerCase().includes(typing.query) || p.userId.slice(1).toLowerCase().startsWith(typing.query))
        .slice(0, 6)
    : [];
  const open = !!typing && matches.length > 0 && closed !== `${typing.start}:${typing.query}`;
  useEffect(() => setPick(0), [typing?.query]);

  function choose(p: Mention) {
    if (!typing) return;
    const before = value.slice(0, typing.start);
    const after = value.slice(cursor);
    const next = `${before}@${p.name} ${after.replace(/^ /, "")}`;
    place.current = before.length + p.name.length + 2;
    onChange(next);
  }

  return <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); if (!disabled && !busy && value.trim()) onSend(e); }}>
    <div className="chat-compose-box">
      {open && <ul id={list} role="listbox" aria-label="People in this room" className="chat-mentions">
        {matches.map((p, i) => <li key={p.userId} role="option" aria-selected={i === pick}
          onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setPick(i)}>
          <strong>{p.name}</strong><span>{p.userId}</span>
        </li>)}
      </ul>}
      <textarea ref={input} rows={1} value={value} disabled={disabled || busy}
        aria-label={name ? `Message ${name}` : "Message"} aria-describedby={hint}
        aria-controls={open ? list : undefined} aria-expanded={open} aria-autocomplete="list"
        placeholder={name ? `Message ${name}` : "Choose a conversation"}
        onChange={(e) => { onChange(e.target.value); setCursor(e.target.selectionStart ?? e.target.value.length); }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setPick((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(matches[pick] ?? matches[0]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setClosed(`${typing!.start}:${typing!.query}`);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !window.matchMedia("(pointer: coarse)").matches) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }} />
      <Button type="submit" size="md" icon={Send} busy={busy} disabled={disabled || busy || !value.trim()}>Send</Button>
    </div>
    <p id={hint} className="chat-compose-hint">Enter to send · Shift + Enter for a new line{people.length ? " · @ to mention someone" : ""}</p>
  </form>;
}
