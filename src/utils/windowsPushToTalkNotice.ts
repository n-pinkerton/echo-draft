export type WindowsPushToTalkRoute = "insert" | "clipboard";

export interface WindowsPushToTalkRouteState {
  reason?: string;
  routeId?: WindowsPushToTalkRoute;
  fallbackActive?: boolean;
  recoveryPending?: boolean;
  recordingSafetyStopped?: boolean;
}

export interface WindowsPushToTalkUnavailablePayload extends WindowsPushToTalkRouteState {
  unavailableRoutes?: WindowsPushToTalkRouteState[];
}

export interface WindowsPushToTalkRecoveredPayload {
  routeId?: WindowsPushToTalkRoute;
  remainingUnavailableRoutes?: WindowsPushToTalkRoute[];
  remainingUnavailableRouteStates?: WindowsPushToTalkRouteState[];
}

export interface WindowsPushToTalkNotice {
  title: string;
  description: string;
  duration: number;
  variant: "default" | "success";
  tray: {
    stage: "done" | "error";
    stageLabel: string;
    message: string;
  };
  remainsUnavailable: boolean;
}

const routeLabel = (routeId?: WindowsPushToTalkRoute) =>
  routeId === "clipboard" ? "Clipboard" : "Insert";

const normalizeRouteState = (
  state: WindowsPushToTalkRouteState,
  fallbackRoute: WindowsPushToTalkRoute = "insert"
): Required<Pick<WindowsPushToTalkRouteState, "routeId">> & WindowsPushToTalkRouteState => ({
  ...state,
  routeId:
    state.routeId === "clipboard"
      ? "clipboard"
      : state.routeId === "insert"
        ? "insert"
        : fallbackRoute,
});

const normalizeRouteStates = (
  states: WindowsPushToTalkRouteState[] | undefined,
  fallback: WindowsPushToTalkRouteState
) => {
  const source = Array.isArray(states) && states.length > 0 ? states : [fallback];
  const byRoute = new Map<WindowsPushToTalkRoute, ReturnType<typeof normalizeRouteState>>();
  for (const state of source) {
    if (!state || typeof state !== "object") continue;
    const normalized = normalizeRouteState(
      state,
      fallback.routeId === "clipboard" ? "clipboard" : "insert"
    );
    byRoute.set(normalized.routeId, normalized);
  }
  return [...byRoute.values()];
};

const describeUnavailableRoute = (state: WindowsPushToTalkRouteState) => {
  const label = routeLabel(state.routeId);
  if (state.fallbackActive) {
    return state.recoveryPending
      ? `${label} is using tap-to-toggle while automatic recovery runs: press once to start and once to stop.`
      : `${label} is using tap-to-toggle; no automatic retry is scheduled.`;
  }
  if (state.recoveryPending) {
    return `${label} is temporarily unavailable while automatic recovery runs; use the EchoDraft tray for ${label}.`;
  }
  if (state.reason === "binary_not_found") {
    return `${label} cannot use its Windows key listener and no automatic retry is scheduled; use the EchoDraft tray, choose F9 or F10 in Settings, or reinstall EchoDraft.`;
  }
  return `${label} is unavailable and no automatic retry is scheduled; use the EchoDraft tray for ${label} or choose F9 or F10 in Settings.`;
};

export function getWindowsPushToTalkUnavailableNotice(
  payload: WindowsPushToTalkUnavailablePayload = {}
): WindowsPushToTalkNotice {
  const states = normalizeRouteStates(payload.unavailableRoutes, payload);
  const labels = states.map((state) => routeLabel(state.routeId));
  const anyRecoveryPending = states.some((state) => state.recoveryPending === true);
  const safetyNote = states.some((state) => state.recordingSafetyStopped === true)
    ? " Any active recording was stopped safely."
    : "";
  const description = `${states.map(describeUnavailableRoute).join(" ")}${safetyNote}`;
  const singleLabel = labels.length === 1 ? labels[0] : null;

  return {
    title: anyRecoveryPending ? "Windows shortcuts recovering" : "Windows shortcuts need attention",
    description,
    duration: 12_000,
    variant: "default",
    tray: {
      stage: "error",
      stageLabel: singleLabel ? `${singleLabel} Shortcut Recovery` : "Shortcut Recovery",
      message: description,
    },
    remainsUnavailable: true,
  };
}

export function getWindowsPushToTalkRecoveredNotice(
  payload: WindowsPushToTalkRecoveredPayload = {}
): WindowsPushToTalkNotice {
  const label = routeLabel(payload.routeId);
  const legacyRemaining = Array.isArray(payload.remainingUnavailableRoutes)
    ? payload.remainingUnavailableRoutes.filter(
        (route): route is WindowsPushToTalkRoute => route === "insert" || route === "clipboard"
      )
    : [];
  const remainingStates = normalizeRouteStates(
    payload.remainingUnavailableRouteStates,
    legacyRemaining.length > 0 ? { routeId: legacyRemaining[0] } : { routeId: payload.routeId }
  ).filter((state) =>
    payload.remainingUnavailableRouteStates?.length ? true : legacyRemaining.includes(state.routeId)
  );
  const remainsUnavailable = remainingStates.length > 0;
  const description = remainsUnavailable
    ? `${label} recovered. ${remainingStates.map(describeUnavailableRoute).join(" ")}`
    : `${label} recovered and its Windows shortcut is working again.`;

  return {
    title: remainsUnavailable ? `${label} shortcut recovered` : "Windows shortcuts recovered",
    description,
    duration: 4_500,
    variant: remainsUnavailable ? "default" : "success",
    tray: {
      stage: remainsUnavailable ? "error" : "done",
      stageLabel: remainsUnavailable ? "Shortcut Recovery" : "Shortcuts Recovered",
      message: description,
    },
    remainsUnavailable,
  };
}
