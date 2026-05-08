import 'package:flutter/material.dart';

import '../theme.dart';

class AuthScreenBackground extends StatelessWidget {
  const AuthScreenBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: isDark ? tetherAuthDarkGradient : tetherAuthLightGradient,
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            top: -96,
            right: -80,
            child: _Glow(
              size: 220,
              color: (isDark ? tetherDarkBrand : tetherLightBrand)
                  .withValues(alpha: isDark ? 0.22 : 0.28),
            ),
          ),
          Positioned(
            left: -110,
            bottom: -90,
            child: _Glow(
              size: 260,
              color: (isDark ? tetherDarkSuccess : tetherLightSuccess)
                  .withValues(alpha: isDark ? 0.14 : 0.18),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [
              color,
              tetherTransparent,
            ],
          ),
        ),
      ),
    );
  }
}
