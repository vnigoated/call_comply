import { useState } from 'react'

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')

export default function QAWidget({ apiKey }) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(3)
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [sources, setSources] = useState([])
  const [error, setError] = useState(null)

  const quickPrompts = [
    'Did the agent explain payment options?',
    'What was the customer sentiment?',
    'Which transcript mentions EMI?',
  ]

  async function runQA(e) {
    e?.preventDefault()
    setError(null)
    setAnswer(null)
    setSources([])
    if (!query.trim()) {
      setError('Enter a short question to query the transcript index')
      return
    }
    setLoading(true)
    try {
      const body = { query: query.trim(), limit }
      const r = await fetch(`${API_BASE_URL}/api/qa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey || '',
        },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail || j?.message || 'QA failed')
      setAnswer(j.answer || 'No answer returned')
      setSources(j.sources || [])
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="panel qa-panel">
      <div className="card-topline">
        <span>Semantic QA</span>
        <strong>Ask indexed calls</strong>
      </div>
      <h3>QA assistant</h3>
      <p className="qa-helper-text">
        Ask natural-language questions about indexed calls and get source-grounded answers.
      </p>
      <div className="qa-chip-row">
        {quickPrompts.map((prompt) => (
          <button key={prompt} type="button" className="qa-chip" onClick={() => setQuery(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <form onSubmit={runQA} className="qa-form">
        <input
          placeholder="e.g. Did the agent offer EMI options?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="qa-input"
        />
        <div className="qa-controls">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={1}>Top 1</option>
            <option value={3}>Top 3</option>
            <option value={5}>Top 5</option>
          </select>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Running...' : 'Ask'}
          </button>
        </div>
      </form>

      {error && <div className="notice-banner notice-error"><span>{error}</span></div>}

      {answer && (
        <div className="qa-result">
          <h4>Assistant answer</h4>
          <p className="qa-answer-bubble">{answer}</p>
          {sources.length === 0 ? (
            <p className="muted-text">No sources returned.</p>
          ) : (
            <details className="qa-sources" open>
              <summary>{`Sources (${sources.length})`}</summary>
              <ul>
                {sources.map((s) => (
                  <li key={s.transcript_id}>
                    <strong>[ID:{s.transcript_id}]</strong> {s.summary} — <em>{s.snippet}</em>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
