import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';
import 'package:tether/theme.dart';

import '../models/protocol.dart';
import '../services/conversation_service.dart';
import '../services/relay_client.dart';
import '../widgets/chat_session_surface.dart';
import 'terminal_screen.dart';

class SessionScreen extends StatefulWidget {
  const SessionScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final relayClient = context.read<RelayClient>();
    context.read<ConversationService>().attach(relayClient, widget.sessionId);
    relayClient.subscribe(
      widget.sessionId,
      mode: RelayClientMode.control,
      after: 0,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final border = isDark ? tetherDarkBorder : tetherLightBorder;
    final muted = isDark ? tetherDarkMuted : tetherLightMuted;
    final relayClient = context.watch<RelayClient>();
    final session = relayClient.sessions
        .where((item) => item.id == widget.sessionId)
        .firstOrNull;
    final statusLabel = _sessionStatusLabel(session?.status);
    final providerLabel = session?.provider ?? 'Agent';
    final agentSessionId = session?.agentSessionId;

    return DefaultTabController(
      length: 2,
      initialIndex: 1,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor:
              theme.scaffoldBackgroundColor.withValues(alpha: 0.92),
          toolbarHeight: 56,
          titleSpacing: 0,
          title: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Row(
              children: [
                IconButton(
                  tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: const Icon(Icons.arrow_back_rounded),
                ),
                const SizedBox(width: 10),
                _StatusPill(
                  icon: Icons.circle,
                  label: statusLabel,
                  color: theme.colorScheme.primary,
                  filled: true,
                ),
                const SizedBox(width: 8),
                _StatusPill(
                  icon: Icons.smart_toy_outlined,
                  label: providerLabel,
                  color: muted,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: Container(
                      height: 38,
                      width: 172,
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(
                        color:
                            theme.colorScheme.surface.withValues(alpha: 0.84),
                        borderRadius: BorderRadius.circular(13),
                        border: Border.all(color: border),
                      ),
                      child: TabBar(
                        indicatorSize: TabBarIndicatorSize.tab,
                        indicator: BoxDecoration(
                          color: theme.colorScheme.primary,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        labelColor: theme.colorScheme.onPrimary,
                        unselectedLabelColor: muted,
                        dividerColor: Colors.transparent,
                        labelStyle: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                        ),
                        unselectedLabelStyle: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                        ),
                        tabs: [
                          Tab(
                            child: _TabLabel(
                              icon: Icons.terminal_rounded,
                              label: l10n.terminalTab,
                            ),
                          ),
                          Tab(
                            child: _TabLabel(
                              icon: Icons.chat_bubble_outline_rounded,
                              label: l10n.chatTab,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          bottom: PreferredSize(
            preferredSize: Size.fromHeight(agentSessionId == null ? 1 : 44),
            child: Container(
              width: double.infinity,
              padding: EdgeInsets.fromLTRB(
                16,
                agentSessionId == null ? 0 : 10,
                16,
                agentSessionId == null ? 0 : 10,
              ),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: border)),
              ),
              child: agentSessionId == null
                  ? const SizedBox.shrink()
                  : Text(
                      'Agent 会话: $agentSessionId',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: muted,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0,
                      ),
                    ),
            ),
          ),
        ),
        body: TabBarView(
          children: [
            TerminalScreen(sessionId: widget.sessionId),
            const ChatSessionSurface(),
          ],
        ),
      ),
    );
  }
}

class _TabLabel extends StatelessWidget {
  const _TabLabel({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return FittedBox(
      fit: BoxFit.scaleDown,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 15),
          const SizedBox(width: 5),
          Text(label, maxLines: 1),
        ],
      ),
    );
  }
}

String _sessionStatusLabel(RelaySessionStatus? status) {
  return switch (status) {
    RelaySessionStatus.running => '处理中',
    RelaySessionStatus.completed => '已完成',
    RelaySessionStatus.stopped => '已停止',
    RelaySessionStatus.failed => '失败',
    RelaySessionStatus.lost => '已丢失',
    null => '正在同步',
  };
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.icon,
    required this.label,
    required this.color,
    this.filled = false,
  });

  final IconData icon;
  final String label;
  final Color color;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: filled ? 0.16 : 0.10),
        borderRadius: BorderRadius.circular(999),
        border:
            Border.all(color: color.withValues(alpha: filled ? 0.32 : 0.12)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: filled ? 10 : 15, color: color),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
