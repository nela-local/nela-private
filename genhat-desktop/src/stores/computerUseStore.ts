import { create } from "zustand";
import { Api } from "../api";

export type ComputerUseEvent = {
  event: string;
  run_id?: string;
  goal?: string;
  text?: string;
  prompt?: string;
  kind?: "confirm" | "clarify" | string;
  step?: number;
  action?: string;
  detail?: string;
  summary?: string;
  status?: string;
  message?: string;
  nela_calls?: number;
};

export type ComputerUseConfirmResult =
  | { confirmed: true; answer: string }
  | { confirmed: false; reason: "user_cancelled" };

type PendingInput = {
  runId: string;
  prompt: string;
  kind: "confirm" | "clarify";
};

interface ComputerUseState {
  enabled: boolean;
  running: boolean;
  runId: string | null;
  goal: string | null;
  lastNarration: string | null;
  steps: Array<{ step: number; action: string }>;
  pendingInput: PendingInput | null;
  lastError: string | null;
}

let startConfirmResolve: ((value: ComputerUseConfirmResult) => void) | null =
  null;

export const useComputerUseStore = create<ComputerUseState>(() => ({
  enabled: false,
  running: false,
  runId: null,
  goal: null,
  lastNarration: null,
  steps: [],
  pendingInput: null,
  lastError: null,
}));

export const setComputerUseEnabled = (enabled: boolean) => {
  useComputerUseStore.setState({ enabled });
};

export const openComputerUseStartConfirm = (
  goal: string
): Promise<ComputerUseConfirmResult> => {
  if (startConfirmResolve) {
    startConfirmResolve({ confirmed: false, reason: "user_cancelled" });
    startConfirmResolve = null;
  }
  return new Promise((resolve) => {
    startConfirmResolve = resolve;
    useComputerUseStore.setState({
      pendingInput: {
        runId: "__start__",
        prompt: `Allow Computer Use to control this machine for:\n\n“${goal}”`,
        kind: "confirm",
      },
      goal,
      lastError: null,
    });
  });
};

export const resolveComputerUsePending = async (answer: string) => {
  const pending = useComputerUseStore.getState().pendingInput;
  if (!pending) return;

  // Start gate (before sidecar run)
  if (pending.runId === "__start__") {
    const resolver = startConfirmResolve;
    startConfirmResolve = null;
    useComputerUseStore.setState({ pendingInput: null });
    const ok = /^(y|yes|ok|okay|sure|proceed|allow|go|do it)\b/i.test(answer.trim())
      || answer.trim() === "yes"
      || answer === "__allow__";
    resolver?.(
      ok
        ? { confirmed: true, answer: "yes" }
        : { confirmed: false, reason: "user_cancelled" }
    );
    return;
  }

  useComputerUseStore.setState({ pendingInput: null });
  try {
    await Api.computerUseRespond({
      runId: pending.runId,
      answer,
      kind: pending.kind,
    });
  } catch (e) {
    useComputerUseStore.setState({
      lastError: e instanceof Error ? e.message : String(e),
    });
  }
};

export const denyComputerUsePending = async () => {
  const pending = useComputerUseStore.getState().pendingInput;
  if (!pending) return;
  if (pending.runId === "__start__") {
    await resolveComputerUsePending("no");
    return;
  }
  useComputerUseStore.setState({ pendingInput: null });
  try {
    await Api.computerUseRespond({
      runId: pending.runId,
      answer: "no",
      kind: pending.kind,
    });
  } catch {
    /* ignore */
  }
};

export const cancelComputerUseRun = async () => {
  const { runId } = useComputerUseStore.getState();
  try {
    await Api.computerUseCancel(runId);
  } catch {
    /* ignore */
  }
  if (startConfirmResolve) {
    startConfirmResolve({ confirmed: false, reason: "user_cancelled" });
    startConfirmResolve = null;
  }
  useComputerUseStore.setState({
    running: false,
    pendingInput: null,
  });
};

export const handleComputerUseEvent = (raw: ComputerUseEvent) => {
  const event = raw.event;
  if (event === "started") {
    useComputerUseStore.setState({
      running: true,
      runId: raw.run_id ?? null,
      goal: raw.goal ?? useComputerUseStore.getState().goal,
      steps: [],
      lastNarration: null,
      lastError: null,
      pendingInput: null,
    });
    return;
  }
  if (event === "narrate" && raw.text) {
    useComputerUseStore.setState({ lastNarration: raw.text });
    return;
  }
  if (event === "step") {
    const step = raw.step ?? 0;
    const action = raw.action ?? raw.detail ?? "step";
    useComputerUseStore.setState((s) => ({
      steps: [...s.steps, { step, action }].slice(-20),
      lastNarration: action,
    }));
    return;
  }
  if (event === "need_input" && raw.prompt && raw.run_id) {
    useComputerUseStore.setState({
      pendingInput: {
        runId: raw.run_id,
        prompt: raw.prompt,
        kind: raw.kind === "confirm" ? "confirm" : "clarify",
      },
    });
    return;
  }
  if (event === "error" && raw.message) {
    useComputerUseStore.setState({ lastError: raw.message });
    return;
  }
  if (event === "done") {
    useComputerUseStore.setState({
      running: false,
      pendingInput: null,
      lastNarration: raw.summary ?? useComputerUseStore.getState().lastNarration,
    });
  }
};
