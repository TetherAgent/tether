const COLORS_ENABLED = process.stdout.isTTY && !process.env.NO_COLOR;

function ansi(value: string, code: string): string {
  return COLORS_ENABLED ? `\x1b[${code}m${value}\x1b[0m` : value;
}

export const color = {
  bold: (value: string) => ansi(value, '1'),
  dim: (value: string) => ansi(value, '2'),
  red: (value: string) => ansi(value, '31'),
  green: (value: string) => ansi(value, '32'),
  yellow: (value: string) => ansi(value, '33'),
  cyan: (value: string) => ansi(value, '36')
};

export function status(value: string): string {
  const displayValue = translateStatusValue(value);
  const okWords = [
    '运行中',
    '已连接',
    '已登录',
    '已配置',
    '已加载',
    '已开启',
    '已安装',
    '包含 ',
    '成功',
    '通过'
  ];
  const warnWords = [
    '未确认',
    '未配置',
    '未知',
    '警告',
    'refresh 未确认'
  ];
  const failWords = [
    '已停止',
    '无法连接',
    '认证失败',
    '失败',
    '已过期',
    '未登录'
  ];
  if (
    okWords.some((word) => displayValue.includes(word))
  ) {
    return color.green(displayValue);
  }
  if (
    warnWords.some((word) => displayValue.includes(word))
  ) {
    return color.yellow(displayValue);
  }
  if (
    failWords.some((word) => displayValue.includes(word))
  ) {
    return color.red(displayValue);
  }
  return displayValue;
}

function translateStatusValue(value: string): string {
  switch (value) {
    case 'running':
      return '运行中';
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'disconnected':
      return '已断开';
    case 'stopped':
      return '已停止';
    case 'unreachable':
      return '无法连接';
    case 'stopped/unreachable':
      return '已停止或无法连接';
    case 'auth_failed':
      return '认证失败';
    case 'ok':
      return '通过';
    case 'warn':
      return '警告';
    case 'fail':
      return '失败';
    default:
      return value;
  }
}

export function section(title: string): void {
  console.log(color.bold(color.cyan(title)));
}

export function line(label: string, value: string | number | undefined): void {
  const printable = value === undefined || value === '' ? '-' : String(value);
  console.log(`${color.dim(label)}: ${status(printable)}`);
}

export function success(message: string): void {
  console.log(color.green(message));
}

export function warn(message: string): void {
  console.log(color.yellow(message));
}
