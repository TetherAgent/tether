import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';

import '../models/protocol.dart';
import '../services/relay_client.dart';

class ReplayScreen extends StatefulWidget {
  const ReplayScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  State<ReplayScreen> createState() => _ReplayScreenState();
}

class _ReplayScreenState extends State<ReplayScreen> {
  RelayClient? _relayClient;
  StreamSubscription<ReplayOutput>? _subscription;
  final StringBuffer _buffer = StringBuffer();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _relayClient ??= context.read<RelayClient>();
    _subscription ??= _relayClient!.replayOutputStream.listen((frame) {
      if (frame.sessionId != widget.sessionId) {
        return;
      }
      setState(() {
        _buffer.write(frame.data);
      });
    });
    _relayClient!
        .subscribe(widget.sessionId, mode: RelayClientMode.observe, after: 0);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final session = context
        .watch<RelayClient>()
        .historySessions
        .cast<RelaySession?>()
        .firstWhere(
          (item) => item?.id == widget.sessionId,
          orElse: () => null,
        );
    final title = session == null
        ? widget.sessionId
        : (session.title.isNotEmpty ? session.title : session.provider);
    return Scaffold(
      appBar: AppBar(
        title: Text('$title · ${l10n.replayTitle}'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: SingleChildScrollView(
          child: SelectableText(
              _buffer.isEmpty ? widget.sessionId : _buffer.toString()),
        ),
      ),
    );
  }
}
