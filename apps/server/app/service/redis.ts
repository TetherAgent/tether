import { Service } from 'egg';

export default class RedisService extends Service {
  private get client() {
    const { app } = this;
    return (app as unknown as { redis: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
      del(key: string): Promise<unknown>;
      publish(channel: string, payload: string): Promise<unknown>;
    } }).redis;
  }

  public async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  public async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  public async publish(channel: string, payload: string): Promise<void> {
    await this.client.publish(channel, payload);
  }
}
