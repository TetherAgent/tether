export function ChatBubbleUser({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-3xl rounded-br-md px-4 py-3 text-sm text-[var(--user-bubble-text)] shadow-sm" style={{ background: 'var(--user-bubble)' }}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
      </div>
    </div>
  );
}
