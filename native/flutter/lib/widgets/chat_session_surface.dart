import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tether/l10n/app_localizations.dart';
import 'package:tether/theme.dart';

import '../models/conversation.dart';
import '../services/conversation_service.dart';
import '../services/relay_client.dart';
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
  final FocusNode _keyboardFocusNode = FocusNode();
  final List<String> _history = <String>[];
  int _unreadCount = 0;
  int? _historyIndex;
  String? _draftKey;

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
    _composerController.addListener(_persistDraft);
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
    _keyboardFocusNode.dispose();
    super.dispose();
  }

  Future<void> _send(ConversationService service) async {
    final text = _composerController.text;
    if (text.trim().isEmpty) {
      return;
    }
    _composerController.clear();
    _history.add(text.trim());
    _historyIndex = null;
    await service.sendMessage(text);
    _composerFocusNode.requestFocus();
  }

  Future<void> _loadDraft(String sessionId) async {
    final key = 'tether:draft:$sessionId';
    if (_draftKey == key) {
      return;
    }
    _draftKey = key;
    final prefs = await SharedPreferences.getInstance();
    if (!mounted || _composerController.text.isNotEmpty) {
      return;
    }
    _composerController.text = prefs.getString(key) ?? '';
  }

  void _persistDraft() {
    final key = _draftKey;
    if (key == null) {
      return;
    }
    SharedPreferences.getInstance().then((prefs) {
      final text = _composerController.text;
      if (text.isEmpty) {
        prefs.remove(key);
      } else {
        prefs.setString(key, text);
      }
    });
  }

  void _handleKey(KeyEvent event, ConversationService service) {
    if (event is! KeyDownEvent) {
      return;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape && service.isTyping) {
      service.cancelGeneration();
      return;
    }
    if (HardwareKeyboard.instance.isMetaPressed ||
        HardwareKeyboard.instance.isControlPressed) {
      if (key == LogicalKeyboardKey.keyK) {
        _composerController.clear();
        _historyIndex = null;
      }
      return;
    }
    if (_composerController.text.isNotEmpty || _history.isEmpty) {
      return;
    }
    if (key == LogicalKeyboardKey.arrowUp) {
      final nextIndex = _historyIndex == null
          ? _history.length - 1
          : (_historyIndex! - 1).clamp(0, _history.length - 1);
      _historyIndex = nextIndex;
      _composerController.text = _history[nextIndex];
      _composerController.selection = TextSelection.collapsed(
        offset: _composerController.text.length,
      );
      return;
    }
    if (key == LogicalKeyboardKey.arrowDown && _historyIndex != null) {
      final nextIndex = _historyIndex! + 1;
      if (nextIndex >= _history.length) {
        _historyIndex = null;
        _composerController.clear();
      } else {
        _historyIndex = nextIndex;
        _composerController.text = _history[nextIndex];
        _composerController.selection = TextSelection.collapsed(
          offset: _composerController.text.length,
        );
      }
    }
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
    final relayClient = Provider.of<RelayClient?>(context);
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final border = isDark ? tetherDarkBorder : tetherLightBorder;
    final field = isDark ? tetherDarkField : tetherLightField;
    final muted = isDark ? tetherDarkMuted : tetherLightMuted;
    final sendLabel =
        Localizations.of<AppLocalizations>(context, AppLocalizations)
                ?.chatSend ??
            '发送';
    final sessionId = service.sessionId;
    if (sessionId != null) {
      unawaited(_loadDraft(sessionId));
    }
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

    return KeyboardListener(
      focusNode: _keyboardFocusNode,
      autofocus: true,
      onKeyEvent: (event) => _handleKey(event, service),
      child: DecoratedBox(
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
                if (service.errorBanner != null ||
                    relayClient?.gatewayUnavailable == true ||
                    relayClient?.status == 'disconnected' ||
                    relayClient?.status == 'error')
                  _ChatErrorBanner(
                    message: service.errorBanner ??
                        (relayClient?.gatewayUnavailable == true
                            ? 'Gateway 尚未连接到 Relay。'
                            : '连接已断开，正在重连。'),
                    actionLabel:
                        relayClient?.gatewayUnavailable == true ? '刷新' : '重连',
                    onAction: () {
                      if (relayClient?.gatewayUnavailable == true) {
                        service.refreshConversation();
                      } else if (relayClient != null) {
                        unawaited(relayClient.connect());
                      }
                    },
                  ),
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
                          UserTurn() => UserBubble(
                              turn: turn,
                              folded: folded,
                              onRetry: () => service.retryMessage(turn),
                            ),
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
                            onTap: _keyboardFocusNode.requestFocus,
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
      ),
    );
  }
}

class _ChatErrorBanner extends StatelessWidget {
  const _ChatErrorBanner({
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      decoration: BoxDecoration(
        color: theme.colorScheme.error.withValues(alpha: 0.10),
        border: Border(
          bottom: BorderSide(
            color: theme.colorScheme.error.withValues(alpha: 0.45),
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.wifi_off_rounded,
              size: 16, color: theme.colorScheme.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.error,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          TextButton(
            onPressed: onAction,
            child: Text(actionLabel),
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
