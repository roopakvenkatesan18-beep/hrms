import { createHmac, randomUUID } from 'node:crypto';

export const LOGIN_LIMIT_SCRIPT = `
local stamp = redis.call('TIME')
local now = tonumber(stamp[1]) * 1000 + math.floor(tonumber(stamp[2]) / 1000)
local window = tonumber(ARGV[1])
local maximum = tonumber(ARGV[2])
local retry = 0
for _, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  if redis.call('ZCARD', key) >= maximum then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    retry = math.max(retry, tonumber(oldest[2]) + window - now)
  end
end
if retry > 0 then return {0, retry} end
for _, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, ARGV[3])
  redis.call('PEXPIRE', key, window)
end
return {1, 0}
`;

export function limiterId(secret, kind, value) {
  return createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex');
}

export function createLoginLimiter(client, secret) {
  return {
    async consume(ip, empid) {
      if (!client.isReady) throw new Error('Rate limit store unavailable');
      let timeout;
      let result;
      try {
        result = await Promise.race([
          client.eval(LOGIN_LIMIT_SCRIPT, {
            keys: [
              `hrms:{login}:ip:${limiterId(secret, 'ip', ip)}`,
              `hrms:{login}:empid:${limiterId(secret, 'empid', empid)}`
            ],
            arguments: ['900000', '15', randomUUID()]
          }),
          new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Rate limit store timed out')), 3000);
          })
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid rate limit response');
      return { allowed: Number(result[0]) === 1, retryAfterMs: Number(result[1]) };
    }
  };
}
