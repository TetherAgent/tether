import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:xterm/xterm.dart';

import '../services/relay_client.dart';
import '../theme.dart';

class TerminalScreen extends StatefulWidget {
  const TerminalScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  State<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends State<TerminalScreen> {
  final Terminal _terminal = Terminal(maxLines: 1000);
  RelayClient? _relayClient;
  StreamSubscription? _subscription;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _relayClient ??= context.read<RelayClient>();
    _subscription ??= _relayClient!.eventStream.listen((event) {
      if (event.sessionId != widget.sessionId) {
        return;
      }
      final output = event.payload['data'] as String?;
      if (output != null && output.isNotEmpty) {
        _terminal.write(output);
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TerminalView(
      _terminal,
      theme: tetherTerminalTheme,
      textStyle: const TerminalStyle(fontSize: 14),
    );
  }
}
