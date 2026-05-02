import { Controller } from 'egg';

export default class HealthController extends Controller {
  public async index(): Promise<void> {
    this.ctx.body = {
      ok: true,
      service: '@tether/server'
    };
  }
}
