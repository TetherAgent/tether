import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

const _keyAccessToken = 'tether:accessToken';
const _keyRefreshToken = 'tether:refreshToken';
const _keyServerUrl = 'tether:serverUrl';

// Default Server URL — overridable via settings (UI deferred).
const kDefaultServerUrl = 'https://tether.example.com';

class AuthService {
  final FlutterSecureStorage _storage;
  String? _accessToken;
  String? _refreshToken;
  String _serverUrl = kDefaultServerUrl;

  AuthService() : _storage = const FlutterSecureStorage();

  String get serverUrl => _serverUrl;
  String? get accessToken => _accessToken;
  bool get isAuthenticated => _accessToken != null;

  Future<void> load() async {
    _accessToken = await _storage.read(key: _keyAccessToken);
    _refreshToken = await _storage.read(key: _keyRefreshToken);
    _serverUrl = await _storage.read(key: _keyServerUrl) ?? kDefaultServerUrl;
  }

  Future<void> login(String email, String password) async {
    final res = await http.post(
      Uri.parse('$_serverUrl/api/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    if (res.statusCode != 200) {
      throw Exception('login_failed');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    _accessToken = body['accessToken'] as String;
    _refreshToken = body['refreshToken'] as String?;
    await _storage.write(key: _keyAccessToken, value: _accessToken);
    if (_refreshToken != null) {
      await _storage.write(key: _keyRefreshToken, value: _refreshToken);
    }
  }

  /// Returns true if refresh succeeded, false if re-login is required.
  Future<bool> refresh() async {
    final rt = _refreshToken;
    if (rt == null) return false;
    try {
      final res = await http.post(
        Uri.parse('$_serverUrl/api/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': rt}),
      );
      if (res.statusCode != 200) return false;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      _accessToken = body['accessToken'] as String;
      await _storage.write(key: _keyAccessToken, value: _accessToken);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> logout() async {
    _accessToken = null;
    _refreshToken = null;
    await _storage.deleteAll();
  }

  /// Relay WS URL is derived from Server URL.
  String get relayWsUrl {
    final uri = Uri.parse(_serverUrl);
    final wsScheme = uri.scheme == 'https' ? 'wss' : 'ws';
    return '$wsScheme://${uri.host}${uri.port != 80 && uri.port != 443 ? ':${uri.port}' : ''}/relay/client';
  }
}
