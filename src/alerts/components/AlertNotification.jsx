```jsx
import React, { useEffect, useState, useCallback } from 'react';

const ALERTS_STORAGE_KEY = 'clinician_alerts_acknowledged';

const priorityConfig = {
  critical: {
    color: '#d32f2f',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
      </svg>
    ),
    soundSrc:
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAD///8=', // dummy silent wav, replace with real alert sound URL or base64
  },
  high: {
    color: '#f57c00',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M1 21h22L12 2 1 21zM12 16v-4h-2v4h2zm0 4v-2h-2v2h2z" />
      </svg>
    ),
    soundSrc: null,
  },
  medium: {
    color: '#1976d2',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
    soundSrc: null,
  },
  low: {
    color: '#388e3c',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <circle cx="12" cy="12" r="6" />
      </svg>
    ),
    soundSrc: null,
  },
};

const playSound = (src) => {
  if (!src) return;
  try {
    const audio = new Audio(src);
    audio.play();
  } catch {
    // fail silently if sound cannot be played
  }
};

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  if (isNaN(date)) return '';
  return date.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function AlertNotification({ alert }) {
  const { id, priority, message, details, timestamp } = alert;
  const config = priorityConfig[priority] || priorityConfig.low;

  const [acknowledged, setAcknowledged] = useState(false);

  // Load acknowledged status from localStorage
  useEffect(() => {
    try {
      const ackData = JSON.parse(
        localStorage.getItem(ALERTS_STORAGE_KEY) || '{}'
      );
      if (ackData[id]) setAcknowledged(true);
    } catch {
      // ignore parse errors
    }
  }, [id]);

  // On mount, play sound if critical and not acknowledged
  useEffect(() => {
    if (!acknowledged && priority === 'critical') {
      playSound(config.soundSrc);
    }
  }, [acknowledged, priority, config.soundSrc]);

  const acknowledgeAlert = useCallback(() => {
    setAcknowledged(true);
    try {
      const ackData = JSON.parse(
        localStorage.getItem(ALERTS_STORAGE_KEY) || '{}'
      );
      ackData[id] = true;
      localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(ackData));
    } catch {
      // ignore write errors
    }
  }, [id]);

  if (acknowledged) return null;

  return (
    <section
      role="alert"
      aria-live={priority === 'critical' ? 'assertive' : 'polite'}
      aria-atomic="true"
      tabIndex={0}
      style={{
        borderLeft: `4px solid ${config.color}`,
        backgroundColor: '#fff',
        boxShadow: '0 2px 6px rgb(0 0 0 / 0.15)',
        marginBottom: 12,
        padding: 16,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        maxWidth: 480,
      }}
    >
      <span
        aria-hidden="true"
        style={{ color: config.color, flexShrink: 0, marginTop: 2 }}
      >
        {config.icon}
      </span>
      <div style={{ flexGrow: 1 }}>
        <p
          style={{
            margin: 0,
            fontWeight: '600',
            color: '#222',
            fontSize: '1rem',
          }}
        >
          {message}
        </p>
        {details && (
          <p
            style={{
              margin: '4px 0 0',
              color: '#555',
              fontSize: '0.875rem',
              whiteSpace: 'pre-wrap',
            }}
          >
            {details}
          </p>
        )}
        <time
          dateTime={timestamp}
          style={{ display: 'block', marginTop: 6, fontSize: '0.75rem', color: '#777' }}
        >
          {formatTimestamp(timestamp)}
        </time>
      </div>
      <button
        aria-label={`Dismiss alert: ${message}`}
        onClick={acknowledgeAlert}
        style={{
          background: 'transparent',
          border: 'none',
          color: config.color,
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          padding: 4,
          marginLeft: 8,
          alignSelf: 'start',
        }}
        title="Dismiss alert"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill={config.color}
        >
          <path d="M18 6L6 18M6 6l12 12" stroke={config.color} strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}
```