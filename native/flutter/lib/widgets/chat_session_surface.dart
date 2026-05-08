import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';
import 'package:tether/theme.dart';

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
  final TextEditingController _composerController = TextEditingController();
  final FocusNode _composerFocusNode = FocusNode();
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
    _composerController.dispose();
    _composerFocusNode.dispose();
    super.dispose();
  }

  Future<void> _send(ConversationService service) async {
    final text = _composerController.text;
    if (text.trim().isEmpty) {
      return;
    }
    _composerController.clear();
    await service.sendMessage(text);
    _composerFocusNode.requestFocus();
  }

  bool _isFolded(List<ConversationTurn> turns, int index) {
    if (index <= 0) {
      return false;
    }
    final previous = turns[index - 1];
    final current = turns[index];
    return (previous is UserTurn && current is UserTurn) ||
        (previous is AssistantTurn && current is AssistantTurn);
  }

  @override
  Widget build(BuildContext context) {
    final service = context.watch<ConversationService>();
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final border = isDark ? tetherDarkBorder : tetherLightBorder;
    final field = isDark ? tetherDarkField : tetherLightField;
    final muted = isDark ? tetherDarkMuted : tetherLightMuted;
    final sendLabel =
        Localizations.of<AppLocalizations>(context, AppLocalizations)
                ?.chatSend ??
            '发送';
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

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -1.2),
          radius: 1.25,
          colors: [
            theme.colorScheme.primary.withValues(alpha: 0.08),
            theme.scaffoldBackgroundColor,
          ],
          stops: const [0, 0.62],
        ),
      ),
      child: Stack(
        children: [
          Column(
            children: [
              Expanded(
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.fromLTRB(16, 24, 16, 18),
                  itemCount: service.turns.isEmpty && !service.isTyping
                      ? 1
                      : service.turns.length + (service.isTyping ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (service.turns.isEmpty && !service.isTyping) {
                      return _EmptyChatState(muted: muted);
                    }
                    if (index == service.turns.length) {
                      return const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: TypingIndicator(visible: true),
                      );
                    }
                    final turns = service.turns;
                    final turn = turns[index];
                    final folded = _isFolded(turns, index);
                    return Padding(
                      padding: EdgeInsets.only(bottom: folded ? 6 : 14),
                      child: switch (turn) {
                        UserTurn() => UserBubble(turn: turn, folded: folded),
                        AssistantTurn() =>
                          AssistantBubble(turn: turn, folded: folded),
                        ToolCallTurn() => ToolCard(turn: turn),
                        ToolResultTurn() => ToolResultCard(turn: turn),
                        SelectOptionsTurn() =>
                          SelectOptionsRow(turn: turn, service: service),
                      },
                    );
                  },
                ),
              ),
              SafeArea(
                top: false,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surface.withValues(alpha: 0.96),
                    border: Border(top: BorderSide(color: border)),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x14000000),
                        blurRadius: 18,
                        offset: Offset(0, -8),
                      ),
                    ],
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _composerController,
                          focusNode: _composerFocusNode,
                          minLines: 1,
                          maxLines: 4,
                          textInputAction: TextInputAction.newline,
                          decoration: InputDecoration(
                            hintText: '发送给 Agent',
                            hintStyle: TextStyle(color: muted),
                            filled: true,
                            fillColor: field,
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 11,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: border),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(14),
                              borderSide: BorderSide(color: border),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      FilledButton(
                        onPressed: () => _send(service),
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(54, 44),
                          padding: const EdgeInsets.symmetric(horizontal: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(sendLabel),
                            const SizedBox(width: 5),
                            const Icon(Icons.send_rounded, size: 16),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (_unreadCount > 0)
            Positioned(
              right: 16,
              bottom: 88,
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
      ),
    );
  }
}

class _EmptyChatState extends StatelessWidget {
  const _EmptyChatState({required this.muted});

  final Color muted;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: muted.withValues(alpha: 0.14)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.smart_toy_outlined,
            size: 18,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '暂无结构化聊天记录，可切到终端查看回放。',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: muted,
                    height: 1.45,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
