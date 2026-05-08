import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';

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
    relayClient.subscribe(widget.sessionId, mode: RelayClientMode.control);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.sessionId),
          bottom: TabBar(
            tabs: [
              Tab(text: l10n.chatTab),
              Tab(text: l10n.terminalTab),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            const ChatSessionSurface(),
            TerminalScreen(sessionId: widget.sessionId),
          ],
        ),
      ),
    );
  }
}
