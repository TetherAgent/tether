export function ChatBubbleUser({ content }: { content: string }) {
  return (
    <div className="flex min-w-0 justify-end">
      <div className="min-w-0 max-w-[82%] overflow-hidden rounded-3xl rounded-br-md px-4 py-3 text-sm text-[var(--user-bubble-text)] shadow-sm md:max-w-[72%]" style={{ background: 'var(--user-bubble)' }}>
        <div className="break-words [overflow-wrap:anywhere]" style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
      </div>
    </div>
  );
}
