import { describe, it, expect } from 'vitest';

import { OpenCodeProvider, isOpenCodeAvailable } from '../opencode.js';

describe('OpenCodeProvider', () => {
  describe('constructor', () => {
    it('should create instance with default config', () => {
      const provider = new OpenCodeProvider({ provider: 'opencode', model: 'default' });
      expect(provider).toBeDefined();
    });

    it('should create instance with custom model', () => {
      const provider = new OpenCodeProvider({ provider: 'opencode', model: 'anthropic/claude-sonnet-4-5' });
      expect(provider).toBeDefined();
    });

    it('should create instance with custom baseUrl', () => {
      const provider = new OpenCodeProvider({ provider: 'opencode', model: 'default', baseUrl: 'http://localhost:5000' });
      expect(provider).toBeDefined();
    });
  });

  describe('isOpenCodeAvailable', () => {
    it('should be a function', () => {
      expect(typeof isOpenCodeAvailable).toBe('function');
    });
  });
});