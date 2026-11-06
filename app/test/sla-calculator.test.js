// Tests for SLA calculation logic

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { shouldIncludeRequest, aggregateResponders } from '../src/sla-calculator.js';

describe('SLA Calculator', () => {
  describe('shouldIncludeRequest', () => {
    it('should include request in date range', () => {
      const request = {
        id: 1,
        status: 'complete',
        created_at: '2026-10-15T10:00:00Z',
        deleted_at: null,
        merged_into_id: null,
      };

      const result = shouldIncludeRequest(request, '2026-10-01', '2026-10-31', 'UTC');
      assert.strictEqual(result, true);
    });

    it('should exclude canceled request', () => {
      const request = {
        id: 1,
        status: 'canceled',
        created_at: '2026-10-15T10:00:00Z',
        deleted_at: null,
        merged_into_id: null,
      };

      const result = shouldIncludeRequest(request, '2026-10-01', '2026-10-31', 'UTC');
      assert.strictEqual(result, false);
    });

    it('should exclude deleted request', () => {
      const request = {
        id: 1,
        status: 'complete',
        created_at: '2026-10-15T10:00:00Z',
        deleted_at: '2026-10-16T10:00:00Z',
        merged_into_id: null,
      };

      const result = shouldIncludeRequest(request, '2026-10-01', '2026-10-31', 'UTC');
      assert.strictEqual(result, false);
    });

    it('should exclude merged request', () => {
      const request = {
        id: 1,
        status: 'complete',
        created_at: '2026-10-15T10:00:00Z',
        deleted_at: null,
        merged_into_id: 999,
      };

      const result = shouldIncludeRequest(request, '2026-10-01', '2026-10-31', 'UTC');
      assert.strictEqual(result, false);
    });

    it('should exclude request outside date range', () => {
      const request = {
        id: 1,
        status: 'complete',
        created_at: '2026-11-15T10:00:00Z',
        deleted_at: null,
        merged_into_id: null,
      };

      const result = shouldIncludeRequest(request, '2026-10-01', '2026-10-31', 'UTC');
      assert.strictEqual(result, false);
    });
  });

  describe('aggregateResponders', () => {
    it('should aggregate responder statistics', () => {
      const results = [
        {
          id: 1,
          responder_id: 100,
          responder: 'Alice',
          within_target: true,
          completed_late: false,
        },
        {
          id: 2,
          responder_id: 100,
          responder: 'Alice',
          within_target: false,
          completed_late: true,
        },
        {
          id: 3,
          responder_id: 100,
          responder: 'Alice',
          within_target: true,
          completed_late: false,
        },
        {
          id: 4,
          responder_id: 200,
          responder: 'Bob',
          within_target: true,
          completed_late: false,
        },
      ];

      const responders = aggregateResponders(results);

      assert.strictEqual(responders.length, 2);

      const alice = responders.find(r => r.id === 100);
      assert.strictEqual(alice.name, 'Alice');
      assert.strictEqual(alice.requests, 3);
      assert.strictEqual(alice.within_target, 2);
      assert.strictEqual(alice.completed_late, 1);

      const bob = responders.find(r => r.id === 200);
      assert.strictEqual(bob.name, 'Bob');
      assert.strictEqual(bob.requests, 1);
      assert.strictEqual(bob.within_target, 1);
      assert.strictEqual(bob.completed_late, 0);
    });

    it('should skip requests with no responder', () => {
      const results = [
        {
          id: 1,
          responder_id: null,
          responder: null,
          within_target: null,
          completed_late: null,
        },
        {
          id: 2,
          responder_id: 100,
          responder: 'Alice',
          within_target: true,
          completed_late: false,
        },
      ];

      const responders = aggregateResponders(results);

      assert.strictEqual(responders.length, 1);
      assert.strictEqual(responders[0].id, 100);
    });
  });
});
