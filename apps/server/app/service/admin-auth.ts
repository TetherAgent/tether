import { Service } from 'egg';

type ManagementAuthInput = {
  email: string;
  password: string;
  displayName?: string;
  deviceName?: string;
  platform?: string;
  ip?: string;
  userAgent?: string;
};

export default class AdminAuthService extends Service {
  public async registerManagementUser(input: ManagementAuthInput) {
    const { ctx } = this;
    return await ctx.service.auth.registerManagementUser(input);
  }

  public async loginManagementUser(input: ManagementAuthInput) {
    const { ctx } = this;
    return await ctx.service.auth.loginManagementUser(input);
  }

  public async refreshManagementToken(refreshToken: string) {
    const { ctx } = this;
    return await ctx.service.auth.refreshFromToken(refreshToken);
  }
}
