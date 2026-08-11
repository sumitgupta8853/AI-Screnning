import React, { useEffect, useRef } from "react";

export default function CallScreen({
  messages,
  aiState,
  recording,
  notice,
  micError,
  onRecordStart,
  onRecordStop,
  onEndCall,
}) {
  const feedRef = useRef(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages]);

  const statusLabel = recording
    ? "Listening to you\u2026"
    : aiState === "thinking"
    ? "Ava is thinking\u2026"
    : aiState === "speaking"
    ? "Ava is speaking\u2026"
    : "Hold the button and talk";

  return (
    <div className="call-screen">
      <div className="call-header">
        <div className="live-indicator">
          <span className="live-dot" /> Live call
        </div>
        <button className="end-call-btn" onClick={onEndCall} type="button">
          End call
        </button>
      </div>

      <div className="orb-wrap">
        <div className={`orb ring ${recording ? "listening" : aiState}`} />
        <div className={`orb core ${recording ? "listening" : aiState}`} />
        <p className="orb-status">{statusLabel}</p>
      </div>

      <div className="transcript-feed" ref={feedRef}>
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <span className="bubble-label">{m.role === "assistant" ? "Ava" : "You"}</span>
            <span className="bubble-text">{m.text}</span>
          </div>
        ))}
      </div>

      {(notice || micError) && <div className="notice-bar">{micError || notice}</div>}

      <div className="talk-controls">
        <button
          className={`talk-btn ${recording ? "recording" : ""}`}
          onMouseDown={onRecordStart}
          onMouseUp={onRecordStop}
          onMouseLeave={() => recording && onRecordStop()}
          onTouchStart={(e) => {
            e.preventDefault();
            onRecordStart();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            onRecordStop();
          }}
          type="button"
        >
          {recording ? "Release to send" : "Hold to talk"}
        </button>
      </div>
    </div>
  );
}
