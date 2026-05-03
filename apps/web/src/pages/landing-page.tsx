import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudOff,
  Cpu,
  ExternalLink,
  FileCode2,
  Fingerprint,
  Globe2,
  Languages,
  KeyRound,
  Laptop,
  LockKeyhole,
  Moon,
  MonitorSmartphone,
  RadioTower,
  Server,
  ShieldCheck,
  Smartphone,
  Sun,
  TerminalSquare,
  Waypoints
} from 'lucide-react';
import { Button } from '@tether/design';

import { useAuth } from '../hooks/use-auth.js';
import { useI18n } from '../hooks/use-i18n.js';
import { useUiPreferences } from '../hooks/use-ui-preferences.js';

const liveSessions = [
  { provider: 'codex', task: 'refactor auth flow', state: 'running' },
  { provider: 'claude', task: 'review protocol diff', state: 'observe' },
  { provider: 'opencode', task: 'native app spike', state: 'queued' }
] as const;

const handoffEvents = ['工作站启动', '事件实时同步', '手机审阅', '一键放行'] as const;

const surfaceIcons = [TerminalSquare, Globe2, Smartphone, Laptop, MonitorSmartphone, RadioTower] as const;
const securityIcons = [Server, FileCode2, LockKeyhole, KeyRound, ShieldCheck] as const;
const proofIcons = [Clock3, Server, CloudOff, KeyRound] as const;

export function LandingPage() {
  const { normalAuth } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { isDark, toggleTheme } = useUiPreferences();
  const consolePath = normalAuth?.accessToken ? '/sessions' : '/login';
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 28);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>('.landing-v4');
    if (!root) return undefined;
    let mx = 48;
    let my = 26;
    let tx = mx;
    let ty = my;
    let frame = 0;
    const onMove = (event: MouseEvent) => {
      mx = (event.clientX / window.innerWidth) * 100;
      my = (event.clientY / window.innerHeight) * 100;
    };
    const loop = () => {
      tx += (mx - tx) * 0.08;
      ty += (my - ty) * 0.08;
      root.style.setProperty('--mx', `${tx}%`);
      root.style.setProperty('--my', `${ty}%`);
      frame = window.requestAnimationFrame(loop);
    };
    window.addEventListener('mousemove', onMove);
    frame = window.requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="landing-v4">
      <div className="landing-v4-grid" />
      <div className="landing-v4-spot" />

      <header className="landing-v4-nav" aria-label={t.landingNavLabel}>
        <div className="landing-v4-nav-shell">
          <div className={`landing-v4-nav-inner ${scrolled ? 'is-scrolled' : ''}`}>
            <a className="landing-v4-brand" href="#top" aria-label={t.appName}>
              <span><Waypoints size={18} /></span>
              <strong>{t.appName}</strong>
            </a>
            <nav className="landing-v4-links">
              <a href="#workflow">{t.landingNavWorkflow}</a>
              <a href="#surfaces">{t.landingNavSurfaces}</a>
              <a href="#security">{t.landingNavSecurity}</a>
              <a href="#roadmap">{t.landingNavRoadmap}</a>
              <a
                href="https://github.com/dream2672/tether"
                target="_blank"
                rel="noreferrer"
                aria-label={t.landingNavGitHub}
              >
                <ExternalLink size={15} />
                <span>{t.landingNavGitHub}</span>
              </a>
            </nav>
            <Button variant="brand" asChild size="sm">
              <Link to={consolePath}>{t.landingOpenConsole}</Link>
            </Button>
          </div>
          <div className={`landing-v4-actions ${scrolled ? 'is-scrolled' : ''}`}>
            <button
              className="landing-v4-icon-button"
              type="button"
              aria-label={locale === 'zh' ? '切换到英文' : 'Switch to Chinese'}
              title={locale === 'zh' ? '切换到英文' : 'Switch to Chinese'}
              onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
            >
              <Languages size={17} />
            </button>
            <button
              className="landing-v4-icon-button"
              type="button"
              aria-label={`${t.themeLabel}: ${isDark ? t.light : t.dark}`}
              title={`${t.themeLabel}: ${isDark ? t.light : t.dark}`}
              onClick={toggleTheme}
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="landing-v4-hero">
          <div className="landing-v4-container landing-v4-hero-grid">
            <div className="landing-v4-hero-copy">
              <div className="landing-v4-eyebrow">
                <span />
                {t.landingEyebrow}
              </div>
              <h1>
                {t.landingHeroTitleA}
                <span>{t.landingHeroTitleB}</span>
              </h1>
              <p>{t.landingHeroSubtitle}</p>
              <div className="landing-v4-cta-row">
                <Button variant="brand" asChild size="lg">
                  <Link to={consolePath}>{t.landingPrimaryCta}<ArrowRight size={17} /></Link>
                </Button>
                <a href="#workflow">{t.landingSecondaryCta}<ChevronRight size={16} /></a>
              </div>
              <div className="landing-v4-proof">
                {t.landingProofs.map((proof, index) => {
                  const Icon = proofIcons[index] ?? ShieldCheck;
                  return (
                    <span key={proof}>
                      <em>{String(index + 1).padStart(2, '0')}</em>
                      <Icon size={16} />
                      <strong>{proof}</strong>
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="landing-v4-stage" aria-label={t.landingConsoleLabel}>
              <div className="landing-v4-workstation">
                <div className="landing-v4-window-bar">
                  <span /><span /><span />
                  <strong>workstation</strong>
                  <em>Gateway owner</em>
                </div>
                <div className="landing-v4-terminal-line">
                  <span>$</span>
                  <strong>tether codex</strong>
                  <i />
                </div>
                <div className="landing-v4-session-list">
                  {liveSessions.map((session) => (
                    <div key={session.provider}>
                      <TerminalSquare size={18} />
                      <span>
                        <strong>{session.provider}</strong>
                        <small>{session.task}</small>
                      </span>
                      <em>{session.state}</em>
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-v4-event-rail">
                {handoffEvents.map((event) => <span key={event}>{event}</span>)}
              </div>

              <div className="landing-v4-device-panel">
                <div className="landing-v4-phone">
                  <div className="landing-v4-phone-notch" />
                  <div className="landing-v4-approval-card">
                    <div className="landing-v4-approval-head">
                      <span>Codex 请求执行</span>
                      <em>需要确认</em>
                    </div>
                    <strong>pnpm test</strong>
                    <p>来源：apps/web · 当前会话</p>
                    <div className="landing-v4-approval-meta">
                      <span>只读测试</span>
                      <span>本机执行</span>
                    </div>
                    <div className="landing-v4-approval-actions">
                      <button type="button">拒绝</button>
                      <button className="is-approving" type="button">
                        允许
                        <svg className="landing-v4-cursor" viewBox="0 0 28 28" aria-hidden="true">
                          <path d="M5 3l17 12-8 1.5 4.8 7.6-3.8 2.2-4.6-7.4L5 25V3z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="landing-v4-web-panel">
                  <div className="landing-v4-editor-top">
                    <MonitorSmartphone size={16} />
                    <span>Web / H5 / App</span>
                    <em>review mode</em>
                  </div>
                  <div className="landing-v4-editor-body">
                    <div className="landing-v4-editor-files">
                      <span className="active">src/routes.tsx</span>
                      <span>README.zh-CN.md</span>
                      <span>PLAN.md</span>
                    </div>
                    <div className="landing-v4-editor-code">
                      <code><b>+</b> &lt;Route path="/" element=&lbrace;&lt;LandingPage /&gt;&rbrace; /&gt;</code>
                      <code><b>+</b> gateway.attach(sessionId, "observe")</code>
                      <code><i>~</i> approval required: pnpm test</code>
                    </div>
                  </div>
                  <strong>观察输出 · 接管输入 · 审批动作</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-v4-stats" aria-label={t.landingStatsLabel}>
          <div className="landing-v4-container">
            {t.landingStats.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-v4-section landing-v4-workflow-section" id="workflow">
          <div className="landing-v4-container">
            <div className="landing-v4-section-head is-center">
              <span>{t.landingWorkflowKicker}</span>
              <h2>{t.landingWorkflowTitle}</h2>
              <p>{t.landingWorkflowSubtitle}</p>
            </div>
            <div className="landing-v4-flow-board">
              {t.landingWorkflowSteps.map((step, index) => (
                <article key={step.title}>
                  <div className="landing-v4-flow-head">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <em>{['START', 'STREAM', 'CONTROL', 'DECIDE'][index]}</em>
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div className="landing-v4-flow-meta">
                    {[
                      ['入口', 'tether codex'],
                      ['传输', 'event stream'],
                      ['模式', 'control / observe'],
                      ['动作', 'approve']
                    ][index].map((value) => <span key={value}>{value}</span>)}
                  </div>
                  {index < t.landingWorkflowSteps.length - 1 ? <ChevronRight className="landing-v4-flow-arrow" size={18} /> : null}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-v4-section" id="surfaces">
          <div className="landing-v4-container">
            <div className="landing-v4-section-head is-center">
              <span>{t.landingSurfacesKicker}</span>
              <h2>{t.landingSurfacesTitle}</h2>
              <p>{t.landingSurfacesSubtitle}</p>
            </div>
            <div className="landing-v4-surfaces">
              {t.landingSurfaces.map((surface, index) => {
                const Icon = surfaceIcons[index] ?? MonitorSmartphone;
                return (
                  <article key={surface.title}>
                    <Icon size={24} />
                    <small>{String(index + 1).padStart(2, '0')}</small>
                    <h3>{surface.title}</h3>
                    <p>{surface.body}</p>
                    <SurfaceVisual index={index} />
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-v4-section" id="security">
          <div className="landing-v4-container landing-v4-security">
            <div className="landing-v4-section-head">
              <span>{t.landingSecurityKicker}</span>
              <h2>{t.landingSecurityTitle}</h2>
              <p>{t.landingSecuritySubtitle}</p>
            </div>
            <div className="landing-v4-boundary">
              <div className="landing-v4-boundary-core">
                <Cpu size={26} />
                <strong>{t.landingSecurityCardTitle}</strong>
                <p>{t.landingSecurityCardBody}</p>
                <div className="landing-v4-boundary-tags">
                  <span>本机 Gateway</span>
                  <span>127.0.0.1</span>
                  <span>凭证本地</span>
                </div>
              </div>
              <div className="landing-v4-security-list">
                {t.landingSecurityItems.map((item, index) => {
                  const Icon = securityIcons[index] ?? ShieldCheck;
                  return <div key={item}><Icon size={18} /><span>{item}</span></div>;
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="landing-v4-section" id="roadmap">
          <div className="landing-v4-container">
            <div className="landing-v4-section-head is-center">
              <span>{t.landingRoadmapKicker}</span>
              <h2>{t.landingRoadmapTitle}</h2>
              <p>{t.landingRoadmapSubtitle}</p>
            </div>
            <div className="landing-v4-roadmap">
              {t.landingRoadmapItems.map((item, index) => (
                <article key={item.title}>
                  <CheckCircle2 size={18} />
                  <small>{t.landingRoadmapLabels[index]}</small>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-v4-final">
          <div className="landing-v4-container">
            <Fingerprint size={30} />
            <h2>{t.landingCtaTitle}</h2>
            <p>{t.landingCtaBody}</p>
            <Button variant="brand" asChild size="lg"><Link to={consolePath}>{t.landingCtaButton}<ArrowRight size={17} /></Link></Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function SurfaceVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="surface-visual cli">
        <code>$ tether attach --control</code>
        <code><span>Agent:</span> codex · running</code>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="surface-visual web">
        <aside><span /><span /><span /></aside>
        <main><i /><b /><em /></main>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="surface-visual h5">
        <section>
          <span />
          <b>approve</b>
          <em />
        </section>
      </div>
    );
  }

  if (index === 3) {
    return (
      <div className="surface-visual desktop">
        <section><i /><b /></section>
        <aside><span /><span /></aside>
      </div>
    );
  }

  if (index === 4) {
    return (
      <div className="surface-visual native">
        <span>iOS</span>
        <i />
        <span>Android</span>
        <i />
        <span>Harmony</span>
      </div>
    );
  }

  return (
    <div className="surface-visual flutter">
      <span>Gateway</span>
      <i />
      <span>Relay</span>
      <i />
      <span>Client</span>
    </div>
  );
}
