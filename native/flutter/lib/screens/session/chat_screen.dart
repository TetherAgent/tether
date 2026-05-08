import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// Primary session view — chat bubble interface.
// TODO(09-05): Implement ChatScreen matching H5 ChatSessionSurface.
// Reference: apps/web/src/components/session/chat-session-surface.tsx
class ChatScreen extends StatelessWidget {
  final String sessionId;
  const ChatScreen({super.key, required this.sessionId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(sessionId, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.terminal),
            tooltip: '终端视图',
            onPressed: () => context.go('/sessions/$sessionId/terminal'),
          ),
        ],
      ),
      body: const Center(child: Text('Chat view — coming in plan 09-05')),
    );
  }
}
