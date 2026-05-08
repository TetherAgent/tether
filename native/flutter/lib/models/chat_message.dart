import 'protocol.dart';

enum ChatMessageStatus { pending, sent, delivered, failed }

class SelectPayload {
  final List<SelectOption> options;
  final String raw;
  final int? selectedIndex;
  const SelectPayload({
    required this.options,
    required this.raw,
    this.selectedIndex,
  });

  SelectPayload copyWith({int? selectedIndex}) => SelectPayload(
        options: options,
        raw: raw,
        selectedIndex: selectedIndex ?? this.selectedIndex,
      );
}

class ChatMessage {
  final String id;
  final String role; // 'user' | 'assistant'
  final String content;
  final List<ToolInfo> tools;
  final ChatMessageStatus? status;
  final SelectPayload? selectPayload;
  final int? createdAt;

  const ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.tools,
    this.status,
    this.selectPayload,
    this.createdAt,
  });

  bool get isUser => role == 'user';

  ChatMessage copyWith({
    ChatMessageStatus? status,
    SelectPayload? selectPayload,
  }) =>
      ChatMessage(
        id: id,
        role: role,
        content: content,
        tools: tools,
        status: status ?? this.status,
        selectPayload: selectPayload ?? this.selectPayload,
        createdAt: createdAt,
      );
}
