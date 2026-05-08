import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/protocol.dart';

const String kDefaultServerUrl = 'https://tether.earntools.me';
const String kDefaultRelayUrl = 'wss://tether.earntools.me/client';

class AuthException implements Exception {
  const AuthException(this.message);

  final String message;

  @override
  String toString() => 'AuthException($message)';
}

class AuthService extends ChangeNotifier {
  AuthService({
    String? serverUrl,
    Dio? dio,
    Dio? refreshDio,
    FlutterSecureStorage? storage,
  })  : serverUrl = serverUrl ?? kDefaultServerUrl,
        _storage = storage ?? const FlutterSecureStorage(),
        _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: serverUrl ?? kDefaultServerUrl,
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 10),
              ),
            ),
        _refreshDio = refreshDio ??
            Dio(
              BaseOptions(
                baseUrl: serverUrl ?? kDefaultServerUrl,
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 10),
              ),
            ) {
    if (dio == null) {
      _dio.interceptors.add(
        TokenRefreshInterceptor(
          _storage,
          refreshDio: _refreshDio,
        ),
      );
    }
  }

  static const accessKey = 'tether:access_token';
  static const refreshKey = 'tether:refresh_token';
  static const relayUrlKey = 'tether:relay_url';

  final String serverUrl;
  final FlutterSecureStorage _storage;
  final Dio _dio;
  final Dio _refreshDio;

  bool _isAuthenticated = false;

  bool get isAuthenticated => _isAuthenticated;

  Future<void> login({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/auth/login',
        data: {'email': email, 'password': password},
      );
      await _persistAuth(_unwrapApiData(response.data));
    } on DioException catch (error) {
      throw AuthException(_errorMessage(error.response?.data, 'login_failed'));
    }
  }

  Future<void> register({
    required String email,
    required String password,
    String? displayName,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/api/auth/register',
        data: {
          'email': email,
          'password': password,
          if (displayName != null && displayName.isNotEmpty)
            'displayName': displayName,
        },
      );
      await _persistAuth(_unwrapApiData(response.data));
    } on DioException catch (error) {
      throw AuthException(
        _errorMessage(error.response?.data, 'register_failed'),
      );
    }
  }

  Future<bool> checkStoredToken() async {
    final accessToken = await _storage.read(key: accessKey);
    if (accessToken == null || accessToken.isEmpty) {
      _isAuthenticated = false;
      notifyListeners();
      return false;
    }
    try {
      await _dio.post<Map<String, dynamic>>(
        '/api/token/validate',
        data: {'token': accessToken},
      );
      _isAuthenticated = true;
      notifyListeners();
      return true;
    } on DioException {
      return _tryRefresh();
    }
  }

  Future<void> logout() async {
    _isAuthenticated = false;
    await _storage.delete(key: accessKey);
    await _storage.delete(key: refreshKey);
    await _storage.delete(key: relayUrlKey);
    notifyListeners();
  }

  Future<String?> readAccessToken() => _storage.read(key: accessKey);

  Future<String?> readRefreshToken() => _storage.read(key: refreshKey);

  Future<String?> readRelayUrl() async =>
      (await _storage.read(key: relayUrlKey)) ?? kDefaultRelayUrl;

  Future<Map<String, dynamic>> getSessionConversation(String sessionId) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/api/sessions/$sessionId/conversation',
      options: await _authOptions(),
    );
    return response.data ?? const <String, dynamic>{};
  }

  Future<List<RelaySession>> getSessions() async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/api/sessions',
      options: await _authOptions(),
    );
    final rawSessions =
        response.data?['sessions'] as List<dynamic>? ?? const [];
    return rawSessions
        .map((entry) => RelaySession.fromJson(entry as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> getSessionEvents(
    String sessionId, {
    int after = 0,
    int limit = 1000,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/api/sessions/$sessionId/events',
      queryParameters: {'after': after, 'limit': limit},
      options: await _authOptions(),
    );
    return response.data ?? const <String, dynamic>{};
  }

  Future<void> sendSessionInput(String sessionId, String data) async {
    await _dio.post<Map<String, dynamic>>(
      '/api/sessions/$sessionId/input',
      data: {'data': data},
      options: await _authOptions(),
    );
  }

  Future<void> stopSession(String sessionId) async {
    await _dio.post<Map<String, dynamic>>(
      '/api/sessions/$sessionId/stop',
      options: await _authOptions(),
    );
  }

  Future<Options> _authOptions() async {
    final accessToken = await readAccessToken();
    return Options(
      headers: {
        if (accessToken != null && accessToken.isNotEmpty)
          'Authorization': 'Bearer $accessToken',
      },
    );
  }

  Future<void> _persistAuth(Map<String, dynamic> data) async {
    final accessToken = data['accessToken'] as String?;
    final refreshToken = data['refreshToken'] as String?;
    final relayUrl = data['relayUrl'] as String?;
    if (accessToken == null || accessToken.isEmpty) {
      throw const AuthException('missing_access_token');
    }
    await _storage.write(key: accessKey, value: accessToken);
    if (refreshToken != null && refreshToken.isNotEmpty) {
      await _storage.write(key: refreshKey, value: refreshToken);
    }
    if (relayUrl != null && relayUrl.isNotEmpty) {
      await _storage.write(key: relayUrlKey, value: relayUrl);
    }
    _isAuthenticated = true;
    notifyListeners();
  }

  Future<bool> _tryRefresh() async {
    final refreshToken = await _storage.read(key: refreshKey);
    if (refreshToken == null || refreshToken.isEmpty) {
      await logout();
      return false;
    }
    try {
      final response = await _refreshDio.post<Map<String, dynamic>>(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      await _persistAuth(_unwrapApiData(response.data));
      return true;
    } on DioException {
      await logout();
      return false;
    }
  }

  Map<String, dynamic> _unwrapApiData(Map<String, dynamic>? body) {
    final raw = body ?? const <String, dynamic>{};
    if (raw.containsKey('code') && raw.containsKey('data')) {
      final code = raw['code'] as int?;
      if (code != null && code != 200) {
        throw AuthException(raw['msg'] as String? ?? 'request_failed');
      }
      final data = raw['data'];
      if (data is Map<String, dynamic>) {
        return data;
      }
      throw const AuthException('invalid_response');
    }
    return raw;
  }

  String _errorMessage(Object? data, String fallback) {
    if (data is Map<String, dynamic>) {
      return data['msg'] as String? ?? data['message'] as String? ?? fallback;
    }
    return fallback;
  }
}

class TokenRefreshInterceptor extends QueuedInterceptor {
  TokenRefreshInterceptor(
    this._storage, {
    Dio? refreshDio,
  }) : _refreshDio = refreshDio ?? Dio();

  final FlutterSecureStorage _storage;
  final Dio _refreshDio;

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode != 401) {
      handler.next(err);
      return;
    }

    final refreshToken = await _storage.read(key: AuthService.refreshKey);
    if (refreshToken == null || refreshToken.isEmpty) {
      handler.next(err);
      return;
    }

    try {
      final response = await _refreshDio.post<Map<String, dynamic>>(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final data = _unwrapAuthData(response.data);
      final accessToken = data['accessToken'] as String?;
      if (accessToken == null || accessToken.isEmpty) {
        handler.next(err);
        return;
      }
      await _storage.write(key: AuthService.accessKey, value: accessToken);
      final request = err.requestOptions;
      request.headers['Authorization'] = 'Bearer $accessToken';
      final retry = await _refreshDio.fetch<dynamic>(request);
      handler.resolve(retry);
    } on DioException {
      handler.next(err);
    }
  }

  Map<String, dynamic> _unwrapAuthData(Map<String, dynamic>? body) {
    final raw = body ?? const <String, dynamic>{};
    final data = raw.containsKey('data') ? raw['data'] : raw;
    if (data is Map<String, dynamic>) {
      return data;
    }
    return const <String, dynamic>{};
  }
}
