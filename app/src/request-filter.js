// Request filtering, sorting, and cursor-based pagination for /api/requests

import crypto from 'node:crypto';

/**
 * Filter and paginate requests
 * @param {DataStore} dataStore
 * @param {Object} params - Query parameters
 * @returns {Object} { data: SLAResult[], next_cursor: string|null }
 */
export function filterAndPaginateRequests(dataStore, params) {
  const {
    from,
    to,
    site_id,
    responder_id,
    late,
    within_target,
    sort = 'id',
    limit = 50,
    cursor,
  } = params;

  // Validate limit
  const limitNum = parseInt(limit, 10);
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
    throw new Error('Invalid limit: must be between 1 and 200');
  }

  // Parse cursor if provided
  let cursorData = null;
  if (cursor) {
    cursorData = parseCursor(cursor);
    if (!cursorData) {
      throw new Error('Invalid cursor');
    }
  }

  // Get base report data
  const report = dataStore.getSLAReport(from, to);
  let results = report.requests;

  // Apply filters
  if (site_id) {
    const siteIdNum = parseInt(site_id, 10);
    results = results.filter(r => r.site_id === siteIdNum);
  }

  if (responder_id) {
    const responderIdNum = parseInt(responder_id, 10);
    results = results.filter(r => r.responder_id === responderIdNum);
  }

  if (late !== undefined) {
    const lateValue = late === 'true';
    results = results.filter(r => r.completed_late === lateValue);
  }

  if (within_target !== undefined) {
    const withinTargetValue = within_target === 'true';
    results = results.filter(r => r.within_target === withinTargetValue);
  }

  // Sort results
  results = sortResults(results, sort);

  // Apply cursor pagination
  let startIndex = 0;
  if (cursorData && cursorData.lastId) {
    // Find the position after lastId
    const lastIdIndex = results.findIndex(r => r.id === cursorData.lastId);
    if (lastIdIndex >= 0) {
      startIndex = lastIdIndex + 1;
    }
  }

  // Get page of results
  const page = results.slice(startIndex, startIndex + limitNum);

  // Generate next cursor
  let next_cursor = null;
  if (startIndex + limitNum < results.length) {
    const lastItem = page[page.length - 1];
    next_cursor = createCursor({
      from,
      to,
      site_id,
      responder_id,
      late,
      within_target,
      sort,
      lastId: lastItem.id,
    });
  }

  return {
    data: page,
    next_cursor,
  };
}

/**
 * Sort results according to sort parameter
 * @param {Array} results
 * @param {string} sort - 'id', '-id', 'response_business_minutes', '-response_business_minutes'
 * @returns {Array}
 */
function sortResults(results, sort) {
  const sorted = [...results];

  switch (sort) {
    case 'id':
      sorted.sort((a, b) => a.id - b.id);
      break;

    case '-id':
      sorted.sort((a, b) => b.id - a.id);
      break;

    case 'response_business_minutes':
      sorted.sort((a, b) => {
        // Nulls last
        if (a.response_business_minutes === null && b.response_business_minutes === null) {
          return a.id - b.id; // Tie breaker
        }
        if (a.response_business_minutes === null) return 1;
        if (b.response_business_minutes === null) return -1;

        if (a.response_business_minutes === b.response_business_minutes) {
          return a.id - b.id; // Tie breaker
        }
        return a.response_business_minutes - b.response_business_minutes;
      });
      break;

    case '-response_business_minutes':
      sorted.sort((a, b) => {
        // Nulls last
        if (a.response_business_minutes === null && b.response_business_minutes === null) {
          return a.id - b.id; // Tie breaker
        }
        if (a.response_business_minutes === null) return 1;
        if (b.response_business_minutes === null) return -1;

        if (a.response_business_minutes === b.response_business_minutes) {
          return a.id - b.id; // Tie breaker
        }
        return b.response_business_minutes - a.response_business_minutes;
      });
      break;

    default:
      // Unknown sort - use id ascending
      sorted.sort((a, b) => a.id - b.id);
  }

  return sorted;
}

/**
 * Create an opaque cursor
 * @param {Object} data
 * @returns {string}
 */
function createCursor(data) {
  const json = JSON.stringify(data);
  return Buffer.from(json).toString('base64url');
}

/**
 * Parse and validate cursor
 * @param {string} cursor
 * @returns {Object|null}
 */
function parseCursor(cursor) {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

/**
 * Validate date format YYYY-MM-DD
 * @param {string} date
 * @returns {boolean}
 */
export function isValidDate(date) {
  if (!date) return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(date)) return false;

  const d = new Date(date);
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Validate date range parameters
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function validateDateRange(from, to) {
  if (!isValidDate(from) || !isValidDate(to)) {
    return false;
  }

  return from <= to;
}
