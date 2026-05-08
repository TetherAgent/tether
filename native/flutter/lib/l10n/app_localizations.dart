import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('zh')
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'Tether'**
  String get appName;

  /// No description provided for @agentConsoleSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Agent console'**
  String get agentConsoleSubtitle;

  /// No description provided for @loginButton.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get loginButton;

  /// No description provided for @registerButton.
  ///
  /// In en, this message translates to:
  /// **'Register'**
  String get registerButton;

  /// No description provided for @logoutButton.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get logoutButton;

  /// No description provided for @emailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get emailLabel;

  /// No description provided for @passwordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get passwordLabel;

  /// No description provided for @displayNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Display name'**
  String get displayNameLabel;

  /// No description provided for @confirmPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Confirm password'**
  String get confirmPasswordLabel;

  /// No description provided for @confirmPasswordMismatch.
  ///
  /// In en, this message translates to:
  /// **'Passwords do not match'**
  String get confirmPasswordMismatch;

  /// No description provided for @noAccountLink.
  ///
  /// In en, this message translates to:
  /// **'No account yet? Register'**
  String get noAccountLink;

  /// No description provided for @sessionsTab.
  ///
  /// In en, this message translates to:
  /// **'Sessions'**
  String get sessionsTab;

  /// No description provided for @settingsTab.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTab;

  /// No description provided for @activeLabel.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get activeLabel;

  /// No description provided for @historyLabel.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get historyLabel;

  /// No description provided for @gatewayLabel.
  ///
  /// In en, this message translates to:
  /// **'Gateway'**
  String get gatewayLabel;

  /// No description provided for @gatewayPanelTitle.
  ///
  /// In en, this message translates to:
  /// **'Connection'**
  String get gatewayPanelTitle;

  /// No description provided for @relayShortLabel.
  ///
  /// In en, this message translates to:
  /// **'Relay'**
  String get relayShortLabel;

  /// No description provided for @stopSessionLabel.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get stopSessionLabel;

  /// No description provided for @themeLabel.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get themeLabel;

  /// No description provided for @localeLabel.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get localeLabel;

  /// No description provided for @accountInfoLabel.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get accountInfoLabel;

  /// No description provided for @gatewayNotConnected.
  ///
  /// In en, this message translates to:
  /// **'Gateway not connected'**
  String get gatewayNotConnected;

  /// No description provided for @relayGatewayUnavailableDescription.
  ///
  /// In en, this message translates to:
  /// **'Gateway has not connected to Relay. Start tether gateway first.'**
  String get relayGatewayUnavailableDescription;

  /// No description provided for @noSessionsDescription.
  ///
  /// In en, this message translates to:
  /// **'Start a session from the CLI, then refresh this page.'**
  String get noSessionsDescription;

  /// No description provided for @chatTab.
  ///
  /// In en, this message translates to:
  /// **'Chat'**
  String get chatTab;

  /// No description provided for @terminalTab.
  ///
  /// In en, this message translates to:
  /// **'Terminal'**
  String get terminalTab;

  /// No description provided for @chatSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get chatSend;

  /// No description provided for @thinkingLabel.
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get thinkingLabel;

  /// No description provided for @toolCallLabel.
  ///
  /// In en, this message translates to:
  /// **'Tool call'**
  String get toolCallLabel;

  /// No description provided for @toolCompleted.
  ///
  /// In en, this message translates to:
  /// **'Tool completed'**
  String get toolCompleted;

  /// No description provided for @selectPrompt.
  ///
  /// In en, this message translates to:
  /// **'Select an option'**
  String get selectPrompt;

  /// No description provided for @replayTitle.
  ///
  /// In en, this message translates to:
  /// **'Replay'**
  String get replayTitle;

  /// No description provided for @throughRelay.
  ///
  /// In en, this message translates to:
  /// **'Connected via Relay'**
  String get throughRelay;

  /// No description provided for @sessionScreenPending.
  ///
  /// In en, this message translates to:
  /// **'The session screen will be implemented in 09-05.'**
  String get sessionScreenPending;

  /// No description provided for @replayScreenPending.
  ///
  /// In en, this message translates to:
  /// **'The replay screen will be implemented in 09-05.'**
  String get replayScreenPending;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'zh'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
