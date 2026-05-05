// Node 运行时 flag，必须由 launcher / launchd plist / session-runner spawn 一致注入。
// --experimental-sqlite 在 Node 22.13+ 实测是 no-op（node:sqlite 不带 flag 也能 load），
// 保留是为了 future-proof 防止某个 minor 改成必需。
// --no-warnings=ExperimentalWarning 抑制 sqlite 加载时的实验性警告。
export const NODE_RUNTIME_FLAGS = [
  '--experimental-sqlite',
  '--no-warnings=ExperimentalWarning'
] as const;
