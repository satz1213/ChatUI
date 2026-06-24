import { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, StreamingMessage } from './types';
import './App.css';

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => sessionStorage.getItem('claude_api_key') ?? '');
  const [keyDraft, setKeyDraft] = useState('');
  const [mcpUrlDraft, setMcpUrlDraft] = useState(sessionStorage.getItem('mcp_server_url') ?? '');
  const [mcpTokenDraft, setMcpTokenDraft] = useState(sessionStorage.getItem('mcp_auth_token') ?? '');
  const [mcpServerUrl, setMcpServerUrl] = useState<string>(sessionStorage.getItem('mcp_server_url') ?? '');
  const [mcpAuthToken, setMcpAuthToken] = useState<string>(sessionStorage.getItem('mcp_auth_token') ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState('');
  const [showKeySetup, setShowKeySetup] = useState(!sessionStorage.getItem('claude_api_key'));
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [showMcpFields, setShowMcpFields] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming?.text]);

  const saveKey = () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    sessionStorage.setItem('claude_api_key', trimmed);
    setApiKey(trimmed);

    const url = mcpUrlDraft.trim();
    const token = mcpTokenDraft.trim();
    if (url) {
      sessionStorage.setItem('mcp_server_url', url);
      sessionStorage.setItem('mcp_auth_token', token);
    } else {
      sessionStorage.removeItem('mcp_server_url');
      sessionStorage.removeItem('mcp_auth_token');
    }
    setMcpServerUrl(url);
    setMcpAuthToken(token);

    setKeyDraft('');
    setShowKeySetup(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming || !apiKey) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsStreaming(true);
    setStreaming({ text: '', thinking: '' });

    let accText = '';
    let accThinking = '';
    let completed = false;

    try {
      const body: Record<string, unknown> = {
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
        apiKey,
      };
      if (mcpServerUrl) {
        body.mcpServerUrl = mcpServerUrl;
        body.mcpAuthToken = mcpAuthToken;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }

          switch (event.type) {
            case 'text':
              accText += (event.text as string) ?? '';
              setStreaming({ text: accText, thinking: accThinking });
              break;
            case 'thinking':
              accThinking += (event.thinking as string) ?? '';
              setStreaming({ text: accText, thinking: accThinking });
              break;
            case 'done':
              completed = true;
              setMessages(prev => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: accText,
                  thinking: accThinking || undefined,
                },
              ]);
              setStreaming(null);
              setIsStreaming(false);
              break;
            case 'error':
              throw new Error((event.message as string) ?? 'API error');
          }
        }
      }

      if (!completed) {
        setMessages(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: accText || '(empty response)',
            thinking: accThinking || undefined,
          },
        ]);
        setStreaming(null);
        setIsStreaming(false);
      }
    } catch (err) {
      if (!completed) {
        setMessages(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
            isError: true,
          },
        ]);
        setStreaming(null);
        setIsStreaming(false);
      }
    }
  }, [input, isStreaming, apiKey, messages, mcpServerUrl, mcpAuthToken]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleThinking = (id: string) => {
    setExpandedThinking(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── API Key Setup Screen ──────────────────────────────────
  if (showKeySetup || !apiKey) {
    return (
      <div className="key-setup">
        <div className="key-card">
          <div className="key-logo">⬡</div>
          <h1>Claude Chat</h1>
          <p className="key-sub">Enter your Anthropic API key to get started</p>
          <input
            className="key-input"
            type="password"
            placeholder="sk-ant-api03-…"
            value={keyDraft}
            onChange={e => setKeyDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveKey()}
            autoFocus
          />

          <button
            className="mcp-toggle"
            type="button"
            onClick={() => setShowMcpFields(v => !v)}
          >
            {showMcpFields ? '▾' : '▸'} Salesforce MCP (optional)
          </button>

          {showMcpFields && (
            <div className="mcp-fields">
              <label className="mcp-label">Salesforce MCP Server URL</label>
              <input
                className="key-input"
                type="text"
                placeholder="https://your-org.my.salesforce.com/mcp/v1"
                value={mcpUrlDraft}
                onChange={e => setMcpUrlDraft(e.target.value)}
              />
              <label className="mcp-label">Salesforce Auth Token</label>
              <input
                className="key-input"
                type="password"
                placeholder="OAuth access token"
                value={mcpTokenDraft}
                onChange={e => setMcpTokenDraft(e.target.value)}
              />
              <p className="key-note" style={{ marginTop: '6px' }}>
                Find the URL in your Salesforce org Setup → MCP or from your claude.ai integration settings.
              </p>
            </div>
          )}

          <button className="key-btn" onClick={saveKey} disabled={!keyDraft.trim()}>
            Start Chatting
          </button>
          <p className="key-note">
            Stored in session storage only. Never saved to disk or sent to any third party.
          </p>
        </div>
      </div>
    );
  }

  // ── Main Chat UI ──────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="header-logo">⬡</span>
          <span>Claude Chat</span>
          {mcpServerUrl && <span className="mcp-badge">Salesforce</span>}
        </div>
        <div className="header-actions">
          <button className="btn-ghost" onClick={() => setMessages([])}>
            New Chat
          </button>
          <button className="btn-ghost" onClick={() => setShowKeySetup(true)}>
            API Key
          </button>
        </div>
      </header>

      <main className="chat-area">
        {messages.length === 0 && !streaming && (
          <div className="empty-state">
            <div className="empty-logo">⬡</div>
            <h2>How can I help you?</h2>
            <p>
              {mcpServerUrl
                ? 'Claude Opus 4.8 with Salesforce MCP'
                : 'Powered by Claude Opus 4.8 with adaptive thinking'}
            </p>
          </div>
        )}

        <div className="messages">
          {messages.map(msg => (
            <div key={msg.id} className={`msg msg-${msg.role}`}>
              {msg.role === 'assistant' && <div className="avatar">C</div>}
              <div className="msg-content">
                {msg.thinking && (
                  <div className="thinking">
                    <button className="thinking-toggle" onClick={() => toggleThinking(msg.id)}>
                      <span className="thinking-arrow">
                        {expandedThinking.has(msg.id) ? '▾' : '▸'}
                      </span>
                      Thinking
                    </button>
                    {expandedThinking.has(msg.id) && (
                      <pre className="thinking-text">{msg.thinking}</pre>
                    )}
                  </div>
                )}
                <div className={`bubble${msg.isError ? ' bubble-error' : ''}`}>
                  {msg.content}
                </div>
              </div>
              {msg.role === 'user' && <div className="avatar avatar-user">U</div>}
            </div>
          ))}

          {streaming !== null && (
            <div className="msg msg-assistant">
              <div className="avatar">C</div>
              <div className="msg-content">
                {streaming.thinking && (
                  <div className="thinking">
                    <button className="thinking-toggle">
                      <span className="thinking-arrow thinking-spin">◌</span>
                      Thinking…
                    </button>
                  </div>
                )}
                <div className="bubble">
                  {streaming.text
                    ? <>{streaming.text}<span className="cursor" /></>
                    : <span className="dots"><span>.</span><span>.</span><span>.</span></span>
                  }
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="input-area">
        <div className="input-row">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="Message Claude… (Shift+Enter for new line)"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            rows={1}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            title="Send (Enter)"
          >
            ↑
          </button>
        </div>
        <p className="input-hint">Claude Opus 4.8 · Enter to send · Shift+Enter for new line</p>
      </footer>
    </div>
  );
}
