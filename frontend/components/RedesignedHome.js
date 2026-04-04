import { useEffect, useMemo, useRef, useState } from 'react'
import QAWidget from './QAWidget'

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
).replace(/\/$/, '')
const FRONTEND_API_KEY = process.env.NEXT_PUBLIC_API_KEY || ''

const sopFields = [
  { key: 'greeting', label: 'Greeting' },
  { key: 'identification', label: 'Identification' },
  { key: 'problemStatement', label: 'Problem Statement' },
  { key: 'solutionOffering', label: 'Solution Offering' },
  { key: 'closing', label: 'Closing' },
]

const analyticsFields = [
  { key: 'paymentPreference', label: 'Payment preference' },
  { key: 'rejectionReason', label: 'Rejection reason' },
  { key: 'sentiment', label: 'Sentiment' },
]

const productSignals = [
  { label: 'Transcription', value: 'India-language ready', tone: 'blue' },
  { label: 'Compliance', value: 'Policy-aware', tone: 'green' },
  { label: 'Analytics', value: 'Enterprise-ready', tone: 'amber' },
]

const featureSpotlights = [
  {
    title: 'Multilingual Transcript Intelligence',
    text: 'Capture Tamil and Hindi calls with English-ready transcript output and original-language preservation.',
  },
  {
    title: 'Compliance-first Call Scoring',
    text: 'Instant SOP checks, adherence scoring, and explanation-first outputs for reviewer confidence.',
  },
  {
    title: 'Semantic QA and Retrieval',
    text: 'Ask natural-language questions over indexed calls and get source-linked answers for fast audits.',
  },
]

const landingStats = [
  { value: '2', label: 'Supported languages' },
  { value: '5', label: 'SOP checkpoints' },
  { value: '1', label: 'Unified review workflow' },
]

function sanitizeReportValue(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function downloadBlob(filename, content, mimeType) {
  if (typeof window === 'undefined') return
  const blob = new Blob([content], { type: mimeType })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrapReportLine(text, maxLength = 95) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  if (!words.length) return ['']

  const lines = []
  let current = words[0]
  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`
    if (candidate.length <= maxLength) {
      current = candidate
    } else {
      lines.push(current)
      current = words[index]
    }
  }
  lines.push(current)
  return lines
}

function buildReportLines(responseObj, language) {
  const lines = [
    'CallComply Report',
    '',
    `Language: ${sanitizeReportValue(responseObj.language || language)}`,
    `Compliance score: ${typeof responseObj?.sop_validation?.complianceScore === 'number'
      ? `${Math.round(responseObj.sop_validation.complianceScore * 100)}%`
      : 'Unavailable'}`,
    `Adherence status: ${sanitizeReportValue(responseObj?.sop_validation?.adherenceStatus || 'Unavailable')}`,
    '',
    'Conversation summary',
    ...wrapReportLine(responseObj.summary || 'Summary unavailable.'),
    '',
    'Analytics',
    `Payment preference: ${sanitizeReportValue(responseObj?.analytics?.paymentPreference || 'Unavailable')}`,
    `Rejection reason: ${sanitizeReportValue(responseObj?.analytics?.rejectionReason || 'Unavailable')}`,
    `Sentiment: ${sanitizeReportValue(responseObj?.analytics?.sentiment || 'Unavailable')}`,
    '',
    'SOP validation',
    `Greeting: ${responseObj?.sop_validation?.greeting ? 'Pass' : 'Miss'}`,
    `Identification: ${responseObj?.sop_validation?.identification ? 'Pass' : 'Miss'}`,
    `Problem statement: ${responseObj?.sop_validation?.problemStatement ? 'Pass' : 'Miss'}`,
    `Solution offering: ${responseObj?.sop_validation?.solutionOffering ? 'Pass' : 'Miss'}`,
    `Closing: ${responseObj?.sop_validation?.closing ? 'Pass' : 'Miss'}`,
    '',
    `Keywords: ${sanitizeReportValue(responseObj?.keywords || []) || 'Unavailable'}`,
    '',
  ]

  if (responseObj?.speaker_stats) {
    lines.push('Speaker stats')
    lines.push(`Turns: ${sanitizeReportValue(responseObj.speaker_stats.turnCount || 'Unknown')}`)
    lines.push(
      `Agent share: ${
        typeof responseObj.speaker_stats.agentShare === 'number'
          ? `${Math.round(responseObj.speaker_stats.agentShare * 100)}%`
          : 'Unknown'
      }`
    )
    lines.push(
      `Customer share: ${
        typeof responseObj.speaker_stats.customerShare === 'number'
          ? `${Math.round(responseObj.speaker_stats.customerShare * 100)}%`
          : 'Unknown'
      }`
    )
    lines.push(`Dominant speaker: ${sanitizeReportValue(responseObj.speaker_stats.dominantSpeaker || 'Unknown')}`)
    lines.push('')
  }

  lines.push('Evaluator-friendly transcript')
  String(responseObj.transcript || 'No transcript returned.')
    .split('\n')
    .forEach((line) => {
      const wrapped = wrapReportLine(line, 92)
      wrapped.forEach((wrappedLine) => lines.push(wrappedLine))
    })

  if (responseObj?.original_transcript) {
    lines.push('')
    lines.push(`Original ${language} transcript`)
    String(responseObj.original_transcript)
      .split('\n')
      .forEach((line) => {
        const wrapped = wrapReportLine(line, 92)
        wrapped.forEach((wrappedLine) => lines.push(wrappedLine))
      })
  }

  return lines
}

function createSimplePdf(reportLines) {
  const linesPerPage = 42
  const pageHeight = 792
  const startY = 760
  const lineHeight = 16
  const pages = []

  for (let start = 0; start < reportLines.length; start += linesPerPage) {
    pages.push(reportLines.slice(start, start + linesPerPage))
  }

  const objects = []
  const addObject = (content) => {
    objects.push(content)
    return objects.length
  }

  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const contentIds = pages.map((pageLines) => {
    const commands = ['BT', '/F1 11 Tf', `50 ${startY} Td`]
    pageLines.forEach((line, index) => {
      if (index > 0) {
        commands.push(`0 -${lineHeight} Td`)
      }
      commands.push(`(${escapePdfText(line)}) Tj`)
    })
    commands.push('ET')
    const stream = commands.join('\n')
    return addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })

  const pageIds = contentIds.map((contentId) =>
    addObject(
      `<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    )
  )
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ')
  const pagesId = addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`)
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`
  pageIds.forEach((pageId) => {
    objects[pageId - 1] = objects[pageId - 1].replace('PAGES_ID', String(pagesId))
  })

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefPosition = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPosition}\n%%EOF`
  return pdf
}

export default function RedesignedHome() {
  const [enteredWorkspace, setEnteredWorkspace] = useState(false)
  const [health, setHealth] = useState(null)
  const [language, setLanguage] = useState('Tamil')
  const [fileB64, setFileB64] = useState('')
  const [fileName, setFileName] = useState('')
  const [response, setResponse] = useState(null)
  const [responseObj, setResponseObj] = useState(null)
  const [showCard, setShowCard] = useState(true)
  const [showRaw, setShowRaw] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [expandAssessment, setExpandAssessment] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)
  const resultsRef = useRef(null)

  function scrollToSection(id) {
    if (typeof document === 'undefined') return
    const section = document.getElementById(id)
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function scrollToFeatures() {
    scrollToSection('feature-tour')
  }

  async function checkHealth() {
    try {
      const r = await fetch(`${API_BASE_URL}/health`)
      const j = await r.json()
      setHealth(JSON.stringify(j))
    } catch (e) {
      setHealth('error: ' + e.message)
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setNotice(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const b64 = dataUrl.split(',')[1]
      setFileB64(b64)
    }
    reader.readAsDataURL(file)
  }

  function clearSelectedFile() {
    setFileName('')
    setFileB64('')
    setNotice(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    handleFile({ target: { files: [file] } })
  }

  async function sendAnalysis() {
    if (!fileB64) {
      setNotice({
        tone: 'warning',
        message: 'Choose or drag an audio file first to start analysis.',
      })
      return
    }

    setLoading(true)
    setNotice({
      tone: 'info',
      message: 'Running transcription, translation, and compliance analysis.',
    })
    try {
      const body = { language, audioFormat: 'mp3', audioBase64: fileB64 }
      const r = await fetch(`${API_BASE_URL}/api/call-analytics/verbose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': FRONTEND_API_KEY,
        },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        throw new Error(j?.detail || j?.message || 'Analysis failed')
      }
      setResponseObj(j)
      setResponse(null)
      setShowCard(true)
      setShowRaw(false)
      setShowOriginal(false)
      setNotice({
        tone: 'success',
        message: 'Analysis complete. Review the transcript, SOP map, and business signals below.',
      })
    } catch (e) {
      setResponse('error: ' + e.message)
      setResponseObj(null)
      setNotice({
        tone: 'error',
        message: e.message || 'Something went wrong while analyzing the call.',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (enteredWorkspace && !health) {
      checkHealth()
    }
  }, [enteredWorkspace, health])

  useEffect(() => {
    if (responseObj && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [responseObj])

  const complianceScore = responseObj?.sop_validation?.complianceScore
  const scoreLabel =
    typeof complianceScore === 'number'
      ? `${Math.round(complianceScore * 100)}%`
      : complianceScore || 'Pending'

  const qualitySummary = useMemo(() => {
    if (!responseObj?.sop_validation) {
      return 'No call analyzed yet'
    }
    return responseObj.sop_validation.adherenceStatus === 'FOLLOWED'
      ? 'Agent flow appears fully compliant'
      : responseObj.sop_validation.explanation
  }, [responseObj])

  function exportCsvReport() {
    if (!responseObj) return
    const rows = [
      ['Field', 'Value'],
      ['Language', sanitizeReportValue(responseObj.language || language)],
      ['Summary', sanitizeReportValue(responseObj.summary)],
      ['Compliance score', typeof responseObj?.sop_validation?.complianceScore === 'number'
        ? `${Math.round(responseObj.sop_validation.complianceScore * 100)}%`
        : 'Unavailable'],
      ['Adherence status', sanitizeReportValue(responseObj?.sop_validation?.adherenceStatus)],
      ['Greeting', responseObj?.sop_validation?.greeting ? 'Pass' : 'Miss'],
      ['Identification', responseObj?.sop_validation?.identification ? 'Pass' : 'Miss'],
      ['Problem statement', responseObj?.sop_validation?.problemStatement ? 'Pass' : 'Miss'],
      ['Solution offering', responseObj?.sop_validation?.solutionOffering ? 'Pass' : 'Miss'],
      ['Closing', responseObj?.sop_validation?.closing ? 'Pass' : 'Miss'],
      ['Payment preference', sanitizeReportValue(responseObj?.analytics?.paymentPreference)],
      ['Rejection reason', sanitizeReportValue(responseObj?.analytics?.rejectionReason)],
      ['Sentiment', sanitizeReportValue(responseObj?.analytics?.sentiment)],
      ['Keywords', sanitizeReportValue(responseObj?.keywords)],
      ['Transcript', sanitizeReportValue(responseObj?.transcript)],
    ]

    if (responseObj?.speaker_stats) {
      rows.push(['Turns', sanitizeReportValue(responseObj.speaker_stats.turnCount)])
      rows.push([
        'Agent share',
        typeof responseObj.speaker_stats.agentShare === 'number'
          ? `${Math.round(responseObj.speaker_stats.agentShare * 100)}%`
          : 'Unknown',
      ])
      rows.push([
        'Customer share',
        typeof responseObj.speaker_stats.customerShare === 'number'
          ? `${Math.round(responseObj.speaker_stats.customerShare * 100)}%`
          : 'Unknown',
      ])
      rows.push(['Dominant speaker', sanitizeReportValue(responseObj.speaker_stats.dominantSpeaker)])
    }

    if (responseObj?.original_transcript) {
      rows.push([`Original ${language} transcript`, sanitizeReportValue(responseObj.original_transcript)])
    }

    const csv = rows
      .map((row) => row.map((value) => `"${sanitizeReportValue(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    downloadBlob('call-analysis-report.csv', csv, 'text/csv;charset=utf-8;')
  }

  function exportPdfReport() {
    if (!responseObj) return
    const pdf = createSimplePdf(buildReportLines(responseObj, language))
    downloadBlob('call-analysis-report.pdf', pdf, 'application/pdf')
  }

  return (
    <main className="page-shell">
      <div className="page-noise" />
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <section className="topbar panel topbar-panel">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span className="brand-mark-core">
              <span className="brand-orbit" />
              <span className="brand-v brand-v-left" />
              <span className="brand-v brand-v-right" />
              <span className="brand-node brand-node-large" />
              <span className="brand-node brand-node-small" />
            </span>
          </div>
          <div>
            <span className="brand-kicker">
              {enteredWorkspace ? 'Review workspace' : 'Multilingual AI platform'}
            </span>
            <strong className="brand-wordmark">CallComply</strong>
          </div>
        </div>
        <div className={`topbar-actions ${enteredWorkspace ? 'workspace-topbar-actions' : ''}`}>
          <nav className="brand-nav-links" aria-label="Primary">
            <button className="nav-link-button" onClick={() => scrollToSection('feature-tour')} type="button">
              Features
            </button>
            {enteredWorkspace && (
              <>
                <button className="nav-link-button" onClick={() => scrollToSection('workspace-zone')} type="button">
                  Workspace
                </button>
                <button className="nav-link-button" onClick={() => scrollToSection('results-zone')} type="button">
                  Results
                </button>
                <button className="nav-link-button" onClick={() => scrollToSection('qa-zone')} type="button">
                  QA Chat
                </button>
              </>
            )}
          </nav>
          {enteredWorkspace ? (
            <button className="ghost-button" onClick={() => setEnteredWorkspace(false)} type="button">
              Back to landing
            </button>
          ) : (
            <button className="ghost-button" onClick={() => setEnteredWorkspace(true)} type="button">
              Get started
            </button>
          )}
        </div>
      </section>

      {!enteredWorkspace ? (
        <>
          <section className="hero panel premium-hero landing-hero">
            <div className="hero-copy">
              <span className="eyebrow">Multilingual compliance intelligence</span>
              <h1>Review customer calls with the clarity of a modern AI product.</h1>
              <p className="hero-text">
                Upload multilingual call recordings, generate evaluator-friendly
                transcripts, score SOP adherence, and surface payment and sentiment
                signals in one calm workspace.
              </p>

              <div className="hero-actions">
                <button className="primary-button" onClick={() => setEnteredWorkspace(true)} type="button">
                  Get started
                </button>
                <button className="secondary-button" onClick={scrollToFeatures} type="button">
                  Explore features
                </button>
                <button className="ghost-button" onClick={checkHealth} type="button">
                  Check platform status
                </button>
              </div>

              <div className="hero-stats premium-stats">
                {landingStats.map((item) => (
                  <div className="stat-card landing-stat" key={item.label}>
                    <strong>{item.value}</strong>
                    <span className="stat-label">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-stage">
              <div className="signal-frame landing-signal">
                <div className="signal-header">
                  <span className="signal-live">Platform overview</span>
                  <strong>AI</strong>
                </div>
                <div className="signal-grid">
                  {productSignals.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                  <div>
                    <span>Original transcript</span>
                    <strong>One-click view</strong>
                  </div>
                </div>
                <div className="signal-wave">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </section>

          <section className="landing-feature-strip panel" id="feature-tour">
            <div className="features-panel-head">
              <span className="eyebrow">Why teams pick CallComply</span>
              <h2>Essential capabilities, clearly structured</h2>
            </div>
            <div className="features-panel-grid">
              {featureSpotlights.map((item) => (
                <article className="feature-spotlight-card" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="workspace-layout">
            <div className="panel control-panel control-panel-wide" id="workspace-zone">
              <div className="workspace-section-heading">
                <div>
                  <span className="eyebrow">Review setup</span>
                  <h2>Prepare the call for analysis</h2>
                  <p className="workspace-intro">
                    Pick the call language, add an audio sample, and run the pipeline when you are ready.
                  </p>
                </div>
                <button className="secondary-button" onClick={checkHealth} type="button">
                  {health ? 'Refresh platform status' : 'Check platform status'}
                </button>
              </div>

              <div className="workspace-setup-grid">
                <div className="setup-column">
                  <label className="field workspace-field">
                    <span>Call language</span>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option>Tamil</option>
                      <option>Hindi</option>
                    </select>
                  </label>

                  <div className="platform-strip">
                    <div>
                      <span>Pipeline state</span>
                      <strong>{health ? 'Connected to backend' : 'Ready to check backend'}</strong>
                    </div>
                    <div>
                      <span>Prepared sample</span>
                      <strong>{fileName || 'No audio selected'}</strong>
                    </div>
                  </div>
                </div>

                <label
                  className={`upload-card premium-upload workspace-upload ${dragActive ? 'upload-drag-active' : ''}`}
                  onDragEnter={(e) => {
                    e.preventDefault()
                    setDragActive(true)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragActive(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setDragActive(false)
                  }}
                  onDrop={handleDrop}
                >
                  <div className="upload-visual">
                    <div className="upload-orb" />
                    <div className="upload-bars">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                  <input
                    className="upload-input-hidden"
                    id="call-audio-upload"
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleFile}
                  />
                  <div className="upload-actions">
                    <span className={`upload-file-pill ${fileName ? 'selected' : ''}`}>
                      {fileName || 'No file selected'}
                    </span>
                    <div className="upload-action-buttons">
                      <span className="upload-button">Choose audio</span>
                      {fileName && (
                        <button
                          className="upload-clear-button"
                          onClick={(e) => {
                            e.preventDefault()
                            clearSelectedFile()
                          }}
                          type="button"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <span className="upload-kicker">Audio input</span>
                  <strong>{fileName || 'Choose audio to start the analysis flow'}</strong>
                  <small>
                    Use the highlighted button or drag and drop an MP3 here. The call is
                    converted to base64 in the browser and sent through the full compliance
                    intelligence pipeline.
                  </small>
                </label>
              </div>

              <div className="workspace-action-bar">
                <button
                  className="primary-button workspace-primary-button"
                  onClick={sendAnalysis}
                  disabled={loading}
                  type="button"
                >
                  {loading ? 'Running AI workflow...' : 'Analyze conversation'}
                </button>
                <p className="action-hint">
                  {fileName ? `Prepared sample: ${fileName}` : 'Upload an audio sample to start the pipeline'}
                </p>
              </div>

              {notice && (
                <div className={`notice-banner notice-${notice.tone}`}>
                  <strong>{notice.tone === 'success' ? 'Ready' : notice.tone === 'error' ? 'Issue' : notice.tone === 'warning' ? 'Action needed' : 'In progress'}</strong>
                  <span>{notice.message}</span>
                </div>
              )}
            </div>

            <div className="workspace-side-column">
              <div className="panel intelligence-panel intelligence-panel-hero">
                <span className="eyebrow">AI signal</span>
                <h2>What teams see first</h2>

                <div className="intelligence-score">
                  <span>Compliance confidence</span>
                  <strong>{scoreLabel}</strong>
                </div>

                <div className="insight-quote">
                  <span>Assessment</span>
                  <p
                    className={`assessment-text ${expandAssessment ? 'expanded' : ''}`}
                    title={qualitySummary}
                  >
                    {qualitySummary}
                  </p>
                  <button
                    className="assessment-toggle"
                    type="button"
                    onClick={() => setExpandAssessment((value) => !value)}
                  >
                    {expandAssessment ? 'Show less' : 'Show more'}
                  </button>
                </div>
              </div>

              <div id="qa-zone">
                <QAWidget apiKey={FRONTEND_API_KEY} />
              </div>
            </div>
          </section>

          <section className="panel results-panel premium-results" id="results-zone" ref={resultsRef}>
            <div className="panel-heading results-heading">
              <div>
                <span className="eyebrow">Analysis layer</span>
                <h2>Compliance narrative and business extraction</h2>
                <p className="results-intro">
                  Review the translated transcript, inspect SOP coverage, and open raw or native-language detail only when needed.
                </p>
              </div>

              {responseObj && (
                <div className="toolbar">
                  <button
                    className="secondary-button"
                    onClick={() => setShowCard((s) => !s)}
                    type="button"
                  >
                    {showCard ? 'Hide analysis' : 'Show analysis'}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setShowRaw((s) => !s)}
                    type="button"
                  >
                    {showRaw ? 'Hide raw JSON' : 'View raw JSON'}
                  </button>
                  <button className="secondary-button" onClick={exportCsvReport} type="button">
                    Download CSV
                  </button>
                  <button className="secondary-button" onClick={exportPdfReport} type="button">
                    Download PDF
                  </button>
                  {responseObj?.original_transcript && (
                    <button
                      className="secondary-button"
                      onClick={() => setShowOriginal((s) => !s)}
                      type="button"
                    >
                      {showOriginal ? `Hide ${language} transcript` : `Show ${language} transcript`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {!responseObj && !response && (
              <div className="empty-state premium-empty">
                <div className="empty-icon">AI</div>
                <h3>No analysis yet</h3>
                <p>
                  Upload a call to unlock transcript review, compliance logic, payment
                  categorization, sentiment detection, and original-script inspection.
                </p>
              </div>
            )}

            {response && <pre className="error-box">{response}</pre>}

            {responseObj && showCard && (
              <div className="results-stack">
                <div className="summary-card premium-summary">
                  <div className="summary-content">
                    <span className="eyebrow">Executive summary</span>
                    <h3>Conversation summary</h3>
                    <p className="summary-text">{responseObj.summary || 'Analysis summary'}</p>
                  </div>
                  <div className="score-pill premium-pill">{scoreLabel}</div>
                </div>

                <div className="result-grid premium-result-grid">
                  <article className="result-card transcript-card transcript-wide">
                    <div className="card-topline">
                      <span>Transcript block</span>
                      <strong>{responseObj.language}</strong>
                    </div>
                    <h3>Evaluator-friendly transcript</h3>
                    {responseObj?.speaker_stats && (
                      <div className="speaker-stats-row">
                        <span className="speaker-stat-chip">
                          Turns: {responseObj.speaker_stats.turnCount ?? 'Unknown'}
                        </span>
                        <span className="speaker-stat-chip">
                          Agent share: {typeof responseObj.speaker_stats.agentShare === 'number'
                            ? `${Math.round(responseObj.speaker_stats.agentShare * 100)}%`
                            : 'Unknown'}
                        </span>
                        <span className="speaker-stat-chip">
                          Customer share: {typeof responseObj.speaker_stats.customerShare === 'number'
                            ? `${Math.round(responseObj.speaker_stats.customerShare * 100)}%`
                            : 'Unknown'}
                        </span>
                        <span className="speaker-stat-chip">
                          Dominant: {responseObj.speaker_stats.dominantSpeaker || 'Unknown'}
                        </span>
                      </div>
                    )}
                    <p>{responseObj.transcript || 'No transcript returned.'}</p>
                  </article>

                  <article className="result-card">
                    <div className="card-topline">
                      <span>SOP scoring</span>
                      <strong>{responseObj.sop_validation?.adherenceStatus || 'Pending'}</strong>
                    </div>
                    <h3>Script adherence map</h3>
                    <div className="checklist">
                      {sopFields.map(({ key, label }) => {
                        const value = responseObj.sop_validation?.[key]
                        const passed = Boolean(value)
                        return (
                          <div className="check-item" key={key}>
                            <span className={`status-badge ${passed ? 'pass' : 'fail'}`}>
                              {passed ? 'Pass' : 'Miss'}
                            </span>
                            <span>{label}</span>
                          </div>
                        )
                      })}
                    </div>
                  </article>

                  <article className="result-card">
                    <div className="card-topline">
                      <span>Business extraction</span>
                      <strong>Structured</strong>
                    </div>
                    <h3>Commercial intent</h3>
                    <div className="metric-list">
                      {analyticsFields.map(({ key, label }) => (
                        <div className="metric-row" key={key}>
                          <span>{label}</span>
                          <strong>{responseObj.analytics?.[key] || 'Unavailable'}</strong>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="result-card">
                    <div className="card-topline">
                      <span>Keyword layer</span>
                      <strong>{responseObj.keywords?.length || 0}</strong>
                    </div>
                    <h3>Conversation anchors</h3>
                    <div className="keyword-wrap">
                      {(responseObj.keywords || []).length > 0 ? (
                        responseObj.keywords.map((keyword, index) => (
                          <span className="keyword-chip" key={`${keyword}-${index}`}>
                            {keyword}
                          </span>
                        ))
                      ) : (
                        <p className="muted-text">No keywords returned.</p>
                      )}
                    </div>
                  </article>
                </div>
              </div>
            )}

          </section>

          {showRaw && responseObj && (
            <div className="overlay-backdrop" onClick={() => setShowRaw(false)}>
              <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
                <div className="overlay-header">
                  <h3>Raw JSON</h3>
                  <button className="secondary-button" onClick={() => setShowRaw(false)} type="button">
                    Close
                  </button>
                </div>
                <pre className="overlay-content raw-box">{JSON.stringify(responseObj, null, 2)}</pre>
              </div>
            </div>
          )}

          {showOriginal && responseObj?.original_transcript && (
            <div className="overlay-backdrop" onClick={() => setShowOriginal(false)}>
              <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
                <div className="overlay-header">
                  <h3>{language} transcript</h3>
                  <button className="secondary-button" onClick={() => setShowOriginal(false)} type="button">
                    Close
                  </button>
                </div>
                <pre className="overlay-content original-box premium-original">{responseObj.original_transcript}</pre>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
