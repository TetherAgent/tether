import 'package:flutter/material.dart';

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
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: List<Widget>.generate(widget.turn.options.length, (index) {
        final option = widget.turn.options[index];
        return ElevatedButton(
          onPressed: _selectedIndex == null
              ? () async {
                  setState(() {
                    _selectedIndex = index;
                  });
                  await widget.service.sendMessage(option.label);
                }
              : null,
          child: Text(option.label),
        );
      }),
    );
  }
}
