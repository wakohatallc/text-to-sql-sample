import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LogOut, Play, RefreshCw, Send } from "lucide-react";
import type { ChatResponse, ChatThread, User } from "@text-to-sql/shared";
import "./styles.css";

type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; response: ChatResponse };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    ...init
  });

  const data = (await response.json().catch(() => ({}))) as T | ApiError;
  if (!response.ok) {
    const error = data as ApiError;
    throw new Error(error.error?.message ?? "リクエストに失敗した");
  }

  return data as T;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [email, setEmail] = useState("demo@example.com");
  const [password, setPassword] = useState("password");
  const [question, setQuestion] = useState("2018年の売り上げランキング上位10位を出して");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestJson<{ user: User }>("/me")
      .then((data) => setUser(data.user))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) return;
    requestJson<{ threads: ChatThread[] }>("/chat-threads")
      .then((data) => setThreads(data.threads))
      .catch(() => undefined);
  }, [user, threadId]);

  const latestResponse = useMemo(() => {
    const assistants = messages.filter((message): message is Extract<Message, { role: "assistant" }> => {
      return message.role === "assistant";
    });
    return assistants.at(-1)?.response;
  }, [messages]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await requestJson<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setUser(data.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "ログインに失敗した");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await requestJson<{ ok: true }>("/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setUser(null);
    setThreadId(undefined);
    setThreads([]);
    setMessages([]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setLoading(true);
    setError(null);

    try {
      const response = await requestJson<ChatResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: trimmed, threadId })
      });
      setThreadId(response.threadId);
      setMessages((current) => [...current, { role: "assistant", text: response.assistantMessage, response }]);
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "チャット処理に失敗した");
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <main className="loginShell">
        <form className="loginPanel" onSubmit={handleLogin}>
          <div>
            <h1>Text-to-SQL</h1>
            <p>Demo Account</p>
          </div>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button className="primaryButton" disabled={loading} type="submit">
            <Play size={16} />
            Login
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Text-to-SQL</h1>
          <span>{user.email}</span>
        </div>
        <button
          className="secondaryButton"
          type="button"
          onClick={() => {
            setThreadId(undefined);
            setMessages([]);
          }}
        >
          <RefreshCw size={15} />
          New
        </button>
        <nav className="threadList">
          {threads.map((thread) => (
            <button
              className={thread.id === threadId ? "thread active" : "thread"}
              key={thread.id}
              type="button"
              onClick={() => setThreadId(thread.id)}
            >
              {thread.title}
            </button>
          ))}
        </nav>
        <button className="iconTextButton" type="button" onClick={handleLogout}>
          <LogOut size={15} />
          Logout
        </button>
      </aside>

      <section className="workspace">
        <div className="conversation">
          {messages.length === 0 ? (
            <div className="emptyState">
              <strong>Ready</strong>
              <span>tenant: data_0001</span>
            </div>
          ) : (
            messages.map((message, index) => (
              <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="messageRole">{message.role}</div>
                <div className="messageText">{message.text}</div>
              </article>
            ))
          )}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} />
          <button className="sendButton" disabled={loading} type="submit" title="Run query">
            <Send size={17} />
          </button>
        </form>

        {error ? <div className="error">{error}</div> : null}

        {latestResponse ? (
          <section className="resultArea">
            <div className="resultMeta">
              <span>{latestResponse.generationMode}</span>
              <span>{latestResponse.rowCount} rows</span>
              <span>{latestResponse.durationMs} ms</span>
            </div>
            <pre className="sqlBlock">{latestResponse.sql}</pre>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    {latestResponse.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {latestResponse.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {latestResponse.columns.map((column) => (
                        <td key={column}>{String(row[column] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
