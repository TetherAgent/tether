import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/conversation.dart';
import '../services/conversation_service.dart';
import 'chat_bubble.dart';
import 'select_options_row.dart';
import 'tool_card.dart';

class ChatSessionSurface extends StatefulWidget {
  const ChatSessionSurface({super.key});

  @override
  State<ChatSessionSurface> createState() => _ChatSessionSurfaceState();
}

class _ChatSessionSurfaceState extends State<ChatSessionSurface> {
  final ScrollController _scrollController = ScrollController();
  int _unreadCount = 0;

  bool get _isNearBottom {
    if (!_scrollController.hasClients) {
      return true;
    }
    return (_scrollController.position.maxScrollExtent -
            _scrollController.position.pixels) <
        80;
  }

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(() {
      if (_isNearBottom && _unreadCount != 0) {
        setState(() {
          _unreadCount = 0;
        });
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final service = context.watch<ConversationService>();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) {
        return;
      }
      if (_isNearBottom) {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      } else {
        setState(() {
          _unreadCount += 1;
        });
      }
    });

    return Stack(
      children: [
        ListView.builder(
          controller: _scrollController,
          padding: const EdgeInsets.all(16),
          itemCount: service.turns.length + (service.isTyping ? 1 : 0),
          itemBuilder: (context, index) {
            if (index == service.turns.length) {
              return const Padding(
                padding: EdgeInsets.only(top: 8),
                child: TypingIndicator(visible: true),
              );
            }
            final turn = service.turns[index];
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: switch (turn) {
                UserTurn() => UserBubble(turn: turn),
                AssistantTurn() => AssistantBubble(turn: turn),
                ToolCallTurn() => ToolCard(turn: turn),
                ToolResultTurn() => ToolResultCard(turn: turn),
                SelectOptionsTurn() =>
                  SelectOptionsRow(turn: turn, service: service),
              },
            );
          },
        ),
        if (_unreadCount > 0)
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton.small(
              onPressed: () {
                _scrollController.animateTo(
                  _scrollController.position.maxScrollExtent,
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOut,
                );
                setState(() {
                  _unreadCount = 0;
                });
              },
              child: Stack(
                alignment: Alignment.center,
                children: [
                  const Icon(Icons.keyboard_arrow_down),
                  if (_unreadCount > 0)
                    Positioned(
                      right: 0,
                      top: 0,
                      child: CircleAvatar(
                        radius: 8,
                        child: Text(
                          '$_unreadCount',
                          style: const TextStyle(fontSize: 10),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
