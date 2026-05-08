import 'package:flutter/material.dart';
import 'package:tether/theme.dart';

import '../models/conversation.dart';
import '../services/conversation_service.dart';

class SelectOptionsRow extends StatefulWidget {
  const SelectOptionsRow({
    super.key,
    required this.turn,
    required this.service,
  });

  final SelectOptionsTurn turn;
  final ConversationService service;

  @override
  State<SelectOptionsRow> createState() => _SelectOptionsRowState();
}

class _SelectOptionsRowState extends State<SelectOptionsRow> {
  int? _selectedIndex;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final border = isDark ? tetherDarkBorder : tetherLightBorder;
    final muted = isDark ? tetherDarkMuted : tetherLightMuted;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(left: 42),
        constraints: const BoxConstraints(maxWidth: 420),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: border),
        ),
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          children: List<Widget>.generate(widget.turn.options.length, (index) {
            final option = widget.turn.options[index];
            final selected = _selectedIndex == index;
            return OutlinedButton(
              onPressed: _selectedIndex == null
                  ? () async {
                      setState(() {
                        _selectedIndex = index;
                      });
                      await widget.service.sendMessage(option.label);
                    }
                  : null,
              style: OutlinedButton.styleFrom(
                foregroundColor: selected
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurface,
                backgroundColor: selected
                    ? theme.colorScheme.primary.withValues(alpha: 0.10)
                    : theme.colorScheme.surface,
                side: BorderSide(
                  color: selected ? theme.colorScheme.primary : border,
                ),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    constraints: const BoxConstraints(minWidth: 18),
                    height: 18,
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    decoration: BoxDecoration(
                      color: muted.withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      '${index + 1}',
                      style: TextStyle(
                        color: muted,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(option.label),
                  if (selected) ...[
                    const SizedBox(width: 6),
                    Text(
                      '已选',
                      style: TextStyle(
                        color: theme.colorScheme.primary,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ],
              ),
            );
          }),
        ),
      ),
    );
  }
}
