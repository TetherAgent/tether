import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tether/services/auth_service.dart';

class _MockAdapter implements HttpClientAdapter {
  _MockAdapter(this.routes);

  final Map<String, (int, Map<String, dynamic>)> routes;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final entry = routes.entries.firstWhere(
      (route) =>
          options.path.endsWith(route.key) ||
          options.uri.path.endsWith(route.key),
      orElse: () => const MapEntry('/missing', (404, {'message': 'missing'})),
    );
    return ResponseBody.fromBytes(
      utf8.encode(jsonEncode(entry.value.$2)),
      entry.value.$1,
      headers: {
        Headers.contentTypeHeader: const ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio _mockDio(Map<String, (int, Map<String, dynamic>)> routes) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test.local'));
  dio.httpClientAdapter = _MockAdapter(routes);
  return dio;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  test('login stores access and refresh tokens', () async {
    final storage = const FlutterSecureStorage();
    final service = AuthService(
      dio: _mockDio({
        '/api/auth/login': (
          200,
          {
            'code': 200,
            'msg': 'success',
            'data': {
              'accessToken': 'access',
              'refreshToken': 'refresh',
              'relayUrl': 'wss://relay.example.com/client',
            },
          },
        ),
      }),
      storage: storage,
    );

    await service.login(email: 'demo@example.com', password: 'secret');

    expect(await storage.read(key: AuthService.accessKey), 'access');
    expect(await storage.read(key: AuthService.refreshKey), 'refresh');
    expect(service.isAuthenticated, isTrue);
  });

  test('login failure does not persist tokens', () async {
    final storage = const FlutterSecureStorage();
    final service = AuthService(
      dio: _mockDio({
        '/api/auth/login': (401, {'msg': 'bad credentials'}),
      }),
      storage: storage,
    );

    expect(
      () => service.login(email: 'demo@example.com', password: 'bad'),
      throwsA(isA<AuthException>()),
    );
    expect(await storage.read(key: AuthService.accessKey), isNull);
  });

  test('checkStoredToken returns false when storage empty', () async {
    final service = AuthService(
        dio: _mockDio({
      '/api/token/validate': (
        200,
        {'code': 200, 'msg': 'success', 'data': {'ok': true}}
      )
    }));

    expect(await service.checkStoredToken(), isFalse);
  });

  test('checkStoredToken returns true when validate succeeds', () async {
    FlutterSecureStorage.setMockInitialValues({
      AuthService.accessKey: 'valid',
      AuthService.refreshKey: 'refresh',
    });
    final storage = const FlutterSecureStorage();
    final service = AuthService(
      dio: _mockDio({
        '/api/token/validate': (
          200,
          {'code': 200, 'msg': 'success', 'data': {'ok': true}}
        )
      }),
      storage: storage,
    );

    expect(await service.checkStoredToken(), isTrue);
    expect(service.isAuthenticated, isTrue);
  });

  test('checkStoredToken refreshes expired token', () async {
    FlutterSecureStorage.setMockInitialValues({
      AuthService.accessKey: 'expired',
      AuthService.refreshKey: 'refresh',
    });
    final storage = const FlutterSecureStorage();
    final service = AuthService(
      dio: _mockDio({
        '/api/token/validate': (401, {'msg': 'expired'})
      }),
      refreshDio: _mockDio({
        '/api/auth/refresh': (
          200,
          {
            'code': 200,
            'msg': 'success',
            'data': {
              'accessToken': 'fresh',
              'refreshToken': 'refresh-2',
              'relayUrl': 'wss://relay.example.com/client',
            },
          },
        ),
      }),
      storage: storage,
    );

    expect(await service.checkStoredToken(), isTrue);
    expect(await storage.read(key: AuthService.accessKey), 'fresh');
    expect(await storage.read(key: AuthService.refreshKey), 'refresh-2');
  });

  test('checkStoredToken clears storage when refresh fails', () async {
    FlutterSecureStorage.setMockInitialValues({
      AuthService.accessKey: 'expired',
      AuthService.refreshKey: 'stale',
    });
    final storage = const FlutterSecureStorage();
    final service = AuthService(
      dio: _mockDio({
        '/api/token/validate': (401, {'msg': 'expired'})
      }),
      refreshDio: _mockDio({
        '/api/auth/refresh': (401, {'msg': 'expired'})
      }),
      storage: storage,
    );

    expect(await service.checkStoredToken(), isFalse);
    expect(await storage.read(key: AuthService.accessKey), isNull);
    expect(await storage.read(key: AuthService.refreshKey), isNull);
  });

  test('logout clears persisted tokens', () async {
    FlutterSecureStorage.setMockInitialValues({
      AuthService.accessKey: 'access',
      AuthService.refreshKey: 'refresh',
    });
    final storage = const FlutterSecureStorage();
    final service = AuthService(storage: storage);

    await service.logout();

    expect(await storage.read(key: AuthService.accessKey), isNull);
    expect(await storage.read(key: AuthService.refreshKey), isNull);
    expect(service.isAuthenticated, isFalse);
  });
}
