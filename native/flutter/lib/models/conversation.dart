enum ConversationTurnStatus { complete, thinking, error }

enum ChatMessageStatus { pending, sent, delivered, failed }

final class ToolCallInfo {
  const ToolCallInfo({
    required this.toolCallId,
    required this.toolName,
    required this.input,
  });

  final String toolCallId;
  final String toolName;
  final Map<String, dynamic> input;
}

final class SelectOption {
  const SelectOption({required this.id, required this.label});

  final String id;
  final String label;

  factory SelectOption.fromJson(Map<String, dynamic> json) => SelectOption(
        id: json['id'] as String,
        label: json['label'] as String,
      );
}

sealed class ConversationTurn {
  const ConversationTurn({required this.id});

  final String id;
}

final class UserTurn extends ConversationTurn {
  const UserTurn({
    required super.id,
    required this.content,
    this.status = ChatMessageStatus.delivered,
  });

  final String content;
  final ChatMessageStatus status;

  UserTurn copyWith({
    String? content,
    ChatMessageStatus? status,
  }) {
    return UserTurn(
      id: id,
      content: content ?? this.content,
      status: status ?? this.status,
    );
  }
}

final class AssistantTurn extends ConversationTurn {
  const AssistantTurn({
    required super.id,
    required this.content,
    this.status = ConversationTurnStatus.complete,
  });

  final String content;
  final ConversationTurnStatus status;

  AssistantTurn copyWith({
    String? content,
    ConversationTurnStatus? status,
  }) {
    return AssistantTurn(
      id: id,
      content: content ?? this.content,
      status: status ?? this.status,
    );
  }
}

final class ToolCallTurn extends ConversationTurn {
  const ToolCallTurn({required super.id, required this.toolCall});

  final ToolCallInfo toolCall;
}

final class ToolResultTurn extends ConversationTurn {
  const ToolResultTurn({
    required super.id,
    required this.toolCallId,
    required this.output,
  });

  final String toolCallId;
  final String output;
}

final class SelectOptionsTurn extends ConversationTurn {
  const SelectOptionsTurn({required super.id, required this.options});

  final List<SelectOption> options;
}
