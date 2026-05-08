import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:tether/models/conversation.dart';
import 'package:tether/services/conversation_service.dart';
import 'package:tether/widgets/chat_session_surface.dart';

class _ConversationServiceStub extends ConversationService {
  _ConversationServiceStub({
    required List<ConversationTurn> initialTurns,
    required bool typing,
  })  : _turns = initialTurns,
        _typing = typing;

  final List<ConversationTurn> _turns;
  final bool _typing;
  String? sentMessage;

  @override
  List<ConversationTurn> get turns => _turns;

  @override
  bool get isTyping => _typing;

  @override
  Future<void> sendMessage(String text) async {
    sentMessage = text;
  }
}

void main() {
  Widget buildApp(_ConversationServiceStub service) {
    return ChangeNotifierProvider<ConversationService>.value(
      value: service,
      child: const MaterialApp(home: Scaffold(body: ChatSessionSurface())),
    );
  }

  testWidgets('renders user and assistant turns', (tester) async {
    final service = _ConversationServiceStub(
      initialTurns: const [
        UserTurn(id: '1', content: 'hello'),
        AssistantTurn(id: '2', content: 'world'),
      ],
      typing: false,
    );
    await tester.pumpWidget(buildApp(service));

    expect(find.text('hello'), findsOneWidget);
    expect(find.text('world'), findsOneWidget);
  });

  testWidgets('renders tool card and select options', (tester) async {
    final service = _ConversationServiceStub(
      initialTurns: const [
        ToolCallTurn(
          id: '1',
          toolCall: ToolCallInfo(
            toolCallId: 'tool-1',
            toolName: 'search',
            input: {'q': 'demo'},
          ),
        ),
        SelectOptionsTurn(
          id: '2',
          options: [
            SelectOption(id: 'a', label: 'Option A'),
            SelectOption(id: 'b', label: 'Option B'),
          ],
        ),
      ],
      typing: false,
    );
    await tester.pumpWidget(buildApp(service));

    expect(find.text('search'), findsOneWidget);
    await tester.tap(find.text('Option A'));
    await tester.pump();
    expect(service.sentMessage, 'Option A');
  });

  testWidgets('shows typing indicator', (tester) async {
    final service = _ConversationServiceStub(
      initialTurns: const [],
      typing: true,
    );
    await tester.pumpWidget(buildApp(service));

    expect(find.byType(AnimatedBuilder), findsWidgets);
  });
}
