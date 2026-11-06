import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelpdeskClient } from "./helpdesk.js";
import { DataStore } from "./data-store.js";
import { validateDateRange } from "./request-filter.js";
import { filterAndPaginateRequests } from "./request-filter.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Initialize data store
  const client = new HelpdeskClient();
  const dataStore = new DataStore(client);

  // Start initialization in the background
  dataStore.initialize().catch(err => {
    console.error('[App] Failed to initialize data store:', err);
  });

  app.use(express.static(path.join(here, "..", "public")));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/ready", (req, res) => {
    if (dataStore.isReady) {
      res.json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  });

  app.get("/api/requests", (req, res) => {
    // Level 4: Filtered, sorted, paginated requests
    if (!dataStore.isReady) {
      return res.status(503).json({ error: "Service not ready" });
    }

    const { from, to, site_id, responder_id, late, within_target, sort, limit, cursor } = req.query;

    // Validate required parameters
    if (!from || !to) {
      return res.status(400).json({ error: "Missing required parameters: from, to" });
    }

    if (!validateDateRange(from, to)) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    try {
      const result = filterAndPaginateRequests(dataStore, {
        from,
        to,
        site_id,
        responder_id,
        late,
        within_target,
        sort,
        limit,
        cursor,
      });

      res.json(result);
    } catch (error) {
      console.error('[App] /api/requests error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/sla-report", (req, res) => {
    // Level 1: SLA Report
    if (!dataStore.isReady) {
      return res.status(503).json({ error: "Service not ready" });
    }

    const { from, to } = req.query;

    // Validate parameters
    if (!from || !to) {
      return res.status(400).json({ error: "Missing required parameters: from, to" });
    }

    if (!validateDateRange(from, to)) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    try {
      const report = dataStore.getSLAReport(from, to);
      res.json(report);
    } catch (error) {
      console.error('[App] /api/sla-report error:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}
