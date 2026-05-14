export function shouldApplySessionResult(targetSessionId: string, currentSessionId: string | undefined): boolean {
  return targetSessionId === currentSessionId;
}

export function shouldClearSessionViewState(input: {
  activeSessionId: string | undefined;
  pendingCreatedSessionId: string | null;
  skipNextHistoryLoadSessionId: string | null;
}): boolean {
  return Boolean(
    input.activeSessionId &&
    input.pendingCreatedSessionId !== input.activeSessionId &&
    input.skipNextHistoryLoadSessionId !== input.activeSessionId
  );
}

export function shouldApplyRequestResult(input: {
  requestId: number;
  latestRequestId: number;
  requestTab: string;
  currentTab: string;
}): boolean {
  return input.requestId === input.latestRequestId && input.requestTab === input.currentTab;
}
