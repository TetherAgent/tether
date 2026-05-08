import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// TODO(09-04): Implement full session list with Relay client, stats row,
// active/history sections, swipe-to-stop, gateway panel. See PLAN.md.
class SessionListScreen extends StatelessWidget {
  const SessionListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('会话')),
      body: const Center(child: Text('Session list — coming in plan 09-04')),
    );
  }
}
