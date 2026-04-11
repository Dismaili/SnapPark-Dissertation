import { describe, it, expect } from 'vitest';
import { BaseChannel } from '../src/channels/BaseChannel.js';

describe('BaseChannel', () => {
  it('should throw when instantiated directly', () => {
    expect(() => new BaseChannel('test'))
      .toThrow('BaseChannel is abstract');
  });

  it('should allow subclasses to be instantiated', () => {
    class TestChannel extends BaseChannel {
      constructor() { super('test'); }
      async send() { return { success: true }; }
    }

    const channel = new TestChannel();
    expect(channel.name).toBe('test');
  });

  it('should throw if send() is not implemented', async () => {
    class IncompleteChannel extends BaseChannel {
      constructor() { super('incomplete'); }
    }

    const channel = new IncompleteChannel();
    await expect(channel.send({}))
      .rejects.toThrow('send() must be implemented');
  });

  it('should allow subclasses to implement send()', async () => {
    class WorkingChannel extends BaseChannel {
      constructor() { super('working'); }
      async send(payload) {
        return { success: true, providerResponse: { to: payload.to } };
      }
    }

    const channel = new WorkingChannel();
    const result = await channel.send({ to: 'test@example.com' });

    expect(result.success).toBe(true);
    expect(result.providerResponse.to).toBe('test@example.com');
  });
});
