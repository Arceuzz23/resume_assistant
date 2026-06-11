// src/App.tsx
import React, { useState, useRef, useEffect } from 'react';
import { api, Message, AssistantResponse } from './lib/api';
import './index.css';

const QUICK_PROMPTS = [
  "Summarize the candidate",
  "What are their top skills?",
  "How many years of experience?",
  "Are they a fit for a backend engineer role?",
  "What's missing from the resume?",
];

export default function App() {

  const [filename, setFilename] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("Groq · Llama 3.3");
  const [isDragActive, setIsDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isUploaded = !!sessionId;
  const viewState =
    sessionId !== null
      ? "chat"
      : "landing";

  // Auto-scroll chat
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);



  const handleFileUpload = async (file: File) => {
    const okType = /\.(pdf|txt)$/i.test(file.name);
    if (!okType) return setErrorMsg("That file type won't work — upload a PDF or .txt.");
    if (file.size > 10 * 1024 * 1024) return setErrorMsg("That file is over 10 MB. Try a smaller one.");

    setIsBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.uploadResume(file);

      setSessionId(res.session_id);
      setFilename(file.name);


      const history = await api.getHistory(res.session_id);

      const restoredMessages =
        history.messages.map(
          (msg: any, index: number) => {

            if (msg.role === "user") {
              return {
                id: `u-${index}`,
                role: "user",
                text: msg.content,
              };
            }

            return {
              id: `a-${index}`,
              role: "assistant",
              data: {
                answer: msg.content,
                confidence: 0.95,
                source: "resume",
                missing_data: [],
              },
            };
          }
        );

      setMessages(restoredMessages);
      setTimeout(() => textareaRef.current?.focus(), 100);
    } catch (err) {
      setErrorMsg("Couldn't process that resume. Is the backend running?");
    } finally {
      setIsBusy(false);
      setIsDragActive(false);
    }
  };

  const handleSend = async (queryOverride?: string) => {
    const text = queryOverride || input.trim();
    if (!text || !sessionId || isBusy) return;

    setInput("");
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: "user", text }]);

    setIsBusy(true);
    setIsTyping(true);

    try {
      const data = await api.chat(sessionId, text, model);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", data }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: "error", text: "That didn't go through. Check the backend." }]);
    } finally {
      setIsBusy(false);
      setIsTyping(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className={`status ${isUploaded ? 'live' : ''}`}>
          <span className="dot"></span>
          <span>{isUploaded ? 'Connected' : 'Waiting for file'}</span>
        </div>
      </div>

      <div className="app-shell">



        <div className="app" data-view={viewState}>
          <div className="stage">

            <div className="hero">
              <svg className="logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              <h1>Hola!</h1>
            </div>

            {viewState === "landing" && (
              <p className="tagline">Upload a resume and I'll answer questions grounded in it.</p>
            )}

            <><div id="uploadSlot">
              {!isUploaded ? (
                <div
                  className={`dropzone ${isDragActive ? 'drag' : ''} ${isBusy ? 'busy' : ''}`}
                  onClick={() => !isBusy && fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragActive(true); }}
                  onDragLeave={() => setIsDragActive(false)}
                  onDrop={onDrop}
                >
                  {isBusy ? (
                    <>
                      <div className="spin"></div>
                      <div className="dz-title" style={{ marginTop: 8 }}>Reading {filename || "file"}…</div>
                      <div className="dz-sub">Extracting and structuring the resume</div>
                    </>
                  ) : (
                    <>
                      <svg className="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 16V4M12 4l-4 4M12 4l4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                      </svg>
                      <div className="dz-title">Upload your resume</div>
                      <div className="dz-sub">Drag and drop, or click to browse · PDF or TXT, up to 10 MB</div>
                      {errorMsg && <div className="dz-error">{errorMsg}</div>}
                    </>
                  )}
                </div>
              ) : (
                <div className="resume-chip">
                  <span className="check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  </span>
                  <span className="fname">{filename}</span>
                  <button className="replace" onClick={() => fileInputRef.current?.click()}>Replace</button>
                </div>
              )}
            </div><input
                type="file"
                ref={fileInputRef}
                accept=".pdf,.txt,application/pdf,text/plain"
                hidden
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                  e.target.value = '';
                }} /></>

            {isUploaded && viewState === "landing" && (
              <p className="empty-hint">Resume loaded. Ask anything — each answer is labelled <em>Resume</em> or <em>Inference</em>.</p>
            )}

            <div className="thread" ref={threadRef}>
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  {m.role === "user" && <div className="bubble-user">{m.text}</div>}

                  {m.role === "assistant" && m.data && (
                    <div className="answer">
                      <p>{m.data.answer}</p>
                      <div className="meta">
                        <span className={`badge ${m.data.source}`}>
                          <span className="dot"></span>{m.data.source === "resume" ? "Resume" : "Inference"}
                        </span>
                        <span className="conf">
                          <span className="track">
                            <span className="fill" style={{ width: `${Math.round(m.data.confidence * 100)}%`, background: m.data.source === "resume" ? "var(--resume)" : "var(--inference)" }}></span>
                          </span>
                          {Math.round(m.data.confidence * 100)}% confidence
                        </span>
                      </div>
                      {m.data.missing_data && m.data.missing_data.length > 0 && (
                        <div className="missing">Not in resume:
                          {m.data.missing_data.map(md => <span key={md} className="tag">{md}</span>)}
                        </div>
                      )}
                    </div>
                  )}

                  {m.role === "error" && (
                    <div className="errline">
                      <span>{m.text}</span>
                    </div>
                  )}
                </div>
              ))}

              {isTyping && (
                <div className="msg assistant">
                  <div className="typing"><span></span><span></span><span></span></div>
                </div>
              )}
            </div>

            <div className={`composer ${!isUploaded ? 'locked' : ''}`}>
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder={isUploaded ? "Ask about experience, skills, or fit…" : "Upload a resume to start chatting"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                disabled={!isUploaded || isBusy}
              />
              <div className="toolbar">
                <button className="tool" onClick={() => fileInputRef.current?.click()} aria-label="Upload resume">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
                <button className="model" onClick={() => setModel(m => m.includes("Groq") ? "Claude · Opus 4.8" : "Groq · Llama 3.3")}>
                  <span>{model}</span><span className="lvl">Fast</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                <button
                  className="send"
                  disabled={!input.trim() || !isUploaded || isBusy}
                  onClick={() => handleSend()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M12 5l-6 6M12 5l6 6" /></svg>
                </button>
              </div>
            </div>

            <div className="pills">
              {QUICK_PROMPTS.map(q => (
                <button
                  key={q}
                  className="pill"
                  disabled={!isUploaded || isBusy}
                  onClick={() => handleSend(q)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  {q}
                </button>
              ))}
            </div>

          </div> {/* stage */}
        </div> {/* app */}

      </div> {/* app-shell */}

    </>
  );
}