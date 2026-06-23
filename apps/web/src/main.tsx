import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertCircle, Database, LogOut, Play, RefreshCw, Send } from "lucide-react";
import type { ChatResponse, ChatThread, User } from "@text-to-sql/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./styles.css";

/**
 * APIエラーレスポンスの標準形である。
 */
type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

/**
 * 画面上の会話ログとして保持するメッセージである。
 */
type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; response: ChatResponse };

/**
 * Cookie付きでJSON APIを呼び出し、失敗時はAPIエラー文言を例外に変換する。
 *
 * @param url 呼び出すAPI path。
 * @param init fetchへ渡す追加オプション。
 * @returns APIから返されたJSON。
 */
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

/**
 * ログイン、自然言語質問入力、SQLと結果表の表示を担当するReactアプリ本体である。
 *
 * @returns Text-to-SQLの操作画面。
 */
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

  /**
   * 初回表示時に既存Cookieセッションからログイン状態を復元する。
   */
  useEffect(() => {
    requestJson<{ user: User }>("/me")
      .then((data) => setUser(data.user))
      .catch(() => undefined);
  }, []);

  /**
   * ログイン後またはスレッド更新後にチャットスレッド一覧を再取得する。
   */
  useEffect(() => {
    if (!user) return;
    requestJson<{ threads: ChatThread[] }>("/chat-threads")
      .then((data) => setThreads(data.threads))
      .catch(() => undefined);
  }, [user, threadId]);

  /**
   * 結果表示に使う直近のassistantレスポンスである。
   */
  const latestResponse = useMemo(() => {
    const assistants = messages.filter((message): message is Extract<Message, { role: "assistant" }> => {
      return message.role === "assistant";
    });
    return assistants.at(-1)?.response;
  }, [messages]);

  /**
   * デモログインフォーム送信時にCookieセッションを作成する。
   *
   * @param event フォーム送信イベント。
   */
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

  /**
   * 現在のCookieセッションを破棄し、画面状態を未ログインへ戻す。
   */
  async function handleLogout() {
    await requestJson<{ ok: true }>("/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setUser(null);
    setThreadId(undefined);
    setThreads([]);
    setMessages([]);
  }

  /**
   * 自然言語質問をAPIへ送り、SQL実行結果を会話ログと結果表へ反映する。
   *
   * @param event フォーム送信イベント。
   */
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
      <main className="grid min-h-screen place-items-center bg-muted/40 px-4">
        <Card className="w-full max-w-[420px]">
          <CardHeader>
            <CardTitle className="text-xl">Text-to-SQL</CardTitle>
            <CardDescription>Demo Account</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={handleLogin}>
              <label className="grid gap-2 text-sm font-medium">
                Email
                <Input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Password
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              {error ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button className="w-full" disabled={loading} type="submit">
                <Play />
                Login
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="grid gap-4 border-b bg-card p-4 lg:min-h-screen lg:grid-rows-[auto_auto_1fr_auto] lg:border-b-0 lg:border-r lg:p-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Text-to-SQL</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <Button
          className="justify-start"
          variant="outline"
          type="button"
          onClick={() => {
            setThreadId(undefined);
            setMessages([]);
          }}
        >
          <RefreshCw />
          New
        </Button>
        <nav className="hidden min-h-0 content-start gap-2 overflow-auto lg:grid">
          {threads.map((thread) => (
            <Button
              className="justify-start overflow-hidden text-ellipsis whitespace-nowrap"
              key={thread.id}
              variant={thread.id === threadId ? "secondary" : "ghost"}
              type="button"
              onClick={() => setThreadId(thread.id)}
            >
              {thread.title}
            </Button>
          ))}
        </nav>
        <Button className="justify-start" variant="ghost" type="button" onClick={handleLogout}>
          <LogOut />
          Logout
        </Button>
      </aside>

      <section className="grid min-w-0 grid-rows-[minmax(220px,1fr)_auto_auto_auto] gap-4 p-4 lg:p-6">
        <Card className="min-h-[220px] overflow-hidden">
          <CardContent className="grid max-h-[44vh] content-start gap-3 overflow-auto p-4 lg:max-h-[52vh] lg:p-5">
            {messages.length === 0 ? (
              <div className="grid min-h-[190px] place-items-center rounded-md border border-dashed text-muted-foreground">
                <div className="grid justify-items-center gap-2">
                  <Database className="h-5 w-5" />
                  <strong className="text-foreground">Ready</strong>
                  <span className="text-sm">tenant: data_0001</span>
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <article className="grid gap-1 border-b pb-3 last:border-b-0" key={`${message.role}-${index}`}>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">{message.role}</div>
                  <div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>
                </article>
              ))
            )}
          </CardContent>
        </Card>

        <form className="grid grid-cols-[minmax(0,1fr)_44px] gap-2" onSubmit={handleSubmit}>
          <Input value={question} onChange={(event) => setQuestion(event.target.value)} />
          <Button disabled={loading} type="submit" title="Run query" size="icon">
            <Send />
          </Button>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {latestResponse ? (
          <section className="grid min-w-0 gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{latestResponse.generationMode}</Badge>
              <Badge variant="outline">{latestResponse.rowCount} rows</Badge>
              <Badge variant="outline">{latestResponse.durationMs} ms</Badge>
            </div>
            <Card>
              <CardContent className="p-0">
                <pre className="overflow-auto p-4 text-sm leading-6">{latestResponse.sql}</pre>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {latestResponse.columns.map((column) => (
                      <TableHead className="whitespace-nowrap" key={column}>
                        {column}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestResponse.rows.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {latestResponse.columns.map((column) => (
                        <TableCell className="whitespace-nowrap" key={column}>
                          {String(row[column] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        ) : null}
      </section>
    </main>
  );
}

/**
 * ReactアプリをHTML上のroot要素へマウントする。
 */
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
