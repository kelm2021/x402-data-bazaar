"use client";

import { useEffect, useState } from "react";

type JsonState = {
  loading: boolean;
  error: string | null;
  payload: unknown;
};

type Props = {
  path: string;
};

export function JsonInspector({ path }: Props) {
  const [state, setState] = useState<JsonState>({
    loading: true,
    error: null,
    payload: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState({ loading: true, error: null, payload: null });
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = (await response.json()) as unknown;
        if (!cancelled) {
          setState({ loading: false, error: null, payload: json });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unknown error";
          setState({ loading: false, error: message, payload: null });
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state.loading) {
    return <p className="muted">Loading {path} ...</p>;
  }

  if (state.error) {
    return <p className="error">Unable to load {path}: {state.error}</p>;
  }

  return <pre className="json-panel">{JSON.stringify(state.payload, null, 2)}</pre>;
}
