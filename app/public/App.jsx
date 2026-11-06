import React, { useState, useEffect } from 'react';
import './App.css';

const App = () => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState('report');

  // Browse API state
  const [filters, setFilters] = useState({
    site_id: '',
    responder_id: '',
    late: '',
    within_target: '',
    sort: 'id',
    limit: 50,
  });
  const [browseData, setBrowseData] = useState(null);
  const [allBrowseData, setAllBrowseData] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [cursorHistory, setCursorHistory] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    checkReadyStatus();
    const interval = setInterval(checkReadyStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkReadyStatus = async () => {
    try {
      const res = await fetch('/ready');
      const data = await res.json();
      setReady(data.ready);
    } catch (err) {
      setReady(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await fetch(`/api/sla-report?${params}`);

      if (!res.ok) {
        throw new Error(`Error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      setReportData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseSubmit = async (e) => {
    e.preventDefault();
    // Reset pagination state on new search
    setAllBrowseData([]);
    setCursorHistory([]);
    setCurrentPage(1);
    await fetchBrowseData(null, true);
  };

  const fetchBrowseData = async (nextCursor = null, isNewSearch = false) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
        ...Object.entries(filters).reduce((acc, [key, value]) => {
          if (value !== '') acc[key] = value;
          return acc;
        }, {}),
      });

      if (nextCursor) {
        params.set('cursor', nextCursor);
      }

      const res = await fetch(`/api/requests?${params}`);

      if (!res.ok) {
        throw new Error(`Error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      setBrowseData(data);
      setCursor(data.next_cursor);

      // Accumulate all loaded data
      if (isNewSearch) {
        setAllBrowseData(data.data);
      } else {
        setAllBrowseData(prev => [...prev, ...data.data]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNextPage = () => {
    if (cursor) {
      setCursorHistory(prev => [...prev, cursor]);
      setCurrentPage(prev => prev + 1);
      fetchBrowseData(cursor, false);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      // Remove last items from accumulated data
      const itemsToRemove = browseData.data.length;
      setAllBrowseData(prev => prev.slice(0, -itemsToRemove));

      // Go back to previous cursor
      const newHistory = [...cursorHistory];
      newHistory.pop();
      setCursorHistory(newHistory);
      setCurrentPage(prev => prev - 1);

      // Fetch previous page data
      const prevCursor = newHistory[newHistory.length - 1] || null;
      fetchBrowseData(prevCursor, false);
    }
  };

  const handleFirstPage = () => {
    setAllBrowseData([]);
    setCursorHistory([]);
    setCurrentPage(1);
    fetchBrowseData(null, true);
  };

  const renderStatus = () => {
    if (!ready) {
      return (
        <div className="status-banner warning">
          System is initializing... Report data will be available soon.
        </div>
      );
    }
    return (
      <div className="status-banner success">
        System ready
      </div>
    );
  };

  const renderRequestsTable = (requests) => {
    if (!requests || requests.length === 0) {
      return <p className="no-data">No requests found for this date range.</p>;
    }

    return (
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Site ID</th>
              <th>Responder</th>
              <th>Response Time (min)</th>
              <th>Within Target</th>
              <th>Completed Late</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <tr key={req.id}>
                <td>{req.id}</td>
                <td>{req.site_id}</td>
                <td>{req.responder || <em>No responder</em>}</td>
                <td className={req.response_business_minutes === null ? 'null-value' : ''}>
                  {req.response_business_minutes !== null ? req.response_business_minutes : '—'}
                </td>
                <td>
                  {req.within_target === null ? (
                    <span className="badge null">—</span>
                  ) : req.within_target ? (
                    <span className="badge success">Yes</span>
                  ) : (
                    <span className="badge error">No</span>
                  )}
                </td>
                <td>
                  {req.completed_late === null ? (
                    <span className="badge null">—</span>
                  ) : req.completed_late ? (
                    <span className="badge error">Yes</span>
                  ) : (
                    <span className="badge success">No</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderRespondersTable = (responders) => {
    if (!responders || responders.length === 0) {
      return null;
    }

    return (
      <div className="table-container">
        <h3>Responder Summary</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Responder</th>
              <th>Total Requests</th>
              <th>Within Target</th>
              <th>Completed Late</th>
              <th>Success Rate</th>
            </tr>
          </thead>
          <tbody>
            {responders.map((resp) => {
              const successRate = resp.requests > 0
                ? ((resp.within_target / resp.requests) * 100).toFixed(1)
                : 0;

              return (
                <tr key={resp.id}>
                  <td><strong>{resp.name}</strong></td>
                  <td>{resp.requests}</td>
                  <td className="success-cell">{resp.within_target}</td>
                  <td className="error-cell">{resp.completed_late}</td>
                  <td>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${successRate}%` }}
                      ></div>
                      <span className="progress-text">{successRate}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderReportTab = () => (
    <div>
      <form onSubmit={handleSubmit} className="report-form">
        <div className="form-group">
          <label htmlFor="from">From Date:</label>
          <input
            type="date"
            id="from"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="to">To Date:</label>
          <input
            type="date"
            id="to"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={loading || !ready} className="btn btn-primary">
          {loading ? 'Loading...' : 'Generate Report'}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {reportData && (
        <div className="report-results">
          <div className="report-header">
            <h2>SLA Report</h2>
            <p className="date-range">
              {reportData.from} to {reportData.to}
            </p>
          </div>

          <div className="summary-cards">
            <div className="card">
              <div className="card-title">Total Requests</div>
              <div className="card-value">{reportData.requests.length}</div>
            </div>
            <div className="card">
              <div className="card-title">Total Responders</div>
              <div className="card-value">{reportData.responders.length}</div>
            </div>
            <div className="card">
              <div className="card-title">Within Target</div>
              <div className="card-value success-text">
                {reportData.requests.filter(r => r.within_target === true).length}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Completed Late</div>
              <div className="card-value error-text">
                {reportData.requests.filter(r => r.completed_late === true).length}
              </div>
            </div>
          </div>

          {renderRespondersTable(reportData.responders)}

        </div>
      )}
    </div>
  );

  const renderBrowseTab = () => (
    <div>
      <form onSubmit={handleBrowseSubmit} className="browse-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="browse-from">From Date:</label>
            <input
              type="date"
              id="browse-from"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="browse-to">To Date:</label>
            <input
              type="date"
              id="browse-to"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="site_id">Site ID:</label>
            <input
              type="number"
              id="site_id"
              value={filters.site_id}
              onChange={(e) => setFilters({ ...filters, site_id: e.target.value })}
              placeholder="All sites"
            />
          </div>

          <div className="form-group">
            <label htmlFor="responder_id">Responder ID:</label>
            <input
              type="number"
              id="responder_id"
              value={filters.responder_id}
              onChange={(e) => setFilters({ ...filters, responder_id: e.target.value })}
              placeholder="All responders"
            />
          </div>

          <div className="form-group">
            <label htmlFor="within_target">Within Target:</label>
            <select
              id="within_target"
              value={filters.within_target}
              onChange={(e) => setFilters({ ...filters, within_target: e.target.value })}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="late">Completed Late:</label>
            <select
              id="late"
              value={filters.late}
              onChange={(e) => setFilters({ ...filters, late: e.target.value })}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="sort">Sort By:</label>
            <select
              id="sort"
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
            >
              <option value="id">ID (ascending)</option>
              <option value="-id">ID (descending)</option>
              <option value="response_business_minutes">Response Time (ascending)</option>
              <option value="-response_business_minutes">Response Time (descending)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="limit">Results per page:</label>
            <input
              type="number"
              id="limit"
              value={filters.limit}
              onChange={(e) => setFilters({ ...filters, limit: e.target.value })}
              min="1"
              max="200"
            />
          </div>
        </div>

        <button type="submit" disabled={loading || !ready} className="btn btn-primary">
          {loading ? 'Loading...' : 'Browse Requests'}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {browseData && (
        <div className="browse-results">
          <div className="results-info">
            <p>Page {currentPage} • Showing {browseData.data.length} results this page • {allBrowseData.length} total loaded</p>
          </div>

          {renderRequestsTable(browseData.data)}

          <div className="pagination-controls">
            {currentPage > 1 && (
              <>
                <button
                  onClick={handleFirstPage}
                  disabled={loading}
                  className="btn btn-secondary"
                >
                  « First
                </button>
                <button
                  onClick={handlePrevPage}
                  disabled={loading}
                  className="btn btn-secondary"
                >
                  ‹ Previous
                </button>
              </>
            )}

            {cursor && (
              <button
                onClick={handleNextPage}
                disabled={loading}
                className="btn btn-secondary"
              >
                Next ›
              </button>
            )}

            {!cursor && browseData.data.length > 0 && (
              <span className="end-message">End of results</span>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>SLA Response-Time Report</h1>
        {renderStatus()}
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'report' ? 'active' : ''}`}
          onClick={() => setActiveTab('report')}
        >
          SLA Report
        </button>
        <button
          className={`tab ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          Browse Requests
        </button>
      </div>

      <div className="container">
        {activeTab === 'report' ? renderReportTab() : renderBrowseTab()}
      </div>
    </div>
  );
};

export default App;
