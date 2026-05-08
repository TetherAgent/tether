// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appName => 'Tether';

  @override
  String get agentConsoleSubtitle => 'Agent 控制台';

  @override
  String get loginButton => '登录';

  @override
  String get registerButton => '注册';

  @override
  String get logoutButton => '退出登录';

  @override
  String get emailLabel => '邮箱';

  @override
  String get passwordLabel => '密码';

  @override
  String get displayNameLabel => '显示名称';

  @override
  String get confirmPasswordLabel => '确认密码';

  @override
  String get confirmPasswordMismatch => '两次输入的密码不一致';

  @override
  String get noAccountLink => '还没有账号？去注册';

  @override
  String get sessionsTab => '会话';

  @override
  String get settingsTab => '设置';

  @override
  String get activeLabel => '活跃';

  @override
  String get historyLabel => '历史';

  @override
  String get gatewayLabel => '网关';

  @override
  String get gatewayPanelTitle => '连接状态';

  @override
  String get relayShortLabel => 'Relay';

  @override
  String get stopSessionLabel => '停止';

  @override
  String get themeLabel => '主题';

  @override
  String get localeLabel => '语言';

  @override
  String get accountInfoLabel => '账号信息';

  @override
  String get gatewayNotConnected => 'Gateway 未连接';

  @override
  String get relayGatewayUnavailableDescription =>
      'Gateway 尚未连接到 Relay，请先启动 tether gateway。';

  @override
  String get noSessionsDescription => '先用 CLI 启动一个 session，然后刷新本页。';

  @override
  String get chatTab => '聊天';

  @override
  String get terminalTab => '终端';

  @override
  String get chatSend => '发送';

  @override
  String get thinkingLabel => '思考中';

  @override
  String get toolCallLabel => '工具调用';

  @override
  String get toolCompleted => '工具已完成';

  @override
  String get selectPrompt => '请选择一个选项';

  @override
  String get replayTitle => '回放';

  @override
  String get throughRelay => '通过 Relay 连接';

  @override
  String get sessionScreenPending => '会话页将在 09-05 中实现。';

  @override
  String get replayScreenPending => '回放页将在 09-05 中实现。';
}
