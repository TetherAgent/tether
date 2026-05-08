import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';

import '../services/relay_client.dart';
import '../theme.dart';
import '../widgets/session_card.dart';
import '../widgets/stats_row.dart';

class SessionListScreen extends StatefulWidget {
  const SessionListScreen({super.key});

  @override
  State<SessionListScreen> createState() => _SessionListScreenState();
}

class _SessionListScreenState extends State<SessionListScreen> {
  bool _historyExpanded = true;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final relayClient = context.watch<RelayClient>();
    final active = relayClient.activeSessions;
    final history = relayClient.historySessions;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.sessionsTab),
        actions: [
          IconButton(
            onPressed: () => context.read<LocaleNotifier>().toggleLocale(),
            icon: const Icon(Icons.language),
          ),
          IconButton(
            onPressed: () => context.read<ThemeNotifier>().toggleTheme(),
            icon: const Icon(Icons.brightness_6_outlined),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          StatsRow(activeCount: active.length, historyCount: history.length),
          const SizedBox(height: 16),
          ListTile(
            title: Text(l10n.gatewayPanelTitle),
            subtitle: Text(l10n.throughRelay),
          ),
          const SizedBox(height: 8),
          if (relayClient.gatewayUnavailable)
            const _GatewayUnavailableEmptyState()
          else ...[
            Text(l10n.activeLabel,
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (active.isEmpty)
              Text(l10n.noSessionsDescription)
            else
              ...active.map(
                (session) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: SessionCard(
                    session: session,
                    onTap: () => context.push('/session/${session.id}'),
                    onStop: () => relayClient.stopSession(session.id),
                    isHistory: false,
                  ),
                ),
              ),
            const SizedBox(height: 16),
            ExpansionTile(
              initiallyExpanded: _historyExpanded,
              onExpansionChanged: (value) {
                setState(() {
                  _historyExpanded = value;
                });
              },
              title: Text(l10n.historyLabel),
              children: history
                  .map(
                    (session) => Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: SessionCard(
                        session: session,
                        onTap: () => context.push('/replay/${session.id}'),
                        onStop: () {},
                        isHistory: true,
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
        ],
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
