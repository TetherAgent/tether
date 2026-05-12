import * as React from 'react';
import {
  Badge,
  Button,
  InfoBlock,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tether/design';
import { ArrowLeft, Bot, RefreshCcw, Terminal, User, Zap } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminPageFrame, AdminPanel } from '../components/console/admin-page-frame.js';
import {
  getSession,
  listSessionChatEvents,
  listSessionMessages,
  listSessionRuntimeEvents,
  type AdminChatEvent,
  type AdminChatMessage,
  type AdminRuntimeEvent,
  type AdminSession,
} from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

type Tab = 'messages' | 'events' | 'chat-events';

const PAGE_SIZE = 50;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function SessionMeta({ session }: { session: AdminSession }) {
  const fields = [
    { label: 'Session ID', value: session.id, mono: true },
    { label: 'Transport', value: session.transport },
    { label: 'Status', value: session.status },
    { label: 'Provider', value: session.provider },
    { label: '用户', value: session.userEmail ?? session.userId ?? '—' },
    { label: 'Gateway ID', value: session.gatewayId, mono: true },
    { label: 'Agent Session ID', value: session.agentSessionId ?? '—', mono: true },
    { label: '项目路径', value: session.projectPath ?? '—' },
    { label: '最后活跃', value: session.lastActiveAt ? formatDate(session.lastActiveAt) : '—' },
    { label: '创建时间', value: formatDate(session.createdAt) },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {fields.map(f => (
        <div key={f.label} className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-foreground-tertiary">{f.label}</div>
          <div className={`mt-1 truncate text-sm font-medium text-foreground ${f.mono ? 'font-mono' : ''}`}>
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagesTab({ token, sessionId }: { token: string; sessionId: string }) {
  const [messages, setMessages] = React.useState<AdminChatMessage[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set());

  React.useEffect(() => {
    setLoading(true);
    setError(null);
    listSessionMessages(token, sessionId, page)
      .then(result => { setMessages(result.messages); setTotal(result.total); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'))
      .finally(() => setLoading(false));
  }, [token, sessionId, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (error) return <InfoBlock variant="error" title="消息加载失败" description={error} />;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold">角色</TableHead>
              <TableHead className="text-xs font-semibold">内容预览</TableHead>
              <TableHead className="text-xs font-semibold">Token 用量</TableHead>
              <TableHead className="text-xs font-semibold">时间</TableHead>
              <TableHead className="text-xs font-semibold">详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : messages.length === 0
              ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      该会话暂无 Chat 消息
                    </TableCell>
                  </TableRow>
                )
              : messages.map(msg => (
                  <React.Fragment key={msg.id}>
                    <TableRow>
                      <TableCell className="align-top">
                        {msg.role === 'user'
                          ? <Badge variant="secondary"><User className="mr-1 inline size-3" />用户</Badge>
                          : <Badge variant="info"><Bot className="mr-1 inline size-3" />助手</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[320px] align-top">
                        <p className="line-clamp-2 text-sm text-foreground">{msg.content}</p>
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground">
                        {typeof msg.usageJson.input_tokens === 'number'
                          ? `in ${msg.usageJson.input_tokens} / out ${msg.usageJson.output_tokens}`
                          : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(msg.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => toggleExpand(msg.id)}>
                          {expandedIds.has(msg.id) ? '收起' : '展开'}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedIds.has(msg.id) && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/10 p-4">
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-border/60 bg-background p-4 text-xs text-foreground">
                            {msg.content}
                          </pre>
                          {Object.keys(msg.usageJson).length > 0 && (
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-2xl border border-border/60 bg-background p-4 text-xs text-muted-foreground">
                              {JSON.stringify(msg.usageJson, null, 2)}
                            </pre>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
          </TableBody>
        </Table>
      </div>
      {!loading && total > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>第 {page} 页，共 {total} 条消息</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RuntimeEventsTab({ token, sessionId }: { token: string; sessionId: string }) {
  const [events, setEvents] = React.useState<AdminRuntimeEvent[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set());

  React.useEffect(() => {
    setLoading(true);
    setError(null);
    listSessionRuntimeEvents(token, sessionId, page)
      .then(result => { setEvents(result.events); setTotal(result.total); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'))
      .finally(() => setLoading(false));
  }, [token, sessionId, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (error) return <InfoBlock variant="error" title="事件加载失败" description={error} />;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold">Event ID</TableHead>
              <TableHead className="text-xs font-semibold">类型</TableHead>
              <TableHead className="text-xs font-semibold">时间</TableHead>
              <TableHead className="text-xs font-semibold">Payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : events.length === 0
              ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      该会话暂无运行事件
                    </TableCell>
                  </TableRow>
                )
              : events.map(evt => (
                  <React.Fragment key={evt.eventId}>
                    <TableRow>
                      <TableCell className="font-mono text-xs text-muted-foreground">{evt.eventId}</TableCell>
                      <TableCell>
                        {evt.eventType.startsWith('agent.') || evt.eventType.startsWith('session.')
                          ? <Badge variant="warning">{evt.eventType}</Badge>
                          : <Badge variant="secondary">{evt.eventType}</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(evt.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => toggleExpand(evt.eventId)}>
                          {expandedIds.has(evt.eventId) ? '收起' : '展开'}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedIds.has(evt.eventId) && (
                      <TableRow>
                        <TableCell colSpan={4} className="bg-muted/10 p-4">
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-border/60 bg-background p-4 text-xs text-foreground">
                            {JSON.stringify(evt.payloadJson, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
          </TableBody>
        </Table>
      </div>
      {!loading && total > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>第 {page} 页，共 {total} 条事件（按 event_id 倒序）</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatEventsTab({ token, sessionId }: { token: string; sessionId: string }) {
  const [events, setEvents] = React.useState<AdminChatEvent[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    setError(null);
    listSessionChatEvents(token, sessionId, page)
      .then(result => { setEvents(result.events); setTotal(result.total); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'))
      .finally(() => setLoading(false));
  }, [token, sessionId, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (error) return <InfoBlock variant="error" title="原始事件加载失败" description={error} />;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold">ID</TableHead>
              <TableHead className="text-xs font-semibold">Event ID</TableHead>
              <TableHead className="text-xs font-semibold">类型</TableHead>
              <TableHead className="text-xs font-semibold">时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : events.length === 0
              ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      该会话暂无原始 Chat 事件
                    </TableCell>
                  </TableRow>
                )
              : events.map(evt => (
                  <TableRow key={evt.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{evt.id}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{evt.eventId}</TableCell>
                    <TableCell><Badge variant="secondary">{evt.eventType}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(evt.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      {!loading && total > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>第 {page} 页，共 {total} 条原始事件</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SessionDetailPage() {
  const { managementAuth } = useAdminAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = React.useState<AdminSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>('messages');

  React.useEffect(() => {
    if (!managementAuth?.accessToken || !id) return;
    setLoading(true);
    setError(null);
    getSession(managementAuth.accessToken, id)
      .then(setSession)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'))
      .finally(() => setLoading(false));
  }, [managementAuth, id]);

  const defaultTab = session?.transport === 'chat' ? 'messages' : 'events';

  React.useEffect(() => {
    if (session) setTab(session.transport === 'chat' ? 'messages' : 'events');
  }, [session]);

  const tabs = ([
    { key: 'messages' as Tab, label: 'Chat 消息', icon: Bot, show: session?.transport === 'chat' },
    { key: 'events' as Tab, label: '运行事件', icon: Terminal, show: session?.transport !== 'chat' },
    { key: 'chat-events' as Tab, label: '原始事件', icon: Zap, show: session?.transport === 'chat' },
  ] as { key: Tab; label: string; icon: React.ElementType; show: boolean }[]).filter(t => t.show);

  const activeTab = tabs.find(t => t.key === tab) ? tab : (tabs[0]?.key ?? defaultTab);

  return (
    <AdminPageFrame
      eyebrow="Session Detail"
      title={session?.title ?? (loading ? '加载中…' : '会话详情')}
      description="查看会话的完整消息历史或运行事件流，用于取证和调试。"
      actions={
        <Button variant="outline" size="sm" onClick={() => navigate('/admin/sessions')}>
          <span className="inline-flex items-center gap-2">
            <ArrowLeft className="size-4" />
            返回会话列表
          </span>
        </Button>
      }
    >
      {error ? (
        <InfoBlock variant="error" title="会话加载失败" description={error} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-background/70 px-4 py-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-full" />
            </div>
          ))}
        </div>
      ) : session ? (
        <SessionMeta session={session} />
      ) : null}

      {session && managementAuth?.accessToken && (
        <AdminPanel
          title="数据明细"
          description={
            session.transport === 'chat'
              ? '该会话为 Chat 类型，可查看对话消息和原始事件流。'
              : '该会话为终端类型，可查看运行事件流。'
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            {tabs.map(t => (
              <Button
                key={t.key}
                variant={activeTab === t.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTab(t.key)}
              >
                <span className="inline-flex items-center gap-2">
                  <t.icon className="size-4" />
                  {t.label}
                </span>
              </Button>
            ))}
          </div>

          {activeTab === 'messages' && (
            <MessagesTab token={managementAuth.accessToken} sessionId={session.id} />
          )}
          {activeTab === 'events' && (
            <RuntimeEventsTab token={managementAuth.accessToken} sessionId={session.id} />
          )}
          {activeTab === 'chat-events' && (
            <ChatEventsTab token={managementAuth.accessToken} sessionId={session.id} />
          )}
        </AdminPanel>
      )}
    </AdminPageFrame>
  );
}
