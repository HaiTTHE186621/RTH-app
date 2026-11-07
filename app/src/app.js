import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelpdeskClient } from "./helpdesk.js";
import { DataStore } from "./data-store.js";
import { validateDateRange, filterAndPaginateRequests, filterAndSortRequests, convertToCSV } from "./request-filter.js";

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

  // Serve static files from dist (built React app) or fallback to public
  const distPath = path.join(here, "..", "dist");
  const publicPath = path.join(here, "..", "public");

  app.use(express.static(distPath));
  app.use(express.static(publicPath));

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

  app.get("/api/requests.csv", (req, res) => {
    // CSV export: same filters as /api/requests, no pagination
    if (!dataStore.isReady) {
      return res.status(503).json({ error: "Service not ready" });
    }

    const { from, to, site_id, responder_id, late, within_target, sort } = req.query;

    // Validate required parameters
    if (!from || !to) {
      return res.status(400).json({ error: "Missing required parameters: from, to" });
    }

    if (!validateDateRange(from, to)) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    try {
      const results = filterAndSortRequests(dataStore, {
        from,
        to,
        site_id,
        responder_id,
        late,
        within_target,
        sort,
      });

      const csv = convertToCSV(results);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="sla-requests-${from}-to-${to}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error('[App] /api/requests.csv error:', error);
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

  // Serve React app for all other routes (SPA fallback)
  // Use a catch-all middleware instead of route pattern
  app.use((req, res) => {
    const indexPath = path.join(here, "..", "dist", "index.html");
    res.sendFile(indexPath, (err) => {
      if (err) {
        // Fallback to public/index.html if dist doesn't exist (dev mode)
        res.sendFile(path.join(here, "..", "public", "index.html"));
      }
    });
  });

  return app;
}
