// Enhanced helpdesk API client with rate limiting and retry logic

/**
 * @typedef {Object} PaginatedResponse
 * @property {any[]} data
 * @property {number} page
 * @property {number} per_page
 * @property {number} total_pages
 * @property {number} total
 */

/**
 * @typedef {Object} EventsPaginatedResponse
 * @property {any[]} data
 * @property {number} page
 * @property {number} per_page
 * @property {boolean} has_more
 */

/**
 * @typedef {Object} ChangeFeedResponse
 * @property {any[]} data
 * @property {string} next_cursor
 * @property {boolean} has_more
 */

export class HelpdeskClient {
  constructor({
    baseUrl = process.env.HELPDESK_URL || "http://localhost:4010",
    token = process.env.HELPDESK_TOKEN || "",
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.requestQueue = [];
    this.isProcessing = false;
    this.minDelay = 50; // Minimum delay between requests (ms)
  }

  // GET a path with optional query params; returns parsed JSON with retry logic
  async get(pathname, params = {}, retries = 3) {
    const url = new URL(this.baseUrl + pathname);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
          },
        });

        // Handle rate limiting
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
          if (attempt < retries) {
            await this.sleep(retryAfter * 1000);
            continue;
          }
        }

        // Handle cursor expiration
        if (res.status === 410) {
          const body = await res.text();
          throw new Error(`Cursor expired: ${body}`);
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Helpdesk API GET ${pathname} failed: ${res.status} ${body}`);
        }

        return res.json();
      } catch (error) {
        if (attempt === retries) throw error;
        // Exponential backoff
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Fetch all pages from a paginated endpoint
  async fetchAllPages(pathname, params = {}, maxPages = Infinity) {
    const allData = [];
    let page = 1;

    while (page <= maxPages) {
      const response = await this.get(pathname, { ...params, page, per_page: 100 });
      allData.push(...response.data);

      if (page >= response.total_pages) break;
      page++;

      // Small delay to avoid rate limiting
      await this.sleep(this.minDelay);
    }

    return allData;
  }

  // Fetch all events for a request
  async fetchAllEvents(requestId) {
    const allEvents = [];
    let page = 1;

    while (true) {
      const response = await this.get(`/v1/requests/${requestId}/events`, { page, per_page: 50 });
      allEvents.push(...response.data);

      if (!response.has_more) break;
      page++;

      await this.sleep(this.minDelay);
    }

    return allEvents;
  }

  // API Endpoints
  async getRequests(params = {}) {
    return this.get("/v1/requests", params);
  }

  async getRequest(id) {
    return this.get(`/v1/requests/${id}`);
  }

  async getRequestEvents(id, page = 1) {
    return this.get(`/v1/requests/${id}/events`, { page });
  }

  async getSites() {
    return this.get("/v1/sites");
  }

  async getSiteHolidays(siteId) {
    return this.get(`/v1/sites/${siteId}/holidays`);
  }

  async getStaff() {
    return this.get("/v1/staff");
  }

  async getStatuses() {
    return this.get("/v1/statuses");
  }

  async getChanges(cursor = null, limit = 500) {
    const params = { limit };
    if (cursor) params.cursor = cursor;
    return this.get("/v1/changes", params);
  }
}
