// Data store with in-memory caching and change feed synchronization

import { HelpdeskClient } from './helpdesk.js';
import { calculateRequestSLA, shouldIncludeRequest, aggregateResponders } from './sla-calculator.js';
import { parseDDMMYYYY } from './business-hours.js';

export class DataStore {
  constructor(helpdeskClient) {
    this.client = helpdeskClient;

    // Core data maps
    this.sites = new Map(); // id -> site object
    this.holidays = new Map(); // site_id -> Set of YYYY-MM-DD dates
    this.staff = new Map(); // id -> name
    this.requests = new Map(); // id -> request object
    this.events = new Map(); // request_id -> array of events

    // SLA calculation cache
    this.slaCache = new Map(); // request_id -> SLAResult

    // Change feed cursor
    this.changeCursor = null;

    // Sync state
    this.isReady = false;
    this.isSyncing = false;
    this.syncStartTime = null;

    // Indexes for fast queries
    this.requestsByDate = new Map(); // YYYY-MM-DD -> Set of request IDs
    this.requestsBySite = new Map(); // site_id -> Set of request IDs
    this.requestsByResponder = new Map(); // responder_id -> Set of request IDs
  }

  /**
   * Initialize data store - fetch all data for last 6 months
   * Uses two-phase loading: quick load first, then backfill
   */
  async initialize() {
    if (this.isSyncing) return;

    this.isSyncing = true;
    this.syncStartTime = Date.now();

    console.log('[DataStore] Starting initial sync...');

    try {
      // Step 1: Fetch static data (sites, holidays, staff)
      await this.fetchStaticData();
      console.log(`[DataStore] Loaded ${this.sites.size} sites, ${this.staff.size} staff`);

      // PHASE 1: Quick load - get last 6 months of requests metadata
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const fromDate = this.formatDate(sixMonthsAgo);
      const toDate = this.formatDate(new Date());

      await this.fetchRequestsInRange(fromDate, toDate);
      console.log(`[DataStore] Loaded ${this.requests.size} requests`);

      // PHASE 2: Load events using change feed (more efficient!)
      // The change feed includes request + event data together
      console.log('[DataStore] Loading data via change feed...');
      await this.initialChangeFeedLoad();

      // Step 3: Pre-calculate SLA for all requests
      this.calculateAllSLA();
      console.log(`[DataStore] Calculated SLA for ${this.slaCache.size} requests`);

      // Step 4: Build indexes
      this.buildIndexes();
      console.log('[DataStore] Built indexes');

      this.isReady = true;
      const elapsed = ((Date.now() - this.syncStartTime) / 1000).toFixed(1);
      console.log(`[DataStore] Initial sync complete in ${elapsed}s`);

      // Step 5: Start change feed polling for updates
      this.startChangeFeedPolling();

      // Step 6: Backfill any missing events in background
      this.backfillMissingEvents();
    } catch (error) {
      console.error('[DataStore] Initial sync failed:', error);
      this.isReady = false;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Load initial data via change feed (more efficient than individual event fetches)
   */
  async initialChangeFeedLoad() {
    let cursor = null;
    let totalChanges = 0;
    let hasMore = true;

    // Load change feed from the beginning
    while (hasMore && totalChanges < 100000) { // Safety limit - need more for full event coverage
      try {
        const response = await this.client.getChanges(cursor, 500);

        // Process changes to build event cache
        for (const change of response.data) {
          if (change.type === 'event.created' && change.request_id) {
            if (!this.events.has(change.request_id)) {
              this.events.set(change.request_id, []);
            }
            this.events.get(change.request_id).push(change.event);
          }
        }

        totalChanges += response.data.length;
        cursor = response.next_cursor;
        hasMore = response.has_more;

        if (totalChanges % 5000 === 0) {
          console.log(`[DataStore] Processed ${totalChanges} changes, ${this.events.size} requests have events`);
        }

        // Small delay to avoid rate limiting
        if (hasMore) {
          await this.sleep(50);
        }
      } catch (error) {
        if (error.message.includes('Cursor expired')) {
          console.log('[DataStore] Cursor expired during initial load, will backfill missing events');
          break;
        }
        throw error;
      }
    }

    console.log(`[DataStore] Loaded events for ${this.events.size}/${this.requests.size} requests via change feed`);
    this.changeCursor = cursor;
  }

  /**
   * Backfill events for requests that don't have them yet (runs in background)
   */
  async backfillMissingEvents() {
    const requestsWithoutEvents = Array.from(this.requests.keys()).filter(
      id => !this.events.has(id)
    );

    if (requestsWithoutEvents.length === 0) {
      console.log('[DataStore] No backfill needed');
      return;
    }

    console.log(`[DataStore] Backfilling events for ${requestsWithoutEvents.length} requests in background...`);

    const batchSize = 20;
    for (let i = 0; i < requestsWithoutEvents.length; i += batchSize) {
      const batch = requestsWithoutEvents.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async requestId => {
          try {
            const events = await this.client.fetchAllEvents(requestId);
            this.events.set(requestId, events);
            this.recalculateSLA(requestId);
          } catch (error) {
            console.error(`[DataStore] Backfill failed for request ${requestId}:`, error.message);
          }
        })
      );

      if ((i + batchSize) % 200 === 0) {
        console.log(`[DataStore] Backfill progress: ${i + batch.length}/${requestsWithoutEvents.length}`);
      }

      await this.sleep(50);
    }

    this.buildIndexes();
    console.log('[DataStore] Backfill complete');
  }

  /**
   * Fetch sites, holidays, and staff
   */
  async fetchStaticData() {
    // Fetch sites
    const sitesResponse = await this.client.getSites();
    sitesResponse.data.forEach(site => {
      this.sites.set(site.id, site);
    });

    // Fetch holidays for each site
    for (const site of this.sites.values()) {
      const holidaysResponse = await this.client.getSiteHolidays(site.id);
      const holidaySet = new Set(
        holidaysResponse.data.map(h => parseDDMMYYYY(h.date))
      );
      this.holidays.set(site.id, holidaySet);
    }

    // Fetch staff
    const staffResponse = await this.client.getStaff();
    staffResponse.data.forEach(staff => {
      this.staff.set(staff.id, staff.name);
    });
  }

  /**
   * Fetch all requests in date range
   */
  async fetchRequestsInRange(from, to) {
    const fromFormatted = this.formatDateForAPI(from);
    const toFormatted = this.formatDateForAPI(to);

    const requests = await this.client.fetchAllPages('/v1/requests', {
      created_from: fromFormatted,
      created_to: toFormatted,
      per_page: 100,
    });

    requests.forEach(request => {
      this.requests.set(request.id, request);
    });
  }

  /**
   * Fetch events for all requests in batches
   */
  async fetchAllEvents() {
    const requestIds = Array.from(this.requests.keys());
    const batchSize = 20; // Fetch events for 20 requests at a time
    const totalBatches = Math.ceil(requestIds.length / batchSize);

    console.log(`[DataStore] Fetching events for ${requestIds.length} requests in ${totalBatches} batches...`);

    for (let i = 0; i < requestIds.length; i += batchSize) {
      const batch = requestIds.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      await Promise.all(
        batch.map(async requestId => {
          try {
            const events = await this.client.fetchAllEvents(requestId);
            this.events.set(requestId, events);
          } catch (error) {
            console.error(`[DataStore] Failed to fetch events for request ${requestId}:`, error.message);
            this.events.set(requestId, []); // Set empty array to avoid refetching
          }
        })
      );

      // Log progress every 10 batches
      if (batchNum % 10 === 0 || i + batchSize >= requestIds.length) {
        const progress = Math.min(100, ((i + batchSize) / requestIds.length * 100).toFixed(1));
        console.log(`[DataStore] Progress: ${progress}% (${i + batch.length}/${requestIds.length} requests)`);
      }

      // Small delay between batches
      if (i + batchSize < requestIds.length) {
        await this.sleep(50);
      }
    }
  }

  /**
   * Calculate SLA for all requests (async to avoid blocking)
   */
  async calculateAllSLA() {
    const requestIds = Array.from(this.requests.keys());
    let processed = 0;

    console.log(`[DataStore] Calculating SLA for ${requestIds.length} requests...`);

    for (const requestId of requestIds) {
      const request = this.requests.get(requestId);
      const events = this.events.get(requestId) || [];
      const site = this.sites.get(request.site_id);
      const holidays = this.holidays.get(request.site_id) || new Set();

      if (site) {
        const sla = calculateRequestSLA(request, events, site, holidays, this.staff);
        this.slaCache.set(requestId, sla);
      }

      processed++;

      // Yield to event loop every 100 requests
      if (processed % 100 === 0) {
        await new Promise(resolve => setImmediate(resolve));

        if (processed % 1000 === 0) {
          console.log(`[DataStore] SLA calculation progress: ${processed}/${requestIds.length}`);
        }
      }
    }

    console.log(`[DataStore] SLA calculation complete: ${this.slaCache.size} requests`);
  }

  /**
   * Build indexes for fast queries
   */
  buildIndexes() {
    this.requestsByDate.clear();
    this.requestsBySite.clear();
    this.requestsByResponder.clear();

    for (const [requestId, request] of this.requests.entries()) {
      const site = this.sites.get(request.site_id);
      if (!site) continue;

      // Index by date (in site's local timezone)
      const localDate = this.getLocalDate(request.created_at, site.timezone);
      if (!this.requestsByDate.has(localDate)) {
        this.requestsByDate.set(localDate, new Set());
      }
      this.requestsByDate.get(localDate).add(requestId);

      // Index by site
      if (!this.requestsBySite.has(request.site_id)) {
        this.requestsBySite.set(request.site_id, new Set());
      }
      this.requestsBySite.get(request.site_id).add(requestId);

      // Index by responder
      const sla = this.slaCache.get(requestId);
      if (sla && sla.responder_id) {
        if (!this.requestsByResponder.has(sla.responder_id)) {
          this.requestsByResponder.set(sla.responder_id, new Set());
        }
        this.requestsByResponder.get(sla.responder_id).add(requestId);
      }
    }
  }

  /**
   * Get SLA report for date range
   */
  getSLAReport(from, to) {
    const results = [];

    for (const [requestId, request] of this.requests.entries()) {
      const site = this.sites.get(request.site_id);
      if (!site) continue;

      // Check if request should be included (Rule 1)
      if (!shouldIncludeRequest(request, from, to, site.timezone)) {
        continue;
      }

      // Get cached SLA result
      const sla = this.slaCache.get(requestId);
      if (sla) {
        results.push(sla);
      }
    }

    // Aggregate responder statistics
    const responders = aggregateResponders(results);

    return {
      from,
      to,
      requests: results,
      responders,
    };
  }

  /**
   * Start polling the change feed
   */
  startChangeFeedPolling() {
    console.log('[DataStore] Starting change feed polling...');
    this.pollChangeFeed();
  }

  /**
   * Poll change feed for updates
   */
  async pollChangeFeed() {
    try {
      const response = await this.client.getChanges(this.changeCursor, 500);

      // Process changes
      for (const change of response.data) {
        await this.processChange(change);
      }

      // Update cursor
      this.changeCursor = response.next_cursor;

      // Schedule next poll
      const delay = response.has_more ? 100 : 5000; // Poll faster if more data available
      setTimeout(() => this.pollChangeFeed(), delay);
    } catch (error) {
      if (error.message.includes('Cursor expired')) {
        console.log('[DataStore] Cursor expired, restarting from beginning');
        this.changeCursor = null;
      } else {
        console.error('[DataStore] Change feed polling error:', error);
      }

      // Retry after delay
      setTimeout(() => this.pollChangeFeed(), 10000);
    }
  }

  /**
   * Process a single change from the change feed
   */
  async processChange(change) {
    switch (change.type) {
      case 'request.created':
      case 'request.updated':
        await this.updateRequest(change.request);
        break;

      case 'event.created':
        await this.updateRequestEvents(change.request_id);
        break;

      case 'staff.updated':
        this.staff.set(change.staff.id, change.staff.name);
        // Invalidate SLA cache for requests with this staff member
        this.invalidateStaffSLA(change.staff.id);
        break;
    }
  }

  /**
   * Update a request and recalculate SLA
   */
  async updateRequest(request) {
    this.requests.set(request.id, request);

    // Refetch events if not already cached
    if (!this.events.has(request.id)) {
      const events = await this.client.fetchAllEvents(request.id);
      this.events.set(request.id, events);
    }

    // Recalculate SLA
    this.recalculateSLA(request.id);
    this.rebuildIndexesForRequest(request.id);
  }

  /**
   * Update events for a request
   */
  async updateRequestEvents(requestId) {
    const events = await this.client.fetchAllEvents(requestId);
    this.events.set(requestId, events);

    // Recalculate SLA
    this.recalculateSLA(requestId);
    this.rebuildIndexesForRequest(requestId);
  }

  /**
   * Recalculate SLA for a single request
   */
  recalculateSLA(requestId) {
    const request = this.requests.get(requestId);
    if (!request) return;

    const events = this.events.get(requestId) || [];
    const site = this.sites.get(request.site_id);
    const holidays = this.holidays.get(request.site_id) || new Set();

    if (site) {
      const sla = calculateRequestSLA(request, events, site, holidays, this.staff);
      this.slaCache.set(requestId, sla);
    }
  }

  /**
   * Invalidate SLA cache for requests with a specific staff member
   */
  invalidateStaffSLA(staffId) {
    for (const [requestId, sla] of this.slaCache.entries()) {
      if (sla.responder_id === staffId) {
        this.recalculateSLA(requestId);
      }
    }
  }

  /**
   * Rebuild indexes for a specific request
   */
  rebuildIndexesForRequest(requestId) {
    // This is simplified - in production, we'd update indexes incrementally
    this.buildIndexes();
  }

  // Helper methods

  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateForAPI(yyyymmdd) {
    const [year, month, day] = yyyymmdd.split('-');
    return `${day}/${month}/${year}`;
  }

  getLocalDate(isoTimestamp, timezone) {
    const date = new Date(isoTimestamp);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
