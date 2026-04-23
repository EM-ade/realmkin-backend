import Redis from 'ioredis';

// Initialize Redis client
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

class RedisCache {
  constructor() {
    this.client = redis;
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, ttl = 300) { // Default TTL: 5 minutes
    await this.client.set(key, JSON.stringify(value), 'EX', ttl);
  }

  async del(key) {
    await this.client.del(key);
  }

  async invalidatePattern(pattern) {
    const keys = await this.client.keys(pattern + '*');
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }
}

export const redisCache = new RedisCache();