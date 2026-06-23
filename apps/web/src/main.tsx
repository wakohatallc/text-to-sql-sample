import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useChat } from "@ai-sdk/react";
import {
  AlertCircle,
  BarChart3,
  Code2,
  Database,
  LineChart as LineChartIcon,
  ListChecks,
  LogOut,
  MessageSquareText,
  PieChart as PieChartIcon,
  Play,
  RefreshCw,
  Send,
  Table2
} from "lucide-react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type {
  ChatDataParts,
  ChatMetadata,
  ChatThread,
  SqlResultData,
  TraceData,
  User,
  VisualizationData
} from "@text-to-sql/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./styles.css";

type AppChatMessage = UIMessage<ChatMetadata, ChatDataParts>;

/**
 * APIエラーレスポンスの標準形である。
 */
type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

const chartColors = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2"];

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

function traceTone(status: TraceData["status"]): "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "running") return "outline";
  return "secondary";
}

function visualizationIcon(kind: VisualizationData["kind"]) {
  if (kind === "bar") return <BarChart3 className="h-4 w-4" />;
  if (kind === "line") return <LineChartIcon className="h-4 w-4" />;
  if (kind === "pie") return <PieChartIcon className="h-4 w-4" />;
  return <Table2 className="h-4 w-4" />;
}

function ResultTable({ result }: { result: SqlResultData }) {
  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((column) => (
              <TableHead className="whitespace-nowrap" key={column}>
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {result.columns.map((column) => (
                <TableCell className="whitespace-nowrap" key={column}>
                  {String(row[column] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ResultChart({ result, visualization }: { result: SqlResultData; visualization: VisualizationData }) {
  if (visualization.kind === "table" || !visualization.xKey || !visualization.yKey) {
    return <ResultTable result={result} />;
  }

  const data = result.rows
    .map((row) => {
      const rawValue = row[visualization.yKey!];
      const numericValue = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? Number(rawValue) : NaN;
      return { ...row, [visualization.yKey!]: numericValue };
    })
    .filter((row) => Number.isFinite(row[visualization.yKey!] as number));

  if (data.length === 0) {
    return <ResultTable result={result} />;
  }

  return (
    <div className="h-[320px] rounded-md border p-3">
      <ResponsiveContainer width="100%" height="100%">
        {visualization.kind === "line" ? (
          <LineChart data={data} margin={{ top: 10, right: 24, bottom: 24, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={visualization.xKey} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey={visualization.yKey} stroke="#2563eb" strokeWidth={2} dot={false} />
          </LineChart>
        ) : visualization.kind === "pie" ? (
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie data={data} dataKey={visualization.yKey} nameKey={visualization.xKey} outerRadius={105} label>
              {data.map((_row, index) => (
                <Cell key={index} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 10, right: 24, bottom: 24, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={visualization.xKey} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey={visualization.yKey} fill="#2563eb" />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function MessageBlock({
  children,
  icon,
  title,
  compact = false
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
  compact?: boolean;
}) {
  return (
    <section className="grid gap-2 rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className={compact ? "text-xs leading-5" : "text-sm leading-6"}>{children}</div>
    </section>
  );
}

function AssistantMessage({ message }: { message: AppChatMessage }) {
  const traces = message.parts
    .filter((part) => part.type === "data-trace")
    .map((part) => part.data);
  const sql = [...message.parts].reverse().find((part) => part.type === "data-sql")?.data.sql;
  const result = [...message.parts].reverse().find((part) => part.type === "data-sql-result")?.data;
  const visualization = [...message.parts].reverse().find((part) => part.type === "data-visualization")?.data ?? {
    kind: "table"
  };

  return (
    <article className="grid gap-3 border-b pb-4 last:border-b-0">
      {message.parts
        .filter((part) => part.type === "text")
        .map((part, index) => (
          <MessageBlock icon={<MessageSquareText className="h-3.5 w-3.5" />} key={`text-${index}`} title="応答">
            <div className="whitespace-pre-wrap">{part.text}</div>
          </MessageBlock>
        ))}
      {traces.length > 0 ? (
        <MessageBlock compact icon={<ListChecks className="h-3.5 w-3.5" />} title="推論過程">
          <div className="flex flex-wrap gap-1.5">
            {traces.map((trace, index) => (
              <Badge className="px-2 py-0 text-[11px] leading-5" key={`${trace.label}-${index}`} variant={traceTone(trace.status)}>
                {trace.label}
                {trace.detail ? `: ${trace.detail}` : ""}
              </Badge>
            ))}
          </div>
        </MessageBlock>
      ) : null}
      {sql ? (
        <details className="rounded-md border bg-muted/30 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold text-muted-foreground">
            <Code2 className="h-3.5 w-3.5" />
            SQL
          </summary>
          <pre className="overflow-auto border-t p-3 leading-5">{sql}</pre>
        </details>
      ) : null}
      {result ? (
        <MessageBlock icon={visualizationIcon(visualization.kind)} title="結果描画">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              {visualizationIcon(visualization.kind)}
              {visualization.kind}
            </Badge>
            <Badge variant="outline">{result.rowCount} rows</Badge>
            <Badge variant="outline">{result.durationMs} ms</Badge>
          </div>
          <ResultChart result={result} visualization={visualization} />
        </MessageBlock>
      ) : null}
    </article>
  );
}

function UserMessage({ message }: { message: AppChatMessage }) {
  return (
    <article className="grid gap-3 border-b pb-4 last:border-b-0">
      <MessageBlock icon={<MessageSquareText className="h-3.5 w-3.5" />} title="ユーザー入力">
      {message.parts
        .filter((part) => part.type === "text")
        .map((part, index) => (
          <div className="whitespace-pre-wrap" key={index}>
            {part.text}
          </div>
        ))}
      </MessageBlock>
    </article>
  );
}

function ChatMessage({ message }: { message: AppChatMessage }) {
  return message.role === "assistant" ? <AssistantMessage message={message} /> : <UserMessage message={message} />;
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
  const [email, setEmail] = useState("demo@example.com");
  const [password, setPassword] = useState("password");
  const [question, setQuestion] = useState("2018年の売り上げランキング上位10位を棒グラフで描画して");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AppChatMessage>({
        api: "/api/chat",
        credentials: "include"
      }),
    []
  );

  const chat = useChat<AppChatMessage>({
    transport,
    onFinish: ({ message }) => {
      if (message.metadata?.threadId) {
        setThreadId(message.metadata.threadId);
      }
    },
    onError: (chatError) => setError(chatError.message)
  });

  const busy = loading || chat.status === "submitted" || chat.status === "streaming";

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
  }, [user, threadId, chat.status]);

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
    chat.setMessages([]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setError(null);
    await chat.sendMessage({ text: trimmed }, { body: { threadId } });
    setQuestion("");
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
            chat.setMessages([]);
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
              onClick={() => {
                setThreadId(thread.id);
                chat.setMessages([]);
              }}
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

      <section className="grid min-w-0 grid-rows-[minmax(260px,1fr)_auto_auto] gap-4 p-4 lg:p-6">
        <Card className="min-h-[260px] overflow-hidden">
          <CardContent className="grid max-h-[68vh] content-start gap-4 overflow-auto p-4 lg:p-5">
            {chat.messages.length === 0 ? (
              <div className="grid min-h-[220px] place-items-center rounded-md border border-dashed text-muted-foreground">
                <div className="grid justify-items-center gap-2">
                  <Database className="h-5 w-5" />
                  <strong className="text-foreground">Ready</strong>
                  <span className="text-sm">tenant: data_0001</span>
                </div>
              </div>
            ) : (
              chat.messages.map((message) => <ChatMessage key={message.id} message={message} />)
            )}
          </CardContent>
        </Card>

        <form className="grid grid-cols-[minmax(0,1fr)_44px] gap-2" onSubmit={handleSubmit}>
          <Input value={question} onChange={(event) => setQuestion(event.target.value)} />
          <Button disabled={busy} type="submit" title="Run query" size="icon">
            <Send />
          </Button>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
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
