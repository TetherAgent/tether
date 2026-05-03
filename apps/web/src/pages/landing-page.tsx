import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Cpu,
  GitBranch,
  LockKeyhole,
  MonitorSmartphone,
  Network,
  RadioTower,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TerminalSquare,
  Waypoints
} from 'lucide-react';
import { Button } from '@tether/design';

import { WebChromeControls } from '../components/console/web-chrome-controls.js';
import { useI18n } from '../hooks/use-i18n.js';
import { useUiPreferences } from '../hooks/use-ui-preferences.js';

const terminalRows = [
  { label: 'codex', detail: 'apps/gateway · PLAN.md', state: 'running', accent: 'live' },
  { label: 'claude', detail: 'packages/protocol · review', state: 'observe', accent: 'watch' },
  { label: 'opencode', detail: 'native/app · spike', state: 'queued', accent: 'queue' }
] as const;

const streamEvents = [
  'pty.output.append',
  'client.attach.control',
  'approval.request',
  'handoff.ready',
  'verification.loop'
] as const;

export function LandingPage() {
  const { t, locale, setLocale } = useI18n();
  const { isDark, toggleTheme } = useUiPreferences();
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 28);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>('.landing-page');
    if (!root) return undefined;
    let mx = 52;
    let my = 28;
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
      root.style.setProperty('--landing-mx', `${tx}%`);
      root.style.setProperty('--landing-my', `${ty}%`);
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
    <div className="landing-page">
      <div className="landing-grid-bg" />
      <div className="landing-cursor-light" />
      <header className="landing-nav" aria-label={t.landingNavLabel}>
        <div className={`landing-nav-inner ${scrolled ? 'is-scrolled' : ''}`}>
          <a className="landing-brand" href="#top" aria-label={t.appName}>
            <span className="landing-brand-mark"><Waypoints size={18} /></span>
            <span>{t.appName}</span>
          </a>
          <nav className="landing-nav-links">
            <a href="#platform">{t.landingNavPlatform}</a>
            <a href="#surfaces">{t.landingNavSurfaces}</a>
            <a href="#workflow">{t.landingNavWorkflow}</a>
            <a href="#security">{t.landingNavSecurity}</a>
            <a href="#roadmap">{t.landingNavRoadmap}</a>
          </nav>
          <div className="landing-nav-actions">
            <WebChromeControls locale={locale} onLocaleChange={setLocale} isDark={isDark} onThemeToggle={toggleTheme} />
            <Button asChild size="sm"><Link to="/login">{t.landingOpenConsole}</Link></Button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <div className="landing-eyebrow landing-reveal">
                <span className="landing-pulse" />
                <span>{t.landingEyebrow}</span>
              </div>
              <h1 className="landing-title landing-reveal d2">
                {t.landingHeroTitleA}
                <span>{t.landingHeroTitleB}</span>
                {t.landingHeroTitleC}
              </h1>
              <p className="landing-subtitle landing-reveal d3">{t.landingHeroSubtitle}</p>
              <div className="landing-hero-actions landing-reveal d4">
                <Button asChild size="lg"><Link to="/login">{t.landingPrimaryCta}<ArrowRight size={17} /></Link></Button>
                <a className="landing-secondary-link" href="#platform">{t.landingSecondaryCta}</a>
              </div>
              <div className="landing-proof-row landing-reveal d5">
                {t.landingProofs.map((proof) => <span key={proof}>{proof}</span>)}
              </div>
            </div>

            <div className="landing-console landing-reveal d3" aria-label={t.landingConsoleLabel}>
              <div className="landing-console-bar">
                <span /><span /><span />
                <strong>tether gateway</strong>
                <em>127.0.0.1:4789</em>
              </div>
              <div className="landing-command-line">
                <span>$</span>
                <strong>tether codex</strong>
                <i />
              </div>
              <div className="landing-session-stack">
                {terminalRows.map((row) => (
                  <div className={`landing-session-row ${row.accent}`} key={row.label}>
                    <span className="landing-session-icon"><TerminalSquare size={16} /></span>
                    <span><strong>{row.label}</strong><small>{row.detail}</small></span>
                    <em>{row.state}</em>
                  </div>
                ))}
              </div>
              <div className="landing-stream-panel">
                {streamEvents.map((event, index) => (
                  <span key={event} style={{ '--delay': `${index * 0.18}s` } as React.CSSProperties}>{event}</span>
                ))}
              </div>
              <div className="landing-device-ring">
                <div><Cpu size={18} /><span>Gateway</span></div>
                <div><MonitorSmartphone size={18} /><span>Web / H5</span></div>
                <div><Smartphone size={18} /><span>App</span></div>
                <div><RadioTower size={18} /><span>Relay</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-band landing-stats" aria-label={t.landingStatsLabel}>
          <div className="landing-container landing-stats-grid">
            {t.landingStats.map((stat) => (
              <div className="landing-stat" key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section" id="platform">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span>{t.landingPlatformKicker}</span>
              <h2>{t.landingPlatformTitle}</h2>
              <p>{t.landingPlatformSubtitle}</p>
            </div>
            <div className="landing-feature-grid">
              {[
                [TerminalSquare, t.landingFeatureProcessTitle, t.landingFeatureProcessBody],
                [Network, t.landingFeatureGatewayTitle, t.landingFeatureGatewayBody],
                [Blocks, t.landingFeatureSurfacesTitle, t.landingFeatureSurfacesBody],
                [GitBranch, t.landingFeatureOpsTitle, t.landingFeatureOpsBody]
              ].map(([Icon, title, body]) => (
                <article className="landing-feature" key={String(title)}>
                  <Icon size={22} />
                  <h3>{title as string}</h3>
                  <p>{body as string}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-surfaces" id="surfaces">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span>{t.landingSurfacesKicker}</span>
              <h2>{t.landingSurfacesTitle}</h2>
              <p>{t.landingSurfacesSubtitle}</p>
            </div>
            <div className="landing-surface-grid">
              {t.landingSurfaces.map((surface) => (
                <div className="landing-surface" key={surface.title}>
                  <strong>{surface.title}</strong>
                  <span>{surface.body}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section landing-workflow" id="workflow">
          <div className="landing-container landing-workflow-grid">
            <div className="landing-section-heading align-left">
              <span>{t.landingWorkflowKicker}</span>
              <h2>{t.landingWorkflowTitle}</h2>
              <p>{t.landingWorkflowSubtitle}</p>
            </div>
            <div className="landing-flow">
              {t.landingWorkflowSteps.map((step, index) => (
                <div className="landing-flow-step" key={step.title}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><h3>{step.title}</h3><p>{step.body}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section" id="security">
          <div className="landing-container landing-security">
            <div>
              <div className="landing-section-heading align-left">
                <span>{t.landingSecurityKicker}</span>
                <h2>{t.landingSecurityTitle}</h2>
                <p>{t.landingSecuritySubtitle}</p>
              </div>
              <div className="landing-security-list">
                {t.landingSecurityItems.map((item) => <div key={item}><ShieldCheck size={18} />{item}</div>)}
              </div>
            </div>
            <div className="landing-security-card">
              <LockKeyhole size={26} />
              <strong>{t.landingSecurityCardTitle}</strong>
              <p>{t.landingSecurityCardBody}</p>
              <div><span>LAN</span><span>Tunnel</span><span>Relay</span></div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="roadmap">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span>{t.landingRoadmapKicker}</span>
              <h2>{t.landingRoadmapTitle}</h2>
              <p>{t.landingRoadmapSubtitle}</p>
            </div>
            <div className="landing-roadmap">
              {t.landingRoadmapItems.map((item) => (
                <div className="landing-roadmap-item" key={item.title}>
                  <CheckCircle2 size={18} />
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-cta">
          <div className="landing-container landing-cta-inner">
            <Sparkles size={26} />
            <h2>{t.landingCtaTitle}</h2>
            <p>{t.landingCtaBody}</p>
            <Button asChild size="lg"><Link to="/login">{t.landingCtaButton}<ArrowRight size={17} /></Link></Button>
          </div>
        </section>
      </main>
    </div>
  );
}
