// Request filtering, sorting, and cursor-based pagination for /api/requests

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

/**
 * Get all filtered and sorted requests (no pagination)
 * @param {DataStore} dataStore
 * @param {Object} params - Query parameters
 * @returns {Array} SLAResult[]
 */
export function filterAndSortRequests(dataStore, params) {
  const {
    from,
    to,
    site_id,
    responder_id,
    late,
    within_target,
    sort = 'id',
  } = params;

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

  return results;
}

/**
 * Convert results to CSV format
 * @param {Array} results - SLAResult[]
 * @returns {string} CSV content
 */
export function convertToCSV(results) {
  // CSV header
  const header = 'id,site_id,responder_id,responder,response_business_minutes,within_target,completed_late';

  // Convert each row
  const rows = results.map(row => {
    const fields = [
      row.id,
      row.site_id,
      row.responder_id,
      escapeCSVField(row.responder),
      row.response_business_minutes === null ? '' : row.response_business_minutes,
      row.within_target === null ? '' : row.within_target,
      row.completed_late === null ? '' : row.completed_late,
    ];
    return fields.join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Escape CSV field (quote if contains comma or quote)
 * @param {string|null} field
 * @returns {string}
 */
function escapeCSVField(field) {
  if (field === null || field === undefined) {
    return '';
  }

  const str = String(field);

  // If field contains comma or quote, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}
