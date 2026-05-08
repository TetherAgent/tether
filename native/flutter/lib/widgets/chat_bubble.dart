import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:tether/models/conversation.dart';
import 'package:tether/theme.dart';

class UserBubble extends StatelessWidget {
  const UserBubble({super.key, required this.turn, this.folded = false});

  final UserTurn turn;
  final bool folded;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bubble = _BubbleSurface(
      alignment: Alignment.centerRight,
      maxWidthFactor: 0.82,
      avatar: folded ? const _AvatarSpacer() : const _UserAvatar(),
      avatarOnRight: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF95EC69),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: Radius.circular(folded ? 16 : 6),
            bottomLeft: const Radius.circular(16),
            bottomRight: const Radius.circular(16),
          ),
        ),
        child: Text(
          turn.content,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: const Color(0xFF052E16),
            height: 1.55,
            fontSize: 14,
          ),
        ),
      ),
    );
    return folded
        ? Transform.translate(offset: const Offset(0, -8), child: bubble)
        : bubble;
  }
}

class AssistantBubble extends StatelessWidget {
  const AssistantBubble({super.key, required this.turn, this.folded = false});

  final AssistantTurn turn;
  final bool folded;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final border = isDark ? tetherDarkBorder : tetherLightBorder;
    final card = isDark ? tetherDarkCard : tetherLightCard;
    final bubble = _BubbleSurface(
      alignment: Alignment.centerLeft,
      maxWidthFactor: 0.88,
      avatar: folded ? const _AvatarSpacer() : const _AgentAvatar(),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: Color.alphaBlend(
            theme.colorScheme.primary.withValues(alpha: isDark ? 0.10 : 0.06),
            card,
          ),
          border: Border.all(color: border),
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(folded ? 16 : 6),
            topRight: const Radius.circular(16),
            bottomLeft: const Radius.circular(16),
            bottomRight: const Radius.circular(16),
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x10000000),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: MarkdownBody(
          data: turn.content,
          selectable: true,
          styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
            p: theme.textTheme.bodyMedium?.copyWith(
              height: 1.6,
              fontSize: 14,
              color: theme.colorScheme.onSurface,
            ),
            code: theme.textTheme.bodySmall?.copyWith(
              fontFamily: 'monospace',
              backgroundColor: (isDark ? tetherDarkMuted : tetherLightMuted)
                  .withValues(alpha: 0.14),
            ),
            codeblockDecoration: BoxDecoration(
              color: (isDark ? tetherDarkMuted : tetherLightMuted)
                  .withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: border),
            ),
            blockquoteDecoration: BoxDecoration(
              color: theme.colorScheme.primary.withValues(alpha: 0.04),
              border: Border(
                left: BorderSide(color: theme.colorScheme.primary, width: 3),
              ),
            ),
          ),
        ),
      ),
    );
    return folded
        ? Transform.translate(offset: const Offset(0, -8), child: bubble)
        : bubble;
  }
}

class TypingIndicator extends StatefulWidget {
  const TypingIndicator({super.key, required this.visible});

  final bool visible;

  @override
  State<TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<TypingIndicator>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 800),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.visible) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    final muted = theme.brightness == Brightness.dark
        ? tetherDarkMuted
        : tetherLightMuted;
    return _BubbleSurface(
      alignment: Alignment.centerLeft,
      maxWidthFactor: 0.7,
      avatar: const _AgentAvatar(),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: muted.withValues(alpha: 0.18)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ...List<Widget>.generate(
              3,
              (index) => FadeTransition(
                opacity: Tween<double>(begin: 0.25, end: 1).animate(
                  CurvedAnimation(
                    parent: _controller,
                    curve: Interval(index * 0.2, 0.6 + index * 0.1),
                  ),
                ),
                child: Container(
                  width: 6,
                  height: 6,
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: BoxDecoration(
                    color: muted,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '思考中',
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
          ],
        ),
      ),
    );
  }
}

class _BubbleSurface extends StatelessWidget {
  const _BubbleSurface({
    required this.alignment,
    required this.maxWidthFactor,
    required this.avatar,
    required this.child,
    this.avatarOnRight = false,
  });

  final Alignment alignment;
  final double maxWidthFactor;
  final Widget avatar;
  final Widget child;
  final bool avatarOnRight;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final bubbleMaxWidth = constraints.maxWidth * maxWidthFactor;
        final children = <Widget>[
          avatar,
          const SizedBox(width: 10),
          Flexible(
            child: Align(
              alignment: alignment,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: bubbleMaxWidth),
                child: child,
              ),
            ),
          ),
        ];
        return Align(
          alignment: alignment,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment:
                avatarOnRight ? MainAxisAlignment.end : MainAxisAlignment.start,
            children: avatarOnRight ? children.reversed.toList() : children,
          ),
        );
      },
    );
  }
}

class _AgentAvatar extends StatelessWidget {
  const _AgentAvatar();

  @override
  Widget build(BuildContext context) {
    return _AvatarCircle(
      backgroundColor:
          Theme.of(context).colorScheme.primary.withValues(alpha: 0.14),
      foregroundColor: Theme.of(context).colorScheme.primary,
      icon: Icons.smart_toy_outlined,
    );
  }
}

class _UserAvatar extends StatelessWidget {
  const _UserAvatar();

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return _AvatarCircle(
      backgroundColor: isDark ? tetherDarkInput : tetherLightInput,
      foregroundColor: isDark ? tetherDarkMuted : tetherLightMuted,
      icon: Icons.terminal_rounded,
    );
  }
}

class _AvatarCircle extends StatelessWidget {
  const _AvatarCircle({
    required this.backgroundColor,
    required this.foregroundColor,
    required this.icon,
  });

  final Color backgroundColor;
  final Color foregroundColor;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: backgroundColor,
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: 16, color: foregroundColor),
    );
  }
}

class _AvatarSpacer extends StatelessWidget {
  const _AvatarSpacer();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(width: 32, height: 1);
  }
}
