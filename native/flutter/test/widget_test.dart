import 'package:flutter_test/flutter_test.dart';

import 'package:tether/main.dart';

void main() {
  testWidgets('TetherApp renders loading state first', (tester) async {
    await tester.pumpWidget(const TetherApp());
    expect(find.byType(TetherApp), findsOneWidget);
  });
}
