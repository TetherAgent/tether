import 'package:flutter/material.dart';
import 'package:tether/l10n/app_localizations.dart';
import 'package:tether/models/conversation.dart';

String _truncate(String value, int maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return '${value.substring(0, maxLength)}...';
}

String _inputSummary(Map<String, dynamic> input, int maxLength) {
  final value =
      input.entries.map((entry) => '${entry.key}:${entry.value}').join(', ');
  return _truncate(value, maxLength);
}

class ToolCard extends StatelessWidget {
  const ToolCard({super.key, required this.turn});

  final ToolCallTurn turn;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.pending_outlined),
        title: Text(turn.toolCall.toolName),
        subtitle: Text(_inputSummary(turn.toolCall.input, 60)),
      ),
    );
  }
}

class ToolResultCard extends StatelessWidget {
  const ToolResultCard({super.key, required this.turn});

  final ToolResultTurn turn;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Card(
      child: ListTile(
        leading: const Icon(Icons.check_circle_outline),
        title: Text(l10n.toolCompleted),
        subtitle: Text(_truncate(turn.output, 80)),
      ),
    );
  }
}
