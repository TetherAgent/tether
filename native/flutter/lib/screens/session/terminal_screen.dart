import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// Secondary session view — xterm terminal widget.
// TODO(09-05): Implement TerminalScreen using xterm pub.dev package.
class TerminalScreen extends StatelessWidget {
  final String sessionId;
  const TerminalScreen({super.key, required this.sessionId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(sessionId, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.chat_bubble_outline),
            tooltip: 'Chat 视图',
            onPressed: () => context.go('/sessions/$sessionId/chat'),
          ),
        ],
      ),
      body: const Center(child: Text('Terminal view — coming in plan 09-05')),
    );
  }
}
