import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';

import '../services/auth_service.dart';
import '../theme.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final themeNotifier = context.watch<ThemeNotifier>();
    final localeNotifier = context.watch<LocaleNotifier>();
    final authService = context.read<AuthService>();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ListTile(
          title: Text(l10n.localeLabel),
          subtitle: Text(localeNotifier.locale.languageCode.toUpperCase()),
          onTap: () => localeNotifier.toggleLocale(),
        ),
        ListTile(
          title: Text(l10n.themeLabel),
          subtitle: Text(themeNotifier.themeMode.name),
          onTap: () => themeNotifier.toggleTheme(),
        ),
        ListTile(
          title: Text(l10n.accountInfoLabel),
          subtitle: Text(authService.serverUrl),
        ),
        ListTile(
          leading: const Icon(Icons.logout),
          title: Text(l10n.logoutButton),
          onTap: () async {
            await authService.logout();
            if (context.mounted) {
              context.go('/login');
            }
          },
        ),
      ],
    );
  }
}
