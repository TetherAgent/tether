import type { Application } from 'egg';
import adminRouter from './router/admin';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireNormalAccess = middleware.requireTokenClass({ expected: [ 'normal_client_access' ] });
  const requireAnyAccess = middleware.requireTokenClass({
    expected: [ 'management_access', 'normal_client_access', 'gateway_access' ]
  });
  const requireGatewayAccess = middleware.requireTokenClass({ expected: [ 'gateway_access' ] });
  const requireRuntimeSyncSecret = middleware.requireRuntimeSyncSecret();

  router.get('/healthz', controller.health.index); // 健康检查

  // 普通用户认证
  router.post('/api/server/auth/register', controller.auth.register);          // 注册
  router.post('/api/server/auth/login', controller.auth.login);                // 登录
  router.post('/api/server/auth/refresh', controller.auth.refresh);            // 刷新 Token
  router.post('/api/server/auth/logout', controller.auth.logout);              // 登出
  router.get('/api/server/auth/me', requireNormalAccess, controller.auth.me);  // 获取当前用户信息

  // Gateway 注册与凭据（CLI 调用）
  router.post('/api/relay/gateway/bind', controller.gateway.bind);                                   // Gateway 绑定账号（邮箱密码）
  router.post('/api/relay/gateway/refresh', controller.gateway.refresh);                             // Gateway 刷新凭据
  router.post('/api/relay/gateway/heartbeat', requireGatewayAccess, controller.gateway.heartbeat);    // Gateway 在线心跳
  router.post('/api/server/gateway-auth/bind', requireNormalAccess, controller.gatewayAuth.bind);    // Gateway 浏览器授权绑定

  // Token 管理
  router.post('/api/server/token/validate', controller.token.validate);                // 验证 Token

  // 审计日志
  router.post('/api/server/audit', controller.audit.create);  // 写入审计事件
  router.get('/api/server/audit', controller.audit.index);    // 查询审计日志

  // Relay → Server 运行时同步（仅 127.0.0.1 可访问，nginx 层拦截外部请求）
  router.post('/api/relay/runtime-sync/gateway/sessions', requireRuntimeSyncSecret, controller.runtimeSync.sessions);      // 同步 Session 列表
  router.post('/api/relay/runtime-sync/gateway/event', requireRuntimeSyncSecret, controller.runtimeSync.event);            // 同步终端事件
  router.get('/api/relay/runtime-sync/gateway-sessions-restore/:gatewayId', requireRuntimeSyncSecret, controller.runtimeSync.gatewaySessionsRestore);

  // Gateway 数据读取（前端只读）
  router.get('/api/server/gateways', requireNormalAccess, controller.gateway.list);

  // Session 数据读取（前端只读，stop/input/resize 走 WebSocket）
  router.get('/api/server/sessions', requireNormalAccess, controller.session.list);                          // Session 列表
  router.patch('/api/server/sessions/:id/title', requireNormalAccess, controller.session.renameTitle);        // 统一会话重命名
  router.post('/api/server/sessions/:id/archive', requireNormalAccess, controller.session.archive);           // 统一会话归档
  router.get('/api/server/sessions/:id/events', requireNormalAccess, controller.session.events);             // 终端事件流
  router.get('/api/server/chat-sessions', requireNormalAccess, controller.chat.sessions);
  router.get('/api/server/chat-sessions/:sessionId/messages', requireNormalAccess, controller.chat.messages);
  router.get('/api/server/chat-sessions/:sessionId/events', requireNormalAccess, controller.chat.events);
  router.put('/api/server/chat-sessions/:sessionId', requireNormalAccess, controller.chat.renameSession);
  router.delete('/api/server/chat-sessions/:sessionId', requireNormalAccess, controller.chat.deleteSession);
  router.get('/api/server/approvals', requireNormalAccess, controller.approval.list);
  router.post('/api/server/approvals/by-request/decision', requireNormalAccess, controller.approval.decideByRequest);
  router.post('/api/server/approvals/:id/decision', requireNormalAccess, controller.approval.decide);
  router.post('/api/relay/approvals/from-event', requireRuntimeSyncSecret, controller.approval.fromEvent);
  router.get('/api/relay/chat-events/:sessionId', requireRuntimeSyncSecret, controller.chatEvents.list);
  router.get('/api/relay/gateway-sessions/:sessionId/metadata', requireRuntimeSyncSecret, controller.runtimeSync.getSessionMetadata);
  router.patch('/api/relay/gateway-sessions/:sessionId/agent-session-id', requireRuntimeSyncSecret, controller.chat.updateAgentSessionId);

  // 管理后台接口
  adminRouter(app);
};
