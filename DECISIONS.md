# DECISIONS

Write in English. Short bullet points are fine. Reviewers read this file alongside your code.

## What I assumed

- **In-memory storage**: 6 months of data fits comfortably in memory; faster than a database for this use case
- **Change feed polling**: More efficient than re-fetching all data; 5-second idle delay balances freshness vs. API load
- **Business hours calculation**: Second-by-second iteration through time range, then floor to minutes (handles DST and arbitrary business hours)
- **Staff names**: Always fetch current name from `/v1/staff`, never use `actor_name` from events (as per rules)
- **Cursor format**: Base64url-encoded JSON with filter params and lastId for consistent pagination
- **Rate limiting**: 50ms minimum delay between requests, exponential backoff on errors, respects `429 Retry-After`
- **CSV export**: Returns all matching rows in memory (no streaming); sufficient for typical dataset sizes

## What I found in the API or data

- **Event reverts**: Both the reverting event AND the reverted event must be excluded (rule 2)
- **Latest deadline**: Must check ALL events for `due_at`, not just completion events (rule 6)
- **Timezone handling**: `Intl.DateTimeFormat` with site timezone works reliably for local date conversion
- **Cursor expiration**: API returns `410` when cursor expires; handled by restarting from beginning
- **Change feed**: Processes deltas efficiently; duplicate events are safe to process multiple times
- **Null priority**: Treated same as `Low` priority (480-minute target) per rule 5

## How I used AI

- Claude Code implemented the entire project from specifications
- Generated SLA calculation logic following all 7 rules from `docs/rules.md`
- Created business hours calculator with timezone and holiday support
- Built change feed sync mechanism with cursor handling and error recovery
- Implemented cursor-based pagination with nulls-last sorting
- Added CSV export feature with proper RFC 4180 escaping
- Generated React frontend with two-tab interface and real-time status
- All code reviewed and adjusted for edge cases (DST, null handling, tie-breaking)

## Trade-offs and what I would do next

### Current implementation strengths:
- Fast O(1) lookups with in-memory Maps indexed by date/site/responder
- Simple architecture: single Node.js process, no database
- Survives restarts via change feed resync
- Under 8-minute startup, <5s October reports

### Known limitations:
- **Memory bound**: Larger datasets (years of data) would need streaming or database
- **Single process**: No horizontal scaling; one container handles all requests
- **CSV streaming**: Large exports held fully in memory before sending
- **No persistent state**: Restart loses cache, requires 8-minute resync

### With more time would add:
- PostgreSQL for larger datasets with proper indexing
- Redis for distributed caching across multiple containers
- Stream CSV exports for memory efficiency
- WebSocket for real-time frontend updates (no 5s polling)
- Horizontal scaling with shared cache layer
- Prometheus metrics for monitoring API usage and performance
- More comprehensive test coverage (integration tests, CSV edge cases)
- Excel (.xlsx) export format alongside CSV
- Request detail drill-down view in frontend
