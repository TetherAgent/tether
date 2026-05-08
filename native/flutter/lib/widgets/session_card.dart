import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:tether/l10n/app_localizations.dart';

import '../models/protocol.dart';
import '../theme.dart';

class SessionCard extends StatelessWidget {
  const SessionCard({
    super.key,
    required this.session,
    required this.onTap,
    required this.onStop,
    required this.isHistory,
  });

  final RelaySession session;
  final VoidCallback onTap;
  final VoidCallback onStop;
  final bool isHistory;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final formatter = DateFormat('y-MM-dd HH:mm', locale);
    final title = session.title.isNotEmpty ? session.title : session.provider;
    return Dismissible(
      key: ValueKey(session.id),
      direction:
          isHistory ? DismissDirection.none : DismissDirection.endToStart,
      confirmDismiss: (_) async {
        onStop();
        return false;
      },
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        decoration: BoxDecoration(
          color: tetherDestructive,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          l10n.stopSessionLabel,
          style:
              const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
        ),
      ),
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    Chip(label: Text(session.status.toJson())),
                  ],
                ),
                const SizedBox(height: 8),
                Text(session.projectPath),
                const SizedBox(height: 6),
                Text(
                  formatter.format(
                    DateTime.fromMillisecondsSinceEpoch(session.lastActiveAt),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  session.id,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
