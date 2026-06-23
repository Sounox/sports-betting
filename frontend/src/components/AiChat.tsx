"use client";
import { useState, useRef, useEffect } from "react";
import { Bot, Send, Loader2, X, MessageSquare } from "lucide-react";
import { clsx } from "clsx";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  eventId?: number;   // si défini → chat contextualisé sur ce match
  matchLabel?: string;
}

export function AiChat({ eventId, matchLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      const welcome = eventId
        ? `Bonjour ! Je suis ton assistant IA pour ce match${matchLabel ? ` (${matchLabel})` : ""}. Pose-moi n'importe quelle question : value bets, probabilités, mise recommandée…`
        : "Bonjour ! Je suis ton assistant IA sportif. Pose-moi une question sur les matchs, les paris, ou l'outil.";
      setMessages([{ role: "assistant", content: welcome }]);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages
        .slice(-6)
        .map(m => ({ role: m.role, content: m.content }));

      const url = eventId
        ? `${API_BASE}/api/v1/ai/chat/${eventId}`
        : `${API_BASE}/api/v1/ai/chat`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.ok) throw new Error("Erreur LLM");
      const data = await res.json();
      setMessages(m => [...m, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages(m => [...m, {
        role: "assistant",
        content: "Désolé, l'IA est temporairement indisponible. Réessaie dans un instant.",
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <>
      {/* Bouton flottant */}
      <button
        onClick={() => setOpen(x => !x)}
        className={clsx(
          "fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all",
          open ? "bg-gray-700 hover:bg-gray-600" : "bg-green-600 hover:bg-green-500"
        )}
      >
        {open ? <X size={20} className="text-white" /> : <Bot size={22} className="text-white" />}
      </button>

      {/* Panel chat */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col"
          style={{ height: "480px" }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Assistant IA</div>
              <div className="text-xs text-gray-500">Llama 3.3 · 70B · Groq</div>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400">En ligne</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={clsx("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
                {msg.role === "assistant" && (
                  <div className="w-6 h-6 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot size={12} className="text-white" />
                  </div>
                )}
                <div className={clsx(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-green-700 text-white rounded-tr-sm"
                    : "bg-gray-800 text-gray-200 rounded-tl-sm"
                )}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0">
                  <Bot size={12} className="text-white" />
                </div>
                <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2">
                  <Loader2 size={14} className="animate-spin text-gray-400" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions rapides */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2 flex gap-2 flex-wrap">
              {(eventId
                ? ["Vaut-il le coup de miser ?", "Quelle mise recommandes-tu ?", "Analyse les risques"]
                : ["Meilleurs value bets du jour ?", "Explique le Kelly criterion", "Quels marchés sont les plus fiables ?"]
              ).map(s => (
                <button key={s} onClick={() => { setInput(s); }}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-full border border-gray-700 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-gray-800 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Pose une question…"
              disabled={loading}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-green-600 disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="w-9 h-9 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
            >
              <Send size={14} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
