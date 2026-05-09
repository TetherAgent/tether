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
  bool _hydrated = false;

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
    if (!_hydrated) {
      _hydrated = true;
      unawaited(_loadReplay());
    }
  }

  Future<void> _loadReplay() async {
    final relayClient = _relayClient;
    if (relayClient == null) {
      return;
    }
    var after = 0;
    var keepLoading = true;
    while (keepLoading) {
      final data = await relayClient.authService.getSessionEvents(
        widget.sessionId,
        after: after,
        limit: 1000,
      );
      final rawEvents = data['events'] as List<dynamic>? ?? const [];
      if (rawEvents.isEmpty) {
        break;
      }
      for (final entry in rawEvents) {
        final event = RelayTerminalEvent.fromJson(entry as Map<String, dynamic>);
        final output = event.payload['data'] as String?;
        if (output != null && output.isNotEmpty) {
          _buffer.write(output);
        }
        after = event.id;
      }
      keepLoading = rawEvents.length == 1000;
      if (mounted) {
        setState(() {});
      }
    }
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
