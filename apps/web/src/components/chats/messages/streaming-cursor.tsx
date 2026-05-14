export function StreamingCursor() {
  return (
    <span className="streaming-status" role="status" aria-live="polite">
      <span className="streaming-status-dot" aria-hidden="true" />
      AI 思考中...
    </span>
  );
}
