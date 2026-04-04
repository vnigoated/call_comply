import { useEffect, useMemo, useState } from 'react'

const diagramMarkup = `
%%{init: {'theme':'base','themeVariables': {'background':'#ffffff','primaryTextColor':'#111827','lineColor':'#374151','fontFamily':'IBM Plex Sans'}}}%%
flowchart LR
  classDef client fill:#FFF4E6,stroke:#C2410C,stroke-width:1.5px,color:#7C2D12;
  classDef frontend fill:#E0F2FE,stroke:#0369A1,stroke-width:1.5px,color:#0C4A6E;
  classDef backend fill:#ECFDF5,stroke:#047857,stroke-width:1.5px,color:#064E3B;
  classDef ai fill:#F5F3FF,stroke:#6D28D9,stroke-width:1.5px,color:#4C1D95;
  classDef data fill:#FEFCE8,stroke:#A16207,stroke-width:1.5px,color:#713F12;
  classDef security fill:#FEE2E2,stroke:#B91C1C,stroke-width:1.5px,color:#7F1D1D;

  U[Evaluator or QA Manager]:::client --> BROWSER[Web Browser]:::client

  subgraph FE[Next.js Frontend on Vercel]
    UI[Landing and Workspace UI]:::frontend
    QA[QA Widget]:::frontend
    EXPORT[CSV and PDF Export]:::frontend
    UI --> QA
    UI --> EXPORT
  end

  BROWSER --> UI

  KEY[x-api-key Validation]:::security
  ENVFE[Frontend Env Vars]:::security
  UI --> ENVFE --> KEY
  QA --> KEY

  subgraph BE[FastAPI Backend on Render]
    API1[POST /api/call-analytics]:::backend
    API2[POST /api/call-analytics/verbose]:::backend
    API3[GET /api/transcripts/search]:::backend
    API4[POST /api/qa]:::backend
    HEALTH[GET /health]:::backend
    VALID[Pydantic Validation]:::backend
    RULES[SOP Rule Engine]:::backend

    API1 --> VALID
    API2 --> VALID
    API3 --> VALID
    API4 --> VALID
    VALID --> RULES
  end

  KEY --> API1
  KEY --> API2
  KEY --> API3
  KEY --> API4
  BROWSER --> HEALTH

  subgraph PIPE[Transcription and Analysis Pipeline]
    DECODE[Decode Base64 MP3]:::backend
    STT[AssemblyAI Transcription]:::ai
    TRANS[Translation Provider Flow]:::ai
    CLEAN[Cleanup and Speaker Normalization]:::backend
    NLP[Groq Structured NLP]:::ai
    DECODE --> STT --> TRANS --> CLEAN --> NLP
  end

  API1 --> DECODE
  API2 --> DECODE

  OUTPUT[Structured JSON Output]:::backend
  NLP --> OUTPUT
  RULES --> OUTPUT

  subgraph VS[Vector Index Layer]
    VEC[vector_store.py]:::data
    DB[(SQLite transcripts.db)]:::data
    INDEX[Embedding and Indexing]:::data
    SEARCH[Semantic Search and QA Retrieval]:::data
    VEC --> INDEX --> DB
    DB --> SEARCH
  end

  OUTPUT --> INDEX
  API3 --> SEARCH
  API4 --> SEARCH
  SEARCH --> NLP
`

export default function ArchitectureDiagram() {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const renderId = useMemo(() => `architecture-${Math.random().toString(36).slice(2)}`, [])

  useEffect(() => {
    let active = true

    async function renderDiagram() {
      try {
        const mermaidModule = await import('mermaid')
        const mermaid = mermaidModule.default

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'base',
        })

        const { svg: renderedSvg } = await mermaid.render(renderId, diagramMarkup)
        if (active) {
          setSvg(renderedSvg)
          setError('')
        }
      } catch (err) {
        if (active) {
          setError(err?.message || 'Unable to render architecture diagram right now.')
        }
      }
    }

    renderDiagram()

    return () => {
      active = false
    }
  }, [renderId])

  return (
    <div className="architecture-diagram-shell" role="img" aria-label="End-to-end architecture diagram">
      {error && <p className="architecture-diagram-error">{error}</p>}
      {!error && !svg && <p className="architecture-diagram-loading">Rendering architecture diagram...</p>}
      {!error && svg && <div className="architecture-diagram-canvas" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  )
}
