export function SystemMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-center py-2">
      <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{text}</div>
    </div>
  );
}
