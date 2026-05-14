# @tether/theme 规范

本包提供 Tether 共享主题 token，面向 Tailwind CSS v4 应用使用。
它应当可以被独立消费：使用方只需要导入本包并阅读本文档，不需要依赖
monorepo 内其他说明。

## Token 准入规则（合并必读）

新增或修改任何颜色 token 必须满足以下底线，否则不予合并：

1. **对比度**：所有 `--*-foreground` / `--*-text` 类前景色，落在其默认搭配
   背景上必须 ≥ 4.5:1（WCAG AA 正文）。仅用于大尺寸文字（≥ 18px / ≥ 14px
   bold）的 token 可放宽到 3:1，但需在该 token 注释中明确标记 "large only"。
2. **PR 证据**：新增颜色 token 时，PR 描述需贴出对比度计算结果或 contrast
   checker 截图，背景色显式列出。
3. **派生关系**：能用 `var(--x)` 派生的不写硬编码（如 `--destructive` 派生
   自 `--bear`、`--primary` 派生自 `--brand`）。
4. **跨主题**：light 与 dark 必须同时定义；只补一支视为破坏。

## 命名模式

主题 token 全部使用 **shadcn 风格扁平命名**，没有 `--bg-` / `--text-` /
`--border-` 业务前缀。shadcn 标准变量保持 shadcn 语义；shadcn 没有的项目
扩展（金融语义色、扩展背景层级、扩展前景色）作为同风格扁平变量补充：

```css
/* shadcn 标准 */
--background / --foreground
--card / --card-foreground
--popover / --popover-foreground
--primary / --primary-foreground
--secondary / --secondary-foreground
--muted / --muted-foreground
--accent / --accent-foreground
--destructive / --destructive-foreground
--border / --input / --ring / --radius

/* 项目扩展 */
--brand / --brand-hover / --brand-text / --brand-muted
--bull / --bull-bg / --bull-muted
--bear / --bear-bg / --bear-muted
--warning / --warning-bg / --warning-fg
--info / --info-bg
--chart-accent

--canvas / --surface / --card-hover / --dialog / --field / --overlay
--border-subtle
--foreground-tertiary / --foreground-disabled / --foreground-inverse
```

角色变量定义在 `:root` / `.dark` / `[data-theme]` 中，不得以 `--color-`
开头；该命名空间保留给 Tailwind 的 `@theme` 导出变量。

### Tailwind 导出变量

`@theme` 块按 Tailwind v4 命名空间生成 utility：

```text
--color-*       -> bg-* / text-* / border-* / ring-* color utilities
--text-*        -> text-* font-size utilities
--font-*        -> font-* font-family utilities
--font-weight-* -> font-* font-weight utilities
--leading-*     -> leading-* line-height utilities
--radius-*      -> rounded-* radius utilities
--shadow-*      -> shadow-* utilities
--duration-*    -> duration-* transition-duration utilities
--ease-*        -> ease-* timing-function utilities
```

所有跨主题切换的语义值（colors / shadows / gradients）通过 `var(...)`
间接 alias 进入 `@theme`（即 `--color-x: var(--x)`），主题切换时由根节点
变量重新解析；这种用法不会产生 `--x: var(--x)` 自引用循环。

## Token 清单

### shadcn 标准角色

| 变量 | 语义 |
|------|------|
| `--background` / `--foreground` | 页面底 / 正文文字 |
| `--card` / `--card-foreground` | 卡片层 / 卡片文字 |
| `--popover` / `--popover-foreground` | 弹层 / 弹层文字 |
| `--primary` / `--primary-foreground` | 主操作（= `--brand`）/ 主按钮文字（恒黑）|
| `--secondary` / `--secondary-foreground` | 次按钮（= `--accent` 中性灰）|
| `--muted` / `--muted-foreground` | 弱化背景 / 次级文字 |
| `--accent` / `--accent-foreground` | hover/active/selected 中性底色 |
| `--destructive` / `--destructive-foreground` | 危险操作（= `--bear`）/ 文字（恒白）|
| `--border` / `--input` / `--ring` | 通用边框 / 输入边框 / focus ring |
| `--radius` | shadcn 默认圆角（= 8px = `--radius-md`）|
| `--chart-1..5` | 图表 5 槽调色板 |
| `--sidebar*` | sidebar 全套 |

### 项目品牌色与金融语义色

```text
--brand / --brand-hover / --brand-text / --brand-muted
--bull / --bull-bg / --bull-muted
--bear / --bear-bg / --bear-muted
--warning / --warning-bg / --warning-fg
--info / --info-bg
--chart-accent
```

`--brand` (`#00b974` light) 是产品身份色（CTA / 选中态 / focus ring 来源）。
`--brand-text` (`#00875a` light) 是**白底文字 / 图标专用**深色派生：在白底
或 `--brand-muted` 底上对比 ≥ 5:1，AA 通过。`--primary` 直接映射为
`--brand`；`--ring` 由 brand 60% 透明派生。

`--bull` (`#16a268` light) 是金融上涨色，**与 brand 解耦**为色相略偏黄绿
的版本，保证 chart 多系列、`Progress tone="bull"` 与 brand 不撞色。

`--bear` (`#e0264f` light) 显式声明，AA 4.6:1。`--destructive` 派生自
`--bear`：`--destructive: var(--bear)`。`--destructive-foreground` 与
`--primary-foreground` 是主题无关恒定色（白 / 黑），不参与派生。

`--warning` (`#d97706` light，amber-600) AA 4.5:1。`--warning-fg`
(`#92400e` light) 是 `--warning-bg` 上的文字专用色（badge / alert variant=
warning 走它），对比 ≥ 7:1。

`--info` (`#2563eb` light，blue-600) AA。

`--chart-accent` (`#7c3aed` light) 中性紫色，专供 chart 调色板第三槽。

### 扩展背景层级（shadcn 没有）

```text
--canvas        物理底层（light #fff / dark #000，最深一层）
--surface       中间面（card 与 background 之间）
--card-hover    卡片 hover 状态底色
--dialog        Dialog 专用底色（与 popover 略有差异）
--field         输入框填充底色（与 --input 边框色区分）
--overlay       全屏蒙层
```

### 边框扩展

```text
--border-subtle  比 --border 更弱的分割线
```

### 前景扩展

```text
--foreground-tertiary  最弱级文字（提示、占位）；浅色 #6b7280 / 深色 #a1a1aa，AA
--foreground-disabled  禁用态文字
--foreground-inverse   主题反色文字（light=#fff, dark=#000，会随主题翻转）
```

`--foreground-inverse` 与 `--primary-foreground` / `--destructive-foreground`
语义不同。前者**随主题翻转**；后两者**主题无关恒定色**：
`--primary-foreground` 永远 `#000`（黑字落在 brand 绿底），
`--destructive-foreground` 永远 `#fff`（白字落在 bear 红底）。
不可互替。

### 字体与字重

```text
--font-family-sans / --font-family-mono
--font-sans / --font-mono / --font-heading
--font-weight-regular / --font-weight-medium /
--font-weight-semibold / --font-weight-bold /
--font-weight-button   (= bold)
```

`--font-family-sans` 默认值首位为 `"Inter Variable"`，由本包通过
`@fontsource-variable/inter` 注入字体资源；后续回退到 system font stack。
`--font-heading` 默认与 `--font-sans` 同源；应用如需差异化标题字体可在
应用层 `@theme` 内覆盖。

字重 token 全部进入 `@theme`，使用 `font-regular` / `font-medium` /
`font-semibold` / `font-bold` / `font-button` utility。**禁止**使用
`font-[var(--font-weight-*)]` arbitrary 写法。

### 字号阶梯（mobile-first）

字号 utility：移动端为基线，桌面端 `@media (min-width: 768px)` 只放大、
**不缩小**。每一阶相邻值至少拉开 1px。

| utility | 移动端（< 768px）| 桌面端（≥ 768px）|
|---|---|---|
| text-2xs  | 0.6875rem (11px) | 0.6875rem (11px) |
| text-xs   | 0.75rem (12px)   | 0.75rem (12px) |
| text-sm   | 0.875rem (14px)  | 0.875rem (14px) |
| text-base | 1rem (16px)      | 1rem (16px) |
| text-lg   | 1.0625rem (17px) | 1.125rem (18px) |
| text-xl   | 1.1875rem (19px) | 1.25rem (20px) |
| text-2xl  | 1.375rem (22px)  | 1.5rem (24px) |
| text-3xl  | 1.625rem (26px)  | 1.875rem (30px) |
| text-4xl  | 1.875rem (30px)  | 2.25rem (36px) |

### 标题语义字号

供 design 组件标题层引用，避免每个组件自己写阶梯：

```text
--text-h1       PageHeader 标题（1.875rem / 30px）
--text-h2       Section 标题（1.5rem / 24px）
--text-h3       Dialog / Empty / Card 标题（1.125rem / 18px）
--text-stat-lg  StatItem size=lg（2rem / 32px）
```

### 行高 utility

```text
leading-none / leading-tight / leading-snug / leading-normal / leading-relaxed
```

### 效果、圆角、动效

```text
--shadow-card / --shadow-bull / --shadow-bear / --shadow-brand
--gradient-brand
--radius-sm / --radius-md / --radius-lg / --radius-xl
--radius-2xl / --radius-3xl / --radius-4xl / --radius-full
--duration-fast (120ms) / --duration-base (200ms)
--ease-out (cubic-bezier(.16,1,.3,1))
```

shadow / gradient / duration / ease 全部以 `var(...)` 间接 alias 形式进入
`@theme`，可直接使用 `shadow-card` / `duration-fast` / `ease-out` utility，
不再需要 `globals.css` 手写 `@utility` 兜底。

## 禁用 Token 与 Utility

- 禁止使用 `text-ui-*`；使用 `text-*`。
- **packages/design/src/** 内**禁止**任意值字号类（`text-[12px]` 等）和数字
  / 任意值行高类（`leading-4` / `leading-[1.2]`）。
  - 例外：应用层 chart label / 第三方嵌入 / 打印小字可使用，但需附行内注释
    说明原因。
- **packages/design/src/** 内禁止 hex / rgb / hsl 字面量与任意值色 utility
  （`bg-[#xxx]` / `text-[#xxx]` / `style={{color:'#...'}}` / SVG fill/stroke
  写死色值）。`chart.tsx` 调色板可申请例外。
- 禁止 `font-[var(--font-weight-*)]` arbitrary 写法；使用 `font-button` 等
  utility。
- 禁止重新引入 `--bg-*` / `--text-*` / `--border-*` 业务前缀变量；统一使用
  shadcn 风格扁平命名。
- 禁止在 `tokens/compat-shadcn.css` 中放置业务专属 token；跨 app 共享的业务
  token（交易所等）集中在 `tokens/business.css`。

## 文件结构

```text
src/
  tokens/
    compat-shadcn.css   单源 token 文件：shadcn 标准 + 项目扩展 + @theme 导出。
    business.css        跨 app 业务 token（交易所等）。
  theme.css             主题 bundle 入口；引入 Inter 字体 + tokens/compat-shadcn。
  globals.css           应用样式入口；引入 tailwindcss、theme.css、tokens/business、
                        tw-animate-css、shadcn/tailwind.css，并声明 design 包 `@source` 扫描。
```

`tokens/compat-shadcn.css` 是 token 唯一事实源（既包含 shadcn 标准 slot，
也包含项目扩展），不再拆分为独立的 semantic 层。`business.css` 单独维护
跨 app 业务 token。`theme.css` 与 `globals.css` 是入口编排文件，不定义 token。

## 使用指南

应用入口（推荐）：

```ts
import "@tether/theme/globals.css";
```

仅引入主题 token（不包含 Tailwind runtime）：

```css
@import "@tether/theme/theme.css";
```

仅引入 token 文件本身：

```css
@import "@tether/theme/tokens";
```

独立引用业务 token：

```css
@import "@tether/theme/business";
```

主题切换由文档根节点上的 `.dark` 或 `[data-theme="dark"]` 驱动。
应用与基础组件统一使用 shadcn 风格 utility，例如 `bg-card`、`text-foreground`、
`border-input`、`ring-ring`、`bg-card-hover`、`text-foreground-tertiary` 等。
跨 app 共享的业务 token（交易所品牌色等）放在 `business.css`，由 `globals.css`
自动引入；仅本 app 私有的业务 token 仍由消费应用自管。

## 迁移说明（旧 → 新）

### v2 → v2.1（本次）

| 项 | 旧 | 新 |
|----|----|----|
| brand 色值 | `#00cd82` (light) | `#00b974` (light，AA) |
| brand 文字 | `text-brand` | `text-brand-text`（白底文字） |
| bull / brand | 同色 `#00cd82` | 解耦：bull `#16a268` |
| bear | 未定义（隐性 bug） | 显式声明 `#e0264f` |
| warning | `#f58a42`（2.8:1 ✗） | `#d97706` (4.5:1) + `--warning-fg` 文字 |
| fg-tertiary | `#9ca3af`（2.85:1 ✗） | `#6b7280` (5:1) |
| 字号 2xs 桌面 | 12 → 10px（缩小） | 11 → 11px（持平，不再逆转） |
| 字号阶梯 | text-lg = text-base mobile | 每阶 ≥ 1px 拉开 |
| font-weight | arbitrary `font-[var(...)]` | `font-button` utility |
| shadow / duration | 手写 `@utility` 兜底 | 进入 `@theme` 间接 alias |

### v1 → v2

token 重命名（`--bg-*` / `--text-*` / `--border-*` 统一并入 shadcn 扁平命名）：

| 旧 | 新 |
|----|----|
| `--bg-base` | `--canvas` |
| `--bg-page` | `--background` |
| `--bg-surface` | `--surface` |
| `--bg-card` | `--card` |
| `--bg-card-hover` | `--card-hover` |
| `--bg-elevated` | `--popover` |
| `--bg-dialog` | `--dialog` |
| `--bg-subtle` | `--muted` |
| `--bg-input` | `--field` |
| `--bg-overlay` | `--overlay` |
| `--bg-selected` | `--accent`（与 `--secondary` 同源）|
| `--border-base` | `--border` |
| `--border-input` | `--input` |
| `--border-focus` | `--ring` |
| `--text-primary` | `--foreground` |
| `--text-secondary` | `--muted-foreground` |
| `--text-tertiary` | `--foreground-tertiary` |
| `--text-disabled` | `--foreground-disabled` |
| `--text-inverse` | `--foreground-inverse` |
| `--text-on-brand` | `--primary-foreground` |
| `--text-on-destructive` | `--destructive-foreground` |

utility 类对应重命名（`bg-bg-*` / `text-text-*` / `border-border-*` 前缀消除）：

| 旧 | 新 |
|----|----|
| `bg-bg-page` | `bg-background` |
| `bg-bg-card` | `bg-card` |
| `bg-bg-card-hover` | `bg-card-hover` |
| `bg-bg-surface` | `bg-surface` |
| `bg-bg-base` | `bg-canvas` |
| `bg-bg-elevated` | `bg-popover` |
| `bg-bg-dialog` | `bg-dialog` |
| `bg-bg-subtle` | `bg-muted` |
| `bg-bg-input` | `bg-field` |
| `bg-bg-overlay` | `bg-overlay` |
| `bg-bg-selected` | `bg-accent` |
| `border-border-base` | `border-border` |
| `border-border-input` | `border-input` |
| `border-border-focus` | `border-ring` |
| `ring-border-focus` | `ring-ring` |
| `text-text-primary` | `text-foreground` |
| `text-text-secondary` | `text-muted-foreground` |
| `text-text-tertiary` | `text-foreground-tertiary` |
| `text-text-disabled` | `text-foreground-disabled` |
| `text-text-inverse` | `text-foreground-inverse` |
| `text-text-on-brand` | `text-primary-foreground` |

历史迁移项：

- `text-ui-*` → `text-*`。
- `--font-size-*` 已移除；字号使用 `--text-*`。
- 数字/任意值行高 → `leading-tight` / `leading-snug` / `leading-normal` / `leading-relaxed`。
- `--bg-nav-active` 已重命名为 `--bg-selected`，本轮再统一为 `--accent`。
- `--exchange-*` 等交易所颜色已移出本包语义层，放入 `tokens/business.css`。
