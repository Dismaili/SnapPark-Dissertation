/**
 * Abstract base class for notification channels.
 * Every channel must implement the send() method and return a
 * standardised result: { success, providerResponse?, error? }.
 */
export class BaseChannel {
  constructor(name) {
    if (new.target === BaseChannel) {
      throw new Error('BaseChannel is abstract and cannot be instantiated directly');
    }
    this.name = name;
  }

  /**
   * @param {{ to: string, subject: string, message: string, metadata: object }} payload
   * @returns {Promise<{ success: boolean, providerResponse?: any, error?: string }>}
   */
  async send(_payload) {
    throw new Error(`send() must be implemented by ${this.name} channel`);
  }
}
