// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Tether';

  @override
  String get agentConsoleSubtitle => 'Agent console';

  @override
  String get loginButton => 'Sign in';

  @override
  String get registerButton => 'Register';

  @override
  String get logoutButton => 'Sign out';

  @override
  String get emailLabel => 'Email';

  @override
  String get passwordLabel => 'Password';

  @override
  String get displayNameLabel => 'Display name';

  @override
  String get confirmPasswordLabel => 'Confirm password';

  @override
  String get confirmPasswordMismatch => 'Passwords do not match';

  @override
  String get noAccountLink => 'No account yet? Register';

  @override
  String get sessionsTab => 'Sessions';

  @override
  String get settingsTab => 'Settings';

  @override
  String get activeLabel => 'Active';

  @override
  String get historyLabel => 'History';

  @override
  String get gatewayLabel => 'Gateway';

  @override
  String get gatewayPanelTitle => 'Connection';

  @override
  String get relayShortLabel => 'Relay';

  @override
  String get stopSessionLabel => 'Stop';

  @override
  String get themeLabel => 'Theme';

  @override
  String get localeLabel => 'Language';

  @override
  String get accountInfoLabel => 'Account';

  @override
  String get gatewayNotConnected => 'Gateway not connected';

  @override
  String get relayGatewayUnavailableDescription =>
      'Gateway has not connected to Relay. Start tether gateway first.';

  @override
  String get noSessionsDescription =>
      'Start a session from the CLI, then refresh this page.';

  @override
  String get chatTab => 'Chat';

  @override
  String get terminalTab => 'Terminal';

  @override
  String get chatSend => 'Send';

  @override
  String get thinkingLabel => 'Thinking';

  @override
  String get toolCallLabel => 'Tool call';

  @override
  String get toolCompleted => 'Tool completed';

  @override
  String get selectPrompt => 'Select an option';

  @override
  String get replayTitle => 'Replay';

  @override
  String get throughRelay => 'Connected via Relay';

  @override
  String get sessionScreenPending =>
      'The session screen will be implemented in 09-05.';

  @override
  String get replayScreenPending =>
      'The replay screen will be implemented in 09-05.';
}
