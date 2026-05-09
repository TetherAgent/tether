import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';

import '../models/protocol.dart';
import '../services/relay_client.dart';
import '../theme.dart';
import '../widgets/session_card.dart';

class SessionListScreen extends StatefulWidget {
  const SessionListScreen({super.key});

  @override
  State<SessionListScreen> createState() => _SessionListScreenState();
}

class _SessionListScreenState extends State<SessionListScreen> {
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final relayClient = context.watch<RelayClient>();
    final active = relayClient.activeSessions;
    final history = relayClient.historySessions;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 18, 0),
                child: Column(
                  children: [
                    _SessionHeader(
                      title: l10n.sessionsTab,
                      onToggleLocale: () {
                        context.read<LocaleNotifier>().toggleLocale();
                      },
                      onToggleTheme: () {
                        context.read<ThemeNotifier>().toggleTheme();
                      },
                    ),
                    const SizedBox(height: 16),
                    _ConnectionPanel(
                      activeCount: active.length,
                      historyCount: history.length,
                      gatewayLabel: l10n.relayShortLabel,
                      title: l10n.gatewayPanelTitle,
                      subtitle: l10n.throughRelay,
                    ),
                    const SizedBox(height: 16),
                    if (relayClient.gatewayUnavailable)
                      const _GatewayUnavailableEmptyState(),
                    _SessionSegmentedTabBar(
                      activeLabel: l10n.activeLabel,
                      historyLabel: l10n.historyLabel,
                    ),
                  ],
                ),
              ),
              Expanded(
                child: TabBarView(
                  children: [
                    _SessionListTab(
                      emptyText: l10n.noSessionsDescription,
                      sessions: active,
                      itemBuilder: (session) => SessionCard(
                        session: session,
                        onTap: () => context.push('/session/${session.id}'),
                        onStop: () => relayClient.stopSession(session.id),
                        isHistory: false,
                      ),
                    ),
                    _SessionListTab(
                      emptyText: l10n.noSessionsDescription,
                      sessions: history,
                      itemBuilder: (session) => SessionCard(
                        session: session,
                        onTap: () => context.push('/replay/${session.id}'),
                        onStop: () {},
                        isHistory: true,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SessionHeader extends StatelessWidget {
  const _SessionHeader({
    required this.title,
    required this.onToggleLocale,
    required this.onToggleTheme,
  });

  final String title;
  final VoidCallback onToggleLocale;
  final VoidCallback onToggleTheme;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
        ),
        IconButton.filledTonal(
          onPressed: onToggleLocale,
          icon: const Icon(Icons.language),
        ),
        const SizedBox(width: 8),
        IconButton.filledTonal(
          onPressed: onToggleTheme,
          icon: const Icon(Icons.brightness_6_outlined),
        ),
      ],
    );
  }
}

class _ConnectionPanel extends StatelessWidget {
  const _ConnectionPanel({
    required this.activeCount,
    required this.historyCount,
    required this.gatewayLabel,
    required this.title,
    required this.subtitle,
  });

  final int activeCount;
  final int historyCount;
  final String gatewayLabel;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: isDark
              ? const [tetherDarkBrandMuted, tetherDarkCard]
              : const [tetherLightBrandMuted, tetherLightCard],
        ),
        border: Border.all(color: isDark ? tetherDarkBorder : tetherLightBorder),
        boxShadow: const [
          BoxShadow(
            color: tetherCardShadow,
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.router_outlined,
                  color: tetherPrimaryForeground,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: Theme.of(context)
                                .colorScheme
                                .onSurface
                                .withValues(alpha: 0.66),
                          ),
                    ),
                  ],
                ),
              ),
              Text(
                gatewayLabel,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: _MetricPill(
                  icon: Icons.bolt_outlined,
                  value: '$activeCount',
                  label: AppLocalizations.of(context)!.activeLabel,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricPill(
                  icon: Icons.history,
                  value: '$historyCount',
                  label: AppLocalizations.of(context)!.historyLabel,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MetricPill extends StatelessWidget {
  const _MetricPill({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.06),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 8),
            Text(
              value,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SessionSegmentedTabBar extends StatelessWidget {
  const _SessionSegmentedTabBar({
    required this.activeLabel,
    required this.historyLabel,
  });

  final String activeLabel;
  final String historyLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 48,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.06),
        ),
      ),
      child: TabBar(
        dividerColor: tetherTransparent,
        indicatorSize: TabBarIndicatorSize.tab,
        indicator: BoxDecoration(
          color: Theme.of(context).colorScheme.primary,
          borderRadius: BorderRadius.circular(14),
        ),
        tabs: [
          Tab(text: activeLabel),
          Tab(text: historyLabel),
        ],
      ),
    );
  }
}

class _SessionListTab extends StatelessWidget {
  const _SessionListTab({
    required this.emptyText,
    required this.sessions,
    required this.itemBuilder,
  });

  final String emptyText;
  final List<RelaySession> sessions;
  final Widget Function(RelaySession session) itemBuilder;

  @override
  Widget build(BuildContext context) {
    if (sessions.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [Text(emptyText)],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: sessions.length,
      itemBuilder: (context, index) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: itemBuilder(sessions[index]),
      ),
    );
  }
}

class _GatewayUnavailableEmptyState extends StatelessWidget {
  const _GatewayUnavailableEmptyState();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          const Icon(Icons.wifi_off, size: 40, color: tetherMuted),
          const SizedBox(height: 12),
          Text(
            l10n.gatewayNotConnected,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            l10n.relayGatewayUnavailableDescription,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
